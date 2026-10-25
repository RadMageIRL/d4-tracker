// "Coming up": the next starts of every shown event, merged and in order, or one event's starts
// with what is predicted for each.

import { clockTime, dayLabel, spanWords } from '../engine/format';
import { hasExtraSpawn, type EventKind, type EventStatus } from '../engine/events';
import { startsInRange } from '../engine/segments';
import { COMING_UP_CHOICES, COMING_UP_HOURS, type ComingUpChoice } from '../store/prefs';
import { h, s, setText } from './dom';
import type { ViewContext } from './cards';

const VERB: Record<EventKind, string> = { helltide: 'begins', worldBoss: 'spawns', legion: 'starts' };
/** A cap on the rows: a day of every event is about 90 starts. */
const MAX_ROWS = 120;
const PICK_LABEL: Record<ComingUpChoice, string> = { all: 'All', starred: 'Starred', helltide: 'Helltide', worldBoss: 'World Boss', legion: 'Legion' };
const EMPTY = 'Nothing shown is scheduled in the next few hours.';
const NONE_STARRED = 'Nothing starred yet. Star an event with ☆ beside its name on its card to list it here.';

export interface TimelineItem {
  kind: EventKind;
  name: string;
  startMs: number;
  /** The end of its window (a Helltide's 55 minutes); the start itself for a spawn. */
  endMs: number;
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
      out.push({ kind: st.kind, name: st.name, startMs: o.startMs, endMs: o.endMs, extra: hasExtraSpawn(st.definition, o.startMs), ...(note ? { note } : {}) });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs || a.kind.localeCompare(b.kind));
  return out.slice(0, limit);
}

/** What Coming up shows: the pick, how far ahead each pick looks, notes, and the player's marks. */
export interface TimelineView {
  choice: ComingUpChoice;
  hours: Record<ComingUpChoice, number>;
  /** `all` notes the starts of every event together; `one` those of a picked event or the starred ones. */
  notes: { all?: TimelineNote; one?: TimelineNote };
  /** Events the player marked done, dimmed until their next start. */
  done?: ReadonlySet<EventKind>;
  /** Events starred on their cards. */
  starred?: ReadonlySet<EventKind>;
}

export class Timeline {
  readonly el: HTMLElement;
  /** How far ahead the list looks, kept for each pick. */
  private hours = h('select', { class: 'tl-hours', 'aria-label': 'How far ahead Coming up looks' });
  private hoursFor: ComingUpChoice | null = null;
  private picks = new Map<ComingUpChoice, HTMLButtonElement>();
  private list = h('ol', { class: 'timeline' });
  private empty = h('p', { class: 'help' }, EMPTY);
  /** Exports what the list shows, for the pick in force. */
  private calendar = h('button', { class: 'tl-calendar', type: 'button' },
    s('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      s('rect', { x: '2', y: '3', width: '12', height: '11', rx: '2' }), s('path', { d: 'M2 7h12M5 1.5v3M11 1.5v3M8 9v4M6 11h4' })),
    'Add to calendar');
  private shown: TimelineItem[] = [];
  private pick: ComingUpChoice = 'all';
  private key = '';

  constructor(onPick: (choice: ComingUpChoice) => void, onHours: (pick: ComingUpChoice, hours: number) => void,
    onCalendar: (items: TimelineItem[], pick: ComingUpChoice) => void) {
    this.hours.addEventListener('change', () => onHours(this.pick, Number(this.hours.value)));
    for (const c of COMING_UP_CHOICES) {
      // Starred is a star alone, so all five fit one row; its name is its label and tooltip.
      const b = c === 'starred'
        ? h('button', { class: 'chip', type: 'button', 'data-pick': c, 'aria-pressed': 'false', 'aria-label': PICK_LABEL[c],
          title: 'Starred: the events you starred on their cards' }, h('span', { class: 'star-mark', 'aria-hidden': 'true' }, '★'))
        : h('button', { class: 'chip', type: 'button', 'data-pick': c, 'aria-pressed': 'false' },
          c === 'all' ? null : h('span', { class: 'swatch', 'aria-hidden': 'true' }), PICK_LABEL[c]);
      b.addEventListener('click', () => onPick(c));
      this.picks.set(c, b);
    }
    this.calendar.addEventListener('click', () => onCalendar(this.shown, this.pick));
    this.el = h('div', {}, h('div', { class: 'tl-head' }, h('h2', { id: 'timeline-title' }, 'Coming up'), this.hours, this.calendar),
      h('div', { class: 'tl-picks', role: 'group', 'aria-label': 'Show in Coming up' }, ...this.picks.values()),
      this.list, this.empty);
  }

  update(statuses: EventStatus[], ctx: ViewContext, view: TimelineView): void {
    const { choice, notes, done = new Set<EventKind>(), starred = new Set<EventKind>() } = view;
    // An event hidden from the page is not offered; one picked before it was hidden shows all.
    const offered = new Set<ComingUpChoice>(['all', 'starred', ...statuses.map((s) => s.kind)]);
    const pick = offered.has(choice) ? choice : 'all';
    for (const [c, b] of this.picks) {
      b.hidden = !offered.has(c);
      b.setAttribute('aria-pressed', String(c === pick));
    }
    const listed = pick === 'all' ? statuses : statuses.filter((s) => (pick === 'starred' ? starred.has(s.kind) : s.kind === pick));
    const hours = view.hours[pick];
    // Each pick has its own choices (the World Boss goes further); rebuilt only when the pick changes.
    if (this.hoursFor !== pick) {
      this.hoursFor = pick;
      this.hours.replaceChildren(...COMING_UP_HOURS[pick].map((n) => h('option', { value: n }, `${n} hours`)));
    }
    if (this.hours.value !== String(hours)) this.hours.value = String(hours);
    setText(this.empty, pick === 'starred' && !listed.length ? NONE_STARRED : EMPTY);
    const items = timelineItems(listed, ctx.nowMs, hours * 3600000, MAX_ROWS, pick === 'all' ? notes.all : notes.one);
    this.shown = items;
    this.pick = pick;
    this.calendar.hidden = !items.length;
    this.calendar.title = `Download the ${items.length} start${items.length === 1 ? '' : 's'} listed here as a calendar file (.ics) `
      + 'for Google Calendar, Outlook or Apple Calendar, each with a reminder';
    const key = pick + [...done].join() + items.map((i) => `${i.kind}${i.startMs}${i.note ?? ''}`).join(',') + ctx.timeZone + ctx.clock;
    if (key !== this.key) {
      this.key = key;
      this.list.replaceChildren(...items.map((i) => {
        const day = dayLabel(i.startMs, ctx.nowMs, ctx.timeZone);
        const t = clockTime(i.startMs, ctx.timeZone, ctx.clock);
        const label = `${i.name} ${VERB[i.kind]}${i.extra ? ' (two)' : ''}`;
        const isDone = done.has(i.kind);
        return h('li', { 'data-kind': i.kind, 'data-start': i.startMs, class: isDone ? 'done' : null,
          title: isDone ? 'Dimmed: you marked the last one done. This clears when the next one starts.' : null },
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
