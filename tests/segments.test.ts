import { describe, expect, it } from 'vitest';
import { activeOccurrence, always, lastStart, nextStart, segmentAt, startsAfter, startsInRange, type Segment } from '../src/engine/segments';
import type { PeriodicSchedule } from '../src/engine/schedule';

const MIN = 60000;
const HOUR = 60 * MIN;
// A rehearsal of the Season 16 change: hourly on the hour until the switch, then on the half hour.
const switchAt = Date.UTC(2026, 11, 1, 17, 0); // a made-up date for the test
const before: PeriodicSchedule = { anchorMs: Date.UTC(2026, 9, 24, 0, 0), periodMs: HOUR, durationMs: 55 * MIN };
const after: PeriodicSchedule = { anchorMs: Date.UTC(2026, 9, 24, 0, 30), periodMs: HOUR, durationMs: 55 * MIN };
const segs: Segment[] = [
  { fromMs: -Infinity, untilMs: switchAt, schedule: before },
  { fromMs: switchAt, untilMs: Infinity, schedule: after },
];

describe('a single open-ended segment', () => {
  const one = always(before);
  it('behaves like the plain schedule', () => {
    const t = Date.UTC(2026, 9, 24, 15, 10);
    expect(nextStart(one, t)?.startMs).toBe(Date.UTC(2026, 9, 24, 16, 0));
    expect(lastStart(one, t)?.startMs).toBe(Date.UTC(2026, 9, 24, 15, 0));
    expect(activeOccurrence(one, t)?.startMs).toBe(Date.UTC(2026, 9, 24, 15, 0));
  });
});

describe('switching schedules at a date', () => {
  it('uses the old schedule before the switch and the new one after', () => {
    expect(segmentAt(segs, switchAt - 1)?.schedule).toBe(before);
    expect(segmentAt(segs, switchAt)?.schedule).toBe(after);
  });

  it('drops the old rule start at the switch instant; the next start is from the new rule', () => {
    // The old rule would start at 17:00, the switch itself; from then on starts are at :30.
    expect(nextStart(segs, switchAt - 30 * MIN)?.startMs).toBe(switchAt + 30 * MIN);
  });

  it('lists starts across the switch with no old start after it', () => {
    const list = startsInRange(segs, switchAt - 3 * HOUR, switchAt + 2 * HOUR).map((o) => (o.startMs - switchAt) / MIN);
    expect(list).toEqual([-180, -120, -60, 30, 90]);
  });

  it('ends the last old window at its own end, before a switch on the hour', () => {
    expect(activeOccurrence(segs, switchAt - HOUR + 55 * MIN - 1)?.startMs).toBe(switchAt - HOUR);
    expect(activeOccurrence(segs, switchAt - HOUR + 55 * MIN)).toBeNull();
    expect(activeOccurrence(segs, switchAt + 10 * MIN)).toBeNull();
  });

  it('keeps an old window running through a mid-hour switch until a new start replaces it', () => {
    const mid = Date.UTC(2026, 11, 1, 17, 20);
    const split: Segment[] = [
      { fromMs: -Infinity, untilMs: mid, schedule: before },
      { fromMs: mid, untilMs: Infinity, schedule: after },
    ];
    expect(activeOccurrence(split, mid + 5 * MIN)?.startMs).toBe(Date.UTC(2026, 11, 1, 17, 0));
    expect(activeOccurrence(split, mid + 11 * MIN)?.startMs).toBe(Date.UTC(2026, 11, 1, 17, 30));
  });

  it('the last start before a time can come from the earlier segment', () => {
    expect(lastStart(segs, switchAt + 10 * MIN)?.startMs).toBe(switchAt - HOUR);
    expect(lastStart(segs, switchAt + 30 * MIN)?.startMs).toBe(switchAt + 30 * MIN);
  });

  it('startsAfter walks across the switch', () => {
    expect(startsAfter(segs, switchAt - 90 * MIN, 3).map((o) => (o.startMs - switchAt) / MIN)).toEqual([-60, 30, 90]);
  });
});

describe('a new rule with a start exactly at the switch', () => {
  // The new rule is anchored on the hour too, so it starts exactly at the switch instant.
  const longer: PeriodicSchedule = { anchorMs: Date.UTC(2026, 9, 24, 0, 0), periodMs: HOUR, durationMs: 58 * MIN };
  const atSwitch: Segment[] = [
    { fromMs: -Infinity, untilMs: switchAt, schedule: before },
    { fromMs: switchAt, untilMs: Infinity, schedule: longer },
  ];

  it('counts the start at the switch instant as the first start of the new rule', () => {
    expect(lastStart(atSwitch, switchAt)?.startMs).toBe(switchAt);
    expect(activeOccurrence(atSwitch, switchAt + 57 * MIN)?.startMs).toBe(switchAt);
    expect(nextStart(atSwitch, switchAt - 1)?.startMs).toBe(switchAt);
  });
});

describe('gaps in the data', () => {
  const ending: Segment[] = [{ fromMs: -Infinity, untilMs: switchAt, schedule: before }];
  it('has no next start after the last segment ends (the card then says it needs updating)', () => {
    expect(nextStart(ending, switchAt)).toBeNull();
    expect(startsAfter(ending, switchAt - 30 * MIN, 5)).toHaveLength(0);
    expect(segmentAt(ending, switchAt)).toBeNull();
  });

  it('has no last start before the first segment begins', () => {
    const starting: Segment[] = [{ fromMs: switchAt, untilMs: Infinity, schedule: after }];
    expect(lastStart(starting, switchAt - 1)).toBeNull();
    expect(nextStart(starting, switchAt - 5 * HOUR)?.startMs).toBe(switchAt + 30 * MIN);
  });
});
