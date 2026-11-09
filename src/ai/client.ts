import type {
  AccompanyCandidate,
  AccompanyRequest,
  AccompanyResult,
  AccompanyStyles,
  AnalysisParts,
  AssistantPatch,
  AssistantStatus,
  AssistantTask,
  AssistantText,
  BeatsResult,
  PitchOptions,
  PitchResult,
  StructureResult,
  BatchResult,
  PracticeRequest,
  SeparateModels,
  SeparateOptions,
  SongAnalysis,
  AiErrorCode,
  AiHealth,
  AiState,
  AiStatus,
  AudioInput,
  DenoiseOptions,
  RequestOptions,
  SeparateResult,
} from './types';

export const AI_BASE_URL = 'http://127.0.0.1:5175';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;
  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

export interface AiClientConfig {
  baseUrl?: string;
  /** injectable for tests; defaults to globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** poll interval for long jobs (ms), default 400 */
  pollMs?: number;
  timeouts?: Partial<{ health: number; denoise: number; separate: number; accompany: number }>;
}

const DEFAULT_TIMEOUTS = { health: 2500, denoise: 120_000, separate: 900_000, accompany: 120_000 };

interface JobJson {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  error: string | null;
  result: Record<string, any> | null;
  elapsed_ms: number | null;
  files: Record<string, string>;
}

function toBlob(x: AudioInput | Blob, type: string): Blob {
  if (x instanceof Blob) return x;
  // copy into a plain ArrayBuffer-backed view so Blob accepts it under any TS lib typing
  const u8 = x instanceof Uint8Array ? x : new Uint8Array(x);
  return new Blob([u8.slice().buffer as ArrayBuffer], { type });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class AiClient {
  readonly baseUrl: string;
  private readonly f: typeof fetch;
  private readonly pollMs: number;
  private readonly timeouts: typeof DEFAULT_TIMEOUTS;

  constructor(cfg: AiClientConfig = {}) {
    this.baseUrl = (cfg.baseUrl ?? AI_BASE_URL).replace(/\/$/, '');
    this.f = cfg.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.pollMs = cfg.pollMs ?? 400;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...cfg.timeouts };
  }

  // ------------------------------------------------------------------ low level

  /** fetch with timeout + caller abort; maps network failures to AiError('offline'). */
  private async request(path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    const onAbort = () => ctl.abort();
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const res = await this.f(this.baseUrl + path, { ...init, signal: ctl.signal });
      if (!res.ok) throw await this.httpError(res);
      return res;
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (timedOut) throw new AiError('timeout', `AI service did not answer within ${Math.round(timeoutMs / 1000)} s`);
      if (signal?.aborted || (e as Error)?.name === 'AbortError') throw new AiError('aborted', 'Request aborted');
      throw new AiError('offline', 'AI service is not running (start ai-service\\start-ai.cmd)');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async httpError(res: Response): Promise<AiError> {
    let detail = res.statusText;
    try {
      const j = await res.json();
      if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* not JSON */
    }
    if (res.status === 503) return new AiError('not_ready', detail || 'Models are still loading', res.status);
    if (res.status >= 400 && res.status < 500) return new AiError('bad_request', detail, res.status);
    return new AiError('server', detail || `HTTP ${res.status}`, res.status);
  }

  /** Runs a background job to completion; reports progress; downloads nothing. */
  private async runJob(path: string, body: FormData, timeoutMs: number, opts: RequestOptions): Promise<JobJson> {
    const t0 = Date.now();
    const left = () => Math.max(1000, timeoutMs - (Date.now() - t0));
    body.append('wait', 'false');
    opts.onProgress?.(0);
    let job = (await (await this.request(path, { method: 'POST', body }, left(), opts.signal)).json()) as JobJson;
    const id = job.job_id;
    try {
      while (job.status === 'queued' || job.status === 'running') {
        if (Date.now() - t0 > timeoutMs) throw new AiError('timeout', 'AI job timed out');
        await this.sleep(this.pollMs, opts.signal);
        job = (await (await this.request(`/jobs/${id}`, {}, left(), opts.signal)).json()) as JobJson;
        opts.onProgress?.(Math.min(0.99, job.progress ?? 0));
      }
    } catch (e) {
      if (e instanceof AiError && (e.code === 'aborted' || e.code === 'timeout')) await this.cancelJob(id);
      throw e;
    }
    if (job.status === 'cancelled') throw new AiError('aborted', 'Job cancelled');
    if (job.status === 'error') throw new AiError('server', job.error ?? 'AI job failed');
    opts.onProgress?.(1);
    return job;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new AiError('aborted', 'Request aborted'));
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new AiError('aborted', 'Request aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // ------------------------------------------------------------------ public API

  /** Never throws: returns null when the service is unreachable. */
  async health(opts: Pick<RequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<AiHealth | null> {
    try {
      const res = await this.request('/health', {}, opts.timeoutMs ?? this.timeouts.health, opts.signal);
      return (await res.json()) as AiHealth;
    } catch {
      return null;
    }
  }

  /** Coarse status for the UI (offline / loading / ready / error + per-feature availability). */
  async status(opts: Pick<RequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<AiStatus> {
    const health = await this.health(opts);
    if (!health) return { state: 'offline', health: null, available: { denoise: false, separate: false, accompany: false } };
    const m = health.models;
    const available = {
      denoise: m.denoise.status === 'ready',
      separate: m.separate.status === 'ready',
      accompany: m.accompany.status === 'ready',
    };
    const all = Object.values(m);
    let state: AiState = 'ready';
    if (all.some((x) => x.status === 'idle' || x.status === 'loading')) state = 'loading';
    else if (!all.some((x) => x.status === 'ready')) state = 'error';
    return { state, health, available };
  }

  /** WAV/MP3 in -> cleaned WAV (same sample rate/channels). ~0.15 s per 12 s of audio on the RTX 3060. */
  async denoise(audio: AudioInput, opts: DenoiseOptions = {}): Promise<Blob> {
    const fd = new FormData();
    fd.append('file', toBlob(audio, 'audio/wav'), 'input.wav');
    if (opts.attenLimDb != null) fd.append('atten_lim_db', String(opts.attenLimDb));
    opts.onProgress?.(0);
    const res = await this.request('/denoise', { method: 'POST', body: fd }, opts.timeoutMs ?? this.timeouts.denoise, opts.signal);
    const blob = await res.blob();
    opts.onProgress?.(1);
    return blob.type === 'audio/wav' ? blob : new Blob([blob], { type: 'audio/wav' });
  }

  /**
   * Whole song in -> WAV stems (Demucs). Default = htdemucs two-stems (vocals + accompaniment).
   * Pass `model`, `twoStems` ('vocals' | 'drums' | ... | 'all'), `shifts`, `overlap`, `segment`, `format`.
   * Results are cached server-side by file hash + parameters (`cacheHit`). Abort the signal to cancel the job.
   */
  async separate(audio: AudioInput, opts: SeparateOptions = {}): Promise<SeparateResult> {
    const timeout = opts.timeoutMs ?? this.timeouts.separate;
    const fd = new FormData();
    fd.append('file', toBlob(audio, 'audio/wav'), 'song.wav');
    fd.append('model', opts.model ?? 'htdemucs');
    fd.append('two_stems', opts.twoStems ?? 'vocals');
    if (opts.shifts != null) fd.append('shifts', String(opts.shifts));
    if (opts.overlap != null) fd.append('overlap', String(opts.overlap));
    if (opts.segment != null) fd.append('segment', String(opts.segment));
    if (opts.format) fd.append('format', opts.format);
    const job = await this.runJob('/separate', fd, timeout, opts);
    const names = Object.keys(job.files);
    const blobs = await Promise.all(
      names.map(async (n) => (await this.request(job.files[n], {}, this.timeouts.denoise, opts.signal)).blob()),
    );
    const stems: Record<string, Blob> = {};
    names.forEach((n, i) => (stems[n] = blobs[i]));
    const r = job.result ?? {};
    return {
      stems,
      vocals: stems.vocals,
      accompaniment: stems.accompaniment,
      cacheKey: r.cache_key ?? '',
      cacheHit: !!r.cache_hit,
      model: r.model ?? opts.model ?? 'htdemucs',
      residualDb: r.residual_db ?? null,
      seconds: r.seconds ?? 0,
      modelMs: r.model_ms ?? job.elapsed_ms ?? 0,
    };
  }

  /** Available Demucs models + output formats. */
  async separateModels(opts: Pick<RequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<SeparateModels> {
    return (await (await this.request('/separate/models', {}, opts.timeoutMs ?? this.timeouts.health, opts.signal)).json()) as SeparateModels;
  }

  /** URL of a cached stem (usable in <audio src> / fetch). */
  stemUrl(cacheKey: string, stem: string): string {
    return `${this.baseUrl}/cache/${cacheKey}/${stem}.wav`;
  }

  /** Cancel a running/queued job (best effort; never throws). */
  async cancelJob(jobId: string): Promise<void> {
    try {
      await this.request(`/jobs/${jobId}/cancel`, { method: 'POST' }, this.timeouts.health);
    } catch {
      /* ignore */
    }
  }

  /**
   * "Învață din cântec": separate (all stems, or reuse `cacheKey`) then analyse drums (tempo map, downbeats, groove),
   * bass (notes, chord roots), harmonic stems (chord chart), key. `vocals` is the hand-off stem for "Din vocea completă".
   */
  async analyzeSong(input: { audio?: AudioInput; cacheKey?: string; model?: string; shifts?: number; chords?: 'auto' | 'chordino' | 'templates' },
    opts: RequestOptions = {}): Promise<SongAnalysis> {
    if (!input.audio && !input.cacheKey) throw new AiError('bad_request', 'audio or cacheKey required');
    const fd = new FormData();
    if (input.audio) fd.append('file', toBlob(input.audio, 'audio/wav'), 'song.wav');
    if (input.cacheKey) fd.append('cache_key', input.cacheKey);
    fd.append('model', input.model ?? 'htdemucs');
    if (input.shifts != null) fd.append('shifts', String(input.shifts));
    fd.append('chords', input.chords ?? 'auto');
    const job = await this.runJob('/analyze/song', fd, opts.timeoutMs ?? this.timeouts.separate, opts);
    return job.result as unknown as SongAnalysis;
  }

  /** Re-run one analysis on a cached separation (rhythm | bass | chords | key). */
  async analyzePart<K extends 'rhythm' | 'bass' | 'chords' | 'key'>(kind: K, cacheKey: string,
    opts: RequestOptions & { beatsPerBar?: number } = {}): Promise<AnalysisParts[K]> {
    const fd = new FormData();
    fd.append('cache_key', cacheKey);
    if (opts.beatsPerBar != null) fd.append('beats_per_bar', String(opts.beatsPerBar));
    const res = await this.request(`/analyze/${kind}`, { method: 'POST', body: fd }, opts.timeoutMs ?? this.timeouts.denoise, opts.signal);
    return (await res.json()) as AnalysisParts[K];
  }

  /** Transpose (-6..+6 semitones) / tempo (0.70..1.20) of the sum of cached stems, or of an uploaded file. WAV out. */
  async practice(req: PracticeRequest, opts: RequestOptions = {}): Promise<Blob> {
    if (req.semitones != null && (req.semitones < -6 || req.semitones > 6)) throw new AiError('bad_request', 'semitones must be within -6..6');
    if (req.tempo != null && (req.tempo < 0.7 || req.tempo > 1.2)) throw new AiError('bad_request', 'tempo must be within 0.70..1.20');
    const fd = new FormData();
    if (req.cacheKey) {
      fd.append('cache_key', req.cacheKey);
      fd.append('stems', (req.stems ?? ['no_vocals']).join(','));
    } else if (req.audio) fd.append('file', toBlob(req.audio, 'audio/wav'), 'in.wav');
    else throw new AiError('bad_request', 'cacheKey or audio required');
    fd.append('semitones', String(req.semitones ?? 0));
    fd.append('tempo', String(req.tempo ?? 1));
    if (req.format) fd.append('format', req.format);
    const res = await this.request('/practice', { method: 'POST', body: fd }, opts.timeoutMs ?? this.timeouts.denoise, opts.signal);
    return new Blob([await res.blob()], { type: 'audio/wav' });
  }

  /** Separate + analyse every audio file in a local folder; the service keeps statistics only. */
  async batch(folder: string, opts: RequestOptions & { model?: string; shifts?: number } = {}): Promise<BatchResult> {
    const fd = new FormData();
    fd.append('folder', folder);
    fd.append('model', opts.model ?? 'htdemucs');
    if (opts.shifts != null) fd.append('shifts', String(opts.shifts));
    const job = await this.runJob('/batch', fd, opts.timeoutMs ?? 24 * 3600_000, opts);
    return job.result as unknown as BatchResult;
  }

  /** Melody + chord chart -> candidate accompaniment MIDI files (Anticipatory Music Transformer). */
  async accompany(req: AccompanyRequest, opts: RequestOptions = {}): Promise<AccompanyResult> {
    const params: Record<string, unknown> = {
      key: req.key,
      mode: req.mode ?? 'major',
      meter: req.meter,
      bpm: req.bpm,
      bars: req.bars,
      chords: req.chords,
      pickup_beats: req.pickupBeats ?? 0,
      n_candidates: req.nCandidates ?? 1,
    };
    if (req.style) params.style = req.style;
    if (req.instruments) params.instruments = req.instruments;
    if (req.skeleton !== undefined) params.skeleton = req.skeleton;
    if (req.topP != null) params.top_p = req.topP;
    if (req.temperature != null) params.temperature = req.temperature;
    if (req.seed != null) params.seed = req.seed;
    if (req.quantize != null) params.quantize = req.quantize;
    if (req.includeMelody != null) params.include_melody = req.includeMelody;
    const fd = new FormData();
    fd.append('melody', toBlob(req.melodyMidi, 'audio/midi'), 'melody.mid');
    fd.append('params', JSON.stringify(params));
    const job = await this.runJob('/accompany', fd, opts.timeoutMs ?? this.timeouts.accompany, opts);
    const r = job.result as Record<string, any>;
    const candidates: AccompanyCandidate[] = (r.candidates as any[]).map((c) => ({
      index: c.index,
      seed: c.seed ?? null,
      midi: b64ToBytes(c.midi_base64),
      notes: c.notes,
      programs: c.programs,
      genMs: c.gen_ms,
    }));
    return {
      candidates,
      bars: r.bars,
      bpm: r.bpm,
      meter: r.meter,
      totalSeconds: r.total_seconds,
      elapsedMs: job.elapsed_ms ?? 0,
    };
  }

  // ------------------------------------------------------------------ A6

  /** Beat This!: beats, downbeats, tempo map from any audio (mix and drums stems work best; a cappella is weak). */
  async beats(audio: AudioInput, opts: RequestOptions = {}): Promise<BeatsResult> {
    const fd = new FormData();
    fd.append('file', toBlob(audio, 'audio/wav'), 'in.wav');
    const res = await this.request('/beats', { method: 'POST', body: fd }, opts.timeoutMs ?? this.timeouts.denoise, opts.signal);
    return (await res.json()) as BeatsResult;
  }

  /** Song sections (intro/verse/chorus/bridge/outro + app section_type) on a Beat This! bar grid. */
  async structure(audio: AudioInput, opts: RequestOptions & { minBars?: number } = {}): Promise<StructureResult> {
    const fd = new FormData();
    fd.append('file', toBlob(audio, 'audio/wav'), 'song.wav');
    if (opts.minBars != null) fd.append('min_bars', String(opts.minBars));
    const res = await this.request('/structure', { method: 'POST', body: fd }, opts.timeoutMs ?? this.timeouts.separate, opts.signal);
    return (await res.json()) as StructureResult;
  }

  /** CREPE frame pitch (10 ms hop). Use instead of pYIN when the service is up ("Detecție note: AI"). */
  async pitch(audio: AudioInput, opts: PitchOptions = {}): Promise<PitchResult> {
    const fd = new FormData();
    fd.append('file', toBlob(audio, 'audio/wav'), 'voice.wav');
    if (opts.fmin != null) fd.append('fmin', String(opts.fmin));
    if (opts.fmax != null) fd.append('fmax', String(opts.fmax));
    if (opts.model) fd.append('model', opts.model);
    if (opts.voicingThreshold != null) fd.append('voicing_threshold', String(opts.voicingThreshold));
    const res = await this.request('/pitch', { method: 'POST', body: fd }, opts.timeoutMs ?? this.timeouts.denoise, opts.signal);
    return (await res.json()) as PitchResult;
  }

  /** VoiceFixer ("Restaurare AI"): best on strong room echo; may hurt mild degradations of singing -> always offer A/B. */
  async restore(audio: AudioInput, opts: RequestOptions & { mode?: 0 | 1 | 2 } = {}): Promise<Blob> {
    const fd = new FormData();
    fd.append('file', toBlob(audio, 'audio/wav'), 'voice.wav');
    fd.append('mode', String(opts.mode ?? 0));
    const res = await this.request('/restore', { method: 'POST', body: fd }, opts.timeoutMs ?? this.timeouts.denoise, opts.signal);
    return new Blob([await res.blob()], { type: 'audio/wav' });
  }

  /** Local Qwen assistant (Romanian). Loaded on first use (~10 s), unloaded after 5 min idle or when Demucs/AMT need VRAM. */
  async assistantPatch(prompt: string, opts: RequestOptions & { current?: Record<string, unknown>; schema?: object } = {}): Promise<AssistantPatch> {
    const fd = new FormData();
    fd.append('task', 'patch');
    fd.append('prompt', prompt);
    if (opts.current) fd.append('context', JSON.stringify(opts.current));
    if (opts.schema) fd.append('schema', JSON.stringify(opts.schema));
    const res = await this.request('/assistant', { method: 'POST', body: fd }, opts.timeoutMs ?? 240_000, opts.signal);
    return (await res.json()) as AssistantPatch;
  }

  async assistantAsk(task: Exclude<AssistantTask, 'patch'>, prompt: string, opts: RequestOptions & { context?: unknown } = {}): Promise<AssistantText> {
    const fd = new FormData();
    fd.append('task', task);
    fd.append('prompt', prompt);
    if (opts.context) fd.append('context', JSON.stringify(opts.context));
    const res = await this.request('/assistant', { method: 'POST', body: fd }, opts.timeoutMs ?? 240_000, opts.signal);
    return (await res.json()) as AssistantText;
  }

  async assistantStatus(opts: Pick<RequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<AssistantStatus> {
    const res = await this.request('/assistant/status', {}, opts.timeoutMs ?? this.timeouts.health, opts.signal);
    return (await res.json()) as AssistantStatus;
  }

  /** Free the VRAM held by the LLM. */
  async assistantUnload(): Promise<void> {
    await this.request('/assistant/unload', { method: 'POST' }, this.timeouts.health);
  }

  /** Available styles / supported GM instruments for the `accompany` call. */
  async accompanyStyles(opts: Pick<RequestOptions, 'signal' | 'timeoutMs'> = {}): Promise<AccompanyStyles> {
    const res = await this.request('/accompany/styles', {}, opts.timeoutMs ?? this.timeouts.health, opts.signal);
    return (await res.json()) as AccompanyStyles;
  }
}

export const createAiClient = (cfg?: AiClientConfig) => new AiClient(cfg);
