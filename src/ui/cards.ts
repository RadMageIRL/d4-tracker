// The three event cards. Built once; update() rewrites only text, classes and widths.

import type { Claim, Confidence } from '../data/schema';
import { agoWords, clockTime, countdown, dayLabel, spanWords, type ClockStyle } from '../engine/format';
import type { EventDetails, EventKind, EventStatus, TimedSegment } from '../engine/events';
import type { Fact } from '../engine/facts';
import { h, nodes, s, setText } from './dom';

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
  /** The player marked the last start done (until the next one starts). */
  done: boolean;
  /** The player starred this event, for Coming up's Starred list. */
  starred: boolean;
}

export interface OrderNote {
  label: string;
  confidence: Confidence;
  text: string;
  /** Shown instead of the confidence's name, e.g. "Predicted". */
  status?: string;
  /** Explained under About this card only, with no badge in the card's trust row. */
  aboutOnly?: boolean;
}

/**
 * How long before a spawn the in-game map marks where it will be, so the card can point there.
 * Approximate, from in-game checks on 2026-10-24: a World Boss marked with 56 minutes to go, Legions
 * with 9 to 10 minutes to go.
 */
const MAP_SHOWN_AHEAD_MS: Partial<Record<EventKind, number>> = { worldBoss: 60 * 60000, legion: 10 * 60000 };
/** What the game shows then: a World Boss's boss as well as its arena. */
const MAP_HINT_TEXT: Partial<Record<EventKind, string>> = {
  worldBoss: 'Check in-game map for boss and location',
  legion: 'Check in-game map for exact location',
};

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

/** Show or hide a whole row, its label included. */
function showRow(row: FactRow, on: boolean): void {
  row.dd.hidden = !on;
  (row.dd.previousElementSibling as HTMLElement).hidden = !on;
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
  private star: HTMLButtonElement;
  private isStarred = false;
  private big = h('div', { class: 'big' });
  private bigLabel = h('div', { class: 'big-label' });
  /** Once the in-game map marks where the coming spawn will be. */
  private mapHint = h('p', { class: 'map-hint', hidden: true },
    s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      s('path', { d: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z' })),
    h('span', {}, ''));
  private bar = h('span', {});
  private lastProgress = 0;
  private dl = h('dl', { class: 'facts' });
  private nextRow: FactRow;
  private lastRow: FactRow | null;
  private identityRow: FactRow | null;
  private locationRow: FactRow;
  /** Legion: the possible sites, folded away, when only their group is predicted. */
  private candidatesLabel = h('span', {});
  private candidatesAlso = h('span', { class: 'hint' });
  private candidatesList = h('ul', {});
  /** The expansion-region Legion's two candidates, the predicted one first, apart from the base-game ones. */
  private candidatesExpansion = h('div', { class: 'candidates-expansion', hidden: true });
  private candidates = h('details', { class: 'candidates' },
    h('summary', {}, this.candidatesLabel, h('span', { class: 'hint' }, ' · predicted'), this.candidatesAlso), this.candidatesList,
    this.candidatesExpansion);
  private extraRow: FactRow | null;
  /** Spawns: the player's own "done" mark on the last start; the tracker cannot see the game. */
  private doneNote = h('span', { class: 'hint done-note' });
  private doneBtn: HTMLButtonElement | null = null;
  private isDone = false;
  private list = h('ul', { class: 'next-list', 'aria-label': 'Later' });
  private predictions = h('ul', {});
  private predictionsBox = h('details', { class: 'later-predictions', hidden: true }, h('summary', {}, 'Later predictions'), this.predictions);
  private notice = h('p', { class: 'notice' });
  private trust = h('div', { class: 'trust' });
  private logLink: HTMLButtonElement;
  private about = h('div', {});
  private aboutKey = '';

  constructor(private kind: EventKind, title: string,
    opts: { identity: boolean; instant: boolean; extra: boolean; onLog: () => void; onDone?: (done: boolean) => void; onStar: (starred: boolean) => void }) {
    const headId = `card-${kind}`;
    this.star = h('button', { class: 'star-btn', type: 'button', 'aria-pressed': 'false', 'aria-label': `Star ${title}`,
      title: 'Star: list it under Starred in Coming up' }, '☆');
    this.star.addEventListener('click', () => opts.onStar(!this.isStarred));
    this.nextRow = factRow(this.dl, 'Next');
    this.lastRow = opts.instant ? factRow(this.dl, 'Last') : null;
    if (this.lastRow && opts.onDone) {
      const onDone = opts.onDone;
      this.doneBtn = h('button', { class: 'link done-toggle', type: 'button' }, 'Mark done');
      this.doneBtn.addEventListener('click', () => onDone(!this.isDone));
      this.lastRow.dd.append(this.doneNote, this.doneBtn);
    }
    this.identityRow = opts.identity ? factRow(this.dl, 'Boss') : null;
    this.locationRow = factRow(this.dl, WORDS[kind].locationLabel);
    this.extraRow = opts.extra ? factRow(this.dl, 'Also') : null;
    this.logLink = h('button', { class: 'link log-link', type: 'button' }, 'Log a sighting');
    this.logLink.addEventListener('click', opts.onLog);
    this.el = h('article', { class: 'panel event', 'data-kind': kind, 'aria-labelledby': headId },
      h('div', { class: 'event-head' }, h('h2', { id: headId }, title), this.star, this.pill),
      h('div', {}, this.big, this.bigLabel, this.mapHint),
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
    this.isStarred = extras.starred;
    setText(this.star, extras.starred ? '★' : '☆');
    this.star.classList.toggle('on', extras.starred);
    this.star.setAttribute('aria-pressed', String(extras.starred));
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
    const shownAhead = MAP_SHOWN_AHEAD_MS[this.kind];
    setText(this.mapHint.lastChild as HTMLElement, MAP_HINT_TEXT[this.kind] ?? '');
    this.mapHint.hidden = !(st.phase === 'waiting' && shownAhead !== undefined && st.msToNext !== null && st.msToNext > 0 && st.msToNext <= shownAhead);

    // Instant events (a spawn with no known window) show how long ago the last one started.
    if (this.lastRow && st.previous) {
      const ago = ctx.nowMs - st.previous.startMs;
      const seen = extras.lastNote ? ` · ${extras.lastNote}` : '';
      showFact(this.lastRow, { known: true, value: `${when(st.previous.startMs, ctx)} (${agoWords(ago)})${seen}`, source: '' });
    }
    if (this.doneBtn) {
      this.isDone = extras.done;
      setText(this.doneNote, extras.done ? ' · done, marked by you' : '');
      setText(this.doneBtn, extras.done ? 'Undo' : 'Mark done');
      this.doneBtn.setAttribute('aria-pressed', String(extras.done));
      this.doneBtn.title = extras.done
        ? 'Clear your mark. It also clears by itself when the next one starts.'
        : 'Mark the last one done, for your own tracking: the tracker cannot see the game. It clears when the next one starts.';
      this.doneBtn.hidden = !st.previous;
    }

    if (this.identityRow) showFact(this.identityRow, st.details.identity);
    showFact(this.locationRow, st.details.location);
    this.showCandidates(st.details.candidates, st.details.also, st.details.alsoPredicted, st.details.alsoOther);
    // Nothing known yet: the row waits until there is (the reason is under About this card).
    if (this.identityRow) showRow(this.identityRow, !!st.details.identity?.known);
    showRow(this.locationRow, st.details.location.known || !!st.details.candidates?.length);
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

  /** The candidate sites in place of a one-line location: "6 candidates · predicted" (four base-game,
   *  two expansion), opened for the list. */
  private showCandidates(list: { place: string; region: string }[] | undefined, also: string | undefined,
    alsoPredicted: EventDetails['alsoPredicted'], alsoOther: EventDetails['alsoOther']): void {
    const on = !!list?.length;
    // In the row only while it has something to show, so the row's text is just what is shown.
    if (on && !this.candidates.isConnected) this.locationRow.dd.append(this.candidates);
    if (!on) this.candidates.remove();
    this.locationRow.value.hidden = on;
    this.locationRow.hint.hidden = on;
    if (!list?.length) return;
    setText(this.locationRow.value, '');
    setText(this.locationRow.hint, '');
    // The predicted expansion site first, then the other one of this group's turns.
    const xs = [alsoPredicted && { ...alsoPredicted, predicted: true }, alsoOther && { ...alsoOther, predicted: false }]
      .filter((x) => !!x);
    setText(this.candidatesLabel, `${list.length + xs.length} candidates`);
    setText(this.candidatesAlso, also ? ` · also ${also} (seen)` : '');
    const items = list.map((c) => `${c.place}, ${c.region}`);
    if ([...this.candidatesList.children].map((li) => li.textContent).join('|') !== items.join('|')) {
      this.candidatesList.replaceChildren(...items.map((t) => h('li', {}, t)));
    }
    const hint = (x: (typeof xs)[number]) => [x.predicted ? ' · Predicted' : '', x.caveat ? ` · ${x.caveat}` : ''].join('');
    const xText = xs.map((x) => `Expansion: ${x.place}, ${x.region}${hint(x)}`).join('');
    if (this.candidatesExpansion.textContent !== xText) {
      this.candidatesExpansion.replaceChildren(...xs.map((x) => h('p', {}, `Expansion: ${x.place}, ${x.region}`, h('span', { class: 'hint' }, hint(x)))));
    }
    this.candidatesExpansion.hidden = !xs.length;
  }

  private renderTrust(st: EventStatus, extras: CardExtras): void {
    const seg: TimedSegment | null = st.segment;
    const stale = extras.checkedDaysAgo > STALE_DAYS;
    const unknowns = [st.details.identity, st.details.location].filter((f): f is Fact<string> & { known: false } => !!f && !f.known);
    const key = [seg?.interval.confidence, seg?.phase.confidence, extras.checkedDaysAgo, extras.sightings, extras.anchorProgress,
      unknowns.map((u) => u.reason).join('|'), extras.orders.map((o) => `${o.confidence}${o.text}`).join('|')].join('#');
    const trusted = extras.orders.filter((o) => o.confidence !== 'unknown' && !o.aboutOnly);
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
