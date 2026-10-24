// An event's timing as a list of schedule segments, each valid for starts in [fromMs, untilMs).
// One open-ended segment is the usual case; a second one lets a known future change (Season 16's
// Helltide split, once its date is announced) take over at its date without code changes.

import {
  latestAtOrBefore, nextAfter, startsBetween, type Occurrence, type PeriodicSchedule,
} from './schedule';

export interface Segment {
  /** First instant this schedule applies to (-Infinity for "always"). */
  fromMs: number;
  /** First instant it no longer applies to (Infinity for "no end"). */
  untilMs: number;
  schedule: PeriodicSchedule;
}

/** One segment covering all time. */
export function always(schedule: PeriodicSchedule): Segment[] {
  return [{ fromMs: -Infinity, untilMs: Infinity, schedule }];
}

/** The segment in force at t, or null when no schedule covers t. */
export function segmentAt(segs: Segment[], t: number): Segment | null {
  return segs.find((s) => t >= s.fromMs && t < s.untilMs) ?? null;
}

/** The first start strictly after t, across segments; null when no later schedule exists. */
export function nextStart(segs: Segment[], t: number): Occurrence | null {
  for (const seg of segs) {
    if (seg.untilMs <= t) continue;
    const lower = Math.max(t + 1, seg.fromMs);
    const o = nextAfter(seg.schedule, lower - 1);
    if (o.startMs < seg.untilMs) return o;
  }
  return null;
}

/** The latest start at or before t, across segments; null when none. */
export function lastStart(segs: Segment[], t: number): Occurrence | null {
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i]!;
    if (seg.fromMs > t) continue;
    const o = latestAtOrBefore(seg.schedule, Math.min(t, seg.untilMs - 1));
    if (o.startMs >= seg.fromMs) return o;
  }
  return null;
}

/** The occurrence in progress at t (start inclusive, end exclusive), or null. */
export function activeOccurrence(segs: Segment[], t: number): Occurrence | null {
  const o = lastStart(segs, t);
  return o && t < o.endMs ? o : null;
}

/** Every start in [fromMs, toMs), across segments, in order. */
export function startsInRange(segs: Segment[], fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const seg of segs) {
    out.push(...startsBetween(seg.schedule, Math.max(fromMs, seg.fromMs), Math.min(toMs, seg.untilMs)));
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** The next `count` starts strictly after t. */
export function startsAfter(segs: Segment[], t: number, count: number): Occurrence[] {
  const out: Occurrence[] = [];
  let at = t;
  while (out.length < count) {
    const o = nextStart(segs, at);
    if (!o) break;
    out.push(o);
    at = o.startMs;
  }
  return out;
}
