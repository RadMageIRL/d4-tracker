import { describe, expect, it } from 'vitest';
import { OfflineDetailsSource } from '../src/adapters/offline-details';
import { DETAIL_REASONS, eventDefinitions } from '../src/data';
import { eventStatus, type EventDefinition, type EventKind } from '../src/engine/events';
import { nextAfter, startsBetween, type PeriodicSchedule } from '../src/engine/schedule';

const EVENT_DEFINITIONS = eventDefinitions();
// A temporary outside cross-check (see its _about). The tests over it run only while it exists, so
// deleting it once our own sightings confirm the anchors leaves the rest of the suite intact.
interface CrossCheck {
  helltides_schedule: Record<'worldBoss' | 'legion' | 'helltide', string[]>;
  diablo4_life_next_world_boss: string;
  d4guides_world_boss_baseline_unix: number;
  d4guides_world_boss_pending_seconds: number;
  diablo_companion_anchor_unix: { worldBoss: number; legion: number };
  helltime_anchor_unix: { worldBoss: number; legion: number };
}
const external = Object.values(import.meta.glob('./fixtures/external-crosscheck-*.json', { eager: true, import: 'default' }))[0] as
  CrossCheck | undefined;

const MIN = 60000;

function def(kind: EventKind): EventDefinition {
  const d = EVENT_DEFINITIONS.find((x) => x.kind === kind);
  if (!d) throw new Error(kind);
  return d;
}
const sched = (kind: EventKind): PeriodicSchedule => def(kind).segments[0]!.schedule;
const offline = new OfflineDetailsSource(DETAIL_REASONS);

describe.skipIf(!external)('outside cross-check: schedules agree with times other trackers published for 2026-10-24', () => {
  const observed = external!;
  for (const [kind, key] of [['worldBoss', 'worldBoss'], ['legion', 'legion'], ['helltide', 'helltide']] as const) {
    it(`${kind}: every observed start is a calculated start, and none is missing in that span`, () => {
      const times = observed.helltides_schedule[key].map((t) => Date.parse(t));
      const first = Math.min(...times);
      const last = Math.max(...times);
      const calculated = startsBetween(sched(kind), first, last + 1).map((o) => o.startMs);
      expect(calculated).toEqual([...times].sort((a, b) => a - b));
    });
  }

  it('diablo4.life\'s next World Boss is a calculated spawn', () => {
    const t = Date.parse(observed.diablo4_life_next_world_boss);
    expect(nextAfter(sched('worldBoss'), t - 1).startMs).toBe(t);
  });

  it('d4guides\' baseline (pending start + 30 min) is a calculated spawn', () => {
    const t = (observed.d4guides_world_boss_baseline_unix + observed.d4guides_world_boss_pending_seconds) * 1000;
    expect(nextAfter(sched('worldBoss'), t - 1).startMs).toBe(t);
  });

  it('the open-source anchors (one from 2023, one from 2026) land on calculated starts', () => {
    for (const a of [observed.diablo_companion_anchor_unix, observed.helltime_anchor_unix]) {
      expect(nextAfter(sched('worldBoss'), a.worldBoss * 1000 - 1).startMs).toBe(a.worldBoss * 1000);
      expect(nextAfter(sched('legion'), a.legion * 1000 - 1).startMs).toBe(a.legion * 1000);
    }
  });

  it('matches the published cycle rules: boss at unix mod 12600 = 10800, Legion at mod 1500 = 1200', () => {
    expect((sched('worldBoss').anchorMs / 1000) % 12600).toBe(10800);
    expect((sched('legion').anchorMs / 1000) % 1500).toBe(1200);
    expect((sched('helltide').anchorMs / 1000) % 3600).toBe(0);
  });

  it('uses Blizzard\'s cadences: 60/55 min Helltide, 210 min World Boss, 25 min Legion', () => {
    expect(sched('helltide')).toMatchObject({ periodMs: 60 * MIN, durationMs: 55 * MIN });
    expect(sched('worldBoss')).toMatchObject({ periodMs: 210 * MIN, durationMs: 0 });
    expect(sched('legion')).toMatchObject({ periodMs: 25 * MIN, durationMs: 0 });
  });
});

describe('Helltide state at the boundaries', () => {
  const top = Date.UTC(2026, 9, 24, 15, 0);
  const at = (t: number) => eventStatus(def('helltide'), offline.details('helltide'), t);

  it('is active at the top of the hour with 55:00 left', () => {
    const st = at(top);
    expect(st.phase).toBe('active');
    expect(st.msLeft).toBe(55 * MIN);
    expect(st.progress).toBe(0);
  });

  it('is active one ms before :55 and inactive at :55', () => {
    expect(at(top + 55 * MIN - 1).phase).toBe('active');
    const st = at(top + 55 * MIN);
    expect(st.phase).toBe('waiting');
    expect(st.msToNext).toBe(5 * MIN);
    expect(st.progress).toBe(0);
  });

  it('counts the gap and reaches the next hour', () => {
    const st = at(top + 59 * MIN);
    expect(st.phase).toBe('waiting');
    expect(st.next?.startMs).toBe(top + 60 * MIN);
    expect(st.progress).toBeCloseTo(0.8, 10);
  });

  it('lists the three starts after the next one', () => {
    const st = at(top + 10 * MIN);
    expect(st.later.map((o) => o.startMs)).toEqual([2, 3, 4].map((h) => top + h * 60 * MIN));
  });
});

describe('World Boss and Legion state', () => {
  const spawn = Date.UTC(2026, 9, 24, 7, 30);

  it('counts down to the spawn and then to the following one', () => {
    const before = eventStatus(def('worldBoss'), offline.details('worldBoss'), spawn - 1000);
    expect(before.phase).toBe('waiting');
    expect(before.msToNext).toBe(1000);
    const after = eventStatus(def('worldBoss'), offline.details('worldBoss'), spawn);
    expect(after.next?.startMs).toBe(spawn + 210 * MIN);
    expect(after.previous?.startMs).toBe(spawn);
  });

  it('never reports a spawn-only event as active', () => {
    for (const t of [spawn, spawn + MIN, spawn + 14 * MIN]) {
      expect(eventStatus(def('worldBoss'), offline.details('worldBoss'), t).phase).toBe('waiting');
      expect(eventStatus(def('legion'), offline.details('legion'), t).phase).toBe('waiting');
    }
  });

  it('keeps progress within 0..1 across a whole cycle', () => {
    for (let t = spawn; t < spawn + 210 * MIN; t += 7 * MIN + 13) {
      for (const kind of ['worldBoss', 'legion', 'helltide'] as const) {
        const p = eventStatus(def(kind), offline.details(kind), t).progress!;
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('unavailable data is never presented as known', () => {
  it('an event without a schedule is unknown, with no times', () => {
    const st = eventStatus({ ...def('worldBoss'), segments: [] }, offline.details('worldBoss'), Date.now());
    expect(st.phase).toBe('unknown');
    expect(st.next).toBeNull();
    expect(st.msToNext).toBeNull();
    expect(st.later).toEqual([]);
  });

  it('with no live source, every location and the boss name are unknown, each with a reason', () => {
    for (const kind of ['helltide', 'worldBoss', 'legion'] as const) {
      const d = offline.details(kind);
      expect(d.location.known).toBe(false);
      if (!d.location.known) expect(d.location.reason.length).toBeGreaterThan(20);
    }
    const boss = offline.details('worldBoss').identity;
    expect(boss?.known).toBe(false);
    expect(offline.details('helltide').identity).toBeUndefined();
  });
});
