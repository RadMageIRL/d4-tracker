// Fixed-interval schedules. Every Diablo IV event this tracker times repeats on a fixed period
// from a known start, so one occurrence is fully described by its index: start = anchor +
// index * period. All arithmetic is in UTC epoch milliseconds; time zones only matter when a
// time is displayed.

export interface PeriodicSchedule {
  /** A UTC instant (epoch ms) at which one occurrence started or will start. */
  anchorMs: number;
  /** Time from one start to the next, in ms. */
  periodMs: number;
  /** How long one occurrence lasts, in ms. 0 means an instant (a spawn with no known window). */
  durationMs: number;
}

export interface Occurrence {
  /** Occurrence number relative to the anchor (negative before it). */
  index: number;
  startMs: number;
  /** startMs + durationMs. An occurrence is active for startMs <= t < endMs. */
  endMs: number;
}

/** Floor division that stays correct for instants before the anchor. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function validateSchedule(s: PeriodicSchedule): void {
  if (!Number.isFinite(s.anchorMs)) throw new RangeError('anchorMs must be a finite number');
  if (!Number.isFinite(s.periodMs) || s.periodMs <= 0) throw new RangeError('periodMs must be positive');
  if (!Number.isFinite(s.durationMs) || s.durationMs < 0 || s.durationMs > s.periodMs) {
    throw new RangeError('durationMs must be between 0 and periodMs');
  }
}

export function occurrence(s: PeriodicSchedule, index: number): Occurrence {
  const startMs = s.anchorMs + index * s.periodMs;
  return { index, startMs, endMs: startMs + s.durationMs };
}

/** Index of the latest occurrence that started at or before t. */
export function indexAt(s: PeriodicSchedule, t: number): number {
  return floorDiv(t - s.anchorMs, s.periodMs);
}

/** The occurrence active at t, or null. The start is inclusive, the end exclusive. */
export function activeAt(s: PeriodicSchedule, t: number): Occurrence | null {
  // A zero-length occurrence (a spawn) is never active: no t satisfies start <= t < start.
  const o = occurrence(s, indexAt(s, t));
  return t >= o.startMs && t < o.endMs ? o : null;
}

/** The first occurrence that starts strictly after t. */
export function nextAfter(s: PeriodicSchedule, t: number): Occurrence {
  return occurrence(s, indexAt(s, t) + 1);
}

/** The latest occurrence that started at or before t. */
export function latestAtOrBefore(s: PeriodicSchedule, t: number): Occurrence {
  return occurrence(s, indexAt(s, t));
}

/** The next `count` occurrences that start strictly after t. */
export function upcoming(s: PeriodicSchedule, t: number, count: number): Occurrence[] {
  const first = indexAt(s, t) + 1;
  const out: Occurrence[] = [];
  for (let i = 0; i < count; i++) out.push(occurrence(s, first + i));
  return out;
}

/** Every occurrence whose start falls in [fromMs, toMs). */
export function startsBetween(s: PeriodicSchedule, fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  if (toMs <= fromMs) return out;
  let i = Math.ceil((fromMs - s.anchorMs) / s.periodMs);
  for (let o = occurrence(s, i); o.startMs < toMs; o = occurrence(s, ++i)) out.push(o);
  return out;
}
