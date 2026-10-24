import { describe, expect, it } from 'vitest';
import { IntelligenceDetailsSource } from '../src/adapters/intelligence';
import { bossNames, DETAIL_REASONS, eventDefinitions, EVENTS, HELLTIDE_CYCLES, LOCATIONS, ROTATIONS } from '../src/data';
import { checkRotations, type RotationsFile } from '../src/data/schema';
import type { EventKind } from '../src/engine/events';
import type { Observation } from '../src/engine/observations';
import { cycleAt, type Cycle } from '../src/engine/rotation';
import type { Segment } from '../src/engine/segments';

const HOUR = 3600000;
const at = (iso: string) => Date.parse(iso);
const PIN = at('2026-10-24T18:00:00Z');

describe('a Helltide region cycle', () => {
  const c: Cycle = { values: ['a', null, 'b'], pin: { startMs: PIN, position: 1 } };

  it('steps one place per Helltide from its pin, wrapping, with null where none runs', () => {
    expect([0, 1, 2, 3, 4].map((k) => cycleAt(c, PIN + k * HOUR, HOUR))).toEqual([null, 'b', 'a', null, 'b']);
  });

  it('gives nothing before its pin or off the hour', () => {
    expect(cycleAt(c, PIN - HOUR, HOUR)).toBeNull();
    expect(cycleAt(c, PIN + HOUR + 60000, HOUR)).toBeNull();
  });
});

describe('the Helltide region cycles in the data', () => {
  const ORDER = ['fractured_peaks', 'scosglen', 'dry_steppes', 'kehjistan', 'hawezar'];
  const base = HELLTIDE_CYCLES.base!;
  const expansion = HELLTIDE_CYCLES.expansion!;

  it('pass the data checks, and the checks refuse bad cycles', () => {
    expect(checkRotations(ROTATIONS, EVENTS, LOCATIONS)).toEqual([]);
    const bad = structuredClone(ROTATIONS) as RotationsFile;
    bad.helltide!.base.cycle[0] = null;
    bad.helltide!.base.cycle[1] = 'nahantu';
    bad.helltide!.expansion!.cycle = [null, 'scosglen'];
    bad.helltide!.expansion!.pin.position = 2;
    const problems = checkRotations(bad, EVENTS, LOCATIONS).join('\n');
    expect(problems).toMatch(/helltide rotation base step 0: null is not a base-game region/);
    expect(problems).toMatch(/helltide rotation base step 1: nahantu is not a base-game region/);
    expect(problems).toMatch(/helltide rotation expansion step 1: scosglen is not an expansion region/);
    expect(problems).toMatch(/helltide rotation expansion pin: position must be 0 to 1/);
  });

  it('are pinned on the hour', () => {
    expect(base.pin.startMs % HOUR).toBe(0);
    expect(expansion.pin.startMs % HOUR).toBe(0);
  });

  it('visit every base-game region once per cycle, never the same twice in a row', () => {
    expect([...base.values].sort()).toEqual([...ORDER].sort());
  });

  it('give the base region of hour h as ORDER[(h + 1) mod 5], the rule the records fit, for weeks ahead', () => {
    for (let t = PIN; t < PIN + 30 * 24 * HOUR; t += HOUR) {
      expect(cycleAt(base, t, HOUR)).toBe(ORDER[(t / HOUR + 1) % 5]);
    }
  });

  it('give an expansion Helltide in Skovos at UTC hours 0 mod 4 and Nahantu at 2 mod 4, none at odd hours', () => {
    for (let t = PIN; t < PIN + 7 * 24 * HOUR; t += HOUR) {
      expect(cycleAt(expansion, t, HOUR)).toBe(({ 0: 'skovos', 2: 'nahantu' } as Record<number, string>)[new Date(t).getUTCHours() % 4] ?? null);
    }
  });

  it('give the Helltide of 2026-10-24 18:00 UTC as recorded: Hawezar and Nahantu', () => {
    expect([cycleAt(base, PIN, HOUR), cycleAt(expansion, PIN, HOUR)]).toEqual(['hawezar', 'nahantu']);
  });
});

describe('the Helltide card and radar from the cycles', () => {
  const defs = eventDefinitions();
  const segsOf = (k: EventKind) => defs.find((d) => d.kind === k)!.segments;
  let n = 0;
  const mark = (iso: string, region: string, rest: Partial<Observation> = {}): Observation =>
    ({ id: `hc${n++}`, event: 'helltide', at: iso, timing: 'during', region, recordedAt: iso, ...rest });
  const source = (list: Observation[], opts: { cycles?: boolean; segments?: (k: EventKind) => Segment[] } = {}) => new IntelligenceDetailsSource({
    reasons: DETAIL_REASONS, sightings: () => list, segments: opts.segments ?? segsOf, registered: [], boundaries: [],
    regions: LOCATIONS.regions, arenas: LOCATIONS.worldBossArenas, bosses: bossNames(),
    ...(opts.cycles === false ? {} : { helltideCycles: HELLTIDE_CYCLES }),
  });
  const occ = (iso: string) => ({ index: 0, startMs: at(iso), endMs: at(iso) + 55 * 60000 });
  const NOW = at('2026-10-24T19:10:00Z');

  it('predicts the region of the Helltide in progress, labeled predicted', () => {
    expect(source([]).details('helltide', occ('2026-10-24T19:00:00Z'), NOW).location)
      .toMatchObject({ known: true, value: 'Fractured Peaks', basis: 'predicted' });
    expect(source([]).details('helltide', occ('2026-10-24T20:00:00Z'), NOW).location)
      .toMatchObject({ value: 'Scosglen and Skovos', basis: 'predicted' });
  });

  it('lights both kinds on the radar, base-game and expansion', () => {
    expect(source([]).radarPredictions('helltide', at('2026-10-24T20:00:00Z'), NOW)).toEqual([
      { region: 'scosglen', confidence: 'inferred' }, { region: 'skovos', confidence: 'inferred' },
    ]);
    expect(source([]).radarPredictions('helltide', at('2026-10-24T19:00:00Z'), NOW)).toEqual([{ region: 'fractured_peaks', confidence: 'inferred' }]);
  });

  it('shows what was seen for its kind, and keeps the other kind predicted, each labeled', () => {
    const d = source([mark('2026-10-24T20:05:00Z', 'hawezar')]).details('helltide', occ('2026-10-24T20:00:00Z'), NOW).location;
    expect(d).toMatchObject({ known: true, value: 'Hawezar (seen); Skovos (predicted)' });
    expect(d.known && d.basis).toBeFalsy();
    const both = source([mark('2026-10-24T20:05:00Z', 'hawezar'), mark('2026-10-24T20:06:00Z', 'nahantu')]).details('helltide', occ('2026-10-24T20:00:00Z'), NOW).location;
    expect(both).toMatchObject({ value: 'Hawezar and Nahantu', basis: 'seen' });
  });

  it('is not moved by a mark: the next hour stays on the cycle', () => {
    const s = source([mark('2026-10-24T20:05:00Z', 'hawezar')]);
    expect(s.predicted('helltide', at('2026-10-24T21:00:00Z'), NOW)).toEqual({ location: 'Dry Steppes' });
  });

  it('keeps a report in the prediction\'s note, never as the region', () => {
    const d = source([mark('2026-10-24T19:05:00Z', 'kehjistan', { provenance: 'reported' })]).details('helltide', occ('2026-10-24T19:00:00Z'), NOW).location;
    expect(d).toMatchObject({ value: 'Fractured Peaks', basis: 'predicted' });
    expect(d.known && d.source).toMatch(/Reported to you, not checked in game: Kehjistan\.$/);
  });

  it('predicts nothing under a new Helltide schedule until the data pins the cycles there', () => {
    const old = segsOf('helltide')[0]!;
    const split = at('2026-11-01T00:00:00Z');
    const segments = (k: EventKind) => (k === 'helltide' ? [{ ...old, untilMs: split }, { ...old, fromMs: split }] : segsOf(k));
    const s = source([], { segments });
    expect(s.predicted('helltide', at('2026-10-31T23:00:00Z'), NOW).location).toBeTruthy();
    expect(s.predicted('helltide', at('2026-11-01T01:00:00Z'), NOW)).toEqual({});
  });

  it('without the cycles, predicts no Helltide region', () => {
    expect(source([], { cycles: false }).radarPredictions('helltide', at('2026-10-24T20:00:00Z'), NOW)).toEqual([]);
  });
});
