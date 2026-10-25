// "Coming up": the next starts of every shown event, merged and in order.

import { clockTime, dayLabel, spanWords } from '../engine/format';
import { hasExtraSpawn, type EventKind, type EventStatus } from '../engine/events';
import { startsInRange } from '../engine/segments';
import { h, setText } from './dom';
import type { ViewContext } from './cards';

const VERB: Record<EventKind, string> = { helltide: 'begins', worldBoss: 'spawns', legion: 'starts' };
/** How far ahead the list looks, and a cap on its rows (six hours hold about 24 starts). */
const SPAN_HOURS = 6;
const MAX_ROWS = 30;

export interface TimelineItem {
  kind: EventKind;
  name: string;
  startMs: number;
  /** This start brings a second one at the same time (every fourth World Boss). */
  extra: boolean;
  /** A short predicted addition for this start, e.g. "also Skovos" (the expansion Legion). */
  note?: string;
}

/** A start's short note, or null for none. */
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
  private list = h('ol', { class: 'timeline' });
  private empty = h('p', { class: 'help' }, 'Nothing shown is scheduled in the next few hours.');
  private key = '';

  constructor() {
    this.el = h('div', {}, h('h2', { id: 'timeline-title' }, 'Coming up', h('span', { class: 'note' }, `next ${SPAN_HOURS} hours`)), this.list, this.empty);
  }

  update(statuses: EventStatus[], ctx: ViewContext, noteOf?: TimelineNote): void {
    const items = timelineItems(statuses, ctx.nowMs, SPAN_HOURS * 3600000, MAX_ROWS, noteOf);
    const key = items.map((i) => `${i.kind}${i.startMs}${i.note ?? ''}`).join(',') + ctx.timeZone + ctx.clock;
    if (key !== this.key) {
      this.key = key;
      this.list.replaceChildren(...items.map((i) => {
        const day = dayLabel(i.startMs, ctx.nowMs, ctx.timeZone);
        const t = clockTime(i.startMs, ctx.timeZone, ctx.clock);
        return h('li', { 'data-kind': i.kind, 'data-start': i.startMs },
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          // The note is kept whole: on a narrow screen it moves to the next line, never splits.
          i.note
            ? h('span', {}, `${i.name} ${VERB[i.kind]}${i.extra ? ' (two)' : ''} `, h('span', { class: 'tl-note' }, `(${i.note})`))
            : h('span', {}, `${i.name} ${VERB[i.kind]}${i.extra ? ' (two)' : ''}`),
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
