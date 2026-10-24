// Schedules calculated in the browser from the checked data in data/events.json. No network:
// this is the source every timer uses.

import type { EventDefinition } from '../engine/events';
import { validateSchedule } from '../engine/schedule';
import type { ScheduleSource } from './types';

export class LocalScheduleSource implements ScheduleSource {
  readonly id = 'local';
  readonly label = 'Calculated in your browser from a fixed schedule';

  constructor(private defs: EventDefinition[]) {
    for (const d of defs) for (const s of d.segments) validateSchedule(s.schedule);
  }

  definitions(): EventDefinition[] {
    return this.defs;
  }
}
