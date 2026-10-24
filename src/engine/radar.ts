// The event radar: which regions of the overview to light, and why.
//
// The one rule that matters most is never lighting the wrong region. A region lights only when its
// event is known for that very occurrence:
//   - seen: a sighting the player checked in game names the region (or the arena or site, whose
//     region is then known), for this Helltide or this spawn; or
//   - predicted: an order the sightings have borne out (src/engine/prediction.ts) gives it,
//     labeled Inferred.
// Never from a secondhand report, an unchecked third-party prediction, a record in the shared
// data, or a sighting of another occurrence; and never because a region merely has a possible
// arena or Legion site. A light goes out when its event is over.

import { isSeen, occurrenceOf, type Observation } from './observations';
import { activeOccurrence, startsInRange, type Segment } from './segments';

export type RadarKind = 'helltide' | 'worldBoss' | 'legion';

export interface RadarLight {
  kind: RadarKind;
  region: string;
  startMs: number;
  /** When the light goes out: the Helltide's end, or a spawn's start plus its grace. */
  untilMs: number;
  /** The boss (World Boss) or the place (arena, Legion site), when known. */
  label?: string;
  /** World Boss only: the second boss of a double spawn, in an expansion region. */
  extra?: boolean;
  basis: 'seen' | 'predicted';
  /** Seen in game: Confirmed. Predicted: Inferred (Confirmed only when Blizzard documents the order). */
  confidence: 'confirmed' | 'inferred';
}

export interface RadarPrediction {
  region?: string;
  /** An arena or site name; its region is looked up. */
  place?: string;
  boss?: string;
  confidence: 'confirmed' | 'inferred';
}

export interface RadarInput {
  nowMs: number;
  sightings: Observation[];
  segments: Record<RadarKind, Segment[]>;
  /** How long before a spawn its marker shows. */
  leadMs: { worldBoss: number; legion: number };
  /** How long after a spawn its marker stays (the fight or event is under way). */
  graceMs: { worldBoss: number; legion: number };
  /** Trusted predictions for an occurrence: only orders that are Inferred or Confirmed. */
  predict: (kind: RadarKind, startMs: number) => RadarPrediction[];
  /** The region of a named World Boss arena or Legion site. */
  placeRegion: (kind: RadarKind, place: string) => string | undefined;
  /** For Helltides: which of the two that can run at once a region belongs to (base or expansion). */
  series: (region: string) => string;
  /** A World Boss sighting of the second spawn of a double spawn (in an expansion arena or region). */
  isExtraSpawn: (o: Observation) => boolean;
  /** Records in the repository's shared data: research records, never lit. */
  isShared?: (o: Observation) => boolean;
}

/** One line of the phone summary: every light of one kind, in time order. */
export interface SummaryLine {
  kind: RadarKind;
  lights: RadarLight[];
}

/**
 * The phone summary under the radar: one line per kind (Helltide, World Boss, Legion) for exactly
 * the lights the radar shows, so the two can never disagree. Kinds with nothing lit are left out.
 */
export function summaryLines(lights: RadarLight[]): SummaryLine[] {
  return (['helltide', 'worldBoss', 'legion'] as const)
    .map((kind) => ({ kind, lights: lights.filter((l) => l.kind === kind).sort((a, b) => a.startMs - b.startMs || Number(!!a.extra) - Number(!!b.extra)) }))
    .filter((line) => line.lights.length > 0);
}

/** May this record light a region? Only one the player checked in game, from their own log. */
function trusted(o: Observation, input: RadarInput): boolean {
  return isSeen(o) && !input.isShared?.(o);
}

function regionOf(o: Observation, kind: RadarKind, input: RadarInput): string | undefined {
  if (o.region) return o.region;
  return o.place ? input.placeRegion(kind, o.place) : undefined;
}

export function radarLights(input: RadarInput): RadarLight[] {
  const out: RadarLight[] = [];
  const { nowMs } = input;

  // Helltides: the one in progress, in every region seen; a trusted prediction only for a kind of
  // region (base or expansion) nobody has seen this Helltide.
  const ht = activeOccurrence(input.segments.helltide, nowMs);
  if (ht) {
    const seen = new Set<string>();
    for (const o of input.sightings) {
      if (o.event !== 'helltide' || o.timing === 'none' || !o.region || !trusted(o, input)) continue;
      if (Date.parse(o.at) > nowMs || occurrenceOf(input.segments.helltide, o)?.startMs !== ht.startMs) continue;
      if (seen.has(o.region)) continue;
      seen.add(o.region);
      out.push({ kind: 'helltide', region: o.region, startMs: ht.startMs, untilMs: ht.endMs, basis: 'seen', confidence: 'confirmed' });
    }
    const seenSeries = new Set([...seen].map(input.series));
    for (const p of input.predict('helltide', ht.startMs)) {
      if (!p.region || seen.has(p.region) || seenSeries.has(input.series(p.region))) continue;
      seen.add(p.region);
      out.push({ kind: 'helltide', region: p.region, startMs: ht.startMs, untilMs: ht.endMs, basis: 'predicted', confidence: p.confidence });
    }
  }

  // World Boss and Legion: each start in its window, from lead-up to just after the start.
  for (const kind of ['worldBoss', 'legion'] as const) {
    const lead = input.leadMs[kind];
    const grace = input.graceMs[kind];
    for (const occ of startsInRange(input.segments[kind], nowMs - grace + 1, nowMs + lead + 1)) {
      const untilMs = occ.startMs + grace;
      const lit = new Set<string>();
      let mainKnown = false;
      for (const o of input.sightings) {
        if (o.event !== kind || o.timing === 'none' || !trusted(o, input)) continue;
        if (occurrenceOf(input.segments[kind], o)?.startMs !== occ.startMs) continue;
        const region = regionOf(o, kind, input);
        if (!region) continue;
        const extra = kind === 'worldBoss' && input.isExtraSpawn(o);
        const key = `${region}|${extra}`;
        if (lit.has(key)) continue;
        lit.add(key);
        if (!extra) mainKnown = true;
        const label = kind === 'worldBoss' ? o.boss : o.place;
        out.push({
          kind, region, startMs: occ.startMs, untilMs, basis: 'seen', confidence: 'confirmed',
          ...(label ? { label } : {}), ...(extra ? { extra } : {}),
        });
      }
      if (mainKnown) continue;
      for (const p of input.predict(kind, occ.startMs)) {
        const region = p.region ?? (p.place ? input.placeRegion(kind, p.place) : undefined);
        if (!region || lit.has(`${region}|false`)) continue;
        lit.add(`${region}|false`);
        const label = kind === 'worldBoss' ? p.boss : p.place;
        out.push({ kind, region, startMs: occ.startMs, untilMs, basis: 'predicted', confidence: p.confidence, ...(label ? { label } : {}) });
      }
    }
  }
  return out;
}
