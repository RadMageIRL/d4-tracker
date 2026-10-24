import { describe, expect, it } from 'vitest';
import {
  cleanObservation, FILE_FORMAT, FILE_VERSION, isSeen, merge, MIN_REPEATS, MIN_RULED_OUT, MAX_CHANCE, newId, offsetFromSchedule, parseFile,
  rotationCheck, timingCheck, toFile, TIMING_TOLERANCE_MS, type Observation,
} from '../src/engine/observations';
import { always } from '../src/engine/segments';

const MIN = 60000;
const wbAnchor = Date.UTC(2026, 9, 24, 4, 0);
const wb = always({ anchorMs: wbAnchor, periodMs: 210 * MIN, durationMs: 0 });
const ht = always({ anchorMs: Date.UTC(2026, 9, 24, 0, 0), periodMs: 60 * MIN, durationMs: 55 * MIN });

let seq = 0;
function obs(partial: Partial<Observation> & Pick<Observation, 'event' | 'at'>): Observation {
  return { id: `t${seq++}`, timing: 'start', recordedAt: '2026-10-24T12:00:00.000Z', ...partial };
}
const spawn = (n: number) => new Date(wbAnchor + n * 210 * MIN).toISOString();

describe('cleaning records', () => {
  it('keeps a valid record and normalizes its times', () => {
    const o = cleanObservation({ id: 'a1', event: 'worldBoss', at: '2026-10-24T04:00:00Z', timing: 'start', recordedAt: '2026-10-24T04:05:00Z', boss: ' Avarice ' });
    expect(o).toEqual({ id: 'a1', event: 'worldBoss', at: '2026-10-24T04:00:00.000Z', timing: 'start', recordedAt: '2026-10-24T04:05:00.000Z', boss: 'Avarice' });
  });

  it('rejects unknown events, timings, bad times, bad ids and odd region ids', () => {
    const base = { id: 'a1', event: 'worldBoss', at: '2026-10-24T04:00:00Z', timing: 'start', recordedAt: '2026-10-24T04:05:00Z' };
    expect(cleanObservation({ ...base, event: 'dungeon' })).toBeNull();
    expect(cleanObservation({ ...base, timing: 'maybe' })).toBeNull();
    expect(cleanObservation({ ...base, at: '2026-10-24 04:00' })).toBeNull();
    expect(cleanObservation({ ...base, at: '2026-10-24T04:00:00+02:00' })).toBeNull();
    expect(cleanObservation({ ...base, id: 'has space' })).toBeNull();
    expect(cleanObservation({ ...base, region: 'Dry Steppes' })).toBeNull();
    expect(cleanObservation(null)).toBeNull();
  });

  it('cuts long text to 120 characters and drops empty fields', () => {
    const o = cleanObservation({ id: 'a1', event: 'legion', at: '2026-10-24T02:00:00Z', timing: 'start', recordedAt: '2026-10-24T02:00:00Z', note: 'x'.repeat(500), place: '   ' })!;
    expect(o.note).toHaveLength(120);
    expect(o.place).toBeUndefined();
  });

  it('makes ids that differ and pass the id check', () => {
    const a = newId(1000, () => 0.1);
    const b = newId(1000, () => 0.2);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('version 2 fields', () => {
  const base = { id: 'v2', event: 'helltideChest', at: '2026-10-24T15:05:00Z', timing: 'during', recordedAt: '2026-10-24T15:05:00Z', region: 'kehjistan', place: 'Gate' };

  it('keeps a secondhand report, realm, hardcore, chest type and a placement (rounded)', () => {
    const o = cleanObservation({ ...base, provenance: 'reported', realm: 'eternal', hardcore: true, chest: 'mystery', pos: { art: 'kehjistan:0123abcd', x: 0.123456, y: 1 } })!;
    expect(o).toMatchObject({ provenance: 'reported', realm: 'eternal', hardcore: true, chest: 'mystery', pos: { art: 'kehjistan:0123abcd', x: 0.1235, y: 1 } });
    expect(isSeen(o)).toBe(false);
  });

  it('keeps a third-party source apart from in-game verification: the source alone is never evidence', () => {
    const predicted = cleanObservation({ ...base, provenance: 'reported', thirdParty: 'a tracker page, screenshot 09:11' })!;
    expect(predicted.thirdParty).toBe('a tracker page, screenshot 09:11');
    expect(isSeen(predicted)).toBe(false);
    const checked = cleanObservation({ ...base, thirdParty: 'a tracker page, screenshot 09:11' })!;
    expect(isSeen(checked)).toBe(true);
  });

  it('treats any provenance other than "reported" as seen, and drops a realm or hardcore value it does not know', () => {
    const o = cleanObservation({ ...base, provenance: 'heard', realm: 'ladder', hardcore: 'yes' })!;
    expect(o.provenance).toBeUndefined();
    expect(isSeen(o)).toBe(true);
    expect(o.realm).toBeUndefined();
    expect(o.hardcore).toBeUndefined();
  });

  it('refuses a record with a malformed chest type or a placement off the drawing', () => {
    expect(cleanObservation({ ...base, chest: 'Mystery<>' })).toBeNull();
    expect(cleanObservation({ ...base, pos: { art: 'kehjistan:0123abcd', x: 1.5, y: 0.5 } })).toBeNull();
    expect(cleanObservation({ ...base, pos: { art: '../evil', x: 0.5, y: 0.5 } })).toBeNull();
    expect(cleanObservation({ ...base, pos: 'here' })).toBeNull();
  });

  it('copies only the fields it knows, so extra keys in a file cannot reach the app', () => {
    const raw = JSON.parse(`{"id":"v2","event":"legion","at":"2026-10-24T02:00:00Z","timing":"start","recordedAt":"2026-10-24T02:00:00Z","__proto__":{"polluted":true},"onclick":"x"}`);
    const o = cleanObservation(raw)!;
    expect(Object.keys(o).sort()).toEqual(['at', 'event', 'id', 'recordedAt', 'timing']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps markup in text fields as plain text, cut to 120 characters', () => {
    const o = cleanObservation({ ...base, place: `<img src=x onerror=alert(1)>${'x'.repeat(200)}` })!;
    expect(o.place!.startsWith('<img src=x')).toBe(true);
    expect(o.place).toHaveLength(120);
  });
});

describe('files', () => {
  it('round-trips an export', () => {
    const list = [obs({ event: 'worldBoss', at: spawn(0), boss: 'Ashava' })];
    const parsed = parseFile(JSON.stringify(toFile(list, Date.UTC(2026, 9, 25))));
    expect(parsed.observations).toEqual(list);
    expect(parsed.rejected).toBe(0);
  });

  it('counts unreadable records instead of failing the whole file', () => {
    const file = { format: FILE_FORMAT, version: 1, exportedAt: '2026-10-25T00:00:00Z', observations: [obs({ event: 'legion', at: spawn(0) }), { nope: 1 }] };
    expect(parseFile(JSON.stringify(file))).toMatchObject({ rejected: 1 });
  });

  it('reads a version 1 file (every record counts as seen) and writes version 2', () => {
    const v1 = { format: FILE_FORMAT, version: 1, exportedAt: '2026-10-23T00:00:00Z', observations: [obs({ event: 'worldBoss', at: spawn(0), boss: 'Ashava' })] };
    const parsed = parseFile(JSON.stringify(v1));
    expect(parsed.observations).toHaveLength(1);
    expect(isSeen(parsed.observations[0]!)).toBe(true);
    expect(FILE_VERSION).toBe(2);
    expect(toFile([], 0).version).toBe(2);
  });

  it('refuses something that is not a sightings file, or is from a newer version', () => {
    expect(() => parseFile('not json')).toThrow(/not a JSON file/);
    expect(() => parseFile('{"format":"other","observations":[]}')).toThrow(/not a D4 Tracker sightings file/);
    expect(() => parseFile(`{"format":"${FILE_FORMAT}","version":99,"observations":[]}`)).toThrow(/newer version/);
  });

  it('merges without duplicates, by id or by the same sighting recorded twice', () => {
    const a = obs({ event: 'worldBoss', at: spawn(0), boss: 'Ashava' });
    const sameAgain = { ...a, id: 'other-id', at: new Date(Date.parse(a.at) + 20000).toISOString() };
    const b = obs({ event: 'worldBoss', at: spawn(1), boss: 'Avarice' });
    const r = merge([a], [a, sameAgain, b]);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(2);
    expect(r.merged.map((o) => o.boss)).toEqual(['Ashava', 'Avarice']);
  });

  it('keeps a chest marked active and the same chest placed on the map in the same minute', () => {
    const base = { event: 'helltideChest' as const, at: '2026-10-24T15:10:00.000Z', region: 'kehjistan', place: 'Gate', chest: 'mystery' };
    const mark = obs({ ...base, timing: 'during' });
    const placed = obs({ ...base, at: '2026-10-24T15:10:20.000Z', timing: 'none', pos: { art: 'kehjistan:0123abcd', x: 0.4, y: 0.5 } });
    const r = merge([], [mark, placed]);
    expect(r.added).toBe(2);
    expect(r.duplicates).toBe(0);
  });
});

describe('timing against the schedule', () => {
  it('measures the signed offset to the nearest calculated start', () => {
    expect(offsetFromSchedule(wb, wbAnchor + 90000)).toBe(90000);
    expect(offsetFromSchedule(wb, wbAnchor - 60000)).toBe(-60000);
  });

  it('agrees within the 2-minute tolerance and not beyond', () => {
    expect(TIMING_TOLERANCE_MS).toBe(120000);
    const list = [
      obs({ event: 'worldBoss', at: new Date(wbAnchor + 120000).toISOString() }),
      obs({ event: 'worldBoss', at: new Date(wbAnchor + 121000).toISOString() }),
    ];
    const r = timingCheck(list, wb, 'worldBoss');
    expect(r.checked).toBe(2);
    expect(r.agree).toBe(1);
    expect(r.disagree.map((d) => d.offsetMs)).toEqual([121000]);
  });

  it('flags a sighting 30 minutes off as not matching (a shifted cycle would show up this way)', () => {
    const r = timingCheck([obs({ event: 'worldBoss', at: new Date(wbAnchor + 30 * MIN).toISOString() })], wb, 'worldBoss');
    expect(r.agree).toBe(0);
    expect(r.disagree).toHaveLength(1);
  });

  it('treats a Helltide seen exactly at :55 as after its window (the end is exclusive)', () => {
    const r = timingCheck([obs({ event: 'helltide', timing: 'during', at: '2026-10-24T15:55:00.000Z' })], ht, 'helltide');
    expect(r.agree).toBe(0);
    expect(r.disagree.map((d) => d.offsetMs)).toEqual([0]);
  });

  it('checks an "already running" Helltide against its 55-minute window', () => {
    const inside = obs({ event: 'helltide', timing: 'during', at: '2026-10-24T15:54:00.000Z' });
    const gap = obs({ event: 'helltide', timing: 'during', at: '2026-10-24T15:56:00.000Z' });
    const r = timingCheck([inside, gap], ht, 'helltide');
    expect(r.agree).toBe(1);
    expect(r.disagree).toHaveLength(1);
  });

  it('skips sightings it cannot check: other events, chest sightings, "already running" spawns', () => {
    const list = [
      obs({ event: 'legion', at: spawn(0) }),
      obs({ event: 'worldBoss', timing: 'during', at: spawn(0) }),
      obs({ event: 'helltideChest', timing: 'none', at: spawn(0) }),
    ];
    expect(timingCheck(list, wb, 'worldBoss').checked).toBe(0);
  });
});

describe('rotation', () => {
  const bosses = ['Ashava', 'Avarice', 'Wandering Death', 'Azmodan'];
  const cycle = (n: number) => bosses[Math.floor(n / 2) % 4]!; // pairs, 8 spawns long
  const sightingsOf = (indices: number[], value: (n: number) => string) =>
    indices.map((n) => obs({ event: 'worldBoss', at: spawn(n), boss: value(n) }));

  it('says not enough data for a handful of sightings, even if they look regular', () => {
    const r = rotationCheck(sightingsOf([0, 1, 2, 3, 4], cycle), wb, 'worldBoss', 'boss', 4);
    expect(r.verdict).toBe('not-enough-data');
    expect(r.explanation).not.toMatch(/consistent with/i);
  });

  it('needs every position seen at least twice before testing a cycle', () => {
    expect(MIN_REPEATS).toBe(2);
    // 15 consecutive spawns: one position of the 8-cycle is seen once, so 8 cannot be tested.
    const r = rotationCheck(sightingsOf([...Array(15).keys()], cycle), wb, 'worldBoss', 'boss', 4);
    expect(r.testedUpTo).toBeLessThan(8);
    expect(r.verdict).not.toBe('consistent');
  });

  it('reports a true 8-spawn cycle as consistent once each position is seen twice, never as proven', () => {
    const r = rotationCheck(sightingsOf([...Array(16).keys()], cycle), wb, 'worldBoss', 'boss', 4);
    expect(r.verdict).toBe('consistent');
    expect(r.period).toBe(8);
    expect(r.repeats).toBe(2);
    expect(r.chance!).toBeLessThan(MAX_CHANCE);
    // 8 positions seen twice each among 4 possible bosses: (1/4)^8, times the 8 cycle lengths tried.
    expect(r.chance!).toBeCloseTo(0.25 ** 8 * 8, 12);
    expect(r.explanation).toMatch(/Not proven/);
  });

  it('does not say "no pattern" until cycles up to 6 are ruled out', () => {
    expect(MIN_RULED_OUT).toBe(6);
    const r = rotationCheck(sightingsOf([0, 1, 2, 3, 4], cycle), wb, 'worldBoss', 'boss', 4);
    expect(r.testedUpTo).toBe(2);
    expect(r.verdict).toBe('not-enough-data');
    expect(r.explanation).toMatch(/not enough to test for a repeating order yet/);
  });

  it('finds no pattern in values that do not repeat', () => {
    // A sequence with no period up to 12: every value changes in a way no short cycle fits.
    const noise = ['Ashava', 'Avarice', 'Avarice', 'Azmodan', 'Ashava', 'Wandering Death', 'Azmodan', 'Ashava',
      'Avarice', 'Wandering Death', 'Wandering Death', 'Ashava', 'Azmodan', 'Avarice', 'Ashava', 'Azmodan',
      'Wandering Death', 'Avarice', 'Ashava', 'Ashava', 'Azmodan', 'Avarice', 'Wandering Death', 'Azmodan',
      'Ashava', 'Avarice'];
    const r = rotationCheck(sightingsOf([...noise.keys()], (n) => noise[n]!), wb, 'worldBoss', 'boss', 4);
    expect(r.verdict).toBe('no-pattern');
  });

  it('does not call a lucky fit consistent when few values are possible', () => {
    // Two possible values and four sightings that all match: chance alone does this often.
    const r = rotationCheck(sightingsOf([0, 1, 2, 3], () => 'Ashava'), wb, 'worldBoss', 'boss', 2);
    expect(r.verdict).toBe('not-enough-data');
    expect(r.chance!).toBeGreaterThanOrEqual(MAX_CHANCE);
  });

  it('adjusts the chance for the number of cycle lengths tried', () => {
    // Four identical sightings among 3 possible values: (1/3)^3 = 3.7% alone, but two cycle
    // lengths were testable, so about 7.4%: not enough.
    const r = rotationCheck(sightingsOf([0, 1, 2, 3], () => 'Ashava'), wb, 'worldBoss', 'boss', 3);
    expect(r.testedUpTo).toBe(2);
    expect(r.chance!).toBeCloseTo((1 / 3) ** 3 * 2, 12);
    expect(r.verdict).toBe('not-enough-data');
  });

  it('leaves out an occurrence recorded with two different values and counts it as a conflict', () => {
    const list = [obs({ event: 'worldBoss', at: spawn(0), boss: 'Ashava' }), obs({ event: 'worldBoss', at: spawn(0), boss: 'Avarice' })];
    const r = rotationCheck(list, wb, 'worldBoss', 'boss', 4);
    expect(r.conflicts).toBe(1);
    expect(r.samples).toBe(0);
  });

  it('places a start typed a minute early in its own occurrence, not the one before', () => {
    const first = obs({ event: 'worldBoss', at: spawn(0), boss: 'Ashava' });
    const early = obs({ event: 'worldBoss', at: new Date(wbAnchor + 210 * MIN - 60000).toISOString(), boss: 'Avarice' });
    const r = rotationCheck([first, early], wb, 'worldBoss', 'boss', 4);
    expect(r.conflicts).toBe(0);
    expect(r.samples).toBe(2);
    expect(r.counts).toEqual({ Ashava: 1, Avarice: 1 });
  });
});
