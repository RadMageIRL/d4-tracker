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

/** Every nth start brings a second one at the same time (the World Boss in an expansion region). */
export interface ExtraSpawnRecord extends Claim {
  every: number;
  /** ISO UTC start of one start that has the extra one. */
  anchor: string;
}

export interface EventRecord {
  id: 'helltide' | 'worldBoss' | 'legion';
  name: string;
  schedules: ScheduleRecord[];
  details: { location: UnknownDetail; identity?: UnknownDetail };
  announcedChanges: AnnouncedChange[];
  roster?: RosterEntry[];
  rotations: RotationClaim[];
  extraSpawn?: ExtraSpawnRecord;
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

/** A kind of Helltide chest, as the game names it. */
export interface ChestTypeRecord {
  id: string;
  name: string;
  confidence: Confidence;
  /** Minutes after a Helltide begins at which these chests move to other spots (empty: they stay). */
  relocatesAtMinutes: number[];
  note?: string;
  sources: string[];
}

/** A spot where a Helltide chest can appear, from our own observations (never from another site). */
export interface ChestSiteRecord extends SiteRecord {
  id: string;
  /** A chestTypes id. */
  type: string;
  /** The day the spot was last seen or checked in game. */
  checkedOn: string;
  /** Only when placed on our own atlas drawing by someone who saw it: fractions of the drawing. */
  position?: { art: string; x: number; y: number };
  /** The season or patch the spot was seen in, since spots can change. */
  appliesFrom?: string;
}

export interface LocationsFile {
  checkedOn: string;
  regions: RegionRecord[];
  helltideRegions: { regions: string[]; confidence: Confidence; note: string; sources: string[] };
  worldBossArenas: SiteRecord[];
  legionSites: SiteRecord[];
  chestTypes: ChestTypeRecord[];
  /** Places a Helltide chest was seen, from our own observations. Empty until we have some. */
  helltideChests: ChestSiteRecord[];
  sources: Record<string, Source>;
}

/**
 * An order someone described (a guide, a forum post, Blizzard), registered so that our own
 * sightings can test it. Registering one claims nothing: the page shows a prediction only after
 * sightings made after registeredOn bear it out (src/engine/prediction.ts), and only Blizzard's
 * own words make it Confirmed.
 */
export interface RuleRecord {
  id: string;
  event: 'worldBoss' | 'legion' | 'helltide';
  field: 'boss' | 'place' | 'region' | 'pair';
  /** In order. Bosses and arenas by name as in the data, regions by id, pairs as "Boss @ Arena". */
  sequence: string[];
  /** ISO UTC start of an occurrence that showed sequence[0], or null to read the phase from sightings. */
  anchor: string | null;
  registeredOn: string;
  /** A few words on where the rule came from. */
  basis: string;
  sources: Source[];
}

/** A moment an order may have reset (a patch, a maintenance): analysis starts again after it. */
export interface ResetRecord {
  at: string;
  label: string;
  sources: Source[];
}

/** A spawn whose place in a cycle is known. */
export interface RotationPinRecord {
  /** ISO UTC start of a World Boss spawn. */
  start: string;
  /** Its place in the cycle (or in the list of second-boss regions), from 0. */
  position: number;
}

/**
 * The World Boss rotation predictions come from: one step per spawn, pinned to a known spawn.
 * Every prediction from it is labeled Predicted.
 */
export interface WorldBossRotationRecord {
  /** The main spawn, in order: the boss by its roster name and its arena's region by id. */
  cycle: { boss: string; region: string }[];
  pin: RotationPinRecord;
  /** How many days after its pin a spawn is predicted. */
  holdDays: number;
  /** The second boss of a double spawn: the expansion regions it appears in, in turn. */
  second?: { regions: string[]; pin: RotationPinRecord };
  /** A few words on where it came from and how far to trust it. */
  basis: string;
  sources: Source[];
}

export interface RotationsFile {
  checkedOn: string;
  worldBoss?: WorldBossRotationRecord;
  rules: RuleRecord[];
  resets: ResetRecord[];
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
    const x = e.extraSpawn;
    if (x) {
      const w = `${e.id} extraSpawn`;
      if (!(Number.isInteger(x.every) && x.every >= 2)) p.add(w, 'every must be a whole number of 2 or more');
      if (!isInstant(x.anchor)) p.add(w, 'anchor must be an ISO UTC instant');
      else {
        const s = e.schedules.find((y) => (y.from === null || Date.parse(y.from) <= Date.parse(x.anchor)) && (y.until === null || Date.parse(x.anchor) < Date.parse(y.until)));
        if (!s || (Date.parse(x.anchor) - Date.parse(s.anchor)) % (s.periodMinutes * 60000) !== 0) p.add(w, 'anchor must be one of the calculated starts');
      }
      checkClaim(p, w, x);
    }
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
  const typeIds = new Set<string>();
  for (const c of f.chestTypes) {
    const w = `chestType ${c.id}`;
    if (!/^[a-z][a-z-]{0,30}$/.test(c.id) || typeIds.has(c.id)) p.add(w, 'id must be unique, lowercase letters and hyphens');
    typeIds.add(c.id);
    if (!c.name) p.add(w, 'needs a name');
    if (!CONFIDENCES.includes(c.confidence)) p.add(w, 'bad confidence');
    const m = c.relocatesAtMinutes;
    if (!Array.isArray(m) || !m.every((x, i) => Number.isInteger(x) && x >= 1 && x <= 59 && (i === 0 || x > m[i - 1]!))) {
      p.add(w, 'relocatesAtMinutes must be whole minutes from 1 to 59, in increasing order');
    }
    for (const id of c.sources) if (!sourceIds.has(id)) p.add(w, `unknown source ${id}`);
    if (c.confidence !== 'unknown' && !c.sources.length) p.add(w, 'needs a source');
    if (c.confidence === 'confirmed' && !confirmedOk(c.sources)) p.add(w, 'confirmed needs a Blizzard source or our own observation');
  }
  const chestIds = new Set<string>();
  for (const c of f.helltideChests) {
    const w = `helltideChests ${c.name}`;
    if (!/^[a-z0-9-]+$/.test(c.id) || chestIds.has(c.id)) p.add(w, 'id must be unique, lowercase letters, digits and hyphens');
    chestIds.add(c.id);
    if (!typeIds.has(c.type)) p.add(w, `unknown chest type ${c.type}`);
    if (!DAY.test(c.checkedOn)) p.add(w, 'checkedOn must be YYYY-MM-DD');
    const pos = c.position;
    if (pos && !(/^[a-z_]+:[0-9a-f]{8}$/.test(pos.art) && [pos.x, pos.y].every((v) => typeof v === 'number' && v >= 0 && v <= 1))) {
      p.add(w, 'position must name a drawing (region:hash) and fractions from 0 to 1');
    }
    if (c.confidence === 'confirmed' && !c.sources.some((id) => f.sources[id]?.kind === 'observation')) {
      p.add(w, 'a chest spot is confirmed only by our own in-game observation');
    }
  }
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

export function checkRotations(f: RotationsFile, events: EventsFile, locations: LocationsFile): string[] {
  const p = new Problems();
  if (!DAY.test(f.checkedOn)) p.add('rotations', 'checkedOn must be YYYY-MM-DD');
  const bosses = new Set(events.events.find((e) => e.id === 'worldBoss')?.roster?.map((r) => r.name) ?? []);
  const arenas = new Set(locations.worldBossArenas.map((a) => a.name));
  const regions = new Set(locations.regions.map((r) => r.id));
  const valid: Record<string, (v: string) => boolean> = {
    'worldBoss boss': (v) => bosses.has(v),
    'worldBoss place': (v) => arenas.has(v),
    'worldBoss pair': (v) => { const [b, a] = v.split(' @ '); return !!b && !!a && bosses.has(b) && arenas.has(a); },
    'worldBoss region': (v) => regions.has(v),
    'legion place': (v) => v.trim().length > 0,
    'legion region': (v) => regions.has(v),
    'helltide region': (v) => regions.has(v),
  };
  const ids = new Set<string>();
  for (const r of f.rules) {
    const w = `rule ${r.id}`;
    if (!/^[a-z0-9-]+$/.test(r.id) || ids.has(r.id)) p.add(w, 'id must be unique, lowercase letters, digits and hyphens');
    ids.add(r.id);
    const ok = valid[`${r.event} ${r.field}`];
    if (!ok) p.add(w, `${r.field} is not a field of ${r.event}`);
    if (!r.sequence.length || r.sequence.length > 64) p.add(w, 'sequence must have 1 to 64 values');
    for (const v of r.sequence) if (ok && !ok(v)) p.add(w, `unknown value ${v} (bosses and arenas by their name in the data, regions by id)`);
    if (r.anchor !== null && !isInstant(r.anchor)) p.add(w, 'anchor must be null or an ISO UTC instant');
    if (!DAY.test(r.registeredOn)) p.add(w, 'registeredOn must be YYYY-MM-DD');
    if (!r.basis) p.add(w, 'needs a basis');
    if (!r.sources.length) p.add(w, 'needs a source');
    r.sources.forEach((s, i) => checkSource(p, `${w} source ${i}`, s));
  }
  const wb = f.worldBoss;
  if (wb) {
    const w = 'worldBoss rotation';
    const base = new Set(locations.regions.filter((r) => r.release === 'base').map((r) => r.id));
    const expansion = new Set(locations.regions.filter((r) => r.release !== 'base').map((r) => r.id));
    const position = (pin: RotationPinRecord, n: number, where: string) => {
      if (!isInstant(pin.start)) p.add(where, 'start must be an ISO UTC instant');
      if (!Number.isInteger(pin.position) || pin.position < 0 || pin.position >= n) p.add(where, `position must be 0 to ${n - 1}`);
    };
    if (!wb.cycle.length || wb.cycle.length > 64) p.add(w, 'cycle must have 1 to 64 steps');
    wb.cycle.forEach((s, i) => {
      if (!bosses.has(s.boss)) p.add(`${w} step ${i}`, `unknown boss ${s.boss}`);
      if (!base.has(s.region)) p.add(`${w} step ${i}`, `${s.region} is not a base-game region (the main spawn is in one)`);
    });
    position(wb.pin, wb.cycle.length, `${w} pin`);
    if (!Number.isInteger(wb.holdDays) || wb.holdDays < 1 || wb.holdDays > 28) p.add(w, 'holdDays must be 1 to 28');
    if (wb.second) {
      const r = wb.second.regions;
      if (!r.length || new Set(r).size !== r.length || r.some((x) => !expansion.has(x))) p.add(`${w} second`, 'regions must be distinct expansion region ids');
      position(wb.second.pin, r.length, `${w} second pin`);
    }
    if (!wb.basis) p.add(w, 'needs a basis');
    if (!wb.sources.length) p.add(w, 'needs a source');
    wb.sources.forEach((s, i) => checkSource(p, `${w} source ${i}`, s));
  }
  for (const x of f.resets) {
    if (!isInstant(x.at)) p.add(`reset ${x.label}`, 'at must be an ISO UTC instant');
    if (!x.label) p.add('reset', 'needs a label');
    if (!x.sources.length) p.add(`reset ${x.label}`, 'needs a source');
    x.sources.forEach((s, i) => checkSource(p, `reset ${x.label} source ${i}`, s));
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
