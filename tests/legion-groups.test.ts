import { describe, expect, it } from 'vitest';
import { IntelligenceDetailsSource } from '../src/adapters/intelligence';
import { bossNames, DETAIL_REASONS, eventDefinitions, EVENTS, LEGION_GROUPS, LOCATIONS, ROTATIONS } from '../src/data';
import { checkRotations, type RotationsFile } from '../src/data/schema';
import type { EventKind } from '../src/engine/events';
import type { Observation } from '../src/engine/observations';
import { cycleAt } from '../src/engine/rotation';
import type { Segment } from '../src/engine/segments';

const SLOT = 25 * 60000;
const at = (iso: string) => Date.parse(iso);
/** The Legion's number on the 25-minute grid (Unix time mod 1500 = 1200). */
const index = (ms: number) => (ms / 1000 - 1200) / 1500;

describe('the Legion site groups in the data', () => {
  const lg = LEGION_GROUPS!;
  const regionOf = (site: string) => LOCATIONS.legionSites.find((s) => s.name === site)?.region;

  it('pass the data checks, and the checks refuse bad groups', () => {
    expect(checkRotations(ROTATIONS, EVENTS, LOCATIONS)).toEqual([]);
    const bad = structuredClone(ROTATIONS) as RotationsFile;
    bad.legion!.groups.a = ['Kor Dragan', 'Nowhere'];
    bad.legion!.groups.b = [...bad.legion!.groups.b!, 'Kor Dragan'];
    bad.legion!.cycle = ['a', 'c'];
    bad.legion!.pin.position = 2;
    const problems = checkRotations(bad, EVENTS, LOCATIONS).join('\n');
    expect(problems).toMatch(/legion rotation group a: unknown site Nowhere/);
    expect(problems).toMatch(/legion rotation group b: Kor Dragan is in two groups/);
    expect(problems).toMatch(/legion rotation step 1: unknown group c/);
    expect(problems).toMatch(/legion rotation pin: position must be 0 to 1/);
  });

  it('are two groups of four known sites: group A in Fractured Peaks, Scosglen and Kehjistan, group B in Hawezar and Dry Steppes', () => {
    expect(Object.keys(lg.groups).sort()).toEqual(['a', 'b']);
    expect(lg.groups.a!.map(regionOf)).toEqual(['fractured_peaks', 'scosglen', 'kehjistan', 'kehjistan']);
    expect(lg.groups.b!.map(regionOf)).toEqual(['hawezar', 'hawezar', 'dry_steppes', 'dry_steppes']);
  });

  it('give group B on every odd Legion and group A on every even one, for months', () => {
    expect((lg.cycle.pin.startMs / 1000) % 1500).toBe(1200); // pinned on the Legion grid
    for (let t = at('2026-03-18T05:20:00Z'); t < at('2026-11-30T00:00:00Z'); t += SLOT) {
      expect(cycleAt(lg.cycle, t, SLOT)).toBe(index(t) % 2 === 1 ? 'b' : 'a');
    }
  });

  it('give group A at 18:40 UTC on 2026-10-24 and group B at 19:05 and 19:55, with Haunted Wreckage in group B', () => {
    expect(['18:40', '19:05', '19:55'].map((hm) => cycleAt(lg.cycle, at(`2026-10-24T${hm}:00Z`), SLOT))).toEqual(['a', 'b', 'b']);
    expect(lg.groups.b).toContain('Haunted Wreckage');
  });
});

describe('the Legion card from the site groups', () => {
  const defs = eventDefinitions();
  const segsOf = (k: EventKind) => defs.find((d) => d.kind === k)!.segments;
  let n = 0;
  const sighting = (iso: string, rest: Partial<Observation>): Observation =>
    ({ id: `lg${n++}`, event: 'legion', at: iso, timing: 'start', recordedAt: iso, ...rest });
  const source = (list: Observation[], opts: { groups?: boolean; segments?: (k: EventKind) => Segment[] } = {}) => new IntelligenceDetailsSource({
    reasons: DETAIL_REASONS, sightings: () => list, segments: opts.segments ?? segsOf, registered: [], boundaries: [],
    regions: LOCATIONS.regions, arenas: LOCATIONS.worldBossArenas, bosses: bossNames(),
    sites: LOCATIONS.legionSites.map((s) => ({ name: s.name, region: s.region })),
    ...(opts.groups === false ? {} : { legionGroups: LEGION_GROUPS! }),
  });
  const occ = (iso: string) => ({ index: 0, startMs: at(iso), endMs: at(iso) });
  const NOW = at('2026-10-24T19:50:00Z');

  it('names the four possible sites of the next Legion, labeled predicted', () => {
    const d = source([]).details('legion', occ('2026-10-24T19:55:00Z'), NOW);
    expect(d.location).toMatchObject({ known: true, value: '4 candidates', basis: 'predicted' });
    expect(d.candidates).toEqual([
      { place: 'Haunted Wreckage', region: 'Hawezar' }, { place: "Crusader's Monument", region: 'Hawezar' },
      { place: 'Norgoi Vigil', region: 'Dry Steppes' }, { place: 'Temple of Rot', region: 'Dry Steppes' },
    ]);
    expect(source([]).details('legion', occ('2026-10-24T20:20:00Z'), NOW).candidates?.map((c) => c.place))
      .toEqual(['Kor Dragan', 'Carrowcrest Ruins', 'Dilapidated Aqueducts', 'Alcarnus']);
  });

  it('shows the site seen in game for that Legion instead, and still predicts the next one', () => {
    const s = source([sighting('2026-10-24T19:55:00Z', { place: 'Haunted Wreckage', region: 'hawezar' })]);
    const d = s.details('legion', occ('2026-10-24T19:55:00Z'), NOW);
    expect(d.location).toMatchObject({ value: 'Haunted Wreckage, Hawezar', basis: 'seen' });
    expect(d.candidates).toBeUndefined();
    expect(s.details('legion', occ('2026-10-24T20:20:00Z'), NOW).candidates).toHaveLength(4);
  });

  it('keeps the base-game candidates when an expansion Legion is seen at the same time, and names it beside them', () => {
    // A group A start with a second Legion at Chakhir (Nahantu) beside the base-game one.
    const chakhir = sighting('2026-10-24T20:20:00Z', { place: 'Chakhir', region: 'nahantu' });
    const d = source([chakhir]).details('legion', occ('2026-10-24T20:20:00Z'), NOW);
    expect(d.location).toMatchObject({ value: '4 candidates', basis: 'predicted' });
    expect(d.candidates?.map((c) => c.place)).toContain('Dilapidated Aqueducts');
    expect(d.also).toBe('Chakhir, Nahantu');
    const both = source([chakhir, sighting('2026-10-24T20:20:00Z', { place: 'Dilapidated Aqueducts' })]).details('legion', occ('2026-10-24T20:20:00Z'), NOW);
    expect(both.location).toMatchObject({ value: 'Dilapidated Aqueducts, Kehjistan; also Chakhir, Nahantu', basis: 'seen' });
    expect(both.candidates).toBeUndefined();
  });

  it('keeps a report in the note, never as the site', () => {
    const d = source([sighting('2026-10-24T19:55:00Z', { place: 'Norgoi Vigil', region: 'dry_steppes', provenance: 'reported' })])
      .details('legion', occ('2026-10-24T19:55:00Z'), NOW);
    expect(d.location).toMatchObject({ value: '4 candidates', basis: 'predicted' });
    expect(d.location.known && d.location.source).toMatch(/Reported to you, not checked in game: Norgoi Vigil, Dry Steppes\.$/);
  });

  it('lights nothing on the radar: a group names no one place', () => {
    expect(source([]).radarPredictions('legion', at('2026-10-24T19:55:00Z'), NOW)).toEqual([]);
  });

  it('lists a later Legion by its group\'s regions', () => {
    expect(source([]).predicted('legion', at('2026-10-24T20:20:00Z'), NOW)).toEqual({ location: '4 candidates: Fractured Peaks, Scosglen, Kehjistan' });
  });

  it('predicts nothing under a new Legion schedule, or without the groups', () => {
    const old = segsOf('legion')[0]!;
    const split = at('2026-11-01T00:00:00Z');
    const segments = (k: EventKind) => (k === 'legion' ? [{ ...old, untilMs: split }, { ...old, fromMs: split }] : segsOf(k));
    // 00:25 is a Legion start (on the 25-minute grid), so only the schedule change stops it.
    expect(source([]).details('legion', occ('2026-11-01T00:25:00Z'), NOW).candidates).toHaveLength(4);
    expect(source([], { segments }).details('legion', occ('2026-11-01T00:25:00Z'), NOW)).toMatchObject({ location: { known: false } });
    expect(source([], { groups: false }).details('legion', occ('2026-10-24T19:55:00Z'), NOW).candidates).toBeUndefined();
  });
});
