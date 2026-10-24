import { describe, expect, it } from 'vitest';
import { dueReminders, GRACE_MS, remindersBetween } from '../src/engine/reminders';
import type { PeriodicSchedule } from '../src/engine/schedule';
import { always } from '../src/engine/segments';

const MIN = 60000;
const base = Date.UTC(2026, 9, 23, 12, 0);
const plain: Record<'worldBoss' | 'legion' | 'helltide', PeriodicSchedule> = {
  worldBoss: { anchorMs: base, periodMs: 210 * MIN, durationMs: 0 },
  legion: { anchorMs: base, periodMs: 25 * MIN, durationMs: 0 },
  helltide: { anchorMs: base, periodMs: 60 * MIN, durationMs: 55 * MIN },
};
const schedules = {
  worldBoss: always(plain.worldBoss),
  legion: always(plain.legion),
  helltide: always(plain.helltide),
};

describe('remindersBetween', () => {
  it('fires a 10-minute reminder 10 minutes before the start', () => {
    const r = remindersBetween(schedules, [{ kind: 'worldBoss', leadMinutes: 10 }], base - 30 * MIN, base + MIN);
    expect(r).toHaveLength(1);
    expect(r[0]!.fireAtMs).toBe(base - 10 * MIN);
    expect(r[0]!.eventStartMs).toBe(base);
  });

  it('lists one reminder per chosen lead time, ordered by fire time', () => {
    const rules = [5, 10, 15].map((leadMinutes) => ({ kind: 'worldBoss' as const, leadMinutes }));
    const r = remindersBetween(schedules, rules, base - 20 * MIN, base);
    expect(r.map((x) => x.leadMinutes)).toEqual([15, 10, 5]);
  });

  it('a helltide reminder with lead 0 fires at the start', () => {
    const r = remindersBetween(schedules, [{ kind: 'helltide', leadMinutes: 0 }], base, base + 1);
    expect(r.map((x) => x.fireAtMs)).toEqual([base]);
  });

  it('includes the from bound and excludes the to bound', () => {
    const rule = [{ kind: 'legion' as const, leadMinutes: 5 }];
    const fire = base - 5 * MIN;
    expect(remindersBetween(schedules, rule, fire, fire + 1)).toHaveLength(1);
    expect(remindersBetween(schedules, rule, fire - 1, fire)).toHaveLength(0);
  });

  it('gives a stable id per event and lead time', () => {
    const r = remindersBetween(schedules, [{ kind: 'legion', leadMinutes: 5 }], base - 6 * MIN, base);
    expect(r[0]!.id).toBe(`legion:${base}:5`);
  });

  it('skips kinds with no schedule', () => {
    expect(remindersBetween({}, [{ kind: 'legion', leadMinutes: 5 }], base - 60 * MIN, base)).toEqual([]);
  });
});

describe('dueReminders', () => {
  const rules = [{ kind: 'worldBoss' as const, leadMinutes: 5 }];
  const fire = base - 5 * MIN;

  it('fires once when a check crosses the fire time', () => {
    expect(dueReminders(schedules, rules, fire - 1000, fire)).toHaveLength(1);
    // The next check starts after the previous one, so it does not repeat.
    expect(dueReminders(schedules, rules, fire, fire + 1000)).toHaveLength(0);
  });

  it('still fires a minute late (a throttled background tab)', () => {
    expect(dueReminders(schedules, rules, fire - 1000, fire + 60000)).toHaveLength(1);
  });

  it('drops a reminder more than the grace period late (the computer slept)', () => {
    expect(dueReminders(schedules, rules, fire - 1000, fire + GRACE_MS + 1)).toHaveLength(0);
    expect(dueReminders(schedules, rules, fire - 1000, fire + GRACE_MS)).toHaveLength(1);
  });

  it('returns nothing when time did not advance (or went back after a clock correction)', () => {
    expect(dueReminders(schedules, rules, fire, fire)).toEqual([]);
    expect(dueReminders(schedules, rules, fire + 1000, fire)).toEqual([]);
  });
});

describe('grace period as a number', () => {
  it('is three minutes: 2 min 59 s late still fires, 3 min 1 s late does not', () => {
    expect(GRACE_MS).toBe(180000);
    const rules = [{ kind: 'legion' as const, leadMinutes: 5 }];
    const fire = base - 5 * MIN;
    expect(dueReminders(schedules, rules, fire - 1000, fire + 179000)).toHaveLength(1);
    expect(dueReminders(schedules, rules, fire - 1000, fire + 181000)).toHaveLength(0);
  });
});
