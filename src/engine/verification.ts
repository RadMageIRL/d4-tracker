// When our own in-game sightings are enough to confirm something, and when they are not.
//
// A schedule anchor (where a cycle starts) becomes Confirmed only with at least MIN_MATCHING
// start-time sightings that agree with the schedule, spread over at least MIN_DAYS different UTC
// days, and none that disagree.
//
// A location is a different question. One sighting confirms that a place exists and is used. A
// recurring rotation (which place comes next) is never Confirmed from sightings at all: the best
// they can give is "inferred, consistent so far", and only with the evidence rotationCheck asks for.

import { TIMING_TOLERANCE_MS, offsetFromSchedule, type Observation, type ObservedEvent } from './observations';
import type { Segment } from './segments';

export const MIN_MATCHING = 3;
export const MIN_DAYS = 2;

export interface AnchorEvidence {
  /** Start-time sightings within the tolerance of a calculated start. */
  matching: number;
  /** Distinct UTC days among the matching sightings. */
  days: string[];
  /** Start-time sightings that do not match. */
  disagreeing: number;
  /** Enough to call the anchor Confirmed. */
  qualifies: boolean;
}

export function anchorEvidence(observations: Observation[], segs: Segment[], event: ObservedEvent): AnchorEvidence {
  let matching = 0;
  let disagreeing = 0;
  const days = new Set<string>();
  for (const o of observations) {
    if (o.event !== event || o.timing !== 'start') continue;
    const t = Date.parse(o.at);
    const off = offsetFromSchedule(segs, t);
    if (off === null) continue;
    if (Math.abs(off) <= TIMING_TOLERANCE_MS) {
      matching++;
      days.add(o.at.slice(0, 10));
    } else {
      disagreeing++;
    }
  }
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
