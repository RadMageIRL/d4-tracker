// The World Boss rotation that predictions come from: a repeating cycle of bosses and arena
// regions, one step per spawn, pinned to a spawn whose place in the cycle is known.
//
// A pin is trusted for a limited time (holdMs): first-hand reports show the place in the cycle
// shifting between weeks. The player's own in-game sightings re-pin it. A sighting the rotation
// predicted moves the pin forward (so it is trusted for longer); one it did not moves the cycle to
// the nearest place that fits what was seen. Everything here is a prediction, never a sighting.
//
// Every fourth spawn brings a second boss in an expansion region; those regions take turns, pinned
// the same way. Which boss it is, is not predicted.
//
// Helltide regions use a plain Cycle (below): one step per hour, base-game and expansion apart.
//
// Type-only imports: local scripts load this file directly with Node.

export interface RotationStep {
  boss: string;
  /** The arena's region, only where an arena order is known (none is today). */
  region?: string;
}

export interface Pin {
  /** A spawn whose place in the cycle is known. */
  startMs: number;
  position: number;
}

export interface Rotation {
  cycle: RotationStep[];
  pin: Pin;
  /** How long after its pin a main spawn is predicted. */
  holdMs: number;
  /** The second boss of a double spawn: the expansion regions it appears in, in turn. */
  second?: { regions: string[]; pin: Pin };
}

/** One spawn the player saw in game, and what they saw of it. */
export interface Sighted {
  startMs: number;
  boss?: string;
  region?: string;
}

const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Whole periods from one spawn to another, or null when the second is not on the first's grid. */
export function stepsBetween(fromMs: number, toMs: number, periodMs: number): number | null {
  const k = (toMs - fromMs) / periodMs;
  return Number.isInteger(k) ? k : null;
}

/** The main spawn predicted at startMs; null before the pin, past its hold, or off its grid. */
export function predictMain(rot: Rotation, startMs: number, periodMs: number): RotationStep | null {
  const k = stepsBetween(rot.pin.startMs, startMs, periodMs);
  if (k === null || k < 0 || startMs - rot.pin.startMs > rot.holdMs) return null;
  return rot.cycle[mod(rot.pin.position + k, rot.cycle.length)] ?? null;
}

/** The second boss's region at a double spawn; extraPeriodMs is the time between double spawns. */
export function predictSecond(rot: Rotation, startMs: number, extraPeriodMs: number): string | null {
  const s = rot.second;
  if (!s) return null;
  const k = stepsBetween(s.pin.startMs, startMs, extraPeriodMs);
  if (k === null || k < 0) return null;
  return s.regions[mod(s.pin.position + k, s.regions.length)] ?? null;
}

/** Places in the cycle that fit a sighting: boss and region where both fit, else the boss alone. */
function fitting(cycle: RotationStep[], s: Sighted): number[] {
  const all = cycle.map((_, i) => i);
  const both = all.filter((i) => (!s.boss || cycle[i]!.boss === s.boss) && (!s.region || cycle[i]!.region === s.region));
  if (both.length || !s.boss) return both;
  return all.filter((i) => cycle[i]!.boss === s.boss);
}

/** The option closest to target around a cycle of n; a tie goes forward. */
function nearest(options: number[], target: number, n: number): number {
  const ahead = (i: number) => mod(i - target, n);
  const dist = (i: number) => Math.min(ahead(i), n - ahead(i));
  return options.reduce((best, i) => (dist(i) < dist(best) || (dist(i) === dist(best) && ahead(i) < ahead(best)) ? i : best));
}

/** Move a pin through sightings, oldest first: each one that fits somewhere becomes the new pin. */
function walk(pin: Pin, sightings: Sighted[], periodMs: number, n: number, fits: (s: Sighted) => number[]): Pin {
  for (const s of [...sightings].sort((a, b) => a.startMs - b.startMs)) {
    const k = stepsBetween(pin.startMs, s.startMs, periodMs);
    if (k === null || k < 0) continue;
    const options = fits(s);
    if (!options.length) continue;
    const expected = mod(pin.position + k, n);
    pin = { startMs: s.startMs, position: options.includes(expected) ? expected : nearest(options, expected, n) };
  }
  return pin;
}

/**
 * A plain cycle of values, one step per occurrence, pinned the same way: a Helltide region, or null
 * where no Helltide of that kind runs (an expansion Helltide every other hour). Unlike the World
 * Boss rotation it is not re-pinned by sightings: a mark corrects its own hour only.
 */
export interface Cycle {
  values: (string | null)[];
  pin: Pin;
}

/** The value at startMs; null before the pin, off its grid, or where the cycle has none. */
export function cycleAt(c: Cycle, startMs: number, periodMs: number): string | null {
  const k = stepsBetween(c.pin.startMs, startMs, periodMs);
  if (k === null || k < 0) return null;
  return c.values[mod(c.pin.position + k, c.values.length)] ?? null;
}

/**
 * The rotation after the player's own sightings since its pins: main spawns re-pin the cycle,
 * second bosses re-pin the turn of expansion regions. Sightings before a pin are ignored.
 */
export function repin(rot: Rotation, main: Sighted[], second: Sighted[], periodMs: number, extraPeriodMs: number): Rotation {
  const pin = walk(rot.pin, main, periodMs, rot.cycle.length, (s) => fitting(rot.cycle, s));
  const s = rot.second;
  const secondPin = s && walk(s.pin, second, extraPeriodMs, s.regions.length, (x) => (x.region && s.regions.includes(x.region) ? [s.regions.indexOf(x.region)] : []));
  if (pin === rot.pin && (!s || secondPin === s.pin)) return rot;
  return { ...rot, pin, ...(s && secondPin ? { second: { ...s, pin: secondPin } } : {}) };
}
