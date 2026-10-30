// Season feed logic: which season is live, how long it has run, what is announced next, and the
// history with each season's length. A season ends when the next begins.

import type { SeasonRecord as Season, SeasonsFile as SeasonFeed, WindowRecord as SeasonWindow } from '../data/schema';
import { dayKey } from './format';

const DAY = 86400000;

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY);
}

/**
 * The instant a season started. With a known hour this is exact; with only a date it is the
 * start of that Pacific day (UTC-7 or -8; the earlier, -7, is used, so a date-only season counts
 * as started no later than it really did).
 */
export function seasonStartMs(s: Season): number {
  return s.startUtc ? Date.parse(s.startUtc) : Date.parse(`${s.startDate}T00:00:00-07:00`);
}

export interface HistoryRow {
  season: Season;
  /** Exact start if known, for display in the viewer's zone. */
  startMs: number | null;
  startDate: string;
  endMs: number | null;
  endDate: string | null;
  /** Days until the next season began; null for the live season. */
  days: number | null;
}

export type WindowState = 'upcoming' | 'running' | 'ended';

export interface WindowView {
  window: SeasonWindow;
  startMs: number;
  endMs: number;
  state: WindowState;
}

export interface SeasonView {
  current: Season | null;
  currentStartMs: number | null;
  /** Days since the current season began (0 on launch day). */
  daysIn: number | null;
  currentEndMs: number | null;
  nextStartMs: number | null;
  /** Announced windows not over yet: upcoming or running. */
  windows: WindowView[];
  /** Windows that have ended, the latest first. Kept for the record, never counted down. */
  pastWindows: WindowView[];
  /** Newest first, the live season included. */
  history: HistoryRow[];
}

export function windowState(startMs: number, endMs: number, nowMs: number): WindowState {
  if (nowMs < startMs) return 'upcoming';
  return nowMs < endMs ? 'running' : 'ended';
}

export function seasonView(feed: SeasonFeed, nowMs: number): SeasonView {
  const started = feed.seasons.filter((s) => seasonStartMs(s) <= nowMs);
  const current = started.length ? started[started.length - 1]! : null;
  const currentStartMs = current ? seasonStartMs(current) : null;
  const history: HistoryRow[] = started.map((s, i) => {
    const next = started[i + 1];
    return {
      season: s,
      startMs: s.startUtc ? Date.parse(s.startUtc) : null,
      startDate: s.startDate,
      endMs: next?.startUtc ? Date.parse(next.startUtc) : null,
      endDate: next ? next.startDate : null,
      days: next ? daysBetween(s.startDate, next.startDate) : null,
    };
  }).reverse();
  const windows = feed.windows.map((w): WindowView => {
    const startMs = Date.parse(w.startUtc);
    const endMs = Date.parse(w.endUtc);
    return { window: w, startMs, endMs, state: windowState(startMs, endMs, nowMs) };
  });
  return {
    current,
    currentStartMs,
    daysIn: currentStartMs === null ? null : Math.floor((nowMs - currentStartMs) / DAY),
    currentEndMs: feed.currentEndUtc ? Date.parse(feed.currentEndUtc) : null,
    nextStartMs: feed.nextStartUtc ? Date.parse(feed.nextStartUtc) : null,
    windows: windows.filter((w) => w.state !== 'ended'),
    pastWindows: windows.filter((w) => w.state === 'ended').sort((a, b) => b.endMs - a.endMs),
    history,
  };
}

/** Problems with the feed data; empty when it is consistent. */
export function validateFeed(feed: SeasonFeed): string[] {
  const problems: string[] = [];
  feed.seasons.forEach((s, i) => {
    if (s.number !== i + 1) problems.push(`season at position ${i} is numbered ${s.number}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.startDate)) problems.push(`season ${s.number} has a bad startDate`);
    if (s.startUtc) {
      const ms = Date.parse(s.startUtc);
      if (!Number.isFinite(ms)) problems.push(`season ${s.number} has a bad startUtc`);
      // The announced date is a Pacific date: the exact instant must fall on it there.
      else if (dayKey(ms, 'America/Los_Angeles') !== s.startDate) {
        problems.push(`season ${s.number}: ${s.startUtc} is not on ${s.startDate} in Pacific time`);
      }
    }
    const prev = feed.seasons[i - 1];
    if (prev && seasonStartMs(prev) >= seasonStartMs(s)) problems.push(`season ${s.number} starts before season ${prev.number}`);
  });
  for (const w of feed.windows) {
    if (!(Date.parse(w.startUtc) < Date.parse(w.endUtc))) problems.push(`window ${w.label} ends before it starts`);
  }
  return problems;
}

/** Whole days since a YYYY-MM-DD check date, for "checked 12 days ago". */
export function daysSince(date: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(`${date}T00:00:00Z`)) / DAY);
}
