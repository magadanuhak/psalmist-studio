import { getAudioRow, putAudio } from './db';

export interface AudioData { data: Float32Array; sr: number }
const cache = new Map<string, AudioData>();

export async function loadAudio(id: string): Promise<AudioData | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = await getAudioRow(id);
  if (row) cache.set(id, row);
  return row;
}
export async function storeAudio(id: string, data: Float32Array, sr: number) {
  cache.set(id, { data, sr });
  await putAudio(id, data, sr);
}
export function dropAudio(id: string) { cache.delete(id); }
export function peekAudio(id: string | undefined) { return id ? cache.get(id) ?? null : null; }
