// Helltide chest spots and which ones are known to be active right now.
//
// A spot is a place a chest has been seen: a region, the landmark name the game shows, and the
// chest type. Spots come from our shared data (checked records) and from the player's own chest
// sightings. A spot is "active" only while a sighting says so: one made during the Helltide in
// progress, for that spot, and before the next time that chest type moves (players report Mystery
// chests moving about half an hour in). No report is never read as "inactive": a spot nobody has
// reported is simply not verified.

import type { Confidence } from '../data/schema';
import { isSeen, occurrenceOf, type ArtPosition, type Observation, type Realm } from './observations';
import { activeOccurrence, type Segment } from './segments';

export interface ChestTypeInfo {
  id: string;
  name: string;
  /** Minutes after a Helltide begins at which its chests move to other spots (empty: they stay). */
  relocatesAtMinutes: number[];
}

/** A chest spot from our shared data. */
export interface SharedSpot {
  id: string;
  region: string;
  name: string;
  type: string;
  confidence: Confidence;
  checkedOn: string;
  position?: ArtPosition;
  source: string;
}

export interface ChestSpot {
  /** region|name|type, name compared without case. */
  key: string;
  region: string;
  name: string;
  type: string;
  /** In our shared data, or only in the player's own sightings. */
  origin: 'shared' | 'yours';
  /** Shared: the record's own. Yours: Confirmed once you saw it yourself, Unknown on reports alone. */
  confidence: Confidence;
  position?: ArtPosition;
  /** Sightings of a chest at this spot (spot records and active marks). */
  sightings: number;
  lastSeenMs: number | null;
  /** For a shared spot: its sources and the day they were checked. */
  source?: string;
  checkedOn?: string;
}

export type ChestState =
  | { state: 'active'; seenMs: number; untilMs: number; basis: 'seen' | 'reported' }
  | { state: 'unverified' };

export function spotKey(region: string, name: string, type: string): string {
  return `${region}|${name.trim().toLowerCase()}|${type}`;
}

function obsKey(o: Observation): string | null {
  return o.event === 'helltideChest' && o.region && o.place && o.chest ? spotKey(o.region, o.place, o.chest) : null;
}

/** Every known spot: shared ones first, then the player's own, each with its sighting count. */
export function chestSpots(shared: SharedSpot[], observations: Observation[]): ChestSpot[] {
  const spots = new Map<string, ChestSpot>();
  for (const s of shared) {
    spots.set(spotKey(s.region, s.name, s.type), {
      key: spotKey(s.region, s.name, s.type), region: s.region, name: s.name, type: s.type, origin: 'shared',
      confidence: s.confidence, sightings: 0, lastSeenMs: null, source: s.source, checkedOn: s.checkedOn,
      ...(s.position ? { position: s.position } : {}),
    });
  }
  const byTime = [...observations].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  for (const o of byTime) {
    const key = obsKey(o);
    if (!key) continue;
    let spot = spots.get(key);
    if (!spot) {
      spot = { key, region: o.region!, name: o.place!, type: o.chest!, origin: 'yours', confidence: 'unknown', sightings: 0, lastSeenMs: null };
      spots.set(key, spot);
    }
    spot.sightings++;
    const t = Date.parse(o.at);
    if (spot.lastSeenMs === null || t > spot.lastSeenMs) spot.lastSeenMs = t;
    if (spot.origin === 'yours' && isSeen(o)) spot.confidence = 'confirmed';
    // The newest placement wins: a player who moves a pin means the new place.
    if (o.pos && (spot.origin === 'yours' || !spot.position)) spot.position = o.pos;
  }
  return [...spots.values()];
}

/**
 * Is a chest at this spot known to be active at nowMs? Only a sighting made during the Helltide in
 * progress counts, until the type next moves, and from the same realm when the player chose one. A
 * sighting seen in game wins over a secondhand report.
 */
export function chestState(
  spot: ChestSpot, observations: Observation[], helltide: Segment[], types: ChestTypeInfo[], nowMs: number, realm?: Realm,
): ChestState {
  const current = activeOccurrence(helltide, nowMs);
  if (!current) return { state: 'unverified' };
  const moves = (types.find((t) => t.id === spot.type)?.relocatesAtMinutes ?? []).map((m) => current.startMs + m * 60000);
  let best: ChestState = { state: 'unverified' };
  for (const o of observations) {
    if (obsKey(o) !== spot.key || o.timing === 'none') continue;
    if (realm && o.realm && o.realm !== realm) continue;
    const t = Date.parse(o.at);
    if (t > nowMs || occurrenceOf(helltide, o)?.startMs !== current.startMs) continue;
    const untilMs = Math.min(current.endMs, ...moves.filter((m) => m > t));
    if (nowMs >= untilMs) continue;
    const basis = isSeen(o) ? 'seen' : 'reported';
    const better = best.state === 'unverified'
      || (basis === 'seen' && best.basis === 'reported')
      || (basis === best.basis && t > best.seenMs);
    if (better) best = { state: 'active', seenMs: t, untilMs, basis };
  }
  return best;
}

/**
 * The regions a Helltide was seen (or reported) in during the occurrence in progress. Two can run
 * at once, one in a base-game region and one in an expansion region, so this is a list. A region
 * seen in game is "seen" even if someone also reported it.
 */
export function observedHelltideRegions(observations: Observation[], helltide: Segment[], nowMs: number): { region: string; basis: 'seen' | 'reported' }[] {
  const current = activeOccurrence(helltide, nowMs);
  if (!current) return [];
  const out = new Map<string, 'seen' | 'reported'>();
  for (const o of observations) {
    if (o.event !== 'helltide' || !o.region || o.timing === 'none') continue;
    const t = Date.parse(o.at);
    if (t > nowMs || t >= current.endMs || occurrenceOf(helltide, o)?.startMs !== current.startMs) continue;
    if (isSeen(o)) out.set(o.region, 'seen');
    else if (!out.has(o.region)) out.set(o.region, 'reported');
  }
  return [...out].map(([region, basis]) => ({ region, basis }));
}

/** FNV-1a, 32 bits, as 8 hex digits: a short fingerprint of one atlas drawing. */
export function artHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
