// The next-event strip: one line above the cards with every shown event, an event in progress
// first, then the next starts soonest first ("Legion in 8 min · World Boss in 13 min").

import { spanWords } from '../engine/format';
import type { EventKind, EventStatus } from '../engine/events';
import { h, setText } from './dom';

interface StripItem {
  kind: EventKind;
  text: string;
  /** Sort key: an event in progress before any start, then the soonest start. */
  order: number;
}

export function stripItems(statuses: EventStatus[]): StripItem[] {
  const out: StripItem[] = [];
  for (const s of statuses) {
    if (s.phase === 'active' && s.msLeft !== null) {
      out.push({ kind: s.kind, text: `${s.name} on now · ${spanWords(s.msLeft)} left`, order: -1 });
    } else if (s.phase === 'waiting' && s.msToNext !== null) {
      out.push({ kind: s.kind, text: `${s.name} in ${spanWords(s.msToNext)}`, order: s.msToNext });
    }
  }
  return out.sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind));
}

export class NextStrip {
  readonly el = h('ol', { class: 'next-strip', 'aria-label': 'Next events' });
  private key = '';

  /** `done`: events the player marked done, dimmed until their next start. */
  update(statuses: EventStatus[], done: ReadonlySet<EventKind>): void {
    const items = stripItems(statuses);
    const key = items.map((i) => `${i.kind}${done.has(i.kind) ? '-' : ''}`).join(',');
    if (key !== this.key) {
      this.key = key;
      // Each item jumps to its card.
      this.el.replaceChildren(...items.map((i) => h('li', { 'data-kind': i.kind, class: done.has(i.kind) ? 'done' : null },
        h('a', { href: `#card-${i.kind}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'text' })))));
    }
    items.forEach((i, n) => setText(this.el.children[n]!.querySelector('.text')!, i.text));
    this.el.hidden = !items.length;
  }
}
