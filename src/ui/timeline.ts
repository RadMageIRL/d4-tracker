// "Coming up": the next starts of every shown event, merged and in order.

import { clockTime, dayLabel, spanWords } from '../engine/format';
import type { EventKind, EventStatus } from '../engine/events';
import { startsInRange } from '../engine/segments';
import { h, setText } from './dom';
import type { ViewContext } from './cards';

const VERB: Record<EventKind, string> = { helltide: 'begins', worldBoss: 'spawns', legion: 'starts' };

export interface TimelineItem {
  kind: EventKind;
  name: string;
  startMs: number;
}

/** Starts of every status in (nowMs, nowMs + spanMs], soonest first, at most `limit`. */
export function timelineItems(statuses: EventStatus[], nowMs: number, spanMs: number, limit: number): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const st of statuses) {
    for (const o of startsInRange(st.definition.segments, nowMs + 1, nowMs + spanMs + 1)) {
      out.push({ kind: st.kind, name: st.name, startMs: o.startMs });
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
    this.el = h('div', {}, h('h2', { id: 'timeline-title' }, 'Coming up', h('span', { class: 'note' }, 'next 4 hours')), this.list, this.empty);
  }

  update(statuses: EventStatus[], ctx: ViewContext): void {
    const items = timelineItems(statuses, ctx.nowMs, 4 * 3600000, 10);
    const key = items.map((i) => `${i.kind}${i.startMs}`).join(',') + ctx.timeZone + ctx.clock;
    if (key !== this.key) {
      this.key = key;
      this.list.replaceChildren(...items.map((i) => {
        const day = dayLabel(i.startMs, ctx.nowMs, ctx.timeZone);
        const t = clockTime(i.startMs, ctx.timeZone, ctx.clock);
        return h('li', { 'data-kind': i.kind, 'data-start': i.startMs },
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          h('span', {}, `${i.name} ${VERB[i.kind]}`),
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
