import { describe, expect, it } from 'vitest';
import { artHash, chestSpots, chestState, observedHelltideRegions, spotKey, type ChestTypeInfo, type SharedSpot } from '../src/engine/chests';
import type { Observation } from '../src/engine/observations';
import { always } from '../src/engine/segments';

const MIN = 60000;
const hour = Date.UTC(2026, 9, 24, 14, 0);
const helltide = always({ anchorMs: hour, periodMs: 60 * MIN, durationMs: 55 * MIN });
const iso = (ms: number) => new Date(ms).toISOString();
const types: ChestTypeInfo[] = [{ id: 'mystery', name: 'Mystery', relocatesAtMinutes: [] }, { id: 'short', name: 'Moves twice', relocatesAtMinutes: [15, 30] }];

let n = 0;
function chest(atMs: number, extra: Partial<Observation> = {}): Observation {
  return {
    id: `c${n++}`, event: 'helltideChest', at: iso(atMs), timing: 'during', region: 'kehjistan', place: 'Old Well', chest: 'mystery',
    recordedAt: iso(atMs), ...extra,
  };
}
const shared: SharedSpot = { id: 'k1', region: 'kehjistan', name: 'Old Well', type: 'mystery', confidence: 'confirmed', checkedOn: '2026-10-24', source: 'ours' };

describe('chest spots', () => {
  it('merges a sighting into the shared spot with the same region, name (any case) and type', () => {
    const spots = chestSpots([shared], [chest(hour + 5 * MIN, { place: 'old well' })]);
    expect(spots).toHaveLength(1);
    expect(spots[0]!.origin).toBe('shared');
    expect(spots[0]!.sightings).toBe(1);
  });

  it('makes your own spot Confirmed only once you saw it yourself; reports alone leave it Unknown', () => {
    const reported = chestSpots([], [chest(hour, { provenance: 'reported' })]);
    expect(reported[0]!.confidence).toBe('unknown');
    const seenToo = chestSpots([], [chest(hour, { provenance: 'reported' }), chest(hour + MIN)]);
    expect(seenToo[0]!.confidence).toBe('confirmed');
  });

  it('keeps a different chest type at the same landmark as its own spot', () => {
    const spots = chestSpots([], [chest(hour), chest(hour, { chest: 'short' })]);
    expect(spots.map((s) => s.key).sort()).toEqual([spotKey('kehjistan', 'Old Well', 'mystery'), spotKey('kehjistan', 'Old Well', 'short')].sort());
  });

  it('uses the newest placement for your own spot', () => {
    const a = chest(hour, { timing: 'none', pos: { art: 'kehjistan:00000001', x: 0.1, y: 0.1 }, recordedAt: iso(hour) });
    const b = chest(hour, { timing: 'none', pos: { art: 'kehjistan:00000001', x: 0.5, y: 0.6 }, recordedAt: iso(hour + MIN) });
    expect(chestSpots([], [b, a])[0]!.position).toEqual({ art: 'kehjistan:00000001', x: 0.5, y: 0.6 });
  });
});

describe('active or not verified', () => {
  const spot = () => chestSpots([shared], [])[0]!;

  it('is not verified when nobody reported it, never "inactive"', () => {
    expect(chestState(spot(), [], helltide, types, hour + 10 * MIN)).toEqual({ state: 'unverified' });
  });

  it('is active from a sighting in this Helltide until the Helltide ends', () => {
    const list = [chest(hour + 5 * MIN)];
    expect(chestState(spot(), list, helltide, types, hour + 54 * MIN)).toMatchObject({ state: 'active', basis: 'seen', untilMs: hour + 55 * MIN });
    expect(chestState(spot(), list, helltide, types, hour + 55 * MIN)).toEqual({ state: 'unverified' });
    expect(chestState(spot(), list, helltide, types, hour + 65 * MIN)).toEqual({ state: 'unverified' });
  });

  it('expires when a chest type that moves next moves, and a mark after a move lasts until the following one', () => {
    const s = chestSpots([], [chest(hour + 5 * MIN, { chest: 'short' })])[0]!;
    const early = [chest(hour + 5 * MIN, { chest: 'short' })];
    expect(chestState(s, early, helltide, types, hour + 14 * MIN)).toMatchObject({ state: 'active', untilMs: hour + 15 * MIN });
    expect(chestState(s, early, helltide, types, hour + 15 * MIN).state).toBe('unverified');
    const late = [chest(hour + 31 * MIN, { chest: 'short' })];
    expect(chestState(s, late, helltide, types, hour + 50 * MIN)).toMatchObject({ state: 'active', untilMs: hour + 55 * MIN });
  });

  it('expires a mark made seconds before a move at that move', () => {
    const s = chestSpots([], [chest(hour + 5 * MIN, { chest: 'short' })])[0]!;
    const list = [chest(hour + 15 * MIN - 30000, { chest: 'short' })];
    expect(chestState(s, list, helltide, types, hour + 15 * MIN - 1000)).toMatchObject({ state: 'active', untilMs: hour + 15 * MIN });
    expect(chestState(s, list, helltide, types, hour + 15 * MIN).state).toBe('unverified');
  });

  it('ignores a spot record with no time, and a sighting dated in the future', () => {
    expect(chestState(spot(), [chest(hour + 5 * MIN, { timing: 'none' })], helltide, types, hour + 10 * MIN).state).toBe('unverified');
    expect(chestState(spot(), [chest(hour + 20 * MIN)], helltide, types, hour + 10 * MIN).state).toBe('unverified');
  });

  it('labels a secondhand report as reported, and prefers a sighting of your own', () => {
    const reported = [chest(hour + 5 * MIN, { provenance: 'reported' })];
    expect(chestState(spot(), reported, helltide, types, hour + 10 * MIN)).toMatchObject({ state: 'active', basis: 'reported' });
    const both = [...reported, chest(hour + 3 * MIN)];
    expect(chestState(spot(), both, helltide, types, hour + 10 * MIN)).toMatchObject({ basis: 'seen', seenMs: hour + 3 * MIN });
  });

  it('keeps realms apart when a realm is chosen, and counts a record without a realm for either', () => {
    const eternal = [chest(hour + 5 * MIN, { realm: 'eternal' })];
    expect(chestState(spot(), eternal, helltide, types, hour + 10 * MIN, 'seasonal').state).toBe('unverified');
    expect(chestState(spot(), eternal, helltide, types, hour + 10 * MIN, 'eternal').state).toBe('active');
    expect(chestState(spot(), [chest(hour + 5 * MIN)], helltide, types, hour + 10 * MIN, 'seasonal').state).toBe('active');
  });
});

describe('the Helltide regions seen in this Helltide', () => {
  const region = (atMs: number, extra: Partial<Observation> = {}): Observation =>
    ({ id: `r${n++}`, event: 'helltide', at: iso(atMs), timing: 'during', region: 'hawezar', recordedAt: iso(atMs), ...extra });

  it('shows during the Helltide it was seen in and expires when it ends', () => {
    const list = [region(hour + 2 * MIN)];
    expect(observedHelltideRegions(list, helltide, hour + 30 * MIN)).toEqual([{ region: 'hawezar', basis: 'seen' }]);
    expect(observedHelltideRegions(list, helltide, hour + 55 * MIN)).toEqual([]);
    expect(observedHelltideRegions(list, helltide, hour + 62 * MIN)).toEqual([]);
  });

  it('keeps two regions running at once, and labels a reported one as reported', () => {
    const list = [region(hour + 2 * MIN), region(hour + 5 * MIN, { region: 'nahantu', provenance: 'reported' })];
    expect(observedHelltideRegions(list, helltide, hour + 10 * MIN)).toEqual([{ region: 'hawezar', basis: 'seen' }, { region: 'nahantu', basis: 'reported' }]);
  });

  it('calls a region seen once you saw it, even if it was reported first', () => {
    const list = [region(hour + 1 * MIN, { provenance: 'reported' }), region(hour + 4 * MIN)];
    expect(observedHelltideRegions(list, helltide, hour + 10 * MIN)).toEqual([{ region: 'hawezar', basis: 'seen' }]);
  });
});

describe('drawing fingerprints', () => {
  it('are 8 hex digits, the same for the same drawing and different for another', () => {
    expect(artHash('<svg/>')).toMatch(/^[0-9a-f]{8}$/);
    expect(artHash('<svg/>')).toBe(artHash('<svg/>'));
    expect(artHash('<svg/>')).not.toBe(artHash('<svg />'));
  });
});
