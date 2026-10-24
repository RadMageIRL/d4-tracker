import { describe, expect, it } from 'vitest';
import { IntelligenceDetailsSource } from '../src/adapters/intelligence';
import { bossNames, DETAIL_REASONS, eventDefinitions, LOCATIONS, ROTATIONS, WORLD_BOSS_ROTATION } from '../src/data';
import { checkRotations, type RotationsFile } from '../src/data/schema';
import { EVENTS } from '../src/data';
import { hasExtraSpawn, type EventKind } from '../src/engine/events';
import type { Observation } from '../src/engine/observations';
import { predictMain, predictSecond, repin, type Rotation } from '../src/engine/rotation';

const MIN = 60000;
const DAY = 1440 * MIN;
const PERIOD = 210 * MIN;
const at = (iso: string) => Date.parse(iso);
const PIN = at('2026-10-24T14:30:00Z');
const spawn = (k: number) => PIN + k * PERIOD;

// A small cycle to test the mechanics: A and B take two spawns each, in two regions.
const ROT: Rotation = {
  cycle: [
    { boss: 'A', region: 'north' }, { boss: 'A', region: 'south' },
    { boss: 'B', region: 'north' }, { boss: 'B', region: 'east' },
  ],
  pin: { startMs: PIN, position: 1 },
  holdMs: 7 * DAY,
  second: { regions: ['isle', 'jungle'], pin: { startMs: PIN, position: 0 } },
};

describe('predicting from a pin', () => {
  it('steps one place per spawn from the pin, and wraps around the cycle', () => {
    expect([0, 1, 2, 3, 4].map((k) => predictMain(ROT, spawn(k), PERIOD)?.region)).toEqual(['south', 'north', 'east', 'north', 'south']);
    expect(predictMain(ROT, spawn(2), PERIOD)).toEqual({ boss: 'B', region: 'east' });
  });

  it('predicts nothing before the pin, after its hold, or off the spawn grid', () => {
    expect(predictMain(ROT, spawn(-1), PERIOD)).toBeNull();
    // A week is exactly 48 spawns: the spawn a week after the pin is the last one predicted.
    expect(predictMain(ROT, spawn(48), PERIOD)).not.toBeNull();
    expect(predictMain(ROT, spawn(49), PERIOD)).toBeNull();
    expect(predictMain(ROT, spawn(1) + MIN, PERIOD)).toBeNull();
  });

  it('gives the second boss of a double spawn the expansion regions in turn, on the double-spawn grid only', () => {
    const every = 4 * PERIOD;
    expect([0, 1, 2, 3].map((k) => predictSecond(ROT, PIN + k * every, every))).toEqual(['isle', 'jungle', 'isle', 'jungle']);
    expect(predictSecond(ROT, spawn(1), every)).toBeNull();
    expect(predictSecond(ROT, PIN - every, every)).toBeNull();
    expect(predictSecond({ ...ROT, second: undefined } as Rotation, PIN, every)).toBeNull();
  });
});

describe('re-pinning from the player\'s own sightings', () => {
  const pinOf = (r: Rotation) => [r.pin.startMs, r.pin.position];
  const go = (main: { k: number; boss?: string; region?: string }[]) =>
    repin(ROT, main.map(({ k, ...rest }) => ({ startMs: spawn(k), ...rest })), [], PERIOD, 4 * PERIOD);

  it('moves the pin forward when the rotation predicted what was seen, keeping its place', () => {
    const r = go([{ k: 2, boss: 'B', region: 'east' }]);
    expect(pinOf(r)).toEqual([spawn(2), 3]);
    // So the hold now runs from the new pin.
    const lastInNewHold = spawn(2 + Math.floor((7 * DAY) / PERIOD));
    expect(predictMain(r, lastInNewHold, PERIOD)).not.toBeNull();
    expect(predictMain(ROT, lastInNewHold, PERIOD)).toBeNull();
  });

  it('moves to the one place that fits a boss and region the rotation did not predict', () => {
    // Predicted B in the east at spawn 2; A was seen in the south: place 1.
    expect(pinOf(go([{ k: 2, boss: 'A', region: 'south' }]))).toEqual([spawn(2), 1]);
  });

  it('with only a boss, moves to the nearer of its places', () => {
    // Predicted place 3 (B, east) at spawn 2; A was seen: places 0 and 1, and 0 is nearer (one step ahead).
    expect(pinOf(go([{ k: 2, boss: 'A' }]))).toEqual([spawn(2), 0]);
    // A boss it predicted keeps the place.
    expect(pinOf(go([{ k: 2, boss: 'B' }]))).toEqual([spawn(2), 3]);
  });

  it('breaks a tie between two equally near places forward', () => {
    // Predicted place 3 at spawn 2; the north is places 0 (one ahead) and 2 (one behind).
    expect(pinOf(go([{ k: 2, region: 'north' }]))).toEqual([spawn(2), 0]);
  });

  it('falls back to the boss alone when the region fits nowhere with it, and ignores what fits nowhere at all', () => {
    expect(pinOf(go([{ k: 2, boss: 'A', region: 'east' }]))).toEqual([spawn(2), 0]);
    expect(pinOf(go([{ k: 2, region: 'desert' }]))).toEqual([PIN, 1]);
  });

  it('ignores sightings before the pin and off the grid, and follows several in time order', () => {
    expect(go([{ k: -2, boss: 'A', region: 'north' }])).toBe(ROT);
    expect(repin(ROT, [{ startMs: spawn(1) + MIN, boss: 'B' }], [], PERIOD, 4 * PERIOD)).toBe(ROT);
    // In time order: A in the north at spawn 1 is place 0, so B at spawn 3 is place 2 as predicted.
    // (Taken first, B alone at spawn 3 would land on place 3, the nearer of its two.)
    const r = go([{ k: 3, boss: 'B' }, { k: 1, boss: 'A', region: 'north' }]);
    expect(pinOf(r)).toEqual([spawn(3), 2]);
  });

  it('re-pins the second boss\'s turn from a second boss seen in an expansion region', () => {
    const every = 4 * PERIOD;
    const r = repin(ROT, [], [{ startMs: PIN + every, region: 'isle' }], PERIOD, every);
    expect(predictSecond(r, PIN + 2 * every, every)).toBe('jungle');
    expect(r.pin).toBe(ROT.pin);
  });
});

describe('the World Boss rotation in the data', () => {
  const rot = WORLD_BOSS_ROTATION!;

  it('passes the data checks, and they refuse a bad one', () => {
    expect(checkRotations(ROTATIONS, EVENTS, LOCATIONS)).toEqual([]);
    const bad = structuredClone(ROTATIONS) as RotationsFile;
    bad.worldBoss!.cycle[0]!.region = 'nahantu';
    bad.worldBoss!.pin.position = 8;
    bad.worldBoss!.holdDays = 0;
    bad.worldBoss!.second = { regions: ['scosglen'], pin: { start: '2026-10-24T11:00:00Z', position: 0 } };
    const problems = checkRotations(bad, EVENTS, LOCATIONS).join('\n');
    expect(problems).toMatch(/not a base-game region/);
    expect(problems).toMatch(/position must be 0 to 7/);
    expect(problems).toMatch(/holdDays must be 1 to 28/);
    expect(problems).toMatch(/distinct expansion region ids/);
  });

  it('has every boss in the roster, two spawns each', () => {
    const count = new Map<string, number>();
    for (const s of rot.cycle) count.set(s.boss, (count.get(s.boss) ?? 0) + 1);
    expect([...count.keys()].sort()).toEqual([...bossNames()].sort());
    expect([...count.values()].every((c) => c === 2)).toBe(true);
  });

  it('predicts no arena and no second-boss region: no arena order holds', () => {
    expect(rot.cycle.every((s) => s.region === undefined)).toBe(true);
    expect(rot.second).toBeUndefined();
  });

  it('is pinned to a World Boss start', () => {
    expect(Number.isInteger((rot.pin.startMs - at('2026-10-24T04:00:00Z')) / PERIOD)).toBe(true);
  });

  it("predicts its own pinned spawn from the pin's place in the cycle", () => {
    expect(predictMain(rot, rot.pin.startMs, PERIOD)).toEqual(rot.cycle[rot.pin.position]);
  });
});

describe('World Boss details and radar from the rotation', () => {
  const defs = eventDefinitions();
  const def = (kind: EventKind) => defs.find((d) => d.kind === kind)!;
  const wb = def('worldBoss');
  let n = 0;
  const sighting = (rest: Partial<Observation> & Pick<Observation, 'at'>): Observation =>
    ({ id: `rot${n++}`, event: 'worldBoss', timing: 'start', recordedAt: rest.at, ...rest });
  const source = (list: Observation[], rotation: Rotation | null = WORLD_BOSS_ROTATION ?? null, isShared?: () => boolean) => new IntelligenceDetailsSource({
    reasons: DETAIL_REASONS, sightings: () => list, segments: (k) => def(k).segments, registered: [], boundaries: [],
    regions: LOCATIONS.regions, arenas: LOCATIONS.worldBossArenas, bosses: bossNames(),
    ...(rotation ? { rotation } : {}), ...(isShared ? { isShared } : {}),
    extra: { every: wb.extra!.every, has: (ms) => hasExtraSpawn(wb, ms) },
  });
  const occ = (iso: string) => ({ index: 0, startMs: at(iso), endMs: at(iso) });
  const NOW = at('2026-10-24T17:00:00Z');

  it('predicts the boss of the next spawn, labeled predicted, and leaves the arena Unknown', () => {
    const d = source([]).details('worldBoss', occ('2026-10-24T18:00:00Z'), NOW);
    expect(d.identity).toMatchObject({ known: true, value: 'Azmodan', basis: 'predicted' });
    expect(d.identity?.known && d.identity.source).toMatch(/pinned to the spawn of 2026-10-24 14:30 UTC/);
    expect(d.location).toMatchObject({ known: false });
    expect(source([]).predicted('worldBoss', at('2026-10-24T18:00:00Z'), NOW)).toEqual({ identity: 'Azmodan' });
  });

  it('lights nothing on the radar from a predicted boss alone, double spawns included', () => {
    expect(source([]).radarPredictions('worldBoss', at('2026-10-24T18:00:00Z'), NOW)).toEqual([]);
    expect(source([]).radarPredictions('worldBoss', at('2026-10-25T01:00:00Z'), NOW)).toEqual([]);
  });

  it('shows the arena seen in game, and the boss seen instead of the prediction', () => {
    const arenaOnly = source([sighting({ at: '2026-10-24T21:30:00Z', place: 'Saraan Caldera', region: 'dry_steppes' })]).details('worldBoss', occ('2026-10-24T21:30:00Z'), NOW);
    expect(arenaOnly.location).toMatchObject({ value: 'Saraan Caldera, Dry Steppes', basis: 'seen' });
    expect(arenaOnly.identity).toMatchObject({ value: 'Azmodan', basis: 'predicted' });
    const both = source([sighting({ at: '2026-10-24T18:00:00Z', boss: 'Ashava', place: 'Seared Basin', region: 'kehjistan' })]).details('worldBoss', occ('2026-10-24T18:00:00Z'), NOW);
    expect(both.identity).toMatchObject({ value: 'Ashava', basis: 'seen' });
  });

  it("keeps a report about a spawn in the prediction's note, without showing it", () => {
    const told = [sighting({ at: '2026-10-24T18:00:00Z', boss: 'Ashava', provenance: 'reported' })];
    const d = source(told).details('worldBoss', occ('2026-10-24T18:00:00Z'), NOW);
    expect(d.identity).toMatchObject({ value: 'Azmodan', basis: 'predicted' });
    expect(d.identity?.known && d.identity.source).toMatch(/Reported to you, not checked in game: Ashava\.$/);
  });

  it("re-pins the boss order to the player's own boss sighting, not to a report, a shared record or an arena alone", () => {
    // The pin says 18:00 is place 6 (Azmodan). Ashava seen there moves the cycle to the nearer
    // Ashava place, 5, so 01:00 (two spawns on) is place 7, Azmodan, instead of place 0.
    const mine = [sighting({ at: '2026-10-24T18:00:00Z', boss: 'Ashava' })];
    expect(source(mine).predicted('worldBoss', at('2026-10-25T01:00:00Z'), NOW)).toEqual({ identity: 'Azmodan' });
    expect(source([]).predicted('worldBoss', at('2026-10-25T01:00:00Z'), NOW)).toEqual({ identity: 'Wandering Death' });
    const told = [sighting({ at: '2026-10-24T18:00:00Z', boss: 'Ashava', provenance: 'reported' })];
    expect(source(told).predicted('worldBoss', at('2026-10-25T01:00:00Z'), NOW)).toEqual({ identity: 'Wandering Death' });
    expect(source(mine, WORLD_BOSS_ROTATION, () => true).predicted('worldBoss', at('2026-10-25T01:00:00Z'), NOW)).toEqual({ identity: 'Wandering Death' });
    const arena = [sighting({ at: '2026-10-24T18:00:00Z', place: 'Caen Adar', region: 'scosglen' })];
    expect(source(arena).predicted('worldBoss', at('2026-10-25T01:00:00Z'), NOW)).toEqual({ identity: 'Wandering Death' });
  });

  it("never re-pins the boss order from a double spawn's second boss", () => {
    // 01:00 on the 25th brings a second boss; one seen in Nahantu says nothing about the main order.
    const second = [sighting({ at: '2026-10-25T01:00:00Z', boss: 'Ashava', place: 'The Cauldron', region: 'nahantu' })];
    expect(source(second).predicted('worldBoss', at('2026-10-25T04:30:00Z'), NOW)).toEqual({ identity: 'Wandering Death' });
  });

  it("would place a spawn, and a double spawn's second boss, if an arena order were ever in the data", () => {
    const base = WORLD_BOSS_ROTATION!;
    const withArenas: Rotation = {
      ...base,
      cycle: base.cycle.map((s, i) => ({ ...s, region: i % 2 ? 'scosglen' : 'kehjistan' })),
      second: { regions: ['nahantu', 'skovos'], pin: { startMs: at('2026-10-24T11:00:00Z'), position: 0 } },
    };
    const s = source([], withArenas);
    // 01:00 on the 25th: place 0 of the cycle (Kehjistan here), and the double spawn after the 11:00 pin (Skovos).
    expect(s.details('worldBoss', occ('2026-10-25T01:00:00Z'), NOW).location)
      .toMatchObject({ value: "Seared Basin, Kehjistan; also Hatred's Mortar, Skovos", basis: 'predicted' });
    expect(s.radarPredictions('worldBoss', at('2026-10-25T01:00:00Z'), NOW)).toEqual([
      { region: 'kehjistan', boss: 'Wandering Death', confidence: 'inferred' },
      { region: 'skovos', extra: true, confidence: 'inferred' },
    ]);
  });

  it('says Unknown, with the reason, once the pin has run out', () => {
    const s = source([]);
    const late = at('2026-11-01T00:00:00Z');
    expect(s.details('worldBoss', occ('2026-11-01T00:30:00Z'), late).identity).toMatchObject({ known: false });
    expect(s.rotationNote(late)).toMatchObject({ predicting: false });
    expect(s.rotationNote(NOW)).toMatchObject({ predicting: true, untilMs: at('2026-10-31T14:30:00Z') });
  });

  it('without a rotation, predicts no World Boss', () => {
    expect(source([], null).predicted('worldBoss', at('2026-10-24T18:00:00Z'), NOW)).toEqual({});
  });
});
