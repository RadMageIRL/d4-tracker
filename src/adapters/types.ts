// Data sources sit behind these two interfaces, so a source that turns out to be unreliable can
// be swapped without touching the dashboard. v0.1 ships local implementations only: schedules
// calculated from checked constants, and details that report what is not known.

import type { EventDefinition, EventDetails, EventKind } from '../engine/events';
import type { Occurrence } from '../engine/schedule';

/** Supplies the event schedules. */
export interface ScheduleSource {
  readonly id: string;
  readonly label: string;
  /** The definitions in force at nowMs. */
  definitions(nowMs: number): EventDefinition[];
}

/**
 * Supplies location and identity for an occurrence. Must be synchronous and cheap: a source that
 * fetches data does so on its own conservative schedule, keeps the result, and answers from it.
 */
export interface DetailsSource {
  readonly id: string;
  readonly label: string;
  details(kind: EventKind, occurrence: Occurrence | null, nowMs: number): EventDetails;
  /** Begin any background work; call onChange when new data arrives. */
  start?(onChange: () => void): void;
  stop?(): void;
}
