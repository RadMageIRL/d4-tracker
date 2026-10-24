// The three event cards. Built once; update() rewrites only text, classes and widths.

import type { Claim, Confidence } from '../data/schema';
import { agoWords, clockTime, countdown, dayLabel, spanWords, type ClockStyle } from '../engine/format';
import type { EventKind, EventStatus, TimedSegment } from '../engine/events';
import type { Fact } from '../engine/facts';
import { h, nodes, setText } from './dom';

export interface ViewContext {
  nowMs: number;
  timeZone: string;
  clock: ClockStyle;
}

export interface CardExtras {
  /** This card's event starts soonest of those shown. */
  isNext: boolean;
  /** Days since the data was checked. */
  checkedDaysAgo: number;
  /** What the player's own sightings say about the start times, if anything. */
  sightings: string | null;
  /** Progress toward confirming an inferred start time from in-game sightings. */
  anchorProgress: string | null;
  /** What the sightings say about each order (boss, arena, region, site). */
  orders: OrderNote[];
  /** For each later start on the card: a short note ("two bosses"), or null. */
  laterNotes: (string | null)[];
  /** For each later start: its predicted boss or place, or null. Listed under a disclosure. */
  laterPredictions: (string | null)[];
  /** What was seen at the previous start, for spawns (e.g. "Ashava, seen in game"). */
  lastNote: string | null;
  /** The next start brings a second one at the same time (every fourth World Boss). */
  extra: { text: string; confidence: Confidence } | null;
}

export interface OrderNote {
  label: string;
  confidence: Confidence;
  text: string;
  /** Shown instead of the confidence's name, e.g. "Predicted". */
  status?: string;
}

// soonMs: how close the next start must be for the card to say Soon instead of Next.
const WORDS: Record<EventKind, { starts: string; locationLabel: string; soonMs: number }> = {
  helltide: { starts: 'begins', locationLabel: 'Region', soonMs: 5 * 60000 },
  worldBoss: { starts: 'spawns', locationLabel: 'Location', soonMs: 15 * 60000 },
  legion: { starts: 'starts', locationLabel: 'Location', soonMs: 5 * 60000 },
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { confirmed: 'Confirmed', inferred: 'Inferred', unknown: 'Unknown' };

/** Data older than this is flagged, since a patch or a new season may have changed it. */
export const STALE_DAYS = 60;

function when(ms: number, ctx: ViewContext): string {
  const day = dayLabel(ms, ctx.nowMs, ctx.timeZone);
  const t = clockTime(ms, ctx.timeZone, ctx.clock);
  return day === 'Today' ? t : `${t} ${day}`;
}

export function badge(label: string, confidence: Confidence, status = CONFIDENCE_LABEL[confidence]): HTMLElement {
  return h('span', { class: `badge conf-${confidence}` }, `${label}: ${status}`);
}

/** Just the confidence, for a list where the label would only repeat it. */
export function confidenceBadge(confidence: Confidence): HTMLElement {
  return h('span', { class: `badge conf-${confidence}` }, CONFIDENCE_LABEL[confidence]);
}

interface FactRow {
  dd: HTMLElement;
  value: HTMLElement;
  hint: HTMLElement;
}

function factRow(dl: HTMLElement, label: string): FactRow {
  const value = h('span', {});
  const hint = h('span', { class: 'hint' });
  const dd = h('dd', {}, value, hint);
  dl.append(h('dt', {}, label), dd);
  return { dd, value, hint };
}

const BASIS_HINT = {
  seen: 'seen in game',
  reported: 'reported to you, not checked',
  predicted: 'predicted',
} as const;

/**
 * Show a fact on one line: its value, or "Unknown" with a short hint (the full reason is under
 * About). A known value says whether it was seen, reported or predicted, so a prediction never
 * reads as a sighting.
 */
function showFact(row: FactRow, fact: Fact<string> | undefined): void {
  setText(row.value, fact?.known ? fact.value : 'Unknown');
  row.dd.classList.toggle('unknown', !fact?.known);
  for (const b of Object.keys(BASIS_HINT)) row.dd.classList.toggle(`basis-${b}`, !!fact?.known && fact.basis === b);
  let hint = '';
  if (fact && !fact.known && fact.hint) hint = ` · ${fact.hint}`;
  else if (fact?.known && fact.basis) {
    hint = ` · ${BASIS_HINT[fact.basis]}`;
  }
  setText(row.hint, hint);
  row.dd.title = !fact ? '' : fact.known ? (fact.basis ? fact.source : '') : fact.reason;
}

function claimBlock(title: string, c: Claim, extra: string | null): HTMLElement {
  return h('div', { class: 'claim' },
    h('p', {}, badge(title, c.confidence), c.note ? ` ${c.note}` : ''),
    extra ? h('p', { class: 'progress-note' }, extra) : null,
    ...c.sources.map((s) => h('p', { class: 'source' },
      s.url ? h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.title) : s.title,
      s.quote ? h('q', {}, s.quote) : null)),
  );
}

export class EventCard {
  readonly el: HTMLElement;
  private pill = h('span', { class: 'pill' });
  private big = h('div', { class: 'big' });
  private bigLabel = h('div', { class: 'big-label' });
  private bar = h('span', {});
  private lastProgress = 0;
  private dl = h('dl', { class: 'facts' });
  private nextRow: FactRow;
  private lastRow: FactRow | null;
  private identityRow: FactRow | null;
  private locationRow: FactRow;
  private extraRow: FactRow | null;
  private list = h('ul', { class: 'next-list', 'aria-label': 'Later' });
  private predictions = h('ul', {});
  private predictionsBox = h('details', { class: 'later-predictions', hidden: true }, h('summary', {}, 'Later predictions'), this.predictions);
  private notice = h('p', { class: 'notice' });
  private trust = h('div', { class: 'trust' });
  private logLink: HTMLButtonElement;
  private about = h('div', {});
  private aboutKey = '';

  constructor(private kind: EventKind, title: string, opts: { identity: boolean; instant: boolean; extra: boolean; onLog: () => void }) {
    const headId = `card-${kind}`;
    this.nextRow = factRow(this.dl, 'Next');
    this.lastRow = opts.instant ? factRow(this.dl, 'Last') : null;
    this.identityRow = opts.identity ? factRow(this.dl, 'Boss') : null;
    this.locationRow = factRow(this.dl, WORDS[kind].locationLabel);
    this.extraRow = opts.extra ? factRow(this.dl, 'Also') : null;
    this.logLink = h('button', { class: 'link log-link', type: 'button' }, 'Log a sighting');
    this.logLink.addEventListener('click', opts.onLog);
    this.el = h('article', { class: 'panel event', 'data-kind': kind, 'aria-labelledby': headId },
      h('div', { class: 'event-head' }, h('h2', { id: headId }, title), this.pill),
      h('div', {}, this.big, this.bigLabel),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, this.bar),
      this.dl,
      this.list,
      this.predictionsBox,
      this.notice,
      this.trust,
      h('details', { class: 'about' }, h('summary', {}, 'About this card'), this.about),
    );
  }

  /** Grow smoothly, but jump straight back when a new wait or window begins. */
  private setProgress(p: number): void {
    this.bar.style.transition = p < this.lastProgress ? 'none' : '';
    this.bar.style.width = `${(p * 100).toFixed(2)}%`;
    this.lastProgress = p;
  }

  update(st: EventStatus, ctx: ViewContext, extras: CardExtras): void {
    const words = WORDS[this.kind];
    const def = st.definition;
    this.el.classList.toggle('is-active', st.phase === 'active');
    this.el.classList.toggle('is-next', extras.isNext && st.phase !== 'active');
    if (st.phase === 'unknown' || !st.next) {
      setText(this.pill, 'Unavailable');
      this.pill.className = 'pill';
      setText(this.big, '--:--');
      setText(this.bigLabel, 'No trustworthy schedule covers this time.');
      this.setProgress(0);
      showFact(this.nextRow, { known: false, reason: 'The schedule data has no rule for now; it needs updating.', hint: 'schedule needs updating' });
    } else if (st.phase === 'active' && st.active && st.msLeft !== null) {
      setText(this.pill, 'Active');
      this.pill.className = 'pill live';
      setText(this.big, countdown(st.msLeft));
      setText(this.bigLabel, `left · ends ${when(st.active.endMs, ctx)}`);
      this.setProgress(st.progress ?? 0);
      showFact(this.nextRow, { known: true, value: `${when(st.next.startMs, ctx)} (in ${spanWords(st.next.startMs - ctx.nowMs)})`, source: '' });
    } else {
      const soon = (st.msToNext ?? Infinity) <= words.soonMs;
      setText(this.pill, soon ? 'Soon' : 'Next');
      this.pill.className = soon ? 'pill soon' : 'pill';
      setText(this.big, countdown(st.msToNext ?? 0));
      setText(this.bigLabel, `until it ${words.starts} · ${when(st.next.startMs, ctx)}`);
      this.setProgress(st.progress ?? 0);
      showFact(this.nextRow, { known: true, value: when(st.next.startMs, ctx), source: '' });
    }

    // Instant events (a spawn with no known window) show how long ago the last one started.
    if (this.lastRow && st.previous) {
      const ago = ctx.nowMs - st.previous.startMs;
      const seen = extras.lastNote ? ` · ${extras.lastNote}` : '';
      showFact(this.lastRow, { known: true, value: `${when(st.previous.startMs, ctx)} (${agoWords(ago)})${seen}`, source: '' });
    }

    if (this.identityRow) showFact(this.identityRow, st.details.identity);
    showFact(this.locationRow, st.details.location);
    if (this.extraRow) {
      const x = extras.extra;
      for (const el of [this.extraRow.dd, this.extraRow.dd.previousElementSibling as HTMLElement]) el.hidden = !x;
      if (x) {
        setText(this.extraRow.value, x.text);
        setText(this.extraRow.hint, ` · ${CONFIDENCE_LABEL[x.confidence]}`);
        this.extraRow.dd.title = 'Every fourth spawn, by every dated first-hand report since October 2024. Not documented by Blizzard.';
      }
    }

    const items = st.later.map((o, i) => (extras.laterNotes[i] ? `${when(o.startMs, ctx)} · ${extras.laterNotes[i]}` : when(o.startMs, ctx)));
    const current = [...this.list.children].map((li) => li.textContent);
    if (current.join('|') !== items.join('|')) this.list.replaceChildren(...items.map((t) => h('li', {}, t)));
    // Predictions for the later starts stay folded away; the next one is in the rows above.
    const predicted = st.later.flatMap((o, i) => (extras.laterPredictions[i] ? [`${when(o.startMs, ctx)} · ${extras.laterPredictions[i]}`] : []));
    const shown = [...this.predictions.children].map((li) => li.textContent);
    if (shown.join('|') !== predicted.join('|')) this.predictions.replaceChildren(...predicted.map((t) => h('li', {}, t)));
    this.predictionsBox.hidden = !predicted.length;

    setText(this.notice, def.notice ?? '');
    this.notice.hidden = !def.notice;
    this.renderTrust(st, extras);
  }

  private renderTrust(st: EventStatus, extras: CardExtras): void {
    const seg: TimedSegment | null = st.segment;
    const stale = extras.checkedDaysAgo > STALE_DAYS;
    const unknowns = [st.details.identity, st.details.location].filter((f): f is Fact<string> & { known: false } => !!f && !f.known);
    const key = [seg?.interval.confidence, seg?.phase.confidence, extras.checkedDaysAgo, extras.sightings, extras.anchorProgress,
      unknowns.map((u) => u.reason).join('|'), extras.orders.map((o) => `${o.confidence}${o.text}`).join('|')].join('#');
    const trusted = extras.orders.filter((o) => o.confidence !== 'unknown');
    if (key === this.aboutKey) return;
    this.aboutKey = key;
    const ago = extras.checkedDaysAgo <= 0 ? 'today' : `${extras.checkedDaysAgo} ${extras.checkedDaysAgo === 1 ? 'day' : 'days'} ago`;
    this.trust.replaceChildren(...nodes(
      seg ? badge('Interval', seg.interval.confidence) : null,
      seg ? badge('Start time', seg.phase.confidence) : null,
      ...trusted.map((o) => badge(o.label, o.confidence, o.status)),
      h('span', { class: stale ? 'checked stale' : 'checked' }, `Checked ${ago}`),
      this.logLink,
    ));
    const phaseExtra = seg && seg.phase.confidence !== 'confirmed' ? extras.anchorProgress : null;
    this.about.replaceChildren(...nodes(
      seg ? claimBlock('Interval', seg.interval, null) : null,
      seg ? claimBlock('Start time', seg.phase, phaseExtra) : null,
      extras.sightings ? h('p', { class: 'claim' }, `Your sightings: ${extras.sightings}`) : null,
      unknowns.length ? h('div', { class: 'claim' }, h('p', {}, badge('Location', 'unknown')),
        ...unknowns.map((u) => h('p', { class: 'source' }, u.reason))) : null,
      ...extras.orders.map((o) => h('div', { class: 'claim order-note' }, h('p', {}, badge(o.label, o.confidence, o.status), ` ${o.text}`))),
      h('p', { class: 'muted' }, `Data checked ${st.definition.checkedOn}.${stale ? ' That is a while ago: a patch or a new season may have changed it.' : ''}`),
    ));
  }
}
