// Details when no live source is connected: anything that cannot be calculated is reported as
// unknown, with a short hint for the card and the full reason, instead of being guessed.

import type { EventDetails, EventKind } from '../engine/events';
import { unknown } from '../engine/facts';
import type { DetailsSource } from './types';

export interface UnknownText {
  hint: string;
  reason: string;
}

export type DetailReasons = Record<EventKind, { location: UnknownText; identity?: UnknownText }>;

export class OfflineDetailsSource implements DetailsSource {
  readonly id = 'offline';
  readonly label = 'none connected, so locations and boss names show as unknown';

  constructor(private reasons: DetailReasons) {}

  details(kind: EventKind): EventDetails {
    const r = this.reasons[kind];
    const out: EventDetails = { location: unknown(r.location.reason, r.location.hint) };
    if (r.identity !== undefined) out.identity = unknown(r.identity.reason, r.identity.hint);
    return out;
  }
}
