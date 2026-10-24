// A piece of event information is either known, with the place it came from, or unknown, with
// the reason. The UI renders both; it never fills an unknown with a guess.

export interface KnownFact<T> {
  known: true;
  value: T;
  /** Short label of where the value came from, e.g. "Calculated from the schedule". */
  source: string;
}

export interface UnknownFact {
  known: false;
  /** Why the value is not available, written for the player. */
  reason: string;
  /** A few words for a one-line display, e.g. "shown in game when it begins". */
  hint?: string;
}

export type Fact<T> = KnownFact<T> | UnknownFact;

export function known<T>(value: T, source: string): KnownFact<T> {
  return { known: true, value, source };
}

export function unknown(reason: string, hint?: string): UnknownFact {
  return hint === undefined ? { known: false, reason } : { known: false, reason, hint };
}
