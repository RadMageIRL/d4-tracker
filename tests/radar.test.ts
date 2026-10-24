import { describe, expect, it } from 'vitest';
import type { Observation } from '../src/engine/observations';
import { radarLights, summaryLines, type RadarInput, type RadarLight, type RadarPrediction } from '../src/engine/radar';
import { always } from '../src/engine/segments';

const MIN = 60000;
const T = (iso: string) => Date.parse(iso);
const segments = {
  helltide: always({ anchorMs: T('2026-10-24T00:00:00Z'), periodMs: 60 * MIN, durationMs: 55 * MIN }),
  worldBoss: always({ anchorMs: T('2026-10-24T04:00:00Z'), periodMs: 210 * MIN, durationMs: 0 }),
  legion: always({ anchorMs: T('2026-10-24T02:00:00Z'), periodMs: 25 * MIN, durationMs: 0 }),
};
const ARENAS: Record<string, string> = { 'Caen Adar': 'scosglen', 'The Cauldron': 'nahantu', 'Seared Basin': 'kehjistan' };
const SITES: Record<string, string> = { 'Kor Dragan': 'fractured_peaks' };
const EXPANSION = new Set(['nahantu', 'skovos']);

let n = 0;
function seen(rest: Partial<Observation> & Pick<Observation, 'event' | 'at'>): Observation {
  return { id: `r${n++}`, timing: rest.event === 'helltide' ? 'during' : 'start', recordedAt: rest.at, ...rest };
}

function lights(nowIso: string, sightings: Observation[], extra: Partial<RadarInput> = {}) {
  return radarLights({
    nowMs: T(nowIso), sightings, segments,
    leadMs: { worldBoss: 30 * MIN, legion: 10 * MIN }, graceMs: { worldBoss: 10 * MIN, legion: 5 * MIN },
    predict: () => [],
    placeRegion: (kind, place) => (kind === 'worldBoss' ? ARENAS[place] : SITES[place]),
    series: (r) => (EXPANSION.has(r) ? 'expansion' : 'base'),
    isExtraSpawn: (o) => !!((o.region && EXPANSION.has(o.region)) || (o.place && EXPANSION.has(ARENAS[o.place] ?? ''))),
    ...extra,
  });
}
const regions = (ls: ReturnType<typeof lights>, kind: string) => ls.filter((l) => l.kind === kind).map((l) => l.region).sort();

describe('Helltide regions', () => {
  const hawezar = seen({ event: 'helltide', at: '2026-10-24T15:04:00Z', region: 'hawezar' });

  it('lights the region seen in this Helltide, until the Helltide ends', () => {
    expect(lights('2026-10-24T15:10:00Z', [hawezar])).toEqual([
      { kind: 'helltide', region: 'hawezar', startMs: T('2026-10-24T15:00:00Z'), untilMs: T('2026-10-24T15:55:00Z'), basis: 'seen', confidence: 'confirmed' },
    ]);
    expect(lights('2026-10-24T15:54:59Z', [hawezar])).toHaveLength(1);
    expect(lights('2026-10-24T15:55:00Z', [hawezar])).toEqual([]);
    expect(lights('2026-10-24T16:10:00Z', [hawezar])).toEqual([]);
  });

  it('lights two Helltides at once, a base-game and an expansion region', () => {
    const list = [hawezar, seen({ event: 'helltide', at: '2026-10-24T15:06:00Z', region: 'nahantu' })];
    expect(regions(lights('2026-10-24T15:10:00Z', list), 'helltide')).toEqual(['hawezar', 'nahantu']);
  });

  it('does not light from a report, an unchecked third-party prediction, or a record in the shared data', () => {
    const reported = seen({ event: 'helltide', at: '2026-10-24T15:04:00Z', region: 'scosglen', provenance: 'reported' });
    const thirdParty = seen({ event: 'helltide', at: '2026-10-24T15:04:00Z', region: 'kehjistan', provenance: 'reported', thirdParty: 'a tracker page' });
    expect(lights('2026-10-24T15:10:00Z', [reported, thirdParty])).toEqual([]);
    expect(lights('2026-10-24T15:10:00Z', [hawezar], { isShared: () => true })).toEqual([]);
  });

  it('keeps a third-party record that was checked in game: the check is what counts', () => {
    const checked = seen({ event: 'helltide', at: '2026-10-24T15:04:00Z', region: 'kehjistan', thirdParty: 'a tracker page' });
    expect(regions(lights('2026-10-24T15:10:00Z', [checked]), 'helltide')).toEqual(['kehjistan']);
  });

  it('stays unlit with no region noted, and for a sighting of another Helltide or one dated later', () => {
    const noRegion = seen({ event: 'helltide', at: '2026-10-24T15:04:00Z' });
    const lastHour = seen({ event: 'helltide', at: '2026-10-24T14:30:00Z', region: 'scosglen' });
    const later = seen({ event: 'helltide', at: '2026-10-24T15:40:00Z', region: 'dry_steppes' });
    expect(lights('2026-10-24T15:10:00Z', [noRegion, lastHour, later])).toEqual([]);
  });

  it('lights a trusted prediction, labeled, only for a kind of region nobody has seen this Helltide', () => {
    const predict = (kind: string): RadarPrediction[] => (kind === 'helltide' ? [{ region: 'kehjistan', confidence: 'inferred' }, { region: 'skovos', confidence: 'inferred' }] : []);
    const ls = lights('2026-10-24T15:10:00Z', [hawezar], { predict });
    expect(ls.map((l) => [l.region, l.basis, l.confidence])).toEqual([['hawezar', 'seen', 'confirmed'], ['skovos', 'predicted', 'inferred']]);
  });
});

describe('World Boss and Legion markers', () => {
  const ashava = seen({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Ashava', place: 'Caen Adar' });

  it('shows the World Boss from 30 minutes before its spawn to 10 minutes after, in the region of the arena seen', () => {
    expect(lights('2026-10-24T10:29:00Z', [ashava])).toEqual([]);
    expect(lights('2026-10-24T10:30:00Z', [ashava])).toEqual([
      { kind: 'worldBoss', region: 'scosglen', startMs: T('2026-10-24T11:00:00Z'), untilMs: T('2026-10-24T11:10:00Z'), label: 'Ashava', basis: 'seen', confidence: 'confirmed' },
    ]);
    expect(lights('2026-10-24T11:09:00Z', [ashava])).toHaveLength(1);
    expect(lights('2026-10-24T11:10:00Z', [ashava])).toEqual([]);
  });

  it('follows a longer lead-up when the player chose one', () => {
    expect(lights('2026-10-24T10:05:00Z', [ashava], { leadMs: { worldBoss: 60 * MIN, legion: 10 * MIN } })).toHaveLength(1);
  });

  it('shows both bosses of a double spawn, each in its own region, the second flagged', () => {
    const avarice = seen({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Avarice', place: 'The Cauldron' });
    const ls = lights('2026-10-24T10:40:00Z', [ashava, avarice]);
    expect(ls.map((l) => [l.region, l.label, l.extra ?? false])).toEqual([['scosglen', 'Ashava', false], ['nahantu', 'Avarice', true]]);
  });

  it('shows a Legion from 10 minutes before its start to 5 minutes after, from the region or the site seen', () => {
    const legion = seen({ event: 'legion', at: '2026-10-24T15:20:00Z', place: 'Kor Dragan' });
    expect(lights('2026-10-24T15:09:00Z', [legion])).toEqual([]);
    expect(regions(lights('2026-10-24T15:10:00Z', [legion]), 'legion')).toEqual(['fractured_peaks']);
    expect(regions(lights('2026-10-24T15:24:00Z', [legion]), 'legion')).toEqual(['fractured_peaks']);
    expect(lights('2026-10-24T15:25:00Z', [legion])).toEqual([]);
  });

  it('places no marker when the region is unknown: a boss with no arena or region, or an arena it cannot place', () => {
    const noWhere = seen({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Azmodan' });
    const unknownArena = seen({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Azmodan', place: 'Somewhere New' });
    expect(lights('2026-10-24T10:40:00Z', [noWhere, unknownArena])).toEqual([]);
  });

  it('never lights a region just because it has a possible arena or site', () => {
    // No sighting and no trusted prediction: every region has an arena, none lights.
    expect(lights('2026-10-24T10:40:00Z', [])).toEqual([]);
  });

  it('keeps an unchecked third-party prediction off the radar (the October 24 Azmodan case)', () => {
    const azmodan = seen({ event: 'worldBoss', at: '2026-10-24T18:00:00Z', boss: 'Azmodan', region: 'scosglen', provenance: 'reported', thirdParty: 'a tracker page' });
    expect(lights('2026-10-24T17:45:00Z', [azmodan])).toEqual([]);
  });

  it('uses a trusted prediction only when no sighting places the main spawn, and labels it', () => {
    const predict = (kind: string): RadarPrediction[] => (kind === 'worldBoss' ? [{ place: 'Seared Basin', boss: 'Avarice', confidence: 'inferred' }] : []);
    expect(lights('2026-10-24T10:40:00Z', [], { predict })).toMatchObject([{ region: 'kehjistan', label: 'Avarice', basis: 'predicted', confidence: 'inferred' }]);
    expect(lights('2026-10-24T10:40:00Z', [ashava], { predict }).map((l) => l.region)).toEqual(['scosglen']);
  });

  it('lights a predicted second boss in its expansion region, flagged, and each spawn seen replaces only its own prediction', () => {
    const predict = (kind: string): RadarPrediction[] => (kind === 'worldBoss'
      ? [{ region: 'kehjistan', boss: 'Avarice', confidence: 'inferred' }, { region: 'skovos', extra: true, confidence: 'inferred' }]
      : []);
    const summary = (ls: RadarLight[]) => ls.map((l) => [l.region, l.basis, l.extra ?? false]);
    expect(summary(lights('2026-10-24T10:40:00Z', [], { predict }))).toEqual([['kehjistan', 'predicted', false], ['skovos', 'predicted', true]]);
    expect(summary(lights('2026-10-24T10:40:00Z', [ashava], { predict }))).toEqual([['scosglen', 'seen', false], ['skovos', 'predicted', true]]);
    const second = seen({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Avarice', place: 'The Cauldron' });
    expect(summary(lights('2026-10-24T10:40:00Z', [second], { predict }))).toEqual([['nahantu', 'seen', true], ['kehjistan', 'predicted', false]]);
  });
});

describe('the phone summary', () => {
  const L = (kind: RadarLight['kind'], region: string, startIso: string, extra = false): RadarLight =>
    ({ kind, region, startMs: T(startIso), untilMs: T(startIso) + 10 * MIN, basis: 'seen', confidence: 'confirmed', ...(extra ? { extra } : {}) });

  it('has one line per event type, Helltide then World Boss then Legion, and leaves out what is not lit', () => {
    const lines = summaryLines([L('legion', 'scosglen', '2026-10-24T10:45:00Z'), L('helltide', 'hawezar', '2026-10-24T10:00:00Z'), L('helltide', 'nahantu', '2026-10-24T10:00:00Z')]);
    expect(lines.map((l) => [l.kind, l.lights.map((x) => x.region)])).toEqual([['helltide', ['hawezar', 'nahantu']], ['legion', ['scosglen']]]);
    expect(summaryLines([])).toEqual([]);
  });

  it('lists the main World Boss before the second one of a double spawn', () => {
    const lines = summaryLines([L('worldBoss', 'nahantu', '2026-10-24T11:00:00Z', true), L('worldBoss', 'kehjistan', '2026-10-24T11:00:00Z')]);
    expect(lines[0]!.lights.map((x) => x.region)).toEqual(['kehjistan', 'nahantu']);
  });
});

describe('several events in one region', () => {
  it('keeps a Helltide, a World Boss and a Legion in the same region as three separate indicators', () => {
    const list = [
      seen({ event: 'helltide', at: '2026-10-24T10:02:00Z', region: 'scosglen' }),
      seen({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Ashava', region: 'scosglen' }),
      seen({ event: 'legion', at: '2026-10-24T10:45:00Z', place: 'Carrowcrest', region: 'scosglen' }),
    ];
    const ls = lights('2026-10-24T10:40:00Z', list);
    expect(ls.map((l) => `${l.kind}:${l.region}`).sort()).toEqual(['helltide:scosglen', 'legion:scosglen', 'worldBoss:scosglen']);
  });
});
