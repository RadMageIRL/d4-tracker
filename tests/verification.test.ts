import { describe, expect, it } from 'vitest';
import { crossCheck, EVENTS, eventDefinitions, SHARED_SIGHTINGS } from '../src/data';
import { checkEvents, type EventsFile } from '../src/data/schema';
import type { Observation } from '../src/engine/observations';
import { anchorEvidence, anchorProgress, MIN_DAYS, MIN_MATCHING } from '../src/engine/verification';

const MIN = 60000;
const defs = eventDefinitions();
const segs = (kind: 'worldBoss' | 'legion') => defs.find((d) => d.kind === kind)!.segments;
// World Boss spawns calculated from the data: 2026-10-24 04:00 UTC and every 210 minutes.
const wbSpawn = (n: number) => new Date(Date.UTC(2026, 9, 24, 4, 0) + n * 210 * MIN);

let seq = 0;
function start(at: Date, event: Observation['event'] = 'worldBoss', offsetMs = 0): Observation {
  return { id: `v${seq++}`, event, at: new Date(at.getTime() + offsetMs).toISOString(), timing: 'start', recordedAt: at.toISOString() };
}

describe('confirming an anchor from our sightings', () => {
  it('needs 3 matching starts on 2 different days', () => {
    expect(MIN_MATCHING).toBe(3);
    expect(MIN_DAYS).toBe(2);
  });

  it('does not qualify with 3 matching starts all on one day', () => {
    // 04:00, 07:30 and 11:00 on 2026-10-24.
    const e = anchorEvidence([start(wbSpawn(0)), start(wbSpawn(1)), start(wbSpawn(2))], segs('worldBoss'), 'worldBoss');
    expect(e.matching).toBe(3);
    expect(e.days).toEqual(['2026-10-24']);
    expect(e.qualifies).toBe(false);
  });

  it('does not qualify with 2 matching starts on 2 days', () => {
    const e = anchorEvidence([start(wbSpawn(0)), start(wbSpawn(7))], segs('worldBoss'), 'worldBoss');
    expect(e.days).toHaveLength(2);
    expect(e.qualifies).toBe(false);
  });

  it('qualifies with 3 matching starts over 2 days, typed up to 2 minutes off', () => {
    const list = [start(wbSpawn(0), 'worldBoss', 60000), start(wbSpawn(1), 'worldBoss', -120000), start(wbSpawn(7))];
    const e = anchorEvidence(list, segs('worldBoss'), 'worldBoss');
    expect(e.days).toEqual(['2026-10-24', '2026-10-25']);
    expect(e.qualifies).toBe(true);
    expect(anchorProgress(e)).toMatch(/3 in-game starts on 2 days match/);
  });

  it('does not qualify while any start disagrees, however many match', () => {
    const list = [start(wbSpawn(0)), start(wbSpawn(1)), start(wbSpawn(7)), start(wbSpawn(8), 'worldBoss', 10 * MIN)];
    const e = anchorEvidence(list, segs('worldBoss'), 'worldBoss');
    expect(e.matching).toBe(3);
    expect(e.disagreeing).toBe(1);
    expect(e.qualifies).toBe(false);
    expect(anchorProgress(e)).toMatch(/disagrees/);
  });

  it('counts only start-time sightings of the same event', () => {
    const list = [
      { ...start(wbSpawn(0)), timing: 'during' as const },
      start(wbSpawn(1), 'legion'),
      start(wbSpawn(2)),
    ];
    expect(anchorEvidence(list, segs('worldBoss'), 'worldBoss').matching).toBe(1);
  });

  it('reports progress toward confirmation', () => {
    expect(anchorProgress(anchorEvidence([], segs('legion'), 'legion'))).toBe('0 of 3 matching in-game starts, on 0 of 2 days, needed to confirm it.');
  });
});

describe('the data refuses to over-claim', () => {
  const confirmBySightings = (): EventsFile => {
    const f: EventsFile = structuredClone(EVENTS);
    const phase = f.events.find((e) => e.id === 'worldBoss')!.schedules[0]!.phase;
    phase.confidence = 'confirmed';
    phase.sources = [{ kind: 'observation', title: 'Our in-game sightings (data/observations.json)' }];
    return f;
  };

  it('today: no shared sightings, nothing claimed from them, nothing disagreeing', () => {
    expect(SHARED_SIGHTINGS).toEqual([]);
    expect(crossCheck(EVENTS, SHARED_SIGHTINGS)).toEqual([]);
  });

  it('rejects an anchor confirmed by sightings when there are too few', () => {
    const problems = crossCheck(confirmBySightings(), [start(wbSpawn(0)), start(wbSpawn(7))]).join();
    expect(problems).toMatch(/confirmed by sightings needs 3 matching starts on 2 days \(have 2 on 2\)/);
  });

  it('accepts it with 3 matching starts on 2 days', () => {
    expect(crossCheck(confirmBySightings(), [start(wbSpawn(0)), start(wbSpawn(1)), start(wbSpawn(7))])).toEqual([]);
  });

  it('rejects shared sightings that disagree with the schedule', () => {
    expect(crossCheck(EVENTS, [start(wbSpawn(0), 'legion', 12 * MIN)]).join()).toMatch(/legion: 1 shared sighting\(s\) disagree/);
  });

  it('never lets sightings confirm a rotation', () => {
    const f: EventsFile = structuredClone(EVENTS);
    const rot = f.events.find((e) => e.id === 'worldBoss')!.rotations[0]!;
    rot.confidence = 'confirmed';
    rot.period = 8;
    rot.evidence = { samples: 400, repeats: 50, chance: 1e-30, analyzedOn: '2027-01-01' };
    rot.sources = [{ kind: 'observation', title: 'Many sightings' }];
    expect(checkEvents(f).join()).toMatch(/confirmed only by Blizzard's own words, never by sightings alone/);
  });

  it('lets strong evidence make a rotation inferred, and refuses weak evidence', () => {
    const f: EventsFile = structuredClone(EVENTS);
    const rot = f.events.find((e) => e.id === 'worldBoss')!.rotations[0]!;
    rot.confidence = 'inferred';
    rot.period = 8;
    rot.sources = [{ kind: 'observation', title: 'Our sightings' }];
    rot.evidence = { samples: 16, repeats: 2, chance: 0.0001, analyzedOn: '2026-12-01' };
    expect(checkEvents(f)).toEqual([]);
    // Each condition alone makes the evidence too weak.
    rot.evidence = { samples: 16, repeats: 1, chance: 0.0001, analyzedOn: '2026-12-01' };
    expect(checkEvents(f).join()).toMatch(/evidence too weak/);
    rot.evidence = { samples: 16, repeats: 2, chance: 0.2, analyzedOn: '2026-12-01' };
    expect(checkEvents(f).join()).toMatch(/evidence too weak/);
    rot.evidence = { samples: 15, repeats: 2, chance: 0.0001, analyzedOn: '2026-12-01' }; // under two full cycles of 8
    expect(checkEvents(f).join()).toMatch(/evidence too weak/);
    delete rot.evidence;
    expect(checkEvents(f).join()).toMatch(/needs its period and the evidence/);
  });

  it('keeps every rotation unknown today', () => {
    for (const e of EVENTS.events) for (const r of e.rotations) expect(r.confidence).toBe('unknown');
  });
});

describe('retiring the outside cross-check', () => {
  const fixtures = Object.keys(import.meta.glob('./fixtures/external-crosscheck-*.json'));
  const covered = (['worldBoss', 'legion'] as const).every((k) => anchorEvidence(SHARED_SIGHTINGS, segs(k), k).qualifies);

  it('the outside fixture must be deleted once our own sightings confirm both anchors', () => {
    // Today our sightings do not cover the anchors yet, so the fixture stays as a cross-check.
    if (covered) expect(fixtures, 'our sightings now confirm both anchors: delete the outside cross-check fixture').toEqual([]);
    else expect(fixtures.length).toBeLessThanOrEqual(1);
  });
});
