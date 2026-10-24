import { describe, expect, it } from 'vitest';
import { IntelligenceDetailsSource } from '../src/adapters/intelligence';
import { bossNames, DETAIL_REASONS, EVENTS, eventDefinitions, LOCATIONS } from '../src/data';
import { checkEvents, type EventsFile } from '../src/data/schema';
import { hasExtraSpawn, type EventKind } from '../src/engine/events';
import type { Observation } from '../src/engine/observations';

const defs = eventDefinitions();
const def = (kind: EventKind) => defs.find((d) => d.kind === kind)!;
const at = (iso: string) => Date.parse(iso);

describe('the World Boss double spawn (every fourth spawn)', () => {
  it('falls on every dated first-hand report of two at once, October 2024 to September 2026', () => {
    for (const iso of ['2024-10-20T01:00:00Z', '2024-10-21T19:00:00Z', '2024-10-29T23:00:00Z', '2025-05-04T01:00:00Z', '2026-09-18T21:00:00Z']) {
      expect(hasExtraSpawn(def('worldBoss'), at(iso))).toBe(true);
    }
  });

  it('comes every 14 hours, and not on the spawns between', () => {
    expect(hasExtraSpawn(def('worldBoss'), at('2026-10-24T11:00:00Z'))).toBe(true);
    expect(hasExtraSpawn(def('worldBoss'), at('2026-10-25T01:00:00Z'))).toBe(true);
    for (const iso of ['2026-10-24T04:00:00Z', '2026-10-24T07:30:00Z', '2026-10-24T14:30:00Z', '2026-10-24T18:00:00Z']) {
      expect(hasExtraSpawn(def('worldBoss'), at(iso))).toBe(false);
    }
  });

  it('is never claimed for an instant off the spawn grid, or for another event', () => {
    expect(hasExtraSpawn(def('worldBoss'), at('2026-10-24T11:01:00Z'))).toBe(false);
    expect(hasExtraSpawn(def('legion'), at('2026-10-24T11:00:00Z'))).toBe(false);
  });

  it('is Inferred, not Confirmed: Blizzard does not document it', () => {
    expect(EVENTS.events.find((e) => e.id === 'worldBoss')!.extraSpawn!.confidence).toBe('inferred');
  });

  it('the data refuses an anchor off the spawn grid, and a Confirmed claim without Blizzard or our own sighting', () => {
    const bad = structuredClone(EVENTS) as EventsFile;
    const x = bad.events.find((e) => e.id === 'worldBoss')!.extraSpawn!;
    x.anchor = '2026-10-24T11:15:00Z';
    x.confidence = 'confirmed';
    const problems = checkEvents(bad).join('\n');
    expect(problems).toMatch(/anchor must be one of the calculated starts/);
    expect(problems).toMatch(/confirmed needs a Blizzard source or our own in-game observation/);
  });
});

describe('details from sightings', () => {
  let n = 0;
  const sighting = (extra: Partial<Observation> & Pick<Observation, 'event' | 'at'>): Observation =>
    ({ id: `i${n++}`, timing: 'start', recordedAt: extra.at, ...extra });
  const source = (list: Observation[]) => new IntelligenceDetailsSource({
    reasons: DETAIL_REASONS, sightings: () => list, segments: (k) => def(k).segments, registered: [], boundaries: [],
    regions: LOCATIONS.regions, arenas: LOCATIONS.worldBossArenas, bosses: bossNames(),
  });
  const spawn = { index: 0, startMs: at('2026-10-24T11:00:00Z'), endMs: at('2026-10-24T11:00:00Z') };

  it('shows the main boss, and a second boss in an expansion arena as "also"', () => {
    const list = [
      sighting({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Ashava', place: 'Caen Adar', region: 'scosglen' }),
      sighting({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Avarice', place: 'The Cauldron', region: 'nahantu' }),
    ];
    const d = source(list).details('worldBoss', spawn, at('2026-10-24T10:30:00Z'));
    expect(d.identity).toMatchObject({ known: true, value: 'Ashava; also Avarice', basis: 'seen' });
    expect(d.location).toMatchObject({ known: true, value: 'Caen Adar, Scosglen; also The Cauldron, Nahantu' });
  });

  it('marks a second boss as "also" even when the main one was not logged', () => {
    const list = [sighting({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Avarice', place: 'The Cauldron', region: 'nahantu' })];
    const d = source(list).details('worldBoss', spawn, at('2026-10-24T10:30:00Z'));
    expect(d.identity).toMatchObject({ known: true, value: 'also Avarice' });
  });

  it('keeps the second boss out of the main order, so a double spawn is not a conflicting record', () => {
    const list = [
      sighting({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Ashava', place: 'Caen Adar', region: 'scosglen' }),
      sighting({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Avarice', place: 'The Cauldron', region: 'nahantu' }),
    ];
    const m = source(list).models('worldBoss', at('2026-10-24T12:00:00Z'));
    expect(m.boss!.points).toBe(1);
    expect(m.boss!.conflicts).toBe(0);
  });

  it('shows both Helltide regions seen in one hour, base and expansion, each in its own order', () => {
    const list = [
      sighting({ event: 'helltide', at: '2026-10-24T15:05:00Z', timing: 'during', region: 'kehjistan' }),
      sighting({ event: 'helltide', at: '2026-10-24T15:06:00Z', timing: 'during', region: 'nahantu' }),
    ];
    const src = source(list);
    const hour = { index: 0, startMs: at('2026-10-24T15:00:00Z'), endMs: at('2026-10-24T15:55:00Z') };
    expect(src.details('helltide', hour, at('2026-10-24T15:10:00Z')).location).toMatchObject({ known: true, value: 'Kehjistan and Nahantu' });
    const m = src.models('helltide', at('2026-10-24T15:10:00Z'));
    expect([m.base!.points, m.base!.conflicts, m.expansion!.points, m.expansion!.conflicts]).toEqual([1, 0, 1, 0]);
  });

  it('shows only the region you saw; one only reported to you goes into the note, as on the radar', () => {
    const list = [
      sighting({ event: 'helltide', at: '2026-10-24T15:05:00Z', timing: 'during', region: 'kehjistan' }),
      sighting({ event: 'helltide', at: '2026-10-24T15:06:00Z', timing: 'during', region: 'nahantu', provenance: 'reported' }),
    ];
    const hour = { index: 0, startMs: at('2026-10-24T15:00:00Z'), endMs: at('2026-10-24T15:55:00Z') };
    const loc = source(list).details('helltide', hour, at('2026-10-24T15:10:00Z')).location;
    expect(loc).toMatchObject({ known: true, value: 'Kehjistan', basis: 'seen' });
    expect(loc.known && loc.source).toMatch(/Also reported to you, not checked: Nahantu/);
  });

  it('never shows a third-party prediction nobody checked in game; shows it once checked', () => {
    const predicted = sighting({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Azmodan', provenance: 'reported', thirdParty: 'a tracker page' });
    // Not even as a "reported" note: that would relay the other tracker's prediction.
    expect(source([predicted]).details('worldBoss', spawn, at('2026-10-24T10:30:00Z')).identity).toMatchObject({ known: false, hint: DETAIL_REASONS.worldBoss.identity!.hint });
    const checked = { ...predicted, id: 'checked', provenance: undefined };
    expect(source([checked]).details('worldBoss', spawn, at('2026-10-24T10:30:00Z')).identity).toMatchObject({ known: true, value: 'Azmodan', basis: 'seen' });
  });

  it('keeps your own unchecked report as a hint on an Unknown value, and a report in the shared data off the cards', () => {
    const report = sighting({ event: 'worldBoss', at: '2026-10-24T11:00:00Z', boss: 'Azmodan', region: 'scosglen', provenance: 'reported' });
    const d = source([report]).details('worldBoss', spawn, at('2026-10-24T10:30:00Z'));
    expect(d.identity).toMatchObject({ known: false, hint: 'reported: Azmodan, not checked' });
    expect(d.location).toMatchObject({ known: false, hint: 'reported: Scosglen, not checked' });
    const shared = new IntelligenceDetailsSource({
      reasons: DETAIL_REASONS, sightings: () => [report], segments: (k) => def(k).segments, registered: [], boundaries: [],
      regions: LOCATIONS.regions, arenas: LOCATIONS.worldBossArenas, bosses: bossNames(), isShared: () => true,
    });
    // Not even as a note: a shared report would reach every visitor.
    expect(shared.details('worldBoss', spawn, at('2026-10-24T10:30:00Z')).identity).toMatchObject({ known: false, hint: DETAIL_REASONS.worldBoss.identity!.hint });
  });

  it('says Unknown, with the reason, when nothing was seen and no order is trusted', () => {
    const d = source([]).details('worldBoss', spawn, at('2026-10-24T10:30:00Z'));
    expect(d.identity).toMatchObject({ known: false });
    expect(d.identity && !d.identity.known && d.identity.reason).toMatch(/Not predicted for this spawn/);
  });
});
