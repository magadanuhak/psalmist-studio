export interface BenchSong { title: string; key: string; mode: 'major' | 'minor'; sig: string; eighths: number; compound: boolean; bpm: number; pickup: number; genre: string; form: string[]; chords: string[]; alt?: Record<string, string[]>; melody: [string, number][] }
export const SONGS: Record<string, BenchSong>;
export function noteMidi(n: string): number;
export function eighthSec(s: BenchSong, tempoScale?: number): number;
export interface SingOpts { register?: 'male' | 'female'; bars?: number; seed?: number; snrDb?: number; detuneCents?: number; jitterMs?: number; tempoScale?: number; noise?: boolean; lead?: number }
export interface Truth { lead: number; e8: number; barSec: number; bars: number[]; chords: string[]; notes: { name: string; midi: number; u: number; d: number }[]; totalSec: number; shift?: number; register?: string; rangeMidi?: number[] }
export function truthOf(s: BenchSong, o?: SingOpts): Truth;
export function sing(s: BenchSong, o?: SingOpts): { samples: Float32Array; sr: number; truth: Truth };
export function wavBytes(samples: Float32Array, sr: number): Buffer;
export function acceptableAt(s: BenchSong, i: number): string[];
export function chordOk(ref: string, mine: string): boolean;
