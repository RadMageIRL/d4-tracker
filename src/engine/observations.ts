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

/**
 * seen     - the person who recorded it saw it in game (the default, and all that counts as evidence)
 * reported - someone else said so (a friend, a chat, a stream): shown, never used as evidence
 */
export type Provenance = 'seen' | 'reported';
export type Realm = 'seasonal' | 'eternal';
export const REALMS: Realm[] = ['seasonal', 'eternal'];

/** A spot placed by the player on one of the atlas drawings: fractions of its width and height. */
export interface ArtPosition {
  /** Which drawing: region id and a short hash of the drawing, so a redrawn map can be noticed. */
  art: string;
  x: number;
  y: number;
}

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
  /**
   * In-game verification. Absent means seen: the recorder saw it in game (every version 1 record
   * was the recorder's own sighting). "reported" means not checked in game.
   */
  provenance?: Provenance;
  /**
   * A second, separate provenance: where a prediction or display came from when the record started
   * as one (for example another tracker's page). Kept in the data for the record; the page only
   * says "third-party prediction", never the name. It never makes a record evidence by itself:
   * only provenance "seen" does.
   */
  thirdParty?: string;
  realm?: Realm;
  hardcore?: true;
  /** Helltide chest type id (data/locations.json chestTypes). */
  chest?: string;
  pos?: ArtPosition;
  /** ISO UTC, when the record was made. */
  recordedAt: string;
}

export const FILE_FORMAT = 'd4-tracker-observations';
/** 2 added provenance, thirdParty, realm, hardcore, chest and pos; version 1 files still read. */
export const FILE_VERSION = 2;

/** Seen in game by whoever recorded it: the only sightings used as evidence. */
export function isSeen(o: Observation): boolean {
  return o.provenance !== 'reported';
}

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
  for (const k of ['region', 'place', 'boss', 'note', 'thirdParty'] as const) {
    const v = text(r[k]);
    if (v) o[k] = v;
  }
  if (o.region && !/^[a-z_]+$/.test(o.region)) return null;
  if (r.provenance === 'reported') o.provenance = 'reported';
  if (REALMS.includes(r.realm as Realm)) o.realm = r.realm as Realm;
  if (r.hardcore === true) o.hardcore = true;
  const chest = text(r.chest);
  if (chest) {
    if (!/^[a-z][a-z-]{0,30}$/.test(chest)) return null;
    o.chest = chest;
  }
  if (r.pos !== undefined) {
    const pos = cleanPosition(r.pos);
    if (!pos) return null;
    o.pos = pos;
  }
  return o;
}

/** A position inside a drawing (both fractions from 0 to 1), or null. */
export function cleanPosition(raw: unknown): ArtPosition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.art !== 'string' || !/^[a-z_]+:[0-9a-f]{8}$/.test(p.art)) return null;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (!ok(p.x) || !ok(p.y)) return null;
  return { art: p.art, x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 };
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

/**
 * Same sighting recorded twice: same event, minute, timing, region, place, boss, chest type and map
 * placement. A chest marked active and then placed on the map in the same minute are two records.
 */
function sightingKey(o: Observation): string {
  const pos = o.pos ? `${o.pos.art}@${o.pos.x},${o.pos.y}` : '';
  return [o.event, Math.floor(Date.parse(o.at) / 60000), o.timing, o.region ?? '', o.place ?? '', o.boss ?? '', o.chest ?? '', pos].join('|');
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
    if (o.event !== event || o.timing === 'none' || !isSeen(o)) continue;
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
    if (o.event !== event || o.timing === 'none' || !isSeen(o)) continue;
    const value = o[field];
    if (!value) continue;
    const occ = occurrenceOf(segs, o);
    if (!occ) continue;
    const prev = byIndex.get(occ.index);
    if (prev !== undefined && prev !== value) conflicted.add(occ.index);
    else if (prev === undefined) {
      byIndex.set(occ.index, value);
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
  const { values: _values, ...fit } = cycleFit(entries, domainSize, maxPeriod);
  return { field, samples: entries.length, counts, conflicts: conflicted.size, ...fit };
}

/**
 * The occurrence a sighting belongs to, with its index in the schedule in force then. A start
 * typed up to the tolerance early still lands in its own occurrence, not the one before.
 */
export function occurrenceOf(segs: Segment[], o: Observation): { index: number; startMs: number; endMs: number; segment: Segment } | null {
  const t = Date.parse(o.at) + (o.timing === 'start' ? TIMING_TOLERANCE_MS : 0);
  const occ = lastStart(segs, t);
  if (!occ) return null;
  const segment = segs.find((s) => occ.startMs >= s.fromMs && occ.startMs < s.untilMs);
  if (!segment) return null;
  return { index: indexAt(segment.schedule, occ.startMs), startMs: occ.startMs, endMs: occ.endMs, segment };
}

export interface CycleFit {
  verdict: RotationResult['verdict'];
  period?: number;
  repeats?: number;
  chance?: number;
  testedUpTo: number;
  explanation: string;
  /** For a fit: the value at each position of the cycle (position = index mod period). */
  values?: string[];
}

/**
 * The shortest fixed cycle that fits one value per occurrence index, under the rules above:
 * every position seen MIN_REPEATS times, a chance fit under MAX_CHANCE (adjusted for the cycle
 * lengths tried), and "no pattern" only once cycles up to MIN_RULED_OUT are ruled out.
 */
export function cycleFit(entries: [number, string][], domainSize: number, maxPeriod = 12): CycleFit {
  const samples = entries.length;
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
      verdict: 'not-enough-data', testedUpTo,
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
        verdict: 'not-enough-data', testedUpTo, period: p, repeats, chance,
        explanation: `Fits a cycle of ${p} so far, but random values would fit that well about ${pct(chance)} of the time. Needs more sightings.`,
      };
    }
    return {
      verdict: 'consistent', testedUpTo, period: p, repeats, chance,
      values: Array.from({ length: p }, (_, r) => classValue.get(r)!),
      explanation: `Consistent with a cycle of ${p} so far (every position seen at least ${repeats} times; a chance fit is about ${pct(chance)}). ` +
        'Not proven: Blizzard has not documented a rotation, and one more sighting can break it.',
    };
  }
  if (testedUpTo < MIN_RULED_OUT) {
    return {
      verdict: 'not-enough-data', testedUpTo,
      explanation: `${samples} sightings: not enough to test for a repeating order yet (each position of a cycle has to be seen twice).`,
    };
  }
  return {
    verdict: 'no-pattern', testedUpTo,
    explanation: `No cycle of up to ${testedUpTo} fits the ${samples} sightings.`,
  };
}

function pct(x: number): string {
  if (x < 0.001) return 'under 0.1%';
  return `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
}
