// Loads the repository's data files (data/*.json), checks them, and shapes them for the app.
// A failed check throws, so a bad edit breaks the build and the tests rather than the page.

import eventsJson from '../../data/events.json';
import locationsJson from '../../data/locations.json';
import observationsJson from '../../data/observations.json';
import seasonsJson from '../../data/seasons.json';
import type { DetailReasons } from '../adapters/offline-details';
import type { EventDefinition, EventKind, TimedSegment } from '../engine/events';
import { parseFile, type Observation, type ObservedEvent } from '../engine/observations';
import { anchorEvidence, MIN_DAYS, MIN_MATCHING } from '../engine/verification';
import type { MapData, MapMarker, MapRegion } from './map';
import {
  checkEvents, checkLocations, checkSeasons,
  type EventsFile, type LocationsFile, type SeasonsFile, type Source,
} from './schema';

export const EVENTS = eventsJson as EventsFile;
export const LOCATIONS = locationsJson as LocationsFile;
export const SEASONS = seasonsJson as SeasonsFile;

// Our own in-game sightings, added to the repository from exported files. Every record must read
// cleanly: a damaged entry fails the check instead of being dropped quietly.
const parsedSightings = parseFile(JSON.stringify(observationsJson));
export const SHARED_SIGHTINGS: Observation[] = parsedSightings.observations;

const MIN = 60000;
const instant = (iso: string | null, fallback: number) => (iso === null ? fallback : Date.parse(iso));

/**
 * Checks across files: our shared sightings must agree with the schedules, and an anchor marked
 * Confirmed on the strength of our sightings must have enough of them (MIN_MATCHING starts on
 * MIN_DAYS different UTC days).
 */
export function crossCheck(events: EventsFile, sightings: Observation[]): string[] {
  const out: string[] = [];
  for (const def of eventDefinitions(events)) {
    const ev = anchorEvidence(sightings, def.segments, def.kind);
    if (ev.disagreeing) out.push(`${def.kind}: ${ev.disagreeing} shared sighting(s) disagree with the schedule; fix the record or the anchor`);
    const e = events.events.find((x) => x.id === def.kind)!;
    e.schedules.forEach((s, i) => {
      const byBlizzard = s.phase.sources.some((x) => x.kind === 'blizzard');
      if (s.phase.confidence === 'confirmed' && !byBlizzard && !ev.qualifies) {
        out.push(`${def.kind} schedule ${i} phase: confirmed by sightings needs ${MIN_MATCHING} matching starts on ${MIN_DAYS} days (have ${ev.matching} on ${ev.days.length})`);
      }
    });
  }
  return out;
}

/** The event definitions the schedule source serves. */
export function eventDefinitions(file: EventsFile = EVENTS): EventDefinition[] {
  return file.events.map((e) => ({
    kind: e.id,
    name: e.name,
    checkedOn: file.checkedOn,
    notice: e.announcedChanges.find((c) => c.effective === null)?.summary ?? null,
    roster: e.roster,
    segments: e.schedules
      .map((s): TimedSegment => ({
        fromMs: instant(s.from, -Infinity),
        untilMs: instant(s.until, Infinity),
        schedule: { anchorMs: Date.parse(s.anchor), periodMs: s.periodMinutes * MIN, durationMs: s.durationMinutes * MIN },
        interval: s.interval,
        phase: s.phase,
      }))
      .sort((a, b) => a.fromMs - b.fromMs),
  }));
}

export const DETAIL_REASONS: DetailReasons = Object.fromEntries(EVENTS.events.map((e) => [e.id, {
  location: { hint: e.details.location.hint, reason: e.details.location.reason },
  ...(e.details.identity ? { identity: { hint: e.details.identity.hint, reason: e.details.identity.reason } } : {}),
}])) as DetailReasons;

/** World Boss names, for the observation form. */
export function bossNames(): string[] {
  return EVENTS.events.find((e) => e.id === 'worldBoss')?.roster?.map((r) => r.name) ?? [];
}

/** Known place names for the sightings form. */
export function knownPlaces(event: ObservedEvent): string[] {
  if (event === 'worldBoss') return LOCATIONS.worldBossArenas.map((a) => a.name);
  if (event === 'legion') return LOCATIONS.legionSites.map((l) => l.name);
  if (event === 'helltideChest') return LOCATIONS.helltideChests.map((c) => c.name);
  return [];
}

function sourceText(ids: string[]): string {
  return ids.map((id) => LOCATIONS.sources[id]).filter((s): s is Source => !!s).map((s) => s.title).join('; ');
}

const CONFIDENCE_WORD = { confirmed: 'Confirmed', inferred: 'Inferred', unknown: 'Unknown' } as const;

function buildMap(): MapData {
  const ht = LOCATIONS.helltideRegions;
  const regions: MapRegion[] = LOCATIONS.regions.map((r) => ({
    id: r.id,
    name: r.name,
    note: r.release === 'base' ? 'Base game region.' : `${r.release} region.`,
    waypoints: r.waypoints,
    waypointSource: sourceText(r.sources),
    helltide: ht.regions.includes(r.id),
    helltideNote: `${CONFIDENCE_WORD[ht.confidence]}: can host a Helltide. ${r.release === 'base'
      ? 'From Season 16 (3.3.0 PTR notes), base-game Helltides start on the hour.'
      : 'Needs the expansion. From Season 16 (3.3.0 PTR notes), expansion-zone Helltides start at :30.'}`,
    terrain: ({ fractured_peaks: 'snowbound highlands', scosglen: 'rainy coast and forest', dry_steppes: 'wind-carved grassland', kehjistan: 'desert and salt coast', hawezar: 'wetlands and swamp', nahantu: 'dense jungle', skovos: 'rocky island' } as Record<string, string>)[r.id] ?? 'Sanctuary',
  }));
  const markers: MapMarker[] = [
    ...LOCATIONS.regions.flatMap((r) => r.waypoints.map((name): MapMarker => ({
      id: `wp-${r.id}-${name}`, layer: 'waypoint', regionId: r.id, name, confidence: r.confidence,
      detail: 'Waypoint name verified by the listed official source. Its display placement is intentionally omitted until a position is independently verified.',
      source: sourceText(r.sources), checkedOn: LOCATIONS.checkedOn,
    }))),
    ...LOCATIONS.worldBossArenas.map((a): MapMarker => ({
      id: `wb-${a.region}`, layer: 'worldBoss', regionId: a.region, name: a.name, confidence: a.confidence,
      detail: 'One of the seven World Boss arenas. Any boss can appear in any arena; the in-game map shows which arena before the spawn.',
      source: sourceText(a.sources), checkedOn: LOCATIONS.checkedOn,
    })),
    ...LOCATIONS.legionSites.map((l): MapMarker => ({
      id: `legion-${l.region}`, layer: 'legion', regionId: l.region, name: l.name, confidence: l.confidence,
      detail: l.note ?? 'A Gathering Legions site.',
      source: sourceText(l.sources), checkedOn: LOCATIONS.checkedOn,
    })),
  ];
  return {
    banner: 'Stylized reference atlas: original artwork with approximate regional relationships, not a navigation-accurate game map. A named place without a verified display position stays in the location list.',
    intro: 'Select a region to open its regional reference. Gold = World Boss arena, violet = Legion site, blue = waypoint. Helltide eligibility is shown as an inferred availability layer, never as an active-location prediction.',
    regions,
    markers,
  };
}

// Check everything before anything is used. The constants and functions above must exist first.
const problems = [...checkEvents(EVENTS), ...checkLocations(LOCATIONS), ...checkSeasons(SEASONS)];
if (parsedSightings.rejected) problems.push(`observations: ${parsedSightings.rejected} unreadable record(s)`);
if (!problems.length) problems.push(...crossCheck(EVENTS, SHARED_SIGHTINGS));
if (problems.length) throw new Error(`Data check failed:\n${problems.join('\n')}`);

export const MAP_DATA: MapData = buildMap();

export type { EventKind };
