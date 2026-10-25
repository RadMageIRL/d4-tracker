import { describe, expect, it } from 'vitest';
import { IntelligenceDetailsSource } from '../src/adapters/intelligence';
import { bossNames, DETAIL_REASONS, eventDefinitions, EVENTS, LEGION_EXPANSION, LEGION_GROUPS, legionExpansionOf, LOCATIONS, ROTATIONS } from '../src/data';
import { checkRotations, type LegionExpansionRecord, type RotationsFile } from '../src/data/schema';
import type { EventKind, EventStatus } from '../src/engine/events';
import { timelineItems, type TimelineNote } from '../src/ui/timeline';
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
  const source = (list: Observation[], opts: { groups?: boolean; expansion?: boolean; order?: typeof LEGION_EXPANSION; segments?: (k: EventKind) => Segment[] } = {}) => new IntelligenceDetailsSource({
    reasons: DETAIL_REASONS, sightings: () => list, segments: opts.segments ?? segsOf, registered: [], boundaries: [],
    regions: LOCATIONS.regions, arenas: LOCATIONS.worldBossArenas, bosses: bossNames(),
    sites: LOCATIONS.legionSites.map((s) => ({ name: s.name, region: s.region })),
    ...(opts.groups === false ? {} : { legionGroups: LEGION_GROUPS! }),
    ...(opts.expansion === false ? {} : { legionExpansion: opts.order ?? LEGION_EXPANSION! }),
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

  it('predicts the expansion Legion apart from the base-game candidates, with its region', () => {
    const d = source([]).details('legion', occ('2026-10-25T00:05:00Z'), NOW);
    expect(d.location).toMatchObject({ value: '4 candidates', basis: 'predicted' });
    expect(d.candidates?.map((c) => c.place)).toEqual(['Haunted Wreckage', "Crusader's Monument", 'Norgoi Vigil', 'Temple of Rot']);
    expect(d.alsoPredicted).toEqual({ place: 'Of Souls and Spirits', region: 'Nahantu' });
    expect(d.also).toBeUndefined();
  });

  it('gives the Cosmic Archives prediction its caveat, and no other site one', () => {
    expect(source([]).details('legion', occ('2026-10-25T00:30:00Z'), NOW).alsoPredicted)
      .toEqual({ place: 'Cosmic Archives', region: 'Skovos', caveat: 'visibility may depend on campaign/stronghold progression' });
    for (const t of ['2026-10-25T00:05:00Z', '2026-10-25T00:55:00Z', '2026-10-25T01:20:00Z']) {
      expect(source([]).details('legion', occ(t), NOW).alsoPredicted?.caveat).toBeUndefined();
    }
  });

  it('shows an expansion Legion seen in game instead of the predicted one', () => {
    const seen = sighting('2026-10-24T23:40:00Z', { place: 'Siege of Chakhir Ruins', region: 'nahantu' });
    const d = source([seen]).details('legion', occ('2026-10-24T23:40:00Z'), NOW);
    expect(d.also).toBe('Siege of Chakhir Ruins, Nahantu');
    expect(d.alsoPredicted).toBeUndefined();
    expect(d.candidates).toHaveLength(4);
  });

  it('says in the candidates\' source that the expansion site is predicted on its own, and that it is not without the order', () => {
    const src = (o: { expansion?: boolean }) => {
      const f = source([], o).details('legion', occ('2026-10-25T00:05:00Z'), NOW).location;
      return f.known ? f.source : '';
    };
    expect(src({})).toMatch(/its site is predicted on its own, from a fixed order of expansion sites\./);
    expect(src({ expansion: false })).toMatch(/An expansion-region Legion can run at the same time; it is not predicted\./);
  });

  it('lists a later Legion\'s expansion site after its group\'s regions, with the caveat', () => {
    expect(source([]).predicted('legion', at('2026-10-25T00:30:00Z'), NOW)).toEqual({
      location: '4 candidates: Fractured Peaks, Scosglen, Kehjistan; also Cosmic Archives, Skovos (visibility may depend on campaign/stronghold progression)',
    });
    expect(source([]).predicted('legion', at('2026-10-25T00:55:00Z'), NOW)).toEqual({ location: '4 candidates: Hawezar, Dry Steppes; also Pirate Invasion, Skovos' });
  });

  it('still lights nothing on the radar with the expansion order in the data', () => {
    for (const t of ['2026-10-24T23:40:00Z', '2026-10-25T00:30:00Z']) expect(source([]).radarPredictions('legion', at(t), NOW)).toEqual([]);
  });

  it('predicts no expansion site before its pin, off the Legion grid, under a new schedule, or without the order', () => {
    expect(source([]).details('legion', occ('2026-10-24T21:35:00Z'), NOW).alsoPredicted).toBeUndefined();
    expect(source([]).legionExpansionAt(at('2026-10-25T00:31:00Z'))).toBeNull();
    const old = segsOf('legion')[0]!;
    const split = at('2026-11-01T00:00:00Z');
    const segments = (k: EventKind) => (k === 'legion' ? [{ ...old, untilMs: split }, { ...old, fromMs: split }] : segsOf(k));
    expect(source([]).legionExpansionAt(at('2026-11-01T00:25:00Z'))).not.toBeNull();
    expect(source([], { segments }).legionExpansionAt(at('2026-11-01T00:25:00Z'))).toBeNull();
    expect(source([], { segments }).legionExpansionAt(at('2026-10-31T23:35:00Z'))).not.toBeNull();
    expect(source([], { expansion: false }).details('legion', occ('2026-10-25T00:05:00Z'), NOW).alsoPredicted).toBeUndefined();
  });

  it('predicts no expansion site on a null step of the order, and the other steps as before', () => {
    const x = LEGION_EXPANSION!;
    const order = { ...x, cycle: { ...x.cycle, values: x.cycle.values.map((v) => (v === 'Cosmic Archives' ? null : v)) } };
    expect(source([], { order }).details('legion', occ('2026-10-25T00:30:00Z'), NOW).alsoPredicted).toBeUndefined();
    expect(source([], { order }).details('legion', occ('2026-10-25T00:55:00Z'), NOW).alsoPredicted).toEqual({ place: 'Pirate Invasion', region: 'Skovos' });
    expect(source([], { order }).predicted('legion', at('2026-10-25T00:30:00Z'), NOW)).toEqual({ location: '4 candidates: Fractured Peaks, Scosglen, Kehjistan' });
  });

  it('notes each Legion start\'s predicted expansion region in Coming up, and leaves other events\' rows without a note', () => {
    const s = source([]);
    const note: TimelineNote = (kind, t) => {
      const x = kind === 'legion' ? s.legionExpansionAt(t) : null;
      return x ? `also ${x.region}` : null;
    };
    const statuses = (['legion', 'worldBoss'] as EventKind[]).map((k) => ({ kind: k, name: k, definition: defs.find((d) => d.kind === k)! }) as unknown as EventStatus);
    const from = at('2026-10-25T00:00:00Z');
    const items = timelineItems(statuses, from, 3600000, 10, note);
    // 00:05 Of Souls and Spirits, 00:30 Cosmic Archives, 00:55 Pirate Invasion; the World Boss at 01:00.
    expect(items.filter((i) => i.kind === 'legion').map((i) => i.note)).toEqual(['also Nahantu', 'also Skovos', 'also Skovos']);
    const others = items.filter((i) => i.kind !== 'legion');
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((i) => i.note === undefined)).toBe(true);
    expect(timelineItems(statuses, from, 3600000, 10).every((i) => i.note === undefined)).toBe(true);
  });

  it('leaves the base-game candidates exactly as they are without the expansion order', () => {
    for (const t of ['2026-10-24T23:40:00Z', '2026-10-25T00:05:00Z', '2026-10-25T00:30:00Z']) {
      const { alsoPredicted, location, ...withOrder } = source([]).details('legion', occ(t), NOW);
      const { location: plain, ...without } = source([], { expansion: false }).details('legion', occ(t), NOW);
      expect(alsoPredicted).toBeDefined();
      expect(withOrder).toEqual(without);
      expect(location.known && location.value).toBe(plain.known && plain.value);
    }
  });
});

describe('the expansion Legion order in the data', () => {
  const x = LEGION_EXPANSION!;
  const regionOf = (site: string) => LOCATIONS.legionSites.find((s) => s.name === site)?.region;

  it('passes the data checks, and the checks refuse bad orders', () => {
    expect(checkRotations(ROTATIONS, EVENTS, LOCATIONS)).toEqual([]);
    const bad = structuredClone(ROTATIONS) as RotationsFile;
    const xb = bad.legion!.expansion!;
    xb.cycle = ['Siege of Chakhir Ruins', 'Kor Dragan', 'Nowhere', null];
    xb.caveats = { 'Cosmic Archives': 'not in the cycle now', 'Siege of Chakhir Ruins': ' ' };
    xb.pin.position = 4;
    const problems = checkRotations(bad, EVENTS, LOCATIONS).join('\n');
    expect(problems).toMatch(/legion expansion rotation step 1: Kor Dragan is not an expansion-region site/);
    expect(problems).toMatch(/legion expansion rotation step 2: Nowhere is not an expansion-region site/);
    expect(problems).toMatch(/legion expansion rotation caveat: Cosmic Archives is not in the cycle/);
    expect(problems).toMatch(/legion expansion rotation caveat: Siege of Chakhir Ruins needs its text/);
    expect(problems).toMatch(/legion expansion rotation pin: position must be 0 to 3/);
    xb.cycle = [null, null];
    expect(checkRotations(bad, EVENTS, LOCATIONS).join('\n')).toMatch(/legion expansion rotation: needs at least one site/);
  });

  it('is switched off by "enabled": false, and the checks refuse a missing switch', () => {
    const rec = ROTATIONS.legion!.expansion!;
    expect(rec.enabled).toBe(true);
    expect(legionExpansionOf(rec)).toBeDefined();
    expect(legionExpansionOf({ ...rec, enabled: false })).toBeUndefined();
    expect(legionExpansionOf(undefined)).toBeUndefined();
    const bad = structuredClone(ROTATIONS) as RotationsFile;
    delete (bad.legion!.expansion as Partial<LegionExpansionRecord>).enabled;
    expect(checkRotations(bad, EVENTS, LOCATIONS).join('\n')).toMatch(/legion expansion rotation: enabled must be true or false/);
  });

  it('is the four expansion sites once each, two in Nahantu then two in Skovos, pinned on the Legion grid', () => {
    expect(x.cycle.values).toEqual(['Siege of Chakhir Ruins', 'Of Souls and Spirits', 'Cosmic Archives', 'Pirate Invasion']);
    expect(x.cycle.values.map((s) => regionOf(s!))).toEqual(['nahantu', 'nahantu', 'skovos', 'skovos']);
    expect((x.cycle.pin.startMs / 1000) % 1500).toBe(1200);
  });

  it('gives the published sites from 22:00 UTC on 2026-10-24 to 01:20 UTC the next day', () => {
    const times = ['2026-10-24T22:00', '2026-10-24T22:25', '2026-10-24T22:50', '2026-10-24T23:15', '2026-10-24T23:40',
      '2026-10-25T00:05', '2026-10-25T00:30', '2026-10-25T00:55', '2026-10-25T01:20'];
    expect(times.map((t) => cycleAt(x.cycle, at(`${t}:00Z`), SLOT))).toEqual([
      'Siege of Chakhir Ruins', 'Of Souls and Spirits', 'Cosmic Archives', 'Pirate Invasion', 'Siege of Chakhir Ruins',
      'Of Souls and Spirits', 'Cosmic Archives', 'Pirate Invasion', 'Siege of Chakhir Ruins',
    ]);
  });

  it('repeats every 100 minutes and never two Legions in a row at one site, for months', () => {
    for (let t = x.cycle.pin.startMs; t < at('2027-02-01T00:00:00Z'); t += SLOT) {
      expect(cycleAt(x.cycle, t + 4 * SLOT, SLOT)).toBe(cycleAt(x.cycle, t, SLOT));
      expect(cycleAt(x.cycle, t + SLOT, SLOT)).not.toBe(cycleAt(x.cycle, t, SLOT));
    }
  });

  it('puts the stronghold sites on group A starts and the other two on group B starts', () => {
    const lg = LEGION_GROUPS!;
    for (let t = x.cycle.pin.startMs; t < at('2026-12-01T00:00:00Z'); t += SLOT) {
      const site = cycleAt(x.cycle, t, SLOT);
      const group = cycleAt(lg.cycle, t, SLOT);
      expect(group === 'a' ? ['Siege of Chakhir Ruins', 'Cosmic Archives'] : ['Of Souls and Spirits', 'Pirate Invasion']).toContain(site);
    }
  });
});
