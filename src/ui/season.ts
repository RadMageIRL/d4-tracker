// The season panel: the live season with its start and announced end, the next season, announced
// windows such as a PTR with countdowns while they are upcoming or running, and, folded away, every
// past season with its dates and length and every window that has ended.

import type { SeasonsFile as SeasonFeed } from '../data/schema';
import { badge } from './cards';
import { calendarDate, clockTime, plainDate, spanWords } from '../engine/format';
import { seasonView, type HistoryRow, type WindowView } from '../engine/seasons';
import type { ViewContext } from './cards';
import { h, setText } from './dom';

function dateOf(ms: number | null, date: string | null, ctx: ViewContext): string {
  if (ms !== null) return calendarDate(ms, ctx.timeZone);
  return date ? plainDate(date) : '';
}

function stamp(ms: number, ctx: ViewContext): string {
  return `${calendarDate(ms, ctx.timeZone)}, ${clockTime(ms, ctx.timeZone, ctx.clock)}`;
}

function windowLine(w: WindowView, ctx: ViewContext): string {
  if (w.state === 'upcoming') return `Starts in ${spanWords(w.startMs - ctx.nowMs)}`;
  if (w.state === 'running') return `Running now, ends in ${spanWords(w.endMs - ctx.nowMs)}`;
  return 'Ended';
}

export class SeasonPanel {
  readonly el: HTMLElement;
  private title = h('p', {}, h('strong', {}));
  private titleBadge = h('span', {});
  private started = h('p', { class: 'muted' });
  private ends = h('p', {});
  private next = h('p', {});
  private windows = h('div', {});
  private pastWindows = h('div', { class: 'past-windows' });
  private history = h('tbody', {});
  private historyCount = h('span', {});
  private key = '';

  constructor(private feed: SeasonFeed) {
    // Only Blizzard's own pages are linked from the page; community lists used for research are
    // named in the repository's data file instead.
    const official = new Map<string, string>();
    for (const s of [...feed.seasons.flatMap((x) => x.sources), ...feed.windows.flatMap((w) => w.sources)]) {
      if (s.kind === 'blizzard' && s.url) official.set(s.url, s.title);
    }
    const sources = h('p', { class: 'muted' },
      `Dates checked ${feed.checkedOn}. Season ${feed.seasons.at(-1)?.number} and the PTR are confirmed by Blizzard; ` +
      'earlier seasons are inferred from community season lists that agree with each other. Blizzard: ',
      ...[...official].flatMap(([url, title], i) => [i ? ', ' : '', h('a', { href: url, rel: 'noopener', target: '_blank' }, title)]));
    this.el = h('div', {},
      h('h2', { id: 'season-title' }, 'Season'),
      this.title, this.titleBadge, this.started, this.ends, this.next, this.windows,
      h('details', {},
        h('summary', {}, 'Past seasons ', this.historyCount),
        h('table', { class: 'history' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Season and dates'),
              h('th', { scope: 'col', class: 'num' }, 'Days'))),
            this.history),
        h('p', { class: 'muted' }, 'A season ends when the next one begins. Dates with a known launch hour show in your chosen time zone; the rest are the dates Blizzard announced (Pacific time).'),
        this.pastWindows,
      ),
      sources,
    );
  }

  update(ctx: ViewContext): void {
    const v = seasonView(this.feed, ctx.nowMs);
    const strong = this.title.firstChild as HTMLElement;
    if (v.current) {
      setText(strong, `Season ${v.current.number}: ${v.current.name}`);
      if (this.titleBadge.dataset.c !== v.current.confidence) {
        this.titleBadge.dataset.c = v.current.confidence;
        this.titleBadge.replaceChildren(badge('Start date', v.current.confidence));
      }
      const start = v.currentStartMs !== null && v.current.startUtc ? stamp(v.currentStartMs, ctx) : plainDate(v.current.startDate);
      setText(this.started, `Started ${start} · ${v.daysIn} ${v.daysIn === 1 ? 'day' : 'days'} in`);
    } else {
      setText(strong, 'No season is live');
      setText(this.started, '');
    }
    setText(this.ends, v.currentEndMs !== null
      ? `Ends ${stamp(v.currentEndMs, ctx)} (in ${spanWords(v.currentEndMs - ctx.nowMs)})`
      : 'Ends: not announced by Blizzard yet');
    setText(this.next, v.nextStartMs !== null
      ? `${this.feed.nextName} starts ${stamp(v.nextStartMs, ctx)} (in ${spanWords(v.nextStartMs - ctx.nowMs)})`
      : `${this.feed.nextName}: start date not announced yet`);

    // Windows change text every minute; rebuild only when something visible changed.
    const lines = v.windows.map((w) => `${w.window.label}|${stamp(w.startMs, ctx)}|${stamp(w.endMs, ctx)}|${windowLine(w, ctx)}`);
    const key = lines.join('\n') + `|past ${v.pastWindows.map((w) => w.window.label).join(',')}|` + v.history.length + ctx.timeZone;
    if (key === this.key) return;
    this.key = key;
    const announcement = (w: WindowView) => w.window.sources.filter((s) => s.url).slice(0, 1)
      .map((s) => h('a', { href: s.url!, rel: 'noopener', target: '_blank' }, 'announcement'));
    this.windows.replaceChildren(...v.windows.map((w) => h('div', { class: `window ${w.state}` },
      h('p', {}, h('strong', {}, w.window.label), ' ',
        h('span', { class: 'muted' }, `${stamp(w.startMs, ctx)} to ${stamp(w.endMs, ctx)}`)),
      h('p', {}, windowLine(w, ctx), ' · ', ...announcement(w)),
      h('p', { class: 'muted' }, w.window.detail),
    )));
    // An ended window keeps its dates and link here, under Past seasons, with no countdown.
    this.pastWindows.replaceChildren(...v.pastWindows.map((w) => h('p', { class: 'window ended' },
      h('strong', {}, w.window.label), ' ',
      h('span', { class: 'muted' }, `${calendarDate(w.startMs, ctx.timeZone)} to ${calendarDate(w.endMs, ctx.timeZone)} · ended · `),
      ...announcement(w))));
    const past = v.history.filter((r) => r.days !== null);
    setText(this.historyCount, `(${past.length})`);
    this.history.replaceChildren(...past.map((r: HistoryRow) => h('tr', {},
      h('td', {}, String(r.season.number)),
      h('td', {}, r.season.name, r.season.note ? h('span', { class: 'muted' }, ` · ${r.season.note}`) : '',
        h('div', { class: 'muted' }, `${dateOf(r.startMs, r.startDate, ctx)} to ${dateOf(r.endMs, r.endDate, ctx)}`)),
      h('td', { class: 'num' }, String(r.days)),
    )));
  }
}
