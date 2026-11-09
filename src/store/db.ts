import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '../model/types';
import { migrateProject } from '../model/migrate';
import { floatToInt16, int16ToFloat } from '../music/wav';

interface AudioRow { id: string; sr: number; data: Int16Array }
interface Schema extends DBSchema {
  projects: { key: string; value: Project };
  audio: { key: string; value: AudioRow };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<Schema>('psalmist-studio', 1, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('audio', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export async function listProjects(): Promise<Project[]> {
  const all = (await (await db()).getAll('projects')).map((p) => migrateProject(p));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function saveProject(p: Project) { await (await db()).put('projects', p); }
export async function loadProject(id: string) {
  const p = await (await db()).get('projects', id);
  return p ? migrateProject(p) : undefined;
}

export async function putAudio(id: string, data: Float32Array, sr: number) {
  await (await db()).put('audio', { id, sr, data: floatToInt16(data) });
}
export async function getAudioRow(id: string): Promise<{ data: Float32Array; sr: number } | null> {
  const r = await (await db()).get('audio', id);
  return r ? { data: int16ToFloat(r.data), sr: r.sr } : null;
}
export async function deleteAudio(id: string) { await (await db()).delete('audio', id); }

export async function deleteProjectFully(p: Project) {
  const d = await db();
  for (const s of p.sections) for (const t of s.takes) {
    await d.delete('audio', t.rawAudioId);
    if (t.cleanAudioId) await d.delete('audio', t.cleanAudioId);
  }
  await d.delete('projects', p.id);
}
