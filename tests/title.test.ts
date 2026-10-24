import { describe, expect, it } from 'vitest';
import { DETAIL_REASONS, eventDefinitions } from '../src/data';
import { OfflineDetailsSource } from '../src/adapters/offline-details';
import { eventStatus } from '../src/engine/events';
import { APP_TITLE, tabTitle } from '../src/engine/title';

const offline = new OfflineDetailsSource(DETAIL_REASONS);
const at = (t: number) => eventDefinitions().map((d) => eventStatus(d, offline.details(d.kind), t));
// 2026-10-24 15:14:30 UTC: Helltide active until 15:55, Legion next at 15:20, World Boss at 18:00.
const now = Date.UTC(2026, 9, 24, 15, 14, 30);

describe('tab title', () => {
  it('counts down to the soonest start with seconds while visible', () => {
    expect(tabTitle(at(now), 'next', true)).toBe(`Legion 5:30 - ${APP_TITLE}`);
  });

  it('shows whole minutes, rounded up, in a background tab', () => {
    expect(tabTitle(at(now), 'next', false)).toBe(`Legion in 6 min - ${APP_TITLE}`);
  });

  it('follows a chosen event', () => {
    expect(tabTitle(at(now), 'worldBoss', true)).toBe(`World Boss 2:45:30 - ${APP_TITLE}`);
  });

  it('counts a running Helltide down to its end when Helltide is chosen', () => {
    expect(tabTitle(at(now), 'helltide', true)).toBe(`Helltide 40:30 left - ${APP_TITLE}`);
    expect(tabTitle(at(now), 'helltide', false)).toBe(`Helltide 41 min left - ${APP_TITLE}`);
  });

  it('is just the app name when turned off or when nothing is shown', () => {
    expect(tabTitle(at(now), 'off', true)).toBe(APP_TITLE);
    expect(tabTitle([], 'next', true)).toBe(APP_TITLE);
  });

  it('picks the next event among those passed in (hidden cards are left out by the caller)', () => {
    const noLegion = at(now).filter((s) => s.kind !== 'legion');
    expect(tabTitle(noLegion, 'next', true)).toBe(`Helltide 45:30 - ${APP_TITLE}`);
  });
});
