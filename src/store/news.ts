// The latest headlines, kept in this browser so reopening the bar or reloading the page within 15
// minutes does not ask again. Same rules as the preferences: app-prefixed key, and blocked or broken
// storage degrades to "nothing saved".

import { sanitizeCache, type NewsCache } from '../engine/news';
import { PREFIX } from './prefs';

const KEY = 'news';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadNews(store: Storage | null = storage()): NewsCache | null {
  try {
    const text = store?.getItem(PREFIX + KEY);
    return text == null ? null : sanitizeCache(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Save; returns false when the browser did not keep it. */
export function saveNews(cache: NewsCache, store: Storage | null = storage()): boolean {
  try {
    if (!store) return false;
    store.setItem(PREFIX + KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}
