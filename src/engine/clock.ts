// Clock check. Countdowns are only as good as the computer's clock, so the app compares it with
// the Date header of a request to its own host (no outside service, no time API). The header has
// one-second resolution, which bounds what can be detected; small differences are left alone.
// A cache in front of the host (a CDN) can answer with a stored copy whose Date is old; the Age
// header says by how many seconds, so it is added back.

export interface ClockEstimate {
  /** Add this to Date.now() to get the corrected time, in ms. 0 when no correction applies. */
  offsetMs: number;
  /** The raw measured difference (server minus local), in ms. */
  measuredMs: number;
  /** How far the measurement can be off, in ms. */
  uncertaintyMs: number;
  /** True when the difference is large enough to be real and the correction is used. */
  applied: boolean;
}

/** Differences smaller than this are treated as noise and not corrected. */
export const MIN_CORRECTION_MS = 2000;

/** Round trips slower than this give too loose a reading to trust. */
export const MAX_ROUND_TRIP_MS = 3000;

/**
 * Estimate the local clock's error from one request.
 * @param sentMs     Date.now() just before the request.
 * @param receivedMs Date.now() when the response headers arrived.
 * @param dateHeader The response's Date header (HTTP-date, whole seconds).
 * @param ageHeader  The response's Age header (whole seconds a cache has held it), if any.
 * @returns The estimate, or null when the reading is unusable.
 */
export function estimateClock(
  sentMs: number, receivedMs: number, dateHeader: string | null, ageHeader: string | null = null,
): ClockEstimate | null {
  if (!dateHeader) return null;
  const serverSecondMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverSecondMs)) return null;
  const roundTrip = receivedMs - sentMs;
  if (roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) return null;
  let ageSeconds = 0;
  if (ageHeader !== null) {
    if (!/^\d+$/.test(ageHeader.trim())) return null;
    ageSeconds = Number(ageHeader.trim());
  }
  // The server's true time lies in a window that starts at Date (+ Age): one second wide from the
  // Date header, one more from the Age header. Take its middle, read halfway through the trip.
  const windowMs = ageHeader === null ? 1000 : 2000;
  const serverMid = serverSecondMs + ageSeconds * 1000 + windowMs / 2;
  const measuredMs = Math.round(serverMid - (sentMs + roundTrip / 2));
  const uncertaintyMs = Math.round(windowMs / 2 + roundTrip / 2);
  const applied = Math.abs(measuredMs) >= Math.max(MIN_CORRECTION_MS, uncertaintyMs);
  return { offsetMs: applied ? measuredMs : 0, measuredMs, uncertaintyMs, applied };
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
