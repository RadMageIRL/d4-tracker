// "Coming up": the next starts of every shown event, merged and in order, or one event's starts
// with what is predicted for each.

import { clockTime, dayLabel, spanWords } from '../engine/format';
import { hasExtraSpawn, type EventKind, type EventStatus } from '../engine/events';
import { startsInRange } from '../engine/segments';
import { COMING_UP_CHOICES, type ComingUpChoice } from '../store/prefs';
import { h, setText } from './dom';
import type { ViewContext } from './cards';

const VERB: Record<EventKind, string> = { helltide: 'begins', worldBoss: 'spawns', legion: 'starts' };
/** How far ahead the list looks: six hours hold about 24 starts of every event; the World Boss
 *  alone gets a day (about 7). Rows are capped. */
const SPAN_HOURS: Record<ComingUpChoice, number> = { all: 6, helltide: 6, worldBoss: 24, legion: 6 };
const MAX_ROWS = 30;
const PICK_LABEL: Record<ComingUpChoice, string> = { all: 'All', helltide: 'Helltide', worldBoss: 'World Boss', legion: 'Legion' };

export interface TimelineItem {
  kind: EventKind;
  name: string;
  startMs: number;
  /** This start brings a second one at the same time (every fourth World Boss). */
  extra: boolean;
  /** What is predicted for this start: short with every event ("also Skovos", the expansion
   *  Legion), fuller with one picked (the Helltide's regions, the World Boss's boss). */
  note?: string;
}

/** A start's note, or null for none. */
export type TimelineNote = (kind: EventKind, startMs: number) => string | null;

/** Starts of every status in (nowMs, nowMs + spanMs], soonest first, at most `limit`. */
export function timelineItems(statuses: EventStatus[], nowMs: number, spanMs: number, limit: number, noteOf?: TimelineNote): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const st of statuses) {
    for (const o of startsInRange(st.definition.segments, nowMs + 1, nowMs + spanMs + 1)) {
      const note = noteOf?.(st.kind, o.startMs);
      out.push({ kind: st.kind, name: st.name, startMs: o.startMs, extra: hasExtraSpawn(st.definition, o.startMs), ...(note ? { note } : {}) });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs || a.kind.localeCompare(b.kind));
  return out.slice(0, limit);
}

export class Timeline {
  readonly el: HTMLElement;
  private span = h('span', { class: 'note' });
  private picks = new Map<ComingUpChoice, HTMLButtonElement>();
  private list = h('ol', { class: 'timeline' });
  private empty = h('p', { class: 'help' }, 'Nothing shown is scheduled in the next few hours.');
  private key = '';

  constructor(onPick: (choice: ComingUpChoice) => void) {
    for (const c of COMING_UP_CHOICES) {
      const b = h('button', { class: 'chip', type: 'button', 'data-pick': c, 'aria-pressed': 'false' },
        c === 'all' ? null : h('span', { class: 'swatch', 'aria-hidden': 'true' }), PICK_LABEL[c]);
      b.addEventListener('click', () => onPick(c));
      this.picks.set(c, b);
    }
    this.el = h('div', {}, h('h2', { id: 'timeline-title' }, 'Coming up', this.span),
      h('div', { class: 'tl-picks', role: 'group', 'aria-label': 'Show in Coming up' }, ...this.picks.values()),
      this.list, this.empty);
  }

  /** `notes.all` notes the starts of every event together; `notes.one` those of one picked event. */
  update(statuses: EventStatus[], ctx: ViewContext, choice: ComingUpChoice, notes: { all?: TimelineNote; one?: TimelineNote }): void {
    // An event hidden from the page is not offered; one picked before it was hidden shows all.
    const offered = new Set<ComingUpChoice>(statuses.map((s) => s.kind));
    const pick = offered.has(choice) ? choice : 'all';
    for (const [c, b] of this.picks) {
      b.hidden = c !== 'all' && !offered.has(c);
      b.setAttribute('aria-pressed', String(c === pick));
    }
    const hours = SPAN_HOURS[pick];
    setText(this.span, `next ${hours} hours`);
    const items = timelineItems(pick === 'all' ? statuses : statuses.filter((s) => s.kind === pick), ctx.nowMs, hours * 3600000,
      MAX_ROWS, pick === 'all' ? notes.all : notes.one);
    const key = pick + items.map((i) => `${i.kind}${i.startMs}${i.note ?? ''}`).join(',') + ctx.timeZone + ctx.clock;
    if (key !== this.key) {
      this.key = key;
      this.list.replaceChildren(...items.map((i) => {
        const day = dayLabel(i.startMs, ctx.nowMs, ctx.timeZone);
        const t = clockTime(i.startMs, ctx.timeZone, ctx.clock);
        const label = `${i.name} ${VERB[i.kind]}${i.extra ? ' (two)' : ''}`;
        return h('li', { 'data-kind': i.kind, 'data-start': i.startMs },
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          // One event picked: the prediction on its own line under the start. All events: a short
          // note, kept whole (on a narrow screen it moves to the next line, never splits).
          !i.note ? h('span', {}, label)
            : pick !== 'all' ? h('span', {}, label, h('span', { class: 'tl-detail' }, i.note))
            : h('span', {}, `${label} `, h('span', { class: 'tl-note' }, `(${i.note})`)),
          h('span', { class: 'when' }, h('span', { class: 'at' }, day === 'Today' ? t : `${t} ${day}`), ' · ', h('span', { class: 'in' })));
      }));
    }
    for (const li of this.list.children) {
      const start = Number((li as HTMLElement).dataset.start);
      const inEl = li.querySelector('.in');
      if (inEl) setText(inEl, `in ${spanWords(start - ctx.nowMs)}`);
    }
    this.empty.hidden = items.length > 0;
  }
}
