// The browser tab title: the next event's countdown, so a background tab still tells the time.
// Browsers slow timers in background tabs (Chrome to about once a minute after a few minutes), so
// a hidden tab shows whole minutes, rounded up, instead of seconds that would be stale.

import type { EventKind, EventStatus } from './events';
import { countdown, spanWords } from './format';

export type TitleChoice = 'next' | EventKind | 'off';
export const TITLE_CHOICES: TitleChoice[] = ['next', 'helltide', 'worldBoss', 'legion', 'off'];

export const APP_TITLE = 'Diablo IV Tracker';

function pick(statuses: EventStatus[], choice: TitleChoice): EventStatus | null {
  const known = statuses.filter((s) => s.phase !== 'unknown' && s.msToNext !== null);
  if (choice === 'off') return null;
  if (choice !== 'next') return known.find((s) => s.kind === choice) ?? null;
  return known.reduce<EventStatus | null>((best, s) => (!best || s.msToNext! < best.msToNext! ? s : best), null);
}

/**
 * @param statuses The events shown on the page.
 * @param visible  Whether the tab is visible (seconds) or hidden (whole minutes).
 */
export function tabTitle(statuses: EventStatus[], choice: TitleChoice, visible: boolean): string {
  const st = pick(statuses, choice);
  if (!st) return APP_TITLE;
  // A chosen Helltide that is running counts down its time left.
  if (choice === 'helltide' && st.phase === 'active' && st.msLeft !== null) {
    return `${st.name} ${visible ? countdown(st.msLeft) : spanWords(st.msLeft)} left - ${APP_TITLE}`;
  }
  const ms = st.msToNext!;
  return `${st.name} ${visible ? countdown(ms) : `in ${spanWords(ms)}`} - ${APP_TITLE}`;
}
