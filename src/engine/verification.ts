// When our own in-game sightings are enough to confirm something, and when they are not.
//
// A schedule anchor (where a cycle starts) becomes Confirmed only with at least MIN_MATCHING
// start-time sightings that agree with the schedule, spread over at least MIN_DAYS different UTC
// days, and none that disagree.
//
// A location is a different question. One sighting confirms that a place exists and is used. A
// recurring rotation (which place comes next) is never Confirmed from sightings at all: the best
// they can give is "inferred, consistent so far", and only with the evidence rotationCheck asks for.

import { isSeen, TIMING_TOLERANCE_MS, offsetFromSchedule, type Observation, type ObservedEvent } from './observations';
import type { Segment } from './segments';

export const MIN_MATCHING = 3;
export const MIN_DAYS = 2;

export interface AnchorEvidence {
  /**
   * Distinct calculated starts that a start-time sighting matched (within the tolerance). Two
   * records of one spawn (the main and the second World Boss, or the same one logged twice) count
   * once.
   */
  matching: number;
  /** Distinct UTC days among the matching sightings. */
  days: string[];
  /** Start-time sightings that do not match. */
  disagreeing: number;
  /** Enough to call the anchor Confirmed. */
  qualifies: boolean;
}

export function anchorEvidence(observations: Observation[], segs: Segment[], event: ObservedEvent): AnchorEvidence {
  const starts = new Set<number>();
  let disagreeing = 0;
  const days = new Set<string>();
  for (const o of observations) {
    if (o.event !== event || o.timing !== 'start' || !isSeen(o)) continue;
    const t = Date.parse(o.at);
    const off = offsetFromSchedule(segs, t);
    if (off === null) continue;
    if (Math.abs(off) <= TIMING_TOLERANCE_MS) {
      const start = t - off;
      starts.add(start);
      days.add(new Date(start).toISOString().slice(0, 10));
    } else {
      disagreeing++;
    }
  }
  const matching = starts.size;
  const dayList = [...days].sort();
  return {
    matching,
    days: dayList,
    disagreeing,
    qualifies: matching >= MIN_MATCHING && dayList.length >= MIN_DAYS && disagreeing === 0,
  };
}

/** Progress toward confirming an anchor, for the page. */
export function anchorProgress(e: AnchorEvidence): string {
  if (e.disagreeing) {
    return `${e.disagreeing} in-game start${e.disagreeing === 1 ? '' : 's'} disagree${e.disagreeing === 1 ? 's' : ''} with the schedule; it needs checking before it can be confirmed.`;
  }
  if (e.qualifies) return `${e.matching} in-game starts on ${e.days.length} days match the schedule.`;
  return `${Math.min(e.matching, MIN_MATCHING)} of ${MIN_MATCHING} matching in-game starts, on ${Math.min(e.days.length, MIN_DAYS)} of ${MIN_DAYS} days, needed to confirm it.`;
}
