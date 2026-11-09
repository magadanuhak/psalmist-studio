/** "Instrumentul tău": the user's own instruments (IndexedDB), listed next to the catalog. */
import { create } from 'zustand';
import { getInstrument } from '../audio/instruments/catalog';
import type { CatalogEntry } from '../audio/instruments/types';
import { buildUserInstrument, idbStore, memoryStore, userCatalogEntry, userId, type BuildReport, type RecordedNote, type UserInstrument, type UserInstrumentStore } from '../audio/instruments/yourInstrument';

let store: UserInstrumentStore | null = null;
const getStore = (): UserInstrumentStore => {
  if (!store) { try { store = typeof indexedDB === 'undefined' ? memoryStore() : idbStore(); } catch { store = memoryStore(); } }
  return store;
};
const cache = new Map<string, UserInstrument>();
const entries = new Map<string, CatalogEntry>();

/** catalog entry by id, including the user's instruments (`user:<id>`) */
export const entryOf = (id: string): CatalogEntry | undefined => getInstrument(id) ?? entries.get(id);

export async function getUserInstrument(id: string): Promise<UserInstrument | undefined> {
  const raw = id.startsWith('user:') ? id.slice(5) : id;
  const hit = cache.get(raw);
  if (hit) return hit;
  const v = await getStore().get(raw);
  if (v) { cache.set(raw, v); entries.set(userId(v), userCatalogEntry(v)); }
  return v;
}

interface UserState {
  list: CatalogEntry[];
  refresh(): Promise<void>;
  add(notes: readonly RecordedNote[], name: string): Promise<{ id: string | null; report: BuildReport }>;
  remove(id: string): Promise<void>;
}

export const useUserInstruments = create<UserState>((set, get) => ({
  list: [],
  async refresh() {
    try {
      const rows = await getStore().list();
      const out: CatalogEntry[] = [];
      for (const r of rows) { const u = await getUserInstrument(r.id); if (u) out.push(userCatalogEntry(u)); }
      set({ list: out });
    } catch { set({ list: [] }); }
  },
  async add(notes, name) {
    const { instrument, report } = buildUserInstrument(notes, { name });
    if (!instrument) return { id: null, report };
    await getStore().put(instrument);
    cache.set(instrument.id, instrument);
    entries.set(userId(instrument), userCatalogEntry(instrument));
    await get().refresh();
    return { id: userId(instrument), report };
  },
  async remove(id) {
    const raw = id.startsWith('user:') ? id.slice(5) : id;
    await getStore().delete(raw);
    cache.delete(raw); entries.delete('user:' + raw);
    await get().refresh();
  },
}));
