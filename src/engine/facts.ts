// A piece of event information is either known, with the place it came from, or unknown, with
// the reason. The UI renders both; it never fills an unknown with a guess.

/**
 * seen      - seen in game for this very occurrence
 * reported  - someone told the player; not checked (cards show it only as a hint)
 * predicted - worked out from an order that sightings have borne out (never seen for this one)
 */
export type Basis = 'seen' | 'reported' | 'predicted';

export interface KnownFact<T> {
  known: true;
  value: T;
  /** Short label of where the value came from, e.g. "Calculated from the schedule". */
  source: string;
  basis?: Basis;
  /** For a prediction: Inferred, or Confirmed when Blizzard documents the order. */
  confidence?: 'confirmed' | 'inferred';
}

export interface UnknownFact {
  known: false;
  /** Why the value is not available, written for the player. */
  reason: string;
  /** A few words for a one-line display, e.g. "shown in game when it begins". */
  hint?: string;
}

export type Fact<T> = KnownFact<T> | UnknownFact;

export function known<T>(value: T, source: string, basis?: Basis, confidence?: 'confirmed' | 'inferred'): KnownFact<T> {
  const f: KnownFact<T> = { known: true, value, source };
  if (basis) f.basis = basis;
  if (confidence) f.confidence = confidence;
  return f;
}

export function unknown(reason: string, hint?: string): UnknownFact {
  return hint === undefined ? { known: false, reason } : { known: false, reason, hint };
}
