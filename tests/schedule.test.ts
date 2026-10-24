import { describe, expect, it } from 'vitest';
import {
  activeAt, indexAt, latestAtOrBefore, nextAfter, occurrence, startsBetween, upcoming, validateSchedule,
  type PeriodicSchedule,
} from '../src/engine/schedule';

const MIN = 60000;
const anchor = Date.UTC(2026, 9, 23, 12, 0, 0); // 2026-10-23 12:00 UTC
const hourly: PeriodicSchedule = { anchorMs: anchor, periodMs: 60 * MIN, durationMs: 55 * MIN };
const spawn: PeriodicSchedule = { anchorMs: anchor, periodMs: 210 * MIN, durationMs: 0 };

describe('occurrence math', () => {
  it('places occurrence n at anchor + n periods, both directions', () => {
    expect(occurrence(hourly, 0).startMs).toBe(anchor);
    expect(occurrence(hourly, 3).startMs).toBe(anchor + 180 * MIN);
    expect(occurrence(hourly, -2).startMs).toBe(anchor - 120 * MIN);
    expect(occurrence(hourly, 1).endMs).toBe(anchor + 115 * MIN);
  });

  it('indexAt floors before the anchor too (no truncation toward zero)', () => {
    expect(indexAt(hourly, anchor)).toBe(0);
    expect(indexAt(hourly, anchor - 1)).toBe(-1);
    expect(indexAt(hourly, anchor - 60 * MIN)).toBe(-1);
    expect(indexAt(hourly, anchor - 60 * MIN - 1)).toBe(-2);
    expect(indexAt(hourly, anchor + 60 * MIN - 1)).toBe(0);
  });

  it('gives the same answer for any anchor in the same cycle', () => {
    const far = { ...hourly, anchorMs: anchor - 5000 * 60 * MIN };
    const t = anchor + 37 * MIN;
    expect(activeAt(far, t)).toEqual({ ...activeAt(hourly, t)!, index: 5000 });
    expect(nextAfter(far, t).startMs).toBe(nextAfter(hourly, t).startMs);
  });
});

describe('active window boundaries', () => {
  it('is active from the start inclusive', () => {
    expect(activeAt(hourly, anchor)?.startMs).toBe(anchor);
  });

  it('is still active one ms before the end', () => {
    expect(activeAt(hourly, anchor + 55 * MIN - 1)?.startMs).toBe(anchor);
  });

  it('is inactive exactly at the end (exclusive)', () => {
    expect(activeAt(hourly, anchor + 55 * MIN)).toBeNull();
  });

  it('is inactive in the gap and one ms before the next start', () => {
    expect(activeAt(hourly, anchor + 57 * MIN)).toBeNull();
    expect(activeAt(hourly, anchor + 60 * MIN - 1)).toBeNull();
  });

  it('is active again at the next start', () => {
    expect(activeAt(hourly, anchor + 60 * MIN)?.index).toBe(1);
  });

  it('never reports an instant (zero-duration) schedule as active', () => {
    expect(activeAt(spawn, anchor)).toBeNull();
    expect(activeAt(spawn, anchor + 1)).toBeNull();
  });
});

describe('next start', () => {
  it('is strictly after t: at a start, the next one is the following start', () => {
    expect(nextAfter(spawn, anchor).startMs).toBe(anchor + 210 * MIN);
  });

  it('one ms before a start, the next one is that start', () => {
    expect(nextAfter(spawn, anchor - 1).startMs).toBe(anchor);
  });

  it('rolls over midnight UTC without a jump', () => {
    // 210 min from 22:00 UTC is 01:30 UTC the next day.
    const s = { ...spawn, anchorMs: Date.UTC(2026, 9, 23, 22, 0) };
    expect(nextAfter(s, Date.UTC(2026, 9, 23, 23, 59, 59)).startMs).toBe(Date.UTC(2026, 9, 24, 1, 30));
  });

  it('rolls over a year boundary', () => {
    const s = { ...hourly, anchorMs: Date.UTC(2026, 11, 31, 0, 0) };
    expect(nextAfter(s, Date.UTC(2026, 11, 31, 23, 30)).startMs).toBe(Date.UTC(2027, 0, 1, 0, 0));
  });

  it('latestAtOrBefore returns the start at t itself', () => {
    expect(latestAtOrBefore(spawn, anchor).startMs).toBe(anchor);
    expect(latestAtOrBefore(spawn, anchor - 1).startMs).toBe(anchor - 210 * MIN);
  });
});

describe('lists', () => {
  it('upcoming returns consecutive starts after t', () => {
    const list = upcoming(spawn, anchor + 1, 3).map((o) => o.startMs);
    expect(list).toEqual([anchor + 210 * MIN, anchor + 420 * MIN, anchor + 630 * MIN]);
  });

  it('startsBetween includes the from bound and excludes the to bound', () => {
    const list = startsBetween(hourly, anchor, anchor + 180 * MIN).map((o) => o.index);
    expect(list).toEqual([0, 1, 2]);
  });

  it('startsBetween is empty for an empty or reversed span', () => {
    expect(startsBetween(hourly, anchor, anchor)).toEqual([]);
    expect(startsBetween(hourly, anchor + 1, anchor)).toEqual([]);
  });

  it('a day holds 24 hourly starts and 6 or 7 starts of a 210-minute cycle', () => {
    const day = 1440 * MIN;
    expect(startsBetween(hourly, anchor, anchor + day)).toHaveLength(24);
    // 1440 / 210 = 6.86: a window of one day holds 6 or 7 spawns depending on where it begins.
    expect(startsBetween(spawn, anchor, anchor + day)).toHaveLength(7);
    expect(startsBetween(spawn, anchor + 1, anchor + 1 + day)).toHaveLength(6);
  });
});

describe('validation', () => {
  it('accepts a sane schedule', () => {
    expect(() => validateSchedule(hourly)).not.toThrow();
    expect(() => validateSchedule(spawn)).not.toThrow();
  });

  it('accepts an event that lasts its whole period, which is then always active', () => {
    const always = { ...hourly, durationMs: 60 * MIN };
    expect(() => validateSchedule(always)).not.toThrow();
    expect(activeAt(always, anchor + 60 * MIN - 1)?.index).toBe(0);
    expect(activeAt(always, anchor + 60 * MIN)?.index).toBe(1);
  });

  it('rejects a zero period even with a zero duration', () => {
    expect(() => validateSchedule({ ...spawn, periodMs: 0 })).toThrow(RangeError);
  });

  it('rejects a zero period, a negative duration and a duration longer than the period', () => {
    expect(() => validateSchedule({ ...hourly, periodMs: 0 })).toThrow(RangeError);
    expect(() => validateSchedule({ ...hourly, durationMs: -1 })).toThrow(RangeError);
    expect(() => validateSchedule({ ...hourly, durationMs: 61 * MIN })).toThrow(RangeError);
    expect(() => validateSchedule({ ...hourly, anchorMs: Number.NaN })).toThrow(RangeError);
  });
});
