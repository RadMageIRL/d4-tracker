import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import { defaultPrefs, loadPrefs, PREFIX, sanitize, savePrefs } from '../src/store/prefs';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

function throwingStorage(): Storage {
  const fail = () => { throw new Error('SecurityError'); };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe('defaults', () => {
  it('starts dark, not compact, every card shown, no reminders', () => {
    const d = defaultPrefs();
    expect(d.theme).toBe('dark');
    expect(d.compact).toBe(false);
    expect(Object.values(d.cards).every(Boolean)).toBe(true);
    expect(d.reminders).toEqual({ worldBoss: [], legion: [], helltide: [] });
    expect(d.systemNotifications).toBe(false);
    expect(d.title).toBe('next');
    expect(d.cards.sightings).toBe(true);
  });
});

describe('sanitize', () => {
  it('keeps valid fields', () => {
    const p = sanitize({ theme: 'light', compact: true, clock: '24h', zone: 'utc', cards: { map: false } });
    expect(p.theme).toBe('light');
    expect(p.compact).toBe(true);
    expect(p.clock).toBe('24h');
    expect(p.zone).toBe('utc');
    expect(p.cards.map).toBe(false);
    expect(p.cards.helltide).toBe(true);
  });

  it('replaces invalid fields with defaults', () => {
    const p = sanitize({ theme: 'neon', compact: 'yes', clock: 12, zone: null, cards: [] });
    expect(p).toEqual(defaultPrefs());
  });

  it('keeps only offered reminder lead times, largest first, without duplicates', () => {
    const p = sanitize({ reminders: { worldBoss: [5, 15, 7, 5, '10'], legion: [5, 10], helltide: [0, 1] } });
    expect(p.reminders.worldBoss).toEqual([15, 5]);
    expect(p.reminders.legion).toEqual([5]);
    expect(p.reminders.helltide).toEqual([0]);
  });

  it('treats garbage as defaults', () => {
    for (const raw of [null, undefined, 3, 'x', [], true]) expect(sanitize(raw)).toEqual(defaultPrefs());
  });
});

describe('storage key', () => {
  it('is prefixed for this app, so other apps on the same origin do not collide', () => {
    expect(PREFIX).toBe('d4-tracker:v1:');
  });

  it('matches the key the inline theme script in index.html reads before first paint', () => {
    expect(indexHtml).toContain(`localStorage.getItem('${PREFIX}prefs')`);
  });
});

describe('load and save', () => {
  it('round-trips through storage under the app prefix', () => {
    const store = memoryStorage();
    const p = { ...defaultPrefs(), compact: true };
    expect(savePrefs(p, store)).toBe(true);
    expect(store.getItem(`${PREFIX}prefs`)).not.toBeNull();
    expect(loadPrefs(store)).toEqual(p);
  });

  it('falls back to defaults on corrupt JSON', () => {
    expect(loadPrefs(memoryStorage({ [`${PREFIX}prefs`]: '{nope' }))).toEqual(defaultPrefs());
  });

  it('works without storage or when storage throws', () => {
    expect(loadPrefs(null)).toEqual(defaultPrefs());
    expect(loadPrefs(throwingStorage())).toEqual(defaultPrefs());
    expect(savePrefs(defaultPrefs(), null)).toBe(false);
    expect(savePrefs(defaultPrefs(), throwingStorage())).toBe(false);
  });
});
