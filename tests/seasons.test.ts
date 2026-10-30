import { describe, expect, it } from 'vitest';
import { SEASONS as SEASON_FEED } from '../src/data';
import type { SeasonsFile as SeasonFeed } from '../src/data/schema';
import { daysBetween, seasonStartMs, seasonView, validateFeed, windowState } from '../src/engine/seasons';

const s15 = Date.parse('2026-09-15T16:30:00Z');

describe('season data', () => {
  it('is consistent: numbered in order, dates ascending, each exact hour on its announced Pacific date', () => {
    expect(validateFeed(SEASON_FEED)).toEqual([]);
  });

  it('has no announced end for the live season and no announced next start (as of the check date)', () => {
    expect(SEASON_FEED.currentEndUtc).toBeNull();
    expect(SEASON_FEED.nextStartUtc).toBeNull();
  });

  it('catches an exact time that lands on the wrong Pacific day', () => {
    const bad: SeasonFeed = structuredClone(SEASON_FEED);
    bad.seasons[14]!.startUtc = '2026-09-16T16:30:00Z';
    expect(validateFeed(bad).join()).toMatch(/season 15/);
  });

  it('catches two seasons starting at the same instant', () => {
    const bad: SeasonFeed = structuredClone(SEASON_FEED);
    bad.seasons[14]!.startUtc = bad.seasons[13]!.startUtc;
    bad.seasons[14]!.startDate = bad.seasons[13]!.startDate;
    expect(validateFeed(bad).join()).toMatch(/season 15 starts before season 14/);
  });

  it('catches seasons out of order or misnumbered, and a window that ends before it starts', () => {
    const bad: SeasonFeed = structuredClone(SEASON_FEED);
    bad.seasons[3]!.number = 7;
    bad.seasons[5]!.startDate = '2023-01-01';
    delete bad.seasons[5]!.startUtc;
    bad.windows[0]!.endUtc = '2026-10-01T00:00:00Z';
    const problems = validateFeed(bad).join('\n');
    expect(problems).toMatch(/numbered 7/);
    expect(problems).toMatch(/season 6 starts before season 5/);
    expect(problems).toMatch(/ends before it starts/);
  });
});

describe('which season is live', () => {
  it('is Season 14 one ms before Season 15 launched', () => {
    expect(seasonView(SEASON_FEED, s15 - 1).current?.number).toBe(14);
  });

  it('is Season 15 from its launch instant', () => {
    expect(seasonView(SEASON_FEED, s15).current?.number).toBe(15);
  });

  it('counts whole days into the season', () => {
    expect(seasonView(SEASON_FEED, s15).daysIn).toBe(0);
    expect(seasonView(SEASON_FEED, s15 + 86400000 - 1).daysIn).toBe(0);
    expect(seasonView(SEASON_FEED, s15 + 86400000).daysIn).toBe(1);
    expect(seasonView(SEASON_FEED, Date.parse('2026-10-23T16:30:00Z')).daysIn).toBe(38);
  });

  it('has no live season before Season 1', () => {
    const v = seasonView(SEASON_FEED, Date.parse('2023-07-01T00:00:00Z'));
    expect(v.current).toBeNull();
    expect(v.history).toEqual([]);
  });
});

describe('history', () => {
  const v = seasonView(SEASON_FEED, Date.parse('2026-10-23T12:00:00Z'));

  it('lists every started season, newest first, the live one without an end', () => {
    expect(v.history.map((r) => r.season.number)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(v.history[0]!.endDate).toBeNull();
    expect(v.history[0]!.days).toBeNull();
  });

  it('ends each season on the next one\'s start and counts its days', () => {
    const byNumber = new Map(v.history.map((r) => [r.season.number, r]));
    expect(byNumber.get(1)!.endDate).toBe('2023-10-17');
    expect(byNumber.get(1)!.days).toBe(89);
    expect(byNumber.get(3)!.days).toBe(112); // the longest
    expect(byNumber.get(12)!.days).toBe(47); // the shortest, cut short by Lord of Hatred
    expect(byNumber.get(14)!.endMs).toBe(s15);
  });

  it('measures days by calendar date', () => {
    expect(daysBetween('2026-06-30', '2026-09-15')).toBe(77);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap year
  });

  it('starts a date-only season no later than its Pacific midnight', () => {
    const s9 = SEASON_FEED.seasons[8]!;
    expect(s9.startUtc).toBeUndefined();
    expect(seasonStartMs(s9)).toBe(Date.parse('2025-07-01T07:00:00Z'));
  });
});

describe('announced windows', () => {
  const w = SEASON_FEED.windows[0]!;
  const start = Date.parse(w.startUtc);
  const end = Date.parse(w.endUtc);

  it('is upcoming before its start, running from the start, ended from the end', () => {
    expect(windowState(start, end, start - 1)).toBe('upcoming');
    expect(windowState(start, end, start)).toBe('running');
    expect(windowState(start, end, end - 1)).toBe('running');
    expect(windowState(start, end, end)).toBe('ended');
  });

  it('places the 3.3.0 PTR at 10 a.m. PDT Oct 27 to 10 a.m. PST Nov 3', () => {
    expect(start).toBe(Date.UTC(2026, 9, 27, 17, 0));
    expect(end).toBe(Date.UTC(2026, 10, 3, 18, 0));
  });

  it('lists a window while it is upcoming or running, then only among the past windows', () => {
    const labels = (ws: { window: { label: string } }[]) => ws.map((x) => x.window.label);
    const before = seasonView(SEASON_FEED, start - 1);
    expect(before.windows.find((x) => x.window === w)?.state).toBe('upcoming');
    expect(labels(before.pastWindows)).not.toContain(w.label);
    expect(seasonView(SEASON_FEED, end - 1).windows.find((x) => x.window === w)?.state).toBe('running');
    const after = seasonView(SEASON_FEED, end);
    expect(labels(after.windows)).not.toContain(w.label);
    expect(labels(after.pastWindows)).toContain(w.label);
    expect(after.pastWindows.every((x) => x.state === 'ended')).toBe(true);
  });

  it('keeps every ended window, the latest first', () => {
    const older = { ...w, label: 'Season 15 PTR', startUtc: '2026-08-04T17:00:00Z', endUtc: '2026-08-11T17:00:00Z' };
    const feed = { ...SEASON_FEED, windows: [older, w] };
    const after = seasonView(feed, end + 1);
    expect(after.windows).toEqual([]);
    expect(after.pastWindows.map((x) => x.window.label)).toEqual([w.label, 'Season 15 PTR']);
  });
});
