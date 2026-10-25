// Latest news from Blizzard News (news.blizzard.com), the game's official news site. Its Diablo IV
// list does not allow cross-origin reads, so the page asks its own site for it: radmagelabs.com
// passes /d4/news.json through to Blizzard's list. Where nothing answers there (GitHub Pages, a file
// opened from disk) the bar links to Blizzard News instead. Only titles, links, dates and
// categories are used, always as plain text, and only links back to news.blizzard.com are kept.

/** Next to the page, so it resolves to /d4/news.json at radmagelabs.com. */
export const NEWS_PATH = 'news.json';
export const NEWS_HOST = 'news.blizzard.com';
export const BLIZZARD_NEWS = 'https://news.blizzard.com/en-us/diablo4';
/** The address where the headlines load. */
export const NEWS_HOME = 'https://radmagelabs.com/d4/';
export const NEWS_COUNT = 8;
/** A copy younger than this is used as is, and an open bar asks again once it is older. */
export const NEWS_REFRESH_MS = 15 * 60000;
export const NEWS_TIMEOUT_MS = 8000;

export interface NewsItem {
  title: string;
  link: string;
  dateMs: number | null;
  /** Blizzard's label for the post: News, Patch Notes, PTR, Season Update... */
  category: string;
}

export interface NewsCache {
  fetchedAt: number;
  items: NewsItem[];
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '...', ndash: '-', mdash: '-',
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

// Dashes become plain hyphens; control characters are dropped.
function safeChar(code: number): string {
  if (code === 0x2013 || code === 0x2014 || code === 0x2015) return '-';
  if (code < 0x20 || (code >= 0x7f && code < 0xa0) || code > 0x10ffff) return '';
  return String.fromCodePoint(code);
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeChar(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

/** Text for the page: entities decoded, any markup removed, dashes plain, whitespace collapsed. */
export function plainText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return decode(decode(raw).replace(/<[^>]*>/g, ''))
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** An https link to an English page of news.blizzard.com, without query or fragment; null for anything else. */
export function cleanLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== NEWS_HOST || u.port || u.username || u.password || !u.pathname.startsWith('/en-us/')) return null;
  return `https://${NEWS_HOST}${u.pathname}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function item(title: unknown, link: unknown, dateMs: unknown, category: unknown): NewsItem | null {
  const t = plainText(title, 200);
  const l = cleanLink(link);
  if (!t || !l) return null;
  return { title: t, link: l, dateMs: typeof dateMs === 'number' && Number.isFinite(dateMs) ? dateMs : null, category: plainText(category, 40) };
}

function newestFirst(items: NewsItem[], max: number): NewsItem[] {
  const seen = new Set<string>();
  return items
    .filter((i) => !seen.has(i.link) && !!seen.add(i.link))
    .sort((a, b) => (b.dateMs ?? -Infinity) - (a.dateMs ?? -Infinity))
    .slice(0, max);
}

/** The newest posts in Blizzard's Diablo IV list (`contentItems[].properties`), newest first. */
export function parseNews(raw: unknown, max = NEWS_COUNT): NewsItem[] {
  const list = isRecord(raw) && Array.isArray(raw.contentItems) ? raw.contentItems : [];
  const items: NewsItem[] = [];
  for (const entry of list) {
    const p = isRecord(entry) && isRecord(entry.properties) ? entry.properties : null;
    if (!p) continue;
    const dateMs = typeof p.lastUpdated === 'string' ? Date.parse(p.lastUpdated) : NaN;
    const i = item(p.title, p.newsUrl, dateMs, p.category);
    if (i) items.push(i);
  }
  return newestFirst(items, max);
}

export function isFresh(cache: NewsCache | null, nowMs: number): boolean {
  return !!cache && nowMs >= cache.fetchedAt && nowMs - cache.fetchedAt < NEWS_REFRESH_MS;
}

/** A copy read back from storage, kept only if it still looks like what parseNews returns. */
export function sanitizeCache(raw: unknown): NewsCache | null {
  if (!isRecord(raw) || typeof raw.fetchedAt !== 'number' || !Number.isFinite(raw.fetchedAt) || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter(isRecord)
    .filter((i) => typeof i.link === 'string' && cleanLink(i.link) === i.link)
    .map((i) => item(i.title, i.link, i.dateMs, i.category))
    .filter((i): i is NewsItem => !!i);
  return items.length ? { fetchedAt: raw.fetchedAt, items: newestFirst(items, NEWS_COUNT) } : null;
}
