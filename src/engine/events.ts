// Event state at an instant: what is up now, what comes next and when, and what is known about
// where. Timing comes from schedule segments; location and identity come from a details source,
// and stay unknown (with the reason) when nothing reliable supplies them.

import type { Claim, RosterEntry } from '../data/schema';
import type { Fact } from './facts';
import type { Occurrence } from './schedule';
import {
  activeOccurrence, lastStart, nextStart, segmentAt, startsAfter, type Segment,
} from './segments';

export type EventKind = 'helltide' | 'worldBoss' | 'legion';

export const EVENT_KINDS: EventKind[] = ['helltide', 'worldBoss', 'legion'];

/** A schedule segment with how sure we are of its interval and of its start point. */
export interface TimedSegment extends Segment {
  interval: Claim;
  phase: Claim;
}

export interface EventDefinition {
  kind: EventKind;
  name: string;
  /** Empty when no schedule can be trusted; the card then says so. */
  segments: TimedSegment[];
  /** The day the data was last checked against current sources (YYYY-MM-DD). */
  checkedOn: string;
  /** An announced change that is not live yet, shown under the card. */
  notice: string | null;
  roster?: RosterEntry[];
}

export interface EventDetails {
  location: Fact<string>;
  /** Which boss, for the World Boss; not used by the other events. */
  identity?: Fact<string>;
}

export type Phase = 'active' | 'waiting' | 'unknown';

export interface EventStatus {
  kind: EventKind;
  name: string;
  phase: Phase;
  /** The occurrence in progress, if any. */
  active: Occurrence | null;
  /** The next occurrence to start (strictly after now). */
  next: Occurrence | null;
  /** The most recent start at or before now, for "spawned 3 min ago". */
  previous: Occurrence | null;
  msLeft: number | null;
  msToNext: number | null;
  /** 0..1: how far through the active window, or through the wait for the next start. */
  progress: number | null;
  /** Starts after `next`, for the short list on the card. */
  later: Occurrence[];
  /** The segment in force now, for its confidence notes. */
  segment: TimedSegment | null;
  details: EventDetails;
  definition: EventDefinition;
}

export function eventStatus(
  def: EventDefinition,
  details: EventDetails,
  nowMs: number,
  laterCount = 3,
): EventStatus {
  const base = { kind: def.kind, name: def.name, details, definition: def };
  const segs = def.segments;
  const next = nextStart(segs, nowMs);
  if (!next) {
    return {
      ...base, phase: 'unknown', active: null, next: null, previous: null,
      msLeft: null, msToNext: null, progress: null, later: [], segment: null,
    };
  }
  const active = activeOccurrence(segs, nowMs);
  const previous = lastStart(segs, nowMs);
  let progress: number;
  let msLeft: number | null = null;
  if (active) {
    msLeft = active.endMs - nowMs;
    progress = (nowMs - active.startMs) / (active.endMs - active.startMs);
  } else {
    // Waiting: measure from the end of the previous occurrence (its start, for a spawn).
    const waitFrom = previous ? previous.endMs : nowMs;
    progress = (nowMs - waitFrom) / (next.startMs - waitFrom);
  }
  return {
    ...base,
    phase: active ? 'active' : 'waiting',
    active,
    next,
    previous,
    msLeft,
    msToNext: next.startMs - nowMs,
    progress: Math.min(1, Math.max(0, progress)),
    later: startsAfter(segs, next.startMs, laterCount),
    segment: (segmentAt(segs, nowMs) as TimedSegment | null) ?? null,
    details,
  };
}

/** True when the segment in force at t has spawns with no known length (World Boss, Legion). */
export function isInstant(def: EventDefinition, t: number): boolean {
  const seg = segmentAt(def.segments, t);
  return !!seg && seg.schedule.durationMs === 0;
}
