import { describe, expect, it } from 'vitest';
import { EVENTS, LOCATIONS, REGISTERED_RULES, ROTATIONS, SEASONS, SHARED_SIGHTINGS } from '../src/data';
import {
  checkEvents, checkLocations, checkRotations, checkSeasons, type EventsFile, type LocationsFile, type RotationsFile, type RuleRecord,
} from '../src/data/schema';
import { NEWS_PATH } from '../src/engine/news';

const clone = <T>(x: T): T => structuredClone(x);

describe('the repository data passes its checks', () => {
  it('events, locations and seasons have no problems', () => {
    expect(checkEvents(EVENTS)).toEqual([]);
    expect(checkLocations(LOCATIONS)).toEqual([]);
    expect(checkSeasons(SEASONS)).toEqual([]);
  });

  it('every Blizzard source quotes the words relied on and links the page', () => {
    const sources = [
      ...EVENTS.events.flatMap((e) => [...e.schedules.flatMap((s) => [...s.interval.sources, ...s.phase.sources]),
        ...e.announcedChanges.flatMap((c) => c.sources), ...(e.roster ?? []).flatMap((r) => r.sources ?? [])]),
      ...Object.values(LOCATIONS.sources),
      ...SEASONS.seasons.flatMap((s) => s.sources), ...SEASONS.windows.flatMap((w) => w.sources),
    ].filter((s) => s.kind === 'blizzard');
    expect(sources.length).toBeGreaterThan(10);
    for (const s of sources) {
      expect(s.url).toMatch(/^https:\/\/(news\.blizzard\.com|diablo4\.blizzard\.com)\//);
      expect(s.quote?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('marks the World Boss and Legion start times inferred until we observe them in game', () => {
    for (const id of ['worldBoss', 'legion'] as const) {
      const phase = EVENTS.events.find((e) => e.id === id)!.schedules[0]!.phase;
      expect(phase.confidence).toBe('inferred');
    }
  });

  it('keeps every location detail unknown, with a reason', () => {
    for (const e of EVENTS.events) {
      expect(e.details.location.confidence).toBe('unknown');
      expect(e.details.location.reason.length).toBeGreaterThan(20);
    }
  });

  it('starts with no shared sightings and no chest locations (Dos keeps his own sightings private)', () => {
    expect(SHARED_SIGHTINGS).toEqual([]);
    expect(LOCATIONS.helltideChests).toEqual([]);
  });
});

describe('the checks catch bad edits', () => {
  it('rejects "confirmed" backed only by community sources', () => {
    const bad: EventsFile = clone(EVENTS);
    bad.events[1]!.schedules[0]!.phase.confidence = 'confirmed';
    expect(checkEvents(bad).join()).toMatch(/worldBoss schedule 0 phase: confirmed needs a Blizzard source or our own in-game observation/);
  });

  it('rejects a Blizzard source without its quote', () => {
    const bad: EventsFile = clone(EVENTS);
    delete bad.events[0]!.schedules[0]!.interval.sources[0]!.quote;
    expect(checkEvents(bad).join()).toMatch(/needs its url and the quoted words/);
  });

  it('rejects an anchor that is not a UTC instant, and a bad interval', () => {
    const bad: EventsFile = clone(EVENTS);
    bad.events[2]!.schedules[0]!.anchor = '2026-10-24 02:00';
    bad.events[2]!.schedules[0]!.periodMinutes = 0;
    const problems = checkEvents(bad).join('\n');
    expect(problems).toMatch(/legion schedule 0: anchor must be an ISO UTC instant/);
    expect(problems).toMatch(/periodMinutes must be a positive whole number/);
  });

  it('rejects overlapping schedules for one event', () => {
    const bad: EventsFile = clone(EVENTS);
    const s = bad.events[0]!.schedules[0]!;
    bad.events[0]!.schedules.push({ ...clone(s), from: '2026-12-01T00:00:00Z' });
    expect(checkEvents(bad).join()).toMatch(/helltide: schedules overlap/);
  });

  it('accepts a dated switch from one schedule to the next', () => {
    const ok: EventsFile = clone(EVENTS);
    const s = ok.events[0]!.schedules[0]!;
    s.until = '2026-12-01T17:00:00Z';
    ok.events[0]!.schedules.push({ ...clone(s), from: '2026-12-01T17:00:00Z', until: null, anchor: '2026-12-01T17:30:00Z' });
    expect(checkEvents(ok)).toEqual([]);
  });

  it('keeps each unknown hint short enough for one line (40 characters)', () => {
    for (const e of EVENTS.events) for (const d of [e.details.location, e.details.identity]) if (d) expect(d.hint.length).toBeLessThanOrEqual(40);
    const bad: EventsFile = clone(EVENTS);
    bad.events[0]!.details.location.hint = 'x'.repeat(41);
    expect(checkEvents(bad).join()).toMatch(/detail hint too long for one line/);
  });

  it('rejects a location detail claimed as known (no live source exists)', () => {
    const bad: EventsFile = clone(EVENTS);
    (bad.events[1]!.details.location as { confidence: string }).confidence = 'inferred';
    expect(checkEvents(bad).join()).toMatch(/details must be unknown/);
  });

  it('rejects a site in an unknown region or citing an unknown source', () => {
    const bad: LocationsFile = clone(LOCATIONS);
    bad.worldBossArenas[0]!.region = 'atlantis';
    bad.legionSites[0]!.sources = ['nowhere'];
    const problems = checkLocations(bad).join('\n');
    expect(problems).toMatch(/unknown region atlantis/);
    expect(problems).toMatch(/unknown source nowhere/);
  });

  it('rejects a confirmed arena backed only by a community list', () => {
    const bad: LocationsFile = clone(LOCATIONS);
    bad.worldBossArenas[0]!.confidence = 'confirmed';
    expect(checkLocations(bad).join()).toMatch(/confirmed needs a Blizzard source or our own observation/);
  });

  const spot = { id: 'k-example', region: 'kehjistan', name: 'Example landmark', type: 'mystery', checkedOn: '2026-11-01', confidence: 'confirmed' as const, sources: ['obs-2026-11-01'] };

  it('accepts a confirmed chest spot backed by our own observation', () => {
    const ok: LocationsFile = clone(LOCATIONS);
    ok.sources['obs-2026-11-01'] = { kind: 'observation', title: 'Our sighting, 2026-11-01' };
    ok.helltideChests.push({ ...spot, position: { art: 'kehjistan:0123abcd', x: 0.4, y: 0.6 } });
    expect(checkLocations(ok)).toEqual([]);
  });

  it('confirms a chest spot only by our own observation, not by a Blizzard page', () => {
    const bad: LocationsFile = clone(LOCATIONS);
    bad.helltideChests.push({ ...spot, sources: ['blizzard-1.2.0-waypoints'] });
    expect(checkLocations(bad).join()).toMatch(/confirmed only by our own in-game observation/);
  });

  it('rejects a chest spot of an unknown type, a duplicate id, or a position off the drawing', () => {
    const bad: LocationsFile = clone(LOCATIONS);
    bad.sources['obs-2026-11-01'] = { kind: 'observation', title: 'Our sighting, 2026-11-01' };
    bad.helltideChests.push({ ...spot, type: 'golden' }, { ...spot, position: { art: 'kehjistan:0123abcd', x: 1.2, y: 0.5 } });
    const problems = checkLocations(bad).join('\n');
    expect(problems).toMatch(/unknown chest type golden/);
    expect(problems).toMatch(/id must be unique/);
    expect(problems).toMatch(/position must name a drawing/);
  });

  it('rejects chest move times outside 1 to 59 minutes or out of order', () => {
    for (const m of [[0], [60], [30, 15]]) {
      const bad: LocationsFile = clone(LOCATIONS);
      bad.chestTypes[0]!.relocatesAtMinutes = m;
      expect(checkLocations(bad).join()).toMatch(/relocatesAtMinutes must be whole minutes from 1 to 59, in increasing order/);
    }
  });
});

describe('registered orders (data/rotations.json)', () => {
  const rule = (extra: Partial<RuleRecord> = {}): RuleRecord => ({
    id: 'guide-boss-order', event: 'worldBoss', field: 'boss', sequence: ['Ashava', 'Avarice'], anchor: null,
    registeredOn: '2026-10-24', basis: 'a guide', sources: [{ kind: 'community', title: 'A guide' }], ...extra,
  });
  const withRules = (...rules: RuleRecord[]): RotationsFile => ({ ...clone(ROTATIONS), rules });

  it('the data file passes its checks', () => {
    expect(checkRotations(ROTATIONS, EVENTS, LOCATIONS)).toEqual([]);
  });

  it('accepts a well-formed rule, including an arena pair', () => {
    expect(checkRotations(withRules(rule(), rule({ id: 'pairs', field: 'pair', sequence: ['Ashava @ The Crucible'] })), EVENTS, LOCATIONS)).toEqual([]);
  });

  it('rejects a boss or arena the data does not know, and a field the event does not have', () => {
    const problems = checkRotations(withRules(
      rule({ sequence: ['Duriel'] }), rule({ id: 'b', field: 'pair', sequence: ['Ashava @ Nowhere'] }), rule({ id: 'c', event: 'helltide', field: 'boss' }),
    ), EVENTS, LOCATIONS).join('\n');
    expect(problems).toMatch(/unknown value Duriel/);
    expect(problems).toMatch(/unknown value Ashava @ Nowhere/);
    expect(problems).toMatch(/boss is not a field of helltide/);
  });

  it('rejects a duplicate id, an empty order, a bad anchor and a rule without a source', () => {
    const problems = checkRotations(withRules(rule(), rule({ sequence: [], anchor: 'yesterday', sources: [] })), EVENTS, LOCATIONS).join('\n');
    expect(problems).toMatch(/id must be unique/);
    expect(problems).toMatch(/sequence must have 1 to 64 values/);
    expect(problems).toMatch(/anchor must be null or an ISO UTC instant/);
    expect(problems).toMatch(/needs a source/);
  });

  it('marks only a rule with a Blizzard source as documented', () => {
    expect(REGISTERED_RULES.every((r) => r.documented === ROTATIONS.rules.find((x) => x.id === r.id)!.sources.some((s) => s.kind === 'blizzard'))).toBe(true);
  });
});

describe('published text points only at published pages', () => {
  // docs/, local/ and the handoff notes stay on Dos's machine. The data's text is shown on the page,
  // so it may not send a reader to one of those files, and every link must be a web address.
  const data = import.meta.glob('../data/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('names no local-only file', () => {
    for (const [file, text] of Object.entries(data)) {
      expect(`${file}: ${text}`).not.toMatch(/docs\/|local\/|(?<!README|CHANGELOG)\.md\b|HANDOFF|SESSION\.md|CURRENT\.md/);
    }
  });

  it('links only to https web addresses', () => {
    for (const text of Object.values(data)) {
      for (const m of text.matchAll(/"url":\s*"([^"]*)"/g)) expect(m[1]).toMatch(/^https:\/\//);
    }
  });

  it('the start-time sources link to the public explanation in the README', () => {
    expect(data['../data/events.json']).toContain('https://github.com/RadMageIRL/d4-tracker#how-sure-each-piece-is');
  });
});

describe('independence', () => {
  // Competing trackers, map and guide sites. The app and its page may not name them at all; the
  // data files may name them as research provenance but may not link to them.
  // "Helltides" is also the event's own plural, so that site is matched by its domain.
  const sites = String.raw`helltides\.com|d4guides|diablo4\.life|d4planner|d4armory|maxroll|mapgenie|wowhead|fextralife|vaultalts|ggseason|timesaver|raigulus`;
  const named = new RegExp(sites, 'i');
  const linked = new RegExp(String.raw`https?://[^"\s]*(${sites})`, 'i');
  const files = import.meta.glob(['../src/**/*.ts', '../data/*.json', '../index.html'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('scans the app, its data and its page', () => {
    expect(Object.keys(files).length).toBeGreaterThan(25);
  });

  it('the patterns catch what they are meant to, and not the event name', () => {
    expect(named.test('data from helltides.com')).toBe(true);
    expect(named.test('Helltides start on the hour')).toBe(false);
    expect(linked.test('"url": "https://diablo4.wiki.fextralife.com/Seasons"')).toBe(true);
    expect(linked.test('"title": "Fextralife season list"')).toBe(false);
    expect(named.test('diablo4xlife')).toBe(false);
  });

  for (const [path, text] of Object.entries(files)) {
    const isData = path.startsWith('../data/');
    it(`${path.replace('../', '')} ${isData ? 'links' : 'names'} no competing site`, () => {
      expect(text).not.toMatch(isData ? linked : named);
    });
  }

  it('requests nothing from another origin in code: every fetch goes to the page itself', () => {
    const fetches = Object.entries(files).flatMap(([path, text]) => [...text.matchAll(/fetch\(([^,)]*)/g)].map((m) => `${path}: ${m[1]}`));
    expect(fetches).toEqual(['../src/main.ts: NEWS_PATH', '../src/main.ts: url']);
    // Latest news asks the page's own address (radmagelabs.com passes it through to Blizzard).
    expect(NEWS_PATH).toMatch(/^[a-z]+\.json$/);
  });
});
