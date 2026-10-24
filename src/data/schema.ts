// The shape of the repository's data files (data/*.json) and the checks they must pass. Every
// record says how sure we are: confirmed (Blizzard's own words, or seen in game by us), inferred
// (consistent secondary sources or reasoning, not confirmed), or unknown (not available, with the
// reason). The checks run when the app is built and in the tests, so a malformed edit fails loudly
// instead of showing wrong data.

import { MAX_CHANCE as MAX_ROTATION_CHANCE, MIN_REPEATS as MIN_ROTATION_REPEATS } from '../engine/observations';

export type Confidence = 'confirmed' | 'inferred' | 'unknown';
export const CONFIDENCES: Confidence[] = ['confirmed', 'inferred', 'unknown'];

export type SourceKind = 'blizzard' | 'observation' | 'community' | 'derived';

export interface Source {
  kind: SourceKind;
  title: string;
  url?: string;
  /** The exact words relied on, when the source is a page. */
  quote?: string;
}

export interface Claim {
  confidence: Confidence;
  note?: string;
  sources: Source[];
}

export interface UnknownDetail {
  confidence: 'unknown';
  /** A few words for the card, e.g. "shown in game when it begins". */
  hint: string;
  /** The full reason, shown under "About this card". */
  reason: string;
}

/**
 * A claim that a location or boss follows a repeating order. Separate from whether a place exists
 * (that is the location record's own confidence). Never Confirmed from our sightings: only
 * Blizzard's own words can confirm a rotation. Sightings can make it Inferred at most, with the
 * evidence the rotation test asks for.
 */
export interface RotationClaim {
  field: 'boss' | 'place' | 'region';
  confidence: Confidence;
  note: string;
  /** Only for a cycle we inferred from sightings. */
  period?: number;
  evidence?: { samples: number; repeats: number; chance: number; analyzedOn: string };
  sources?: Source[];
}

export interface ScheduleRecord {
  /** The schedule applies to starts in [from, until); null means open-ended. ISO UTC. */
  from: string | null;
  until: string | null;
  periodMinutes: number;
  durationMinutes: number;
  /** One start of the cycle (ISO UTC). */
  anchor: string;
  /** How sure we are of the interval and duration. */
  interval: Claim;
  /** How sure we are of where the cycle starts (the anchor). */
  phase: Claim;
}

export interface AnnouncedChange {
  summary: string;
  /** When it takes effect (ISO UTC), or null when not announced. */
  effective: string | null;
  sources: Source[];
}

export interface RosterEntry {
  name: string;
  confidence: Confidence;
  note?: string;
  sources?: Source[];
}

export interface EventRecord {
  id: 'helltide' | 'worldBoss' | 'legion';
  name: string;
  schedules: ScheduleRecord[];
  details: { location: UnknownDetail; identity?: UnknownDetail };
  announcedChanges: AnnouncedChange[];
  roster?: RosterEntry[];
  rotations: RotationClaim[];
}

export interface EventsFile {
  checkedOn: string;
  events: EventRecord[];
}

export interface SeasonRecord {
  number: number;
  name: string;
  startDate: string;
  startUtc?: string;
  note?: string;
  hourNote?: string;
  confidence: Confidence;
  sources: Source[];
}

export interface WindowRecord {
  label: string;
  startUtc: string;
  endUtc: string;
  detail: string;
  confidence: Confidence;
  sources: Source[];
}

export interface SeasonsFile {
  checkedOn: string;
  seasons: SeasonRecord[];
  currentEndUtc: string | null;
  nextStartUtc: string | null;
  nextName: string;
  windows: WindowRecord[];
}

export interface RegionRecord {
  id: string;
  name: string;
  release: string;
  confidence: Confidence;
  waypoints: string[];
  sources: string[];
}

export interface SiteRecord {
  region: string;
  name: string;
  confidence: Confidence;
  note?: string;
  sources: string[];
}

export interface LocationsFile {
  checkedOn: string;
  regions: RegionRecord[];
  helltideRegions: { regions: string[]; confidence: Confidence; note: string; sources: string[] };
  worldBossArenas: SiteRecord[];
  legionSites: SiteRecord[];
  /** Places a Helltide chest was seen, from our own observations. Empty until we have some. */
  helltideChests: SiteRecord[];
  sources: Record<string, Source>;
}

// Checks

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

class Problems {
  list: string[] = [];
  add(where: string, what: string): void { this.list.push(`${where}: ${what}`); }
}

function isInstant(v: unknown): v is string {
  return typeof v === 'string' && INSTANT.test(v) && Number.isFinite(Date.parse(v));
}

function checkSource(p: Problems, where: string, s: Source): void {
  if (!['blizzard', 'observation', 'community', 'derived'].includes(s.kind)) p.add(where, `bad source kind ${s.kind}`);
  if (!s.title) p.add(where, 'source without a title');
  if (s.kind === 'blizzard' && !(s.url && s.quote)) p.add(where, 'a Blizzard source needs its url and the quoted words');
  if (s.url && !/^https:\/\//.test(s.url)) p.add(where, `source url is not https: ${s.url}`);
}

function checkClaim(p: Problems, where: string, c: Claim): void {
  if (!CONFIDENCES.includes(c.confidence)) p.add(where, `bad confidence ${c.confidence}`);
  if (c.confidence !== 'unknown' && !c.sources.length) p.add(where, 'a known claim needs a source');
  if (c.confidence === 'confirmed' && !c.sources.some((s) => s.kind === 'blizzard' || s.kind === 'observation')) {
    p.add(where, 'confirmed needs a Blizzard source or our own in-game observation');
  }
  c.sources.forEach((s, i) => checkSource(p, `${where} source ${i}`, s));
}

export function checkEvents(f: EventsFile): string[] {
  const p = new Problems();
  if (!DAY.test(f.checkedOn)) p.add('events', 'checkedOn must be YYYY-MM-DD');
  const ids = f.events.map((e) => e.id);
  for (const id of ['helltide', 'worldBoss', 'legion'] as const) if (!ids.includes(id)) p.add('events', `missing ${id}`);
  for (const e of f.events) {
    if (!e.schedules.length) p.add(e.id, 'no schedule');
    e.schedules.forEach((s, i) => {
      const w = `${e.id} schedule ${i}`;
      if (!(Number.isInteger(s.periodMinutes) && s.periodMinutes > 0)) p.add(w, 'periodMinutes must be a positive whole number');
      if (!(Number.isInteger(s.durationMinutes) && s.durationMinutes >= 0 && s.durationMinutes <= s.periodMinutes)) {
        p.add(w, 'durationMinutes must be a whole number from 0 to periodMinutes');
      }
      if (!isInstant(s.anchor)) p.add(w, 'anchor must be an ISO UTC instant like 2026-10-24T04:00:00Z');
      for (const k of ['from', 'until'] as const) if (s[k] !== null && !isInstant(s[k])) p.add(w, `${k} must be null or an ISO UTC instant`);
      if (s.from && s.until && Date.parse(s.from) >= Date.parse(s.until)) p.add(w, 'from must be before until');
      checkClaim(p, `${w} interval`, s.interval);
      checkClaim(p, `${w} phase`, s.phase);
    });
    // Schedules must not overlap: sorted by from, each until <= the next from.
    const sorted = [...e.schedules].sort((a, b) => (a.from ? Date.parse(a.from) : -Infinity) - (b.from ? Date.parse(b.from) : -Infinity));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.until === null || cur.from === null || Date.parse(prev.until) > Date.parse(cur.from)) p.add(e.id, 'schedules overlap');
    }
    for (const d of [e.details.location, e.details.identity]) {
      if (d && (d.confidence !== 'unknown' || !d.reason || !d.hint)) p.add(e.id, 'details must be unknown with a hint and a reason (there is no live source)');
      if (d && d.hint.length > 40) p.add(e.id, `detail hint too long for one line: ${d.hint}`);
    }
    for (const r of e.rotations) {
      const w = `${e.id} rotation ${r.field}`;
      if (!CONFIDENCES.includes(r.confidence)) p.add(w, 'bad confidence');
      if (r.confidence === 'confirmed' && !r.sources?.some((s) => s.kind === 'blizzard')) {
        p.add(w, 'a rotation is confirmed only by Blizzard\'s own words, never by sightings alone');
      }
      if (r.confidence === 'inferred' && !r.sources?.some((s) => s.kind === 'blizzard')) {
        const ev = r.evidence;
        if (!ev || !r.period) p.add(w, 'an inferred rotation needs its period and the evidence from the rotation test');
        else if (ev.repeats < MIN_ROTATION_REPEATS || ev.chance >= MAX_ROTATION_CHANCE || ev.samples < 2 * r.period) {
          p.add(w, `evidence too weak: each position must be seen ${MIN_ROTATION_REPEATS}+ times with a chance fit under ${MAX_ROTATION_CHANCE}`);
        }
      }
    }
    e.announcedChanges.forEach((c, i) => {
      if (c.effective !== null && !isInstant(c.effective)) p.add(`${e.id} change ${i}`, 'effective must be null or an ISO UTC instant');
      if (!c.sources.length) p.add(`${e.id} change ${i}`, 'needs a source');
      c.sources.forEach((s, j) => checkSource(p, `${e.id} change ${i} source ${j}`, s));
    });
    for (const r of e.roster ?? []) {
      if (!CONFIDENCES.includes(r.confidence)) p.add(`${e.id} roster ${r.name}`, 'bad confidence');
      if (r.confidence === 'confirmed' && !r.sources?.some((s) => s.kind === 'blizzard' || s.kind === 'observation')) {
        p.add(`${e.id} roster ${r.name}`, 'confirmed needs a Blizzard source or our own observation');
      }
    }
  }
  return p.list;
}

export function checkLocations(f: LocationsFile): string[] {
  const p = new Problems();
  if (!DAY.test(f.checkedOn)) p.add('locations', 'checkedOn must be YYYY-MM-DD');
  const regionIds = new Set(f.regions.map((r) => r.id));
  if (regionIds.size !== f.regions.length) p.add('locations', 'duplicate region id');
  const sourceIds = new Set(Object.keys(f.sources));
  for (const [id, s] of Object.entries(f.sources)) checkSource(p, `source ${id}`, s);
  const confirmedOk = (ids: string[]) => ids.some((id) => ['blizzard', 'observation'].includes(f.sources[id]?.kind ?? ''));
  for (const r of f.regions) {
    for (const s of r.sources) if (!sourceIds.has(s)) p.add(r.id, `unknown source ${s}`);
    if (r.confidence === 'confirmed' && !confirmedOk(r.sources)) p.add(r.id, 'confirmed needs a Blizzard source or our own observation');
  }
  for (const id of f.helltideRegions.regions) if (!regionIds.has(id)) p.add('helltideRegions', `unknown region ${id}`);
  const lists: [string, SiteRecord[]][] = [['worldBossArenas', f.worldBossArenas], ['legionSites', f.legionSites], ['helltideChests', f.helltideChests]];
  for (const [name, list] of lists) {
    for (const s of list) {
      const w = `${name} ${s.name}`;
      if (!regionIds.has(s.region)) p.add(w, `unknown region ${s.region}`);
      if (!CONFIDENCES.includes(s.confidence)) p.add(w, 'bad confidence');
      for (const id of s.sources) if (!sourceIds.has(id)) p.add(w, `unknown source ${id}`);
      if (s.confidence !== 'unknown' && !s.sources.length) p.add(w, 'needs a source');
      if (s.confidence === 'confirmed' && !confirmedOk(s.sources)) p.add(w, 'confirmed needs a Blizzard source or our own observation');
    }
  }
  return p.list;
}

export function checkSeasons(f: SeasonsFile): string[] {
  const p = new Problems();
  if (!DAY.test(f.checkedOn)) p.add('seasons', 'checkedOn must be YYYY-MM-DD');
  for (const s of f.seasons) {
    const w = `season ${s.number}`;
    if (!CONFIDENCES.includes(s.confidence)) p.add(w, 'bad confidence');
    if (!s.sources.length) p.add(w, 'needs a source');
    s.sources.forEach((x, i) => checkSource(p, `${w} source ${i}`, x));
    if (s.confidence === 'confirmed' && !s.sources.some((x) => x.kind === 'blizzard' || x.kind === 'observation')) {
      p.add(w, 'confirmed needs a Blizzard source or our own observation');
    }
  }
  for (const k of ['currentEndUtc', 'nextStartUtc'] as const) if (f[k] !== null && !isInstant(f[k])) p.add('seasons', `${k} must be null or an ISO UTC instant`);
  for (const w of f.windows) {
    if (!isInstant(w.startUtc) || !isInstant(w.endUtc)) p.add(w.label, 'start and end must be ISO UTC instants');
    w.sources.forEach((x, i) => checkSource(p, `${w.label} source ${i}`, x));
  }
  return p.list;
}
