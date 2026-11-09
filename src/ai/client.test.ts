import { describe, expect, it, vi } from 'vitest';
import { AiClient, AiError } from './client';
import type { AiHealth } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const wav = () => new Response(new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }), { status: 200 });

const health = (over: Partial<AiHealth['models']> = {}): AiHealth => ({
  ok: true,
  service: 'psalmist-ai',
  api_version: '1.0.0',
  uptime_s: 5,
  device: 'cuda',
  gpu: { name: 'RTX 3060', vram_total_mb: 12287, vram_free_mb: 10000, compute_capability: '8.6' },
  models: {
    denoise: { name: 'DeepFilterNet3', status: 'ready', license: 'MIT' },
    separate: { name: 'htdemucs', status: 'ready', license: 'MIT' },
    accompany: { name: 'amt', status: 'ready', license: 'Apache-2.0' },
    ...over,
  },
  versions: {},
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const mockFetch = (h: Handler) => vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => h(String(url), init)) as unknown as typeof fetch;
const client = (h: Handler, extra = {}) => new AiClient({ fetchImpl: mockFetch(h), pollMs: 1, ...extra });

describe('AiClient offline handling', () => {
  it('health() resolves null when the service is down (no throw)', async () => {
    const c = client(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await c.health()).toBeNull();
    const st = await c.status();
    expect(st.state).toBe('offline');
    expect(st.available).toEqual({ denoise: false, separate: false, accompany: false });
  });

  it('denoise() rejects with AiError code offline', async () => {
    const c = client(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(c.denoise(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ name: 'AiError', code: 'offline' });
  });
});

describe('status', () => {
  it('ready / loading / partial', async () => {
    expect((await client(() => json(health())).status()).state).toBe('ready');
    const loading = await client(() => json(health({ accompany: { name: 'a', status: 'loading', license: 'x' } }))).status();
    expect(loading.state).toBe('loading');
    expect(loading.available.denoise).toBe(true);
    expect(loading.available.accompany).toBe(false);
  });
});

describe('denoise', () => {
  it('posts multipart to /denoise and returns a wav blob', async () => {
    let seen: { url: string; body?: FormData } = { url: '' };
    const c = client((url, init) => {
      seen = { url, body: init?.body as FormData };
      return wav();
    });
    const progress: number[] = [];
    const out = await c.denoise(new Blob([new Uint8Array(10)]), { attenLimDb: 12, onProgress: (p) => progress.push(p) });
    expect(seen.url).toBe('http://127.0.0.1:5175/denoise');
    expect(seen.body!.get('atten_lim_db')).toBe('12');
    expect(seen.body!.get('file')).toBeInstanceOf(Blob);
    expect(out.type).toBe('audio/wav');
    expect(progress).toEqual([0, 1]);
  });

  it('maps 4xx to bad_request with the server detail', async () => {
    const c = client(() => json({ detail: 'Cannot decode audio' }, 400));
    const e = await c.denoise(new Uint8Array(4)).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe('bad_request');
    expect(e.message).toContain('Cannot decode');
  });

  it('maps 5xx to server', async () => {
    const e = await client(() => json({ detail: 'boom' }, 500)).denoise(new Uint8Array(4)).catch((x) => x);
    expect(e.code).toBe('server');
  });

  it('times out', async () => {
    const c = client((_u, init) => new Promise<Response>((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))));
    const e = await c.denoise(new Uint8Array(4), { timeoutMs: 20 }).catch((x) => x);
    expect(e.code).toBe('timeout');
  });

  it('honours the caller AbortSignal', async () => {
    const ctl = new AbortController();
    const c = client((_u, init) => new Promise<Response>((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))));
    const p = c.denoise(new Uint8Array(4), { signal: ctl.signal, timeoutMs: 5000 });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('separate (job polling)', () => {
  it('polls progress and downloads both stems', async () => {
    let polls = 0;
    const c = client((url) => {
      if (url.endsWith('/separate')) return json({ job_id: 'j1', status: 'queued', progress: 0, files: {}, result: null, error: null, elapsed_ms: null }, 202);
      if (url.endsWith('/jobs/j1')) {
        polls++;
        return polls < 3
          ? json({ job_id: 'j1', status: 'running', progress: polls / 4, files: {}, result: null, error: null, elapsed_ms: null })
          : json({
              job_id: 'j1', status: 'done', progress: 1, error: null, elapsed_ms: 900,
              result: { seconds: 12, model_ms: 507 },
              files: { vocals: '/jobs/j1/files/vocals', accompaniment: '/jobs/j1/files/accompaniment' },
            });
      }
      if (url.includes('/files/')) return wav();
      return json({}, 404);
    });
    const prog: number[] = [];
    const r = await c.separate(new Uint8Array(8), { onProgress: (p) => prog.push(p) });
    expect(r.vocals!.size).toBe(4);
    expect(r.accompaniment!.size).toBe(4);
    expect(r.modelMs).toBe(507);
    expect(prog[0]).toBe(0);
    expect(prog.at(-1)).toBe(1);
    expect(prog.some((p) => p > 0 && p < 1)).toBe(true);
  });

  it('surfaces job errors', async () => {
    const c = client((url) =>
      url.endsWith('/separate')
        ? json({ job_id: 'j2', status: 'error', progress: 0, error: 'CUDA out of memory', files: {}, result: null, elapsed_ms: 1 }, 202)
        : json({}, 404),
    );
    await expect(c.separate(new Uint8Array(8))).rejects.toMatchObject({ code: 'server', message: 'CUDA out of memory' });
  });
});

describe('accompany', () => {
  it('sends params, decodes base64 MIDI candidates', async () => {
    let params: any;
    const midiB64 = btoa(String.fromCharCode(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6));
    const c = client((url, init) => {
      if (url.endsWith('/accompany')) {
        params = JSON.parse((init!.body as FormData).get('params') as string);
        return json({ job_id: 'a1', status: 'queued', progress: 0, files: {}, result: null, error: null, elapsed_ms: null }, 202);
      }
      return json({
        job_id: 'a1', status: 'done', progress: 1, error: null, elapsed_ms: 1500, files: {},
        result: {
          bars: 16, bpm: 76, meter: '3/4', total_seconds: 38.68,
          candidates: [{ index: 0, seed: 7, midi_base64: midiB64, notes: 90, programs: [0, 48], gen_ms: 1400 }],
        },
      });
    });
    const r = await c.accompany({
      melodyMidi: new Uint8Array([1]), key: 'G', meter: '3/4', bpm: 76, bars: 16, chords: ['G', 'G7', 'C'],
      pickupBeats: 1, style: 'worship', nCandidates: 2, seed: 7,
    });
    expect(params).toMatchObject({ key: 'G', mode: 'major', meter: '3/4', pickup_beats: 1, n_candidates: 2, seed: 7, style: 'worship' });
    expect(r.candidates).toHaveLength(1);
    expect(Array.from(r.candidates[0].midi.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]); // "MThd"
    expect(r.candidates[0].genMs).toBe(1400);
    expect(r.totalSeconds).toBeCloseTo(38.68);
    expect(r.elapsedMs).toBe(1500);
  });

  it('bad chord chart -> bad_request', async () => {
    const c = client(() => json({ detail: 'Bad request: ValueError: Bad chord symbol' }, 400));
    await expect(
      c.accompany({ melodyMidi: new Uint8Array([1]), key: 'G', meter: '4/4', bpm: 90, bars: 1, chords: ['??'] }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('separate options, cancel, cache', () => {
  const doneJob = (files: Record<string, string>, result: Record<string, unknown>) => ({
    job_id: 's1', status: 'done', progress: 1, error: null, elapsed_ms: 100, files, result,
  });

  it('sends model/two_stems/shifts and returns every stem + cacheKey', async () => {
    let fields: Record<string, string> = {};
    const c = client((url, init) => {
      if (url.endsWith('/separate')) {
        for (const [k, v] of (init!.body as FormData).entries()) fields[k] = String(v);
        return json(doneJob({ drums: '/cache/k/drums.wav', bass: '/cache/k/bass.wav', other: '/cache/k/other.wav', vocals: '/cache/k/vocals.wav' },
          { cache_key: 'k', cache_hit: true, model: 'htdemucs_ft', residual_db: -32.1, seconds: 10, model_ms: 900 }), 202);
      }
      return wav();
    });
    const r = await c.separate(new Uint8Array(4), { model: 'htdemucs_ft', twoStems: 'all', shifts: 2, overlap: 0.5, format: 'pcm24' });
    expect(fields).toMatchObject({ model: 'htdemucs_ft', two_stems: 'all', shifts: '2', overlap: '0.5', format: 'pcm24', wait: 'false' });
    expect(Object.keys(r.stems).sort()).toEqual(['bass', 'drums', 'other', 'vocals']);
    expect(r.cacheKey).toBe('k');
    expect(r.cacheHit).toBe(true);
    expect(r.residualDb).toBe(-32.1);
    expect(c.stemUrl('k', 'bass')).toBe('http://127.0.0.1:5175/cache/k/bass.wav');
  });

  it('abort during polling cancels the job on the server', async () => {
    const ctl = new AbortController();
    const calls: string[] = [];
    const c = client((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('http://127.0.0.1:5175', '')}`);
      if (url.endsWith('/separate')) return json({ job_id: 'x9', status: 'running', progress: 0.1, files: {}, result: null, error: null, elapsed_ms: null }, 202);
      if (url.endsWith('/jobs/x9')) {
        ctl.abort();
        return json({ job_id: 'x9', status: 'running', progress: 0.2, files: {}, result: null, error: null, elapsed_ms: null });
      }
      return json({ job_id: 'x9', status: 'cancelled', progress: 0.2, files: {}, result: null, error: null, elapsed_ms: 1 });
    });
    await expect(c.separate(new Uint8Array(4), { signal: ctl.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(calls).toContain('POST /jobs/x9/cancel');
  });

  it('a server-cancelled job surfaces as aborted', async () => {
    const c = client(() => json({ job_id: 'c1', status: 'cancelled', progress: 0, files: {}, result: null, error: null, elapsed_ms: 1 }, 202));
    await expect(c.separate(new Uint8Array(4))).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('analysis, practice, batch', () => {
  it('analyzeSong posts the file + options and returns the job result', async () => {
    let fields: Record<string, string> = {};
    const c = client((url, init) => {
      if (url.endsWith('/analyze/song')) {
        for (const [k, v] of (init!.body as FormData).entries()) fields[k] = typeof v === 'string' ? v : 'blob';
        return json({ job_id: 'a', status: 'done', progress: 1, error: null, elapsed_ms: 5, files: {},
          result: { cache_key: 'k', rhythm: { ok: true, pulse_bpm: 86.6, beats_per_bar: 4, downbeats: [1, 3.77] }, key: { key: 'G', mode: 'minor', confidence: 0.8 }, vocals: { url: '/cache/k/vocals.wav' } } }, 202);
      }
      return json({}, 404);
    });
    const r = await c.analyzeSong({ audio: new Uint8Array(4), chords: 'templates' });
    expect(fields).toMatchObject({ file: 'blob', model: 'htdemucs', chords: 'templates' });
    expect(r.rhythm.downbeats).toEqual([1, 3.77]);
    expect(r.vocals?.url).toBe('/cache/k/vocals.wav');
    await expect(c.analyzeSong({})).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('analyzePart posts cache_key and beats_per_bar', async () => {
    let body: FormData | undefined;
    const c = client((url, init) => {
      body = init!.body as FormData;
      return json({ ok: true, key: url.split('/').pop() });
    });
    await c.analyzePart('rhythm', 'k1', { beatsPerBar: 3 });
    expect(body!.get('cache_key')).toBe('k1');
    expect(body!.get('beats_per_bar')).toBe('3');
  });

  it('practice validates ranges locally and posts stems/semitones/tempo', async () => {
    let body: FormData | undefined;
    const c = client((_u, init) => {
      body = init!.body as FormData;
      return wav();
    });
    const out = await c.practice({ cacheKey: 'k', stems: ['drums', 'bass', 'other'], semitones: -2, tempo: 0.85 });
    expect(out.type).toBe('audio/wav');
    expect(body!.get('stems')).toBe('drums,bass,other');
    expect(body!.get('semitones')).toBe('-2');
    expect(body!.get('tempo')).toBe('0.85');
    await expect(c.practice({ cacheKey: 'k', semitones: 7 })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(c.practice({ cacheKey: 'k', tempo: 1.5 })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(c.practice({})).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('batch returns the statistics result', async () => {
    const c = client((url) =>
      url.endsWith('/batch')
        ? json({ job_id: 'b', status: 'done', progress: 1, error: null, elapsed_ms: 9, files: {}, result: { aggregate: { songs: 2 }, songs: [], stats_file: 'x.json' } }, 202)
        : json({}, 404),
    );
    const r = await c.batch('D:/songs', { model: 'htdemucs' });
    expect(r.aggregate).toEqual({ songs: 2 });
  });
});

describe('A6 endpoints', () => {
  it('beats / structure / pitch post the file and parse JSON', async () => {
    const seen: string[] = [];
    let pitchBody: FormData | undefined;
    const c = client((url, init) => {
      seen.push(url.replace('http://127.0.0.1:5175', ''));
      if (url.endsWith('/pitch')) pitchBody = init!.body as FormData;
      if (url.endsWith('/beats')) return json({ ok: true, bpm: 86.7, beats_per_bar: 4, bar_seconds: 2.77, beats: [0.5], downbeats: [0.5], tempo_map: [], method: 'Beat This!', elapsed_ms: 5 });
      if (url.endsWith('/structure')) return json({ ok: true, segments: [{ start: 0, end: 20, bars: 8, label: 'verse', section_type: 'strofa', cluster: 1 }], beats: [], downbeats: [], bpm: 90, beats_per_bar: 4, bar_seconds: 2.6, method: 'x', elapsed_ms: 9 });
      return json({ hop_ms: 10, frames: 2, model: 'torchcrepe-full', f0_hz: [0, 220], voicing: [0.1, 0.9], voiced: [false, true], elapsed_ms: 3 });
    });
    expect((await c.beats(new Uint8Array(4))).bpm).toBe(86.7);
    expect((await c.structure(new Uint8Array(4), { minBars: 8 })).segments[0].section_type).toBe('strofa');
    const p = await c.pitch(new Uint8Array(4), { model: 'tiny', fmin: 70, voicingThreshold: 0.4 });
    expect(p.f0_hz).toEqual([0, 220]);
    expect(pitchBody!.get('model')).toBe('tiny');
    expect(pitchBody!.get('voicing_threshold')).toBe('0.4');
    expect(seen).toEqual(['/beats', '/structure', '/pitch']);
  });

  it('restore returns a wav blob and sends the mode', async () => {
    let mode: unknown;
    const c = client((_u, init) => {
      mode = (init!.body as FormData).get('mode');
      return wav();
    });
    const b = await c.restore(new Uint8Array(4), { mode: 1 });
    expect(b.type).toBe('audio/wav');
    expect(mode).toBe('1');
  });

  it('assistantPatch sends prompt + context and returns the validated patch', async () => {
    let fd: FormData | undefined;
    const c = client((_u, init) => {
      fd = init!.body as FormData;
      return json({ valid: true, patch: { genre: 'rock', bpm: 120 }, rejected: [], explanation: 'ok', elapsed_ms: 1300 });
    });
    const r = await c.assistantPatch('rock la 120', { current: { bpm: 90 } });
    expect(fd!.get('task')).toBe('patch');
    expect(JSON.parse(fd!.get('context') as string)).toEqual({ bpm: 90 });
    expect(r.patch.genre).toBe('rock');
  });

  it('assistant offline / not installed map to AiError', async () => {
    const down = client(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(down.assistantAsk('explain', 'ce e un acord?')).rejects.toMatchObject({ code: 'offline' });
    const missing = client(() => json({ detail: 'Local LLM not installed' }, 503));
    await expect(missing.assistantPatch('x')).rejects.toMatchObject({ code: 'not_ready' });
  });
});
