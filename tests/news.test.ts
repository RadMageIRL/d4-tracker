import { describe, expect, it } from 'vitest';
import saved from './fixtures/blizzard-news-2026-10-25.json';
import {
  BLIZZARD_NEWS, cleanLink, isFresh, NEWS_COUNT, NEWS_REFRESH_MS, parseNews, plainText, sanitizeCache, type NewsItem,
} from '../src/engine/news';
import { PREFIX } from '../src/store/prefs';
import { loadNews, saveNews } from '../src/store/news';

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
  const no = () => { throw new Error('blocked'); };
  return { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no };
}

const post = (properties: Record<string, unknown>) => ({ contentType: 'blogs', properties });
const ok = { title: 'A post', newsUrl: 'https://news.blizzard.com/en-us/article/1/a-post', lastUpdated: '2026-10-01T17:00:00Z', category: 'News' };

describe('Blizzard News list', () => {
  it('reads the saved copy: the eight newest posts, newest first, with their links, dates and categories', () => {
    const items = parseNews(saved);
    expect(items).toHaveLength(NEWS_COUNT);
    expect(items[0]).toEqual({
      title: 'The 3.3.0 PTR: What You Need to Know',
      link: 'https://news.blizzard.com/en-us/article/24302578/the-3-3-0-ptr-what-you-need-to-know',
      dateMs: Date.parse('2026-10-22T17:00:00Z'),
      category: 'News',
    });
    expect(items.map((i) => i.category)).toEqual(['News', 'News', 'Recap', 'Recap', 'Community', 'Recap', 'News', 'Season Update']);
    expect(items.every((i, n) => n === 0 || (i.dateMs ?? 0) <= (items[n - 1]!.dateMs ?? 0))).toBe(true);
    // Text is kept as written, curly apostrophe and all.
    expect(items.map((i) => i.title)).toContain('Diablo’s Next Era Revealed at BlizzCon 2026: Opening Ceremonies Recap');
  });

  it('keeps only https links to English pages of news.blizzard.com, without query or fragment', () => {
    expect(cleanLink('https://news.blizzard.com/en-us/article/1/a?utm=x#top')).toBe('https://news.blizzard.com/en-us/article/1/a');
    for (const bad of [
      'http://news.blizzard.com/en-us/article/1', 'https://news.blizzard.com.evil.example/en-us/article/1',
      'https://evil.example/en-us/article/1', 'javascript:alert(1)', 'https://news.blizzard.com:8443/en-us/article/1',
      'https://user:pw@news.blizzard.com/en-us/article/1', 'https://news.blizzard.com/de-de/article/1', '/en-us/article/1', 42, null,
    ]) expect(cleanLink(bad), String(bad)).toBeNull();
  });

  it('turns titles into plain text: no markup, entities decoded, plain dashes, one line, capped', () => {
    expect(plainText('<b>Season</b> &amp; Patch\u2014Notes &#8211; <img src=x onerror=alert(1)>Now', 200)).toBe('Season & Patch-Notes - Now');
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;Hi', 200)).toBe('alert(1)Hi');
    expect(plainText('a\u0000b\n\n  c', 200)).toBe('a b c');
    expect(plainText('x'.repeat(300), 200)).toHaveLength(200);
    expect(plainText(7, 200)).toBe('');
  });

  it('drops posts without a title or an allowed link, keeps one without a date at the end, and lists a link once', () => {
    const items = parseNews({ contentItems: [
      post({ ...ok, title: '  ' }),
      post({ ...ok, newsUrl: 'https://evil.example/en-us/x' }),
      post({ ...ok, title: 'No date', newsUrl: 'https://news.blizzard.com/en-us/article/2/b', lastUpdated: 'soon' }),
      post(ok),
      post({ ...ok, title: 'Same link again' }),
      'nonsense', null, { properties: [] },
    ] });
    expect(items.map((i) => [i.title, i.dateMs])).toEqual([['A post', Date.parse(ok.lastUpdated)], ['No date', null]]);
  });

  it('gives nothing for anything that is not the list', () => {
    for (const raw of [null, 'text', [], {}, { contentItems: 'no' }]) expect(parseNews(raw)).toEqual([]);
  });

  it('uses a copy for 15 minutes', () => {
    const cache = { fetchedAt: 1_000_000, items: parseNews(saved) };
    expect(isFresh(cache, cache.fetchedAt)).toBe(true);
    expect(isFresh(cache, cache.fetchedAt + NEWS_REFRESH_MS - 1)).toBe(true);
    expect(isFresh(cache, cache.fetchedAt + NEWS_REFRESH_MS)).toBe(false);
    expect(isFresh(cache, cache.fetchedAt - 1)).toBe(false);
    expect(isFresh(null, 0)).toBe(false);
  });

  it('keeps a stored copy only while it looks like what the list gives', () => {
    const items = parseNews(saved);
    expect(sanitizeCache({ fetchedAt: 5, items })).toEqual({ fetchedAt: 5, items });
    const tampered: unknown[] = [{ ...items[0], link: 'https://evil.example/en-us/x' }, { ...items[1], title: '<b>Bold</b>' }, 'x'];
    expect(sanitizeCache({ fetchedAt: 5, items: tampered })?.items.map((i: NewsItem) => i.title)).toEqual(['Bold']);
    for (const raw of [null, { fetchedAt: 'now', items }, { fetchedAt: 5 }, { fetchedAt: 5, items: [] }]) expect(sanitizeCache(raw)).toBeNull();
  });

  it('stores the copy under the app prefix, and blocked or broken storage means no copy', () => {
    const store = memoryStorage();
    const cache = { fetchedAt: 9, items: parseNews(saved) };
    expect(saveNews(cache, store)).toBe(true);
    expect(store.getItem(`${PREFIX}news`)).not.toBeNull();
    expect(loadNews(store)).toEqual(cache);
    expect(loadNews(memoryStorage({ [`${PREFIX}news`]: '{nope' }))).toBeNull();
    expect(loadNews(throwingStorage())).toBeNull();
    expect(saveNews(cache, throwingStorage())).toBe(false);
    expect(loadNews(null)).toBeNull();
  });

  it('falls back to the Diablo IV page of Blizzard News', () => {
    expect(BLIZZARD_NEWS).toBe('https://news.blizzard.com/en-us/diablo4');
  });
});
