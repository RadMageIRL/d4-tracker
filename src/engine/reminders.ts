// Reminder planning. Pure: given the schedules, the player's chosen lead times and a time span,
// it lists which reminders fall due. The page checks once a second, but browsers slow timers in
// background tabs (Chrome can hold them to about once a minute), so a check can arrive late.
// Each check covers the span since the previous one, so nothing is fired twice, and a reminder
// that is more than GRACE_MS late (the computer slept, say) is dropped instead of firing stale.

import type { EventKind } from './events';
import { startsInRange, type Segment } from './segments';

export interface ReminderRule {
  kind: EventKind;
  /** Minutes before the start. 0 means when it starts. */
  leadMinutes: number;
}

export interface Reminder {
  /** Stable across tabs and reloads, so a system notification can use it as its tag. */
  id: string;
  kind: EventKind;
  leadMinutes: number;
  fireAtMs: number;
  eventStartMs: number;
}

export const GRACE_MS = 3 * 60 * 1000;

export type ScheduleMap = Partial<Record<EventKind, Segment[]>>;

/** Every reminder whose fire time falls in [fromMs, toMs). */
export function remindersBetween(schedules: ScheduleMap, rules: ReminderRule[], fromMs: number, toMs: number): Reminder[] {
  const out: Reminder[] = [];
  for (const rule of rules) {
    const segs = schedules[rule.kind];
    if (!segs) continue;
    const lead = rule.leadMinutes * 60000;
    for (const o of startsInRange(segs, fromMs + lead, toMs + lead)) {
      out.push({
        id: `${rule.kind}:${o.startMs}:${rule.leadMinutes}`,
        kind: rule.kind,
        leadMinutes: rule.leadMinutes,
        fireAtMs: o.startMs - lead,
        eventStartMs: o.startMs,
      });
    }
  }
  return out.sort((a, b) => a.fireAtMs - b.fireAtMs || a.id.localeCompare(b.id));
}

/**
 * Reminders due at a check: fire time in (lastCheckMs, nowMs], and no more than GRACE_MS ago.
 */
export function dueReminders(schedules: ScheduleMap, rules: ReminderRule[], lastCheckMs: number, nowMs: number): Reminder[] {
  if (nowMs <= lastCheckMs) return [];
  const from = Math.max(lastCheckMs + 1, nowMs - GRACE_MS);
  return remindersBetween(schedules, rules, from, nowMs + 1);
}
