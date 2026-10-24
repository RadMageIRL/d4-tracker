import { describe, expect, it } from 'vitest';
import type { Observation } from '../src/engine/observations';
import {
  buildModel, findRule, MAX_TEST_CHANCE, MIN_TESTS, observedAt, predictAt, registeredToRule, sequencePoints,
  testChanceLimit, testRule, type ModelInput, type RegisteredRule, type SequencePoint,
} from '../src/engine/prediction';
import { always, type Segment } from '../src/engine/segments';

const MIN = 60000;
const anchor = Date.UTC(2026, 9, 24, 4, 0);
const wb: Segment[] = always({ anchorMs: anchor, periodMs: 210 * MIN, durationMs: 0 });
const spawn = (n: number) => anchor + n * 210 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function seen(n: number, boss: string, extra: Partial<Observation> = {}): Observation {
  return { id: `p${seq++}`, event: 'worldBoss', at: iso(spawn(n)), timing: 'start', boss, recordedAt: iso(spawn(n)), ...extra };
}

const ORDER = ['Ashava', 'Avarice', 'Wandering Death', 'Azmodan'];
/** Sightings of spawns `ns`, with bosses following ORDER from spawn 0. */
const cycle = (ns: number[], order = ORDER, shift = 0) => ns.map((n) => seen(n, order[(n + shift) % order.length]!));
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

function model(observations: Observation[], extra: Partial<ModelInput> = {}) {
  return buildModel({
    event: 'worldBoss', field: 'boss', observations, segments: wb, nowMs: spawn(200), boundariesMs: [], domainSize: 4, ...extra,
  });
}

describe('points: one value per occurrence, from sightings seen in game', () => {
  const opts = { segments: wb, segment: wb[0]! };

  it('leaves out secondhand reports, and counts them', () => {
    const set = sequencePoints([seen(0, 'Ashava'), seen(1, 'Avarice', { provenance: 'reported' })], 'worldBoss', 'boss', opts);
    expect(set.points.map((p) => p.value)).toEqual(['Ashava']);
    expect(set.reported).toBe(1);
  });

  it('leaves out an occurrence recorded with two different values, and counts the conflict', () => {
    const set = sequencePoints([seen(0, 'Ashava'), seen(0, 'Avarice'), seen(1, 'Azmodan')], 'worldBoss', 'boss', opts);
    expect(set.points.map((p) => p.index)).toEqual([1]);
    expect(set.conflicts).toBe(1);
  });

  it('leaves out occurrences before the reset boundary, and counts them as older', () => {
    const set = sequencePoints([seen(0, 'Ashava'), seen(5, 'Avarice')], 'worldBoss', 'boss', { ...opts, sinceMs: spawn(3) });
    expect(set.points.map((p) => p.index)).toEqual([5]);
    expect(set.older).toBe(1);
  });

  it('keeps realms apart when asked, and counts a record without a realm for either', () => {
    const list = [seen(0, 'Ashava', { realm: 'eternal' }), seen(1, 'Avarice', { realm: 'seasonal' }), seen(2, 'Azmodan')];
    const set = sequencePoints(list, 'worldBoss', 'boss', { ...opts, realm: 'seasonal' });
    expect(set.points.map((p) => p.value)).toEqual(['Avarice', 'Azmodan']);
  });

  it('makes a pair only from sightings that name both the boss and the place', () => {
    const list = [seen(0, 'Ashava', { place: 'Seared Basin' }), seen(1, 'Avarice')];
    const set = sequencePoints(list, 'worldBoss', 'pair', opts);
    expect(set.points.map((p) => p.value)).toEqual(['Ashava @ Seared Basin']);
  });
});

describe('finding a rule', () => {
  const pts = (ns: number[]): SequencePoint[] => ns.map((n) => ({ index: n, startMs: spawn(n), value: ORDER[n % 4]! }));

  it('finds nothing in a handful of sightings, however regular', () => {
    expect(findRule(pts([0, 1, 2]), 4)).toBeNull();
  });

  it('forms the rule from the earliest sightings that support it, and tests only the ones after', () => {
    const found = findRule(pts(range(0, 20)), 4)!;
    expect(found.rule.sequence).toEqual(ORDER);
    expect(found.formedBy).toBeLessThan(20);
    expect(found.rule.testFromMs).toBe(spawn(found.formedBy));
  });
});

describe('testing a rule on sightings', () => {
  const rule = { origin: 'found' as const, id: 'r', sequence: ORDER, offsets: [0], testFromMs: spawn(10), basis: 'test', documented: false };
  const pt = (n: number, value = ORDER[n % 4]!): SequencePoint => ({ index: n, startMs: spawn(n), value });

  it('counts only sightings from its test date on as predictions', () => {
    const t = testRule(rule, [pt(8), pt(9), pt(10), pt(11)], 4);
    expect(t.hits).toBe(2);
    expect(t.untested).toBe(2);
    expect(t.chance).toBeCloseTo(0.0625);
  });

  it('records a wrong prediction as a miss and a contradiction, and tests nothing after it', () => {
    const t = testRule(rule, [pt(10), pt(11, 'Ashava'), pt(12)], 4);
    expect(t.hits).toBe(1);
    expect(t.misses).toEqual([{ startMs: spawn(11), expected: 'Azmodan', seen: 'Ashava' }]);
    expect(t.contradiction).toEqual(t.misses[0]);
    expect(t.untested).toBe(1);
    expect(t.offsets).toEqual([]);
  });

  it('pins an unanchored order from the first sighting, which predicts nothing itself', () => {
    const open = { ...rule, offsets: [0, 1, 2, 3], testFromMs: 0 };
    const t = testRule(open, [pt(5), pt(6)], 4);
    expect(t.untested).toBe(1);
    expect(t.hits).toBe(1);
    expect(t.offsets).toEqual([0]);
  });

  it('stays unpinned while a value that appears twice in the order leaves the phase open', () => {
    const twice = { ...rule, sequence: ['Avarice', 'Ashava', 'Avarice', 'Azmodan'], offsets: [0, 1, 2, 3], testFromMs: 0 };
    const t = testRule(twice, [{ index: 0, startMs: spawn(0), value: 'Avarice' }], 4);
    expect(t.offsets).toEqual([0, 2]);
  });

  it('places an anchored order from its anchor occurrence', () => {
    const r: RegisteredRule = { id: 'x', event: 'worldBoss', field: 'boss', sequence: ORDER, anchor: iso(spawn(2)), registeredOn: '2026-10-24', basis: 'b', documented: false };
    const ruled = registeredToRule(r, wb[0]!);
    // Spawn 2 shows ORDER[0], so spawn 3 shows ORDER[1].
    expect(ORDER[(3 + ruled.offsets[0]!) % 4]).toBe('Avarice');
  });
});

describe('models', () => {
  it('with no sightings: unknown, and no prediction', () => {
    const m = model([]);
    expect(m.state).toBe('no-data');
    expect(m.confidence).toBe('unknown');
    expect(predictAt(m, spawn(201))).toBeNull();
  });

  it(`a true cycle found and then predicted right ${MIN_TESTS}+ times is inferred, never confirmed, and predicts the next spawn`, () => {
    const m = model(cycle(range(0, 24)));
    expect(m.state).toBe('inferred');
    expect(m.confidence).toBe('inferred');
    expect(m.test!.hits).toBeGreaterThanOrEqual(MIN_TESTS);
    expect(predictAt(m, spawn(201))).toBe(ORDER[201 % 4]);
  });

  it('a rule with too few predictions behind it stays unknown and predicts nothing', () => {
    const found = findRule(cycle(range(0, 40)).map((o, i) => ({ index: i, startMs: Date.parse(o.at), value: o.boss! })), 4)!;
    // Exactly the sightings that formed it, plus one: one correct prediction.
    const m = model(cycle(range(0, found.formedBy + 1)));
    expect(m.state).toBe('testing');
    expect(m.confidence).toBe('unknown');
    expect(m.test!.hits).toBe(1);
    expect(predictAt(m, spawn(201))).toBeNull();
  });

  it('withdraws a rule a sighting contradicts, and learns afresh from that sighting', () => {
    const list = [...cycle(range(0, 24)), seen(24, 'Azmodan')];
    const m = model(list);
    expect(m.changes).toEqual([{ startMs: spawn(24), expected: 'Ashava', seen: 'Azmodan' }]);
    expect(m.confidence).toBe('unknown');
    expect(predictAt(m, spawn(201))).toBeNull();
    expect(m.explanation).toMatch(/may have changed or reset/);
  });

  it('after a reset, learns the same order at its new place, and needs fresh predictions to infer it', () => {
    const before = cycle(range(0, 24));
    const after = cycle(range(24, 60), ORDER, 1);
    const m = model([...before, ...after]);
    expect(m.changes).toHaveLength(1);
    expect(m.changes[0]!.startMs).toBe(spawn(24));
    expect(m.confidence).toBe('inferred');
    expect(predictAt(m, spawn(201))).toBe(ORDER[(201 + 1) % 4]);
  });

  it('asks more of a rule after each restart', () => {
    expect(testChanceLimit(0)).toBe(MAX_TEST_CHANCE);
    expect(testChanceLimit(2)).toBeCloseTo(MAX_TEST_CHANCE / 3);
  });

  it('ignores sightings before the last reset boundary, and stops predicting at the next one', () => {
    const list = cycle(range(0, 24));
    const m = model(list, { boundariesMs: [spawn(30), spawn(205)] });
    expect(m.points).toBe(0);
    expect(m.older).toBe(24);
    const later = model(cycle(range(100, 140)), { boundariesMs: [spawn(205)] });
    expect(later.confidence).toBe('inferred');
    expect(predictAt(later, spawn(204))).toBe(ORDER[204 % 4]);
    expect(predictAt(later, spawn(205))).toBeNull();
  });

  describe('registered rules', () => {
    const reg = (extra: Partial<RegisteredRule> = {}): RegisteredRule => ({
      id: 'claim', event: 'worldBoss', field: 'boss', sequence: ORDER, anchor: null, registeredOn: iso(spawn(0)).slice(0, 10), basis: 'a guide', documented: false, ...extra,
    });

    it('tests only sightings from the day after it was registered', () => {
      // Spawns 0..5 fall on 2026-10-24, the day it was registered; spawn 6 is at 01:00 on the 25th.
      const m = model(cycle(range(0, 6)), { registered: [reg()] });
      expect(m.rule?.origin).toBe('registered');
      expect(m.test!.hits).toBe(0);
      expect(m.state).toBe('testing');
      expect(model(cycle(range(0, 9)), { registered: [reg()] }).test!.hits).toBe(3);
    });

    it(`is inferred after ${MIN_TESTS}+ correct predictions with no miss`, () => {
      const m = model(cycle(range(0, 14)), { registered: [reg()] });
      expect(m.rule?.origin).toBe('registered');
      expect(m.test!.hits).toBeGreaterThanOrEqual(MIN_TESTS);
      expect(m.test!.misses).toEqual([]);
      expect(m.confidence).toBe('inferred');
      expect(predictAt(m, spawn(201))).toBe(ORDER[201 % 4]);
    });

    it('is withdrawn by a contradiction, and an anchored order is not re-pinned', () => {
      const list = [...cycle(range(0, 14)), seen(14, 'Ashava')];
      const m = model(list, { registered: [reg({ anchor: iso(spawn(0)) })] });
      expect(m.rule?.origin).not.toBe('registered');
      expect(m.confidence).toBe('unknown');
    });

    it('is confirmed when Blizzard documents it and no sighting contradicts it', () => {
      const m = model([], { registered: [reg({ anchor: iso(spawn(0)), documented: true })] });
      expect(m.confidence).toBe('confirmed');
      const broken = model([seen(150, 'Azmodan')], { registered: [reg({ anchor: iso(spawn(0)), documented: true, registeredOn: '2026-01-01' })] });
      expect(broken.confidence).not.toBe('confirmed');
    });
  });

  describe('where the bar sits', () => {
    // A registered order of `n` distinct values, unanchored: the first sighting pins the phase and
    // predicts nothing; every later one is a test. With `domain` possible values a lucky match is 1/domain.
    const values = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    const run = (n: number, domain: number, tests: number) => buildModel({
      event: 'worldBoss', field: 'boss', segments: wb, nowMs: spawn(200), boundariesMs: [], domainSize: domain,
      observations: range(10, 11 + tests).map((k) => seen(k, values(n)[k % n]!)),
      registered: [{ id: 'r', event: 'worldBoss', field: 'boss', sequence: values(n), anchor: null, registeredOn: '2026-01-01', basis: 'test', documented: false }],
    });

    it(`needs ${MIN_TESTS} correct predictions even when 2 would already be a rare match`, () => {
      // 20 possible values: 2 correct predictions are a 0.25% match, still not enough.
      expect(run(20, 20, 2)).toMatchObject({ state: 'testing', confidence: 'unknown' });
      expect(run(20, 20, 3)).toMatchObject({ state: 'inferred', confidence: 'inferred' });
    });

    it(`infers at ${MIN_TESTS} correct predictions when the match is under ${MAX_TEST_CHANCE * 100}% (7 arenas: 0.3%)`, () => {
      expect(run(7, 7, 3)).toMatchObject({ state: 'inferred' });
    });

    it('does not infer when 3 correct predictions are a 1.6% match (4 bosses); a fourth is needed', () => {
      expect(run(4, 4, 3)).toMatchObject({ state: 'testing', confidence: 'unknown' });
      expect(run(4, 4, 4)).toMatchObject({ state: 'inferred' });
    });

    it('counts a correct prediction of a value that is common anyway for little: always the same boss needs 7, not 4', () => {
      const always = (tests: number) => buildModel({
        event: 'worldBoss', field: 'boss', segments: wb, nowMs: spawn(200), boundariesMs: [], domainSize: 4,
        observations: range(10, 10 + tests).map((k) => seen(k, 'Ashava')),
        registered: [{ id: 'r', event: 'worldBoss', field: 'boss', sequence: ['Ashava'], anchor: iso(spawn(0)), registeredOn: '2026-01-01', basis: 'test', documented: false }],
      });
      // 4 right of a varied order is a 0.4% match; 4 right of "always Ashava" is 2.9%.
      expect(always(4).test!.hits).toBe(4);
      expect(always(4).test!.chance).toBeGreaterThan(MAX_TEST_CHANCE);
      expect(always(4).confidence).toBe('unknown');
      expect(always(6).confidence).toBe('unknown');
      expect(always(7).confidence).toBe('inferred');
    });

    it('says ambiguous, and predicts nothing, while the sightings fit more than one place in the order', () => {
      const m = buildModel({
        event: 'worldBoss', field: 'boss', segments: wb, nowMs: spawn(200), boundariesMs: [], domainSize: 4,
        observations: [seen(10, 'Avarice')],
        registered: [{ id: 'r', event: 'worldBoss', field: 'boss', sequence: ['Avarice', 'Ashava', 'Avarice', 'Azmodan'], anchor: null, registeredOn: '2026-01-01', basis: 'test', documented: false }],
      });
      expect(m.state).toBe('ambiguous');
      expect(predictAt(m, spawn(201))).toBeNull();
    });
  });

  it('rarely infers anything from random values (overfitting check)', () => {
    let state = 12345;
    const rand = () => { state = (state * 1103515245 + 12345) % 2 ** 31; return state / 2 ** 31; };
    let inferred = 0;
    const runs = 60;
    for (let r = 0; r < runs; r++) {
      const list = range(0, 60).map((n) => seen(n, ORDER[Math.floor(rand() * 4)]!));
      if (model(list).confidence !== 'unknown') inferred++;
    }
    expect(inferred / runs).toBeLessThan(0.05);
  });
});

describe('what was seen for one occurrence', () => {
  it('returns the sightings of that occurrence, reports included, newest record first', () => {
    const a = seen(3, 'Ashava', { recordedAt: iso(spawn(3) + 60000) });
    const b = seen(3, 'Avarice', { provenance: 'reported', recordedAt: iso(spawn(3) + 120000) });
    const other = seen(4, 'Azmodan');
    expect(observedAt([a, b, other], wb, 'worldBoss', spawn(3)).map((o) => o.boss)).toEqual(['Avarice', 'Ashava']);
  });
});
