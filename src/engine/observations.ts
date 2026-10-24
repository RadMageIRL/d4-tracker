// In-game observations: what a player saw, when and where, recorded in the browser and exported as
// JSON files we keep in our own repository. Two questions are asked of them:
//
// 1. Timing: do sightings of a start agree with the calculated schedule? That is what turns an
//    inferred cycle start point into one we have seen ourselves.
// 2. Rotation: do the boss, arena, Helltide region or Legion place repeat in a fixed cycle? A few
//    sightings cannot prove that. A pattern is reported only when every position in the cycle has
//    been seen at least twice and a chance match would be rare, and even then it is "consistent
//    so far", never "proven".

import { lastStart, nextStart, type Segment } from './segments';
import { indexAt } from './schedule';

export type ObservedEvent = 'worldBoss' | 'legion' | 'helltide' | 'helltideChest';
export const OBSERVED_EVENTS: ObservedEvent[] = ['worldBoss', 'legion', 'helltide', 'helltideChest'];

/**
 * How the time was taken:
 * start  - the player saw it begin, or read the start from the in-game timer
 * during - it was already running; the time is when it was seen
 * none   - no timing (a chest location, say)
 */
export type Timing = 'start' | 'during' | 'none';
export const TIMINGS: Timing[] = ['start', 'during', 'none'];

export interface Observation {
  id: string;
  event: ObservedEvent;
  /** ISO UTC: the start (timing "start") or when it was seen. */
  at: string;
  timing: Timing;
  /** Region id from data/locations.json. */
  region?: string;
  /** Arena, Legion site or landmark, as named in game. */
  place?: string;
  boss?: string;
  note?: string;
  /** ISO UTC, when the record was made. */
  recordedAt: string;
}

export const FILE_FORMAT = 'd4-tracker-observations';
export const FILE_VERSION = 1;

export interface ObservationFile {
  format: typeof FILE_FORMAT;
  version: number;
  exportedAt: string;
  observations: Observation[];
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
const MAX_TEXT = 120;

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, MAX_TEXT);
  return t || undefined;
}

/** A clean Observation from untrusted input (a stored or imported record), or null. */
export function cleanObservation(raw: unknown): Observation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const event = r.event as ObservedEvent;
  const timing = r.timing as Timing;
  if (!OBSERVED_EVENTS.includes(event) || !TIMINGS.includes(timing)) return null;
  if (typeof r.at !== 'string' || !INSTANT.test(r.at) || !Number.isFinite(Date.parse(r.at))) return null;
  if (typeof r.recordedAt !== 'string' || !Number.isFinite(Date.parse(r.recordedAt))) return null;
  const id = text(r.id);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const o: Observation = { id, event, at: new Date(Date.parse(r.at)).toISOString(), timing, recordedAt: new Date(Date.parse(r.recordedAt)).toISOString() };
  for (const k of ['region', 'place', 'boss', 'note'] as const) {
    const v = text(r[k]);
    if (v) o[k] = v;
  }
  if (o.region && !/^[a-z_]+$/.test(o.region)) return null;
  return o;
}

/** A new id that is unique enough for one player's records (time plus randomness). */
export function newId(nowMs: number, random: () => number = Math.random): string {
  return `${nowMs.toString(36)}${Math.floor(random() * 2 ** 32).toString(36)}`;
}

export function toFile(observations: Observation[], nowMs: number): ObservationFile {
  return { format: FILE_FORMAT, version: FILE_VERSION, exportedAt: new Date(nowMs).toISOString(), observations };
}

export interface ParsedFile {
  observations: Observation[];
  rejected: number;
}

/** Read an exported file. Throws with a readable message when it is not one. */
export function parseFile(textContent: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(textContent);
  } catch {
    throw new Error('This is not a JSON file.');
  }
  const d = data as Partial<ObservationFile>;
  if (d?.format !== FILE_FORMAT || !Array.isArray(d.observations)) throw new Error('This is not a D4 Tracker sightings file.');
  if (typeof d.version !== 'number' || d.version > FILE_VERSION) throw new Error('This file is from a newer version of the tracker.');
  const observations: Observation[] = [];
  let rejected = 0;
  for (const raw of d.observations) {
    const o = cleanObservation(raw);
    if (o) observations.push(o); else rejected++;
  }
  return { observations, rejected };
}

/** Same sighting recorded twice: same event, same minute, same region, place and boss. */
function sightingKey(o: Observation): string {
  return [o.event, Math.floor(Date.parse(o.at) / 60000), o.region ?? '', o.place ?? '', o.boss ?? ''].join('|');
}

export function merge(existing: Observation[], incoming: Observation[]): { merged: Observation[]; added: number; duplicates: number } {
  const merged = [...existing];
  const ids = new Set(existing.map((o) => o.id));
  const keys = new Set(existing.map(sightingKey));
  let added = 0;
  let duplicates = 0;
  for (const o of incoming) {
    const key = sightingKey(o);
    if (ids.has(o.id) || keys.has(key)) { duplicates++; continue; }
    merged.push(o);
    ids.add(o.id);
    keys.add(key);
    added++;
  }
  merged.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { merged, added, duplicates };
}

// Timing

/** A typed-in start can be off by a minute either way; allow two. */
export const TIMING_TOLERANCE_MS = 2 * 60000;

export interface TimingResult {
  /** Sightings that could be checked. */
  checked: number;
  agree: number;
  disagree: { observation: Observation; offsetMs: number }[];
  latestAt: string | null;
}

/** Signed distance from t to the nearest calculated start, or null when there is none. */
export function offsetFromSchedule(segs: Segment[], t: number): number | null {
  const before = lastStart(segs, t);
  const after = nextStart(segs, t);
  const candidates = [before, after].filter((o) => o !== null).map((o) => t - o!.startMs);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
}

/**
 * Check sightings of one event against its schedule. A "start" sighting must lie within the
 * tolerance of a calculated start. A "during" sighting can only be checked for an event with a
 * known length (Helltide): it must fall inside a calculated window.
 */
export function timingCheck(observations: Observation[], segs: Segment[], event: ObservedEvent): TimingResult {
  const result: TimingResult = { checked: 0, agree: 0, disagree: [], latestAt: null };
  for (const o of observations) {
    if (o.event !== event || o.timing === 'none') continue;
    const t = Date.parse(o.at);
    if (o.timing === 'start') {
      const off = offsetFromSchedule(segs, t);
      if (off === null) continue;
      result.checked++;
      if (Math.abs(off) <= TIMING_TOLERANCE_MS) result.agree++;
      else result.disagree.push({ observation: o, offsetMs: off });
    } else {
      const last = lastStart(segs, t);
      if (!last || last.endMs === last.startMs) continue; // no known length: nothing to check
      result.checked++;
      if (t < last.endMs) result.agree++;
      else result.disagree.push({ observation: o, offsetMs: t - last.endMs });
    }
    if (!result.latestAt || o.at > result.latestAt) result.latestAt = o.at;
  }
  return result;
}

// Rotation

export type RotationField = 'boss' | 'place' | 'region';

export interface RotationResult {
  field: RotationField;
  /** Distinct occurrences with a value. */
  samples: number;
  counts: Record<string, number>;
  /** Occurrences recorded with two different values (a recording mistake, or two events at once). */
  conflicts: number;
  verdict: 'not-enough-data' | 'no-pattern' | 'consistent';
  /** The shortest cycle that fits, when consistent. */
  period?: number;
  /** The fewest sightings of any position in that cycle. */
  repeats?: number;
  /** How likely random values would fit some cycle this well (adjusted for the cycles tried). */
  chance?: number;
  /** The longest cycle the sightings cover well enough to test. */
  testedUpTo: number;
  explanation: string;
}

/** Minimum sightings of every position in a cycle before the cycle is tested. */
export const MIN_REPEATS = 2;
/** A fit is reported only when chance would produce it less often than this. */
export const MAX_CHANCE = 0.05;
/** "No pattern" is said only once cycles up to this length have been ruled out. */
export const MIN_RULED_OUT = 6;

/**
 * Look for a fixed cycle in one field of one event's sightings.
 * @param domainSize How many values are possible (4 bosses, 7 arenas, 7 regions): used for the
 *   chance estimate. With fewer possible values, an accidental fit is likelier.
 * @param maxPeriod The longest cycle to try.
 */
export function rotationCheck(
  observations: Observation[], segs: Segment[], event: ObservedEvent, field: RotationField,
  domainSize: number, maxPeriod = 12,
): RotationResult {
  // One value per occurrence, keyed by its cycle index.
  const byIndex = new Map<number, string>();
  const conflicted = new Set<number>();
  const counts: Record<string, number> = {};
  for (const o of observations) {
    if (o.event !== event || o.timing === 'none') continue;
    const value = o[field];
    if (!value) continue;
    const t = Date.parse(o.at) + (o.timing === 'start' ? TIMING_TOLERANCE_MS : 0);
    const occ = lastStart(segs, t);
    if (!occ) continue;
    const seg = segs.find((s) => occ.startMs >= s.fromMs && occ.startMs < s.untilMs);
    if (!seg) continue;
    const index = indexAt(seg.schedule, occ.startMs);
    const prev = byIndex.get(index);
    if (prev !== undefined && prev !== value) conflicted.add(index);
    else if (prev === undefined) {
      byIndex.set(index, value);
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }
  for (const i of conflicted) {
    const v = byIndex.get(i)!;
    counts[v]! -= 1;
    if (counts[v] === 0) delete counts[v];
    byIndex.delete(i);
  }
  const entries = [...byIndex.entries()];
  const samples = entries.length;
  const base = { field, samples, counts, conflicts: conflicted.size };

  // Which cycle lengths do the sightings cover well enough to test?
  const covered = (p: number) => {
    const per = new Map<number, number>();
    for (const [i] of entries) per.set(((i % p) + p) % p, (per.get(((i % p) + p) % p) ?? 0) + 1);
    if (per.size < p) return null;
    return Math.min(...per.values()) >= MIN_REPEATS ? per : null;
  };
  let testedUpTo = 0;
  for (let p = 1; p <= maxPeriod; p++) if (covered(p)) testedUpTo = p;

  if (testedUpTo === 0) {
    return {
      ...base, verdict: 'not-enough-data', testedUpTo,
      explanation: samples === 0 ? 'No sightings yet.' : `${samples} sighting${samples === 1 ? '' : 's'}: not enough to test for a repeating cycle.`,
    };
  }

  for (let p = 1; p <= testedUpTo; p++) {
    const per = covered(p);
    if (!per) continue;
    const classValue = new Map<number, string>();
    let fits = true;
    for (const [i, v] of entries) {
      const r = ((i % p) + p) % p;
      const seen = classValue.get(r);
      if (seen === undefined) classValue.set(r, v);
      else if (seen !== v) { fits = false; break; }
    }
    if (!fits) continue;
    // Chance that random values (uniform over domainSize) agree within every position this often,
    // times the number of cycle lengths tried.
    let chance = 1;
    for (const n of per.values()) chance *= (1 / Math.max(2, domainSize)) ** (n - 1);
    chance = Math.min(1, chance * testedUpTo);
    const repeats = Math.min(...per.values());
    if (chance >= MAX_CHANCE) {
      return {
        ...base, verdict: 'not-enough-data', testedUpTo, period: p, repeats, chance,
        explanation: `Fits a cycle of ${p} so far, but random values would fit that well about ${pct(chance)} of the time. Needs more sightings.`,
      };
    }
    return {
      ...base, verdict: 'consistent', testedUpTo, period: p, repeats, chance,
      explanation: `Consistent with a cycle of ${p} so far (every position seen at least ${repeats} times; a chance fit is about ${pct(chance)}). ` +
        'Not proven: Blizzard has not documented a rotation, and one more sighting can break it.',
    };
  }
  if (testedUpTo < MIN_RULED_OUT) {
    return {
      ...base, verdict: 'not-enough-data', testedUpTo,
      explanation: `${samples} sightings: not enough to test for a repeating order yet (each position of a cycle has to be seen twice).`,
    };
  }
  return {
    ...base, verdict: 'no-pattern', testedUpTo,
    explanation: `No cycle of up to ${testedUpTo} fits the ${samples} sightings.`,
  };
}

function pct(x: number): string {
  if (x < 0.001) return 'under 0.1%';
  return `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
}
