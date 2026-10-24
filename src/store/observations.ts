// The player's sightings, kept in this browser (localStorage) until exported. Same rules as the
// preferences: app-prefixed key, and blocked or broken storage degrades to "nothing saved".

import { cleanObservation, type Observation } from '../engine/observations';
import { PREFIX } from './prefs';

const KEY = 'observations';
/** Plenty for years of sightings; keeps one bad import from filling the browser's storage. */
export const MAX_STORED = 5000;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadObservations(store: Storage | null = storage()): Observation[] {
  try {
    const raw = JSON.parse(store?.getItem(PREFIX + KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(cleanObservation).filter((o): o is Observation => o !== null);
  } catch {
    return [];
  }
}

/** Save; returns false when the browser did not keep it. */
export function saveObservations(list: Observation[], store: Storage | null = storage()): boolean {
  try {
    if (!store) return false;
    store.setItem(PREFIX + KEY, JSON.stringify(list.slice(-MAX_STORED)));
    return true;
  } catch {
    return false;
  }
}
