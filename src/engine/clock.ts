// Clock check. Countdowns are only as good as the computer's clock, so the app compares it with
// the Date header of requests to its own address (no outside service, no time API).
//
// A cache in between makes Date hard to read, and caches disagree. GitHub Pages' CDN stamps the
// current time in Date and adds the stored copy's Age (measured live, 2026-10-24). A standard cache
// keeps the origin's old Date and adds Age, so the time is Date + Age. A misbehaving one keeps an old
// Date and sends no Age at all. One reading cannot tell these apart, so the check takes two readings
// a few seconds apart. Each reading gives a window for the server's time (the header's resolution,
// widened by half the round trip), and one correction must fit both windows. Only a header that
// moves in step with real time can do that, because the readings are further apart than any window
// is wide:
//
//   Date fits both readings              -> Date is a live clock (GitHub's CDN, or no cache).
//   only Date + Age fits both            -> a standard cache.
//   neither (frozen, jumping, garbage)   -> unreliable: make no correction at all.
//
// The correction is the smallest one that fits, and it is used only when it is at least
// MIN_CORRECTION_MS. A cached or uncertain answer can therefore never move the countdowns of a
// clock that is right.

/** One same-origin request: the device clock around it and the headers that came back. */
export interface ClockSample {
  /** Date.now() just before the request. */
  sentMs: number;
  /** Date.now() when the response headers arrived. */
  receivedMs: number;
  /** The Date header, or null. */
  date: string | null;
  /** The Age header, or null. */
  age: string | null;
}

export type ClockBasis = 'date' | 'date+age';

export interface ClockEstimate {
  /** Add this to Date.now() to get the corrected time, in ms. 0 when no correction applies. */
  offsetMs: number;
  /** The smallest correction that fits every reading (server minus local), in ms; 0 if none is needed. */
  measuredMs: number;
  /** Half the width of the range of corrections that fit, in ms. */
  uncertaintyMs: number;
  /** True when the correction is large enough to be used. */
  applied: boolean;
  /** Which reading of the headers fitted. */
  basis: ClockBasis;
}

/** Corrections smaller than this are left alone. */
export const MIN_CORRECTION_MS = 1500;
/** Round trips slower than this give too loose a reading to trust. */
export const MAX_ROUND_TRIP_MS = 1500;
/** The readings must be at least this far apart, wider than any window, so a frozen header cannot fit. */
export const MIN_SAMPLE_GAP_MS = 4000;
/** How far apart the app takes its two readings. */
export const SAMPLE_GAP_MS = 5000;
/** A "correction" larger than this means a broken header, not a wrong clock (TLS would fail first). */
export const MAX_PLAUSIBLE_OFFSET_MS = 24 * 3600 * 1000;

interface Reading {
  local: number; // the device clock halfway through the round trip
  slack: number; // half the round trip
  date: number; // the Date header, ms
  age: number; // the Age header, s (0 when absent)
  hasAge: boolean;
}

function read(s: ClockSample): Reading | null {
  if (!s.date) return null;
  const date = Date.parse(s.date);
  if (!Number.isFinite(date)) return null;
  const rt = s.receivedMs - s.sentMs;
  if (!(rt >= 0 && rt <= MAX_ROUND_TRIP_MS)) return null;
  let age = 0;
  if (s.age !== null) {
    if (!/^\d+$/.test(s.age.trim())) return null;
    age = Number(s.age.trim());
  }
  return { local: s.sentMs + rt / 2, slack: rt / 2, date, age, hasAge: s.age !== null };
}

/** The corrections that fit every reading under one reading of the headers, or null if none fits. */
function fit(rs: Reading[], window: (r: Reading) => [number, number]): [number, number] | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const r of rs) {
    const [a, b] = window(r);
    lo = Math.max(lo, a - r.local - r.slack);
    hi = Math.min(hi, b - r.local + r.slack);
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Estimate the device clock's error from two or more readings in time order. Returns null when the
 * readings cannot be trusted; the caller then keeps the device clock as it is.
 */
export function estimateClock(samples: ClockSample[]): ClockEstimate | null {
  if (samples.length < 2) return null;
  const readings = samples.map(read);
  if (readings.some((r) => r === null)) return null;
  const rs = readings as Reading[];
  if (rs[rs.length - 1]!.local - rs[0]!.local < MIN_SAMPLE_GAP_MS) return null;

  // Date first: if it fits, it is a live clock. Otherwise Date + Age (two seconds of resolution).
  let basis: ClockBasis = 'date';
  let range = fit(rs, (r) => [r.date, r.date + 1000]);
  if (!range && rs.some((r) => r.hasAge)) {
    basis = 'date+age';
    range = fit(rs, (r) => [r.date + r.age * 1000, r.date + r.age * 1000 + 2000]);
  }
  if (!range) return null;
  const [lo, hi] = range;
  const measuredMs = lo > 0 ? Math.round(lo) : hi < 0 ? Math.round(hi) : 0;
  if (Math.abs(measuredMs) > MAX_PLAUSIBLE_OFFSET_MS) return null;
  const applied = Math.abs(measuredMs) >= MIN_CORRECTION_MS;
  return { offsetMs: applied ? measuredMs : 0, measuredMs, uncertaintyMs: Math.round((hi - lo) / 2), applied, basis };
}

export type ResumeKind = 'clock-jump' | 'long-gap' | null;

/** A wall-clock change this large between two ticks, beyond elapsed time, means the clock moved. */
export const CLOCK_JUMP_MS = 2000;
/** A pause this long between ticks means the computer slept (throttled tabs tick about once a minute). */
export const LONG_GAP_MS = 5 * 60 * 1000;

/**
 * Compare two ticks: the wall clock (Date.now) and a steady clock (performance.now). If the wall
 * clock moved more or less than the steady one, the system clock was changed (a time sync, or the
 * user set it); if a long time passed between ticks, the computer probably slept. Either way the
 * clock check should run again.
 */
export function detectResume(prevWall: number, prevSteady: number, wall: number, steady: number): ResumeKind {
  const wallStep = wall - prevWall;
  const steadyStep = steady - prevSteady;
  if (Math.abs(wallStep - steadyStep) > CLOCK_JUMP_MS) return 'clock-jump';
  if (wallStep > LONG_GAP_MS) return 'long-gap';
  return null;
}
