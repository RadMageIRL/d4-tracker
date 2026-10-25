// Latest news: a bar above the cards, closed until it is opened, with the newest Diablo IV headlines
// from Blizzard News. It only shows what main.ts hands it; nothing here fetches, and nothing here
// can stop the timers.

import { BLIZZARD_NEWS, NEWS_HOME, type NewsItem } from '../engine/news';
import { clockTime, dayKey } from '../engine/format';
import { h } from './dom';
import type { ViewContext } from './cards';

/** idle: never opened here; unavailable: this address does not pass the news through. */
export type NewsStatus = 'idle' | 'loading' | 'ok' | 'stale' | 'failed' | 'unavailable';

export interface NewsView {
  status: NewsStatus;
  items: NewsItem[] | null;
  fetchedAt: number | null;
}

const blizzardLink = (label: string) => h('a', { href: BLIZZARD_NEWS, target: '_blank', rel: 'noopener noreferrer' }, label);

export class NewsBar {
  readonly el: HTMLDetailsElement;
  private readonly note: HTMLElement;
  private readonly cols: HTMLElement;
  private shown = '';

  constructor(onToggle: (open: boolean) => void) {
    this.note = h('p', { class: 'news-note', 'aria-live': 'polite' });
    this.cols = h('div', { class: 'news-cols' });
    this.el = h('details', { class: 'panel news', id: 'news' },
      h('summary', {},
        h('span', { class: 'news-title' }, 'Latest news'),
        h('span', { class: 'news-from' }, 'from Blizzard News'),
        h('span', { class: 'news-action', 'aria-hidden': 'true' })),
      h('div', { class: 'news-body' }, this.note, this.cols));
    this.el.addEventListener('toggle', () => onToggle(this.el.open));
  }

  setOpen(open: boolean): void {
    if (this.el.open !== open) this.el.open = open;
  }

  update(view: NewsView, c: ViewContext): void {
    // Called every second: rebuilt only when something it shows changed.
    const key = JSON.stringify([view.status, view.fetchedAt, view.items?.length ?? -1, c.timeZone, c.clock, dayKey(c.nowMs, c.timeZone)]);
    if (key === this.shown) return;
    this.shown = key;
    const when = view.fetchedAt === null ? '' : checkedWhen(view.fetchedAt, c);
    const note: (Node | string)[] = {
      idle: ['Opening this loads the newest Diablo IV headlines from Blizzard News.'],
      loading: ['Loading the newest headlines from Blizzard News.'],
      ok: [`Headlines from Blizzard News, checked ${when}. `, blizzardLink('Open Blizzard News'), '.'],
      stale: [`Blizzard News could not be reached just now; these headlines were checked ${when}. `, blizzardLink('Open Blizzard News'), '.'],
      failed: ['News could not load right now. The timers are not affected. ', blizzardLink('Read the news on Blizzard News'), '.'],
      unavailable: ['Headlines load at ', h('a', { href: NEWS_HOME }, 'radmagelabs.com/d4/'), '. Here, ', blizzardLink('read the news on Blizzard News'), '.'],
    }[view.status];
    this.note.replaceChildren(...note);
    const items = view.status === 'unavailable' ? [] : view.items ?? [];
    // Two columns, read down: the newest four, then the four before them.
    const half = Math.ceil(items.length / 2);
    const lists = [items.slice(0, half), items.slice(half)].filter((l) => l.length)
      .map((l) => h('ul', { class: 'news-list' }, ...l.map((i) => row(i, c))));
    this.cols.replaceChildren(...lists);
  }
}

function row(i: NewsItem, c: ViewContext): HTMLElement {
  return h('li', {},
    h('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer' }, i.title),
    h('span', { class: 'news-meta' },
      i.category ? h('span', { class: 'badge' }, i.category) : null,
      i.dateMs === null ? null : h('time', { datetime: new Date(i.dateMs).toISOString() }, postDate(i.dateMs, c))));
}

/** "Oct 22", with the year when it is not this year's. */
function postDate(ms: number, c: ViewContext): string {
  const thisYear = dayKey(ms, c.timeZone).slice(0, 4) === dayKey(c.nowMs, c.timeZone).slice(0, 4);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: thisYear ? undefined : 'numeric', timeZone: c.timeZone }).format(ms);
}

/** "at 3:45 PM" today, otherwise "Oct 22 at 3:45 PM". */
function checkedWhen(ms: number, c: ViewContext): string {
  const at = `at ${clockTime(ms, c.timeZone, c.clock)}`;
  return dayKey(ms, c.timeZone) === dayKey(c.nowMs, c.timeZone) ? at : `${postDate(ms, c)} ${at}`;
}
