// The sightings log: record what the game showed (a World Boss spawn, a Legion, a Helltide region,
// a chest), keep it in this browser, export it as a file and import files back. Summaries compare
// the sightings with the schedule and look for repeating cycles, and say plainly when there is not
// enough data. Nothing is sent anywhere.

import type { RegionRecord } from '../data/schema';
import type { EventKind } from '../engine/events';
import { calendarDate, clockTime } from '../engine/format';
import {
  cleanObservation, merge, newId, parseFile, rotationCheck, timingCheck, toFile,
  TIMING_TOLERANCE_MS, type Observation, type ObservedEvent, type RotationField,
} from '../engine/observations';
import type { Segment } from '../engine/segments';
import { anchorEvidence, anchorProgress } from '../engine/verification';
import type { ViewContext } from './cards';
import { h, nodes } from './dom';

const EVENT_NAMES: Record<ObservedEvent, string> = {
  worldBoss: 'World Boss', legion: 'Legion', helltide: 'Helltide', helltideChest: 'Helltide chest',
};

export interface SightingsHooks {
  /** Sightings kept in this browser. */
  local: () => Observation[];
  setLocal: (list: Observation[]) => boolean;
  /** Sightings already in the repository's data (read-only here). */
  shared: Observation[];
  /** Shared and local together, without duplicates. */
  all: () => Observation[];
  segments: (kind: EventKind) => Segment[];
  regions: RegionRecord[];
  bosses: string[];
  places: (event: ObservedEvent) => string[];
  ctx: () => ViewContext;
  onChange: () => void;
}

/** One line for an event card: what the player's sightings say about its start times. */
export function timingSummary(list: Observation[], segs: Segment[], event: ObservedEvent): string | null {
  const t = timingCheck(list, segs, event);
  if (!t.checked) return null;
  if (!t.disagree.length) return `${t.agree} of ${t.checked} agree with the schedule (within ${TIMING_TOLERANCE_MS / 60000} min).`;
  return `${t.disagree.length} of ${t.checked} do not match the schedule; see the Sightings panel.`;
}

function regionName(regions: RegionRecord[], id: string | undefined): string | undefined {
  return id ? regions.find((r) => r.id === id)?.name ?? id : undefined;
}

export class SightingsPanel {
  readonly el: HTMLElement;
  private summary = h('div', { class: 'sight-summary' });
  private recent = h('ul', { class: 'sight-list' });
  private status = h('p', { class: 'status-line', role: 'status' });
  private fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  private dialog: HTMLDialogElement;
  private key = '';

  constructor(private hooks: SightingsHooks, dialog: HTMLDialogElement) {
    this.dialog = dialog;
    const log = h('button', { class: 'btn', type: 'button' }, 'Log a sighting');
    log.addEventListener('click', () => this.openForm());
    const exp = h('button', { class: 'btn', type: 'button' }, 'Export');
    exp.addEventListener('click', () => this.exportFile());
    const imp = h('button', { class: 'btn', type: 'button' }, 'Import');
    imp.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => void this.importFile());
    this.el = h('div', {},
      h('h2', { id: 'sightings-title' }, 'Sightings', h('span', { class: 'note' }, 'what you saw in game, kept in this browser')),
      h('div', { class: 'options' }, log, exp, imp, this.fileInput),
      this.status,
      this.summary,
      h('details', { class: 'sight-recent' }, h('summary', {}, 'Recent sightings'), this.recent),
      h('p', { class: 'help' },
        'Log the start time the game shows, not the one on this page. Exported files can be added to the tracker\'s own data. ' +
        'A few sightings cannot prove a rotation; the summary says when there is enough to tell.'),
    );
  }

  openForm(event: ObservedEvent = 'worldBoss'): void {
    this.renderForm(event);
    if (!this.dialog.open) this.dialog.showModal();
  }

  update(): void {
    const all = this.hooks.all();
    const ctx = this.hooks.ctx();
    const key = `${all.length}|${all.at(-1)?.id}|${ctx.timeZone}|${ctx.clock}|${this.hooks.local().length}`;
    if (key === this.key) return;
    this.key = key;
    this.renderSummary(all);
    this.renderRecent(ctx);
  }

  private renderSummary(all: Observation[]): void {
    const regions = this.hooks.regions.length;
    const block = (event: ObservedEvent, kind: EventKind, fields: [RotationField, string, number][]) => {
      const segs = this.hooks.segments(kind);
      const mine = all.filter((o) => o.event === event);
      const t = timingCheck(all, segs, event);
      const lines: (HTMLElement | null)[] = [];
      if (t.checked) {
        lines.push(h('li', {}, `Start times: ${t.agree} of ${t.checked} agree with the schedule.`));
        if (event !== 'helltide') lines.push(h('li', {}, `Start time confirmation: ${anchorProgress(anchorEvidence(all, segs, event))}`));
        for (const d of t.disagree.slice(0, 3)) {
          const mins = Math.round(d.offsetMs / 60000);
          lines.push(h('li', { class: 'warn' }, `${calendarDate(Date.parse(d.observation.at), this.hooks.ctx().timeZone)}: ${Math.abs(mins)} min ${mins > 0 ? 'after' : 'before'} the nearest calculated start.`));
        }
      }
      // Seeing a place confirms it exists and is used; it says nothing yet about an order.
      const seen = new Map<string, number>();
      for (const o of mine) if (o.place) seen.set(o.place, (seen.get(o.place) ?? 0) + 1);
      if (seen.size) {
        lines.push(h('li', {}, `Places seen in game (each sighting confirms the place exists): ${[...seen].map(([p, n]) => `${p} (${n})`).join(', ')}.`));
      }
      for (const [field, label, domain] of fields) {
        const r = rotationCheck(all, segs, event, field, domain);
        if (!r.samples) continue;
        lines.push(h('li', { class: r.verdict === 'consistent' ? 'ok' : '' }, `${label} order: ${r.explanation}${r.conflicts ? ` (${r.conflicts} conflicting record${r.conflicts === 1 ? '' : 's'} left out)` : ''}`));
      }
      return h('div', {},
        h('h3', {}, `${EVENT_NAMES[event]} `, h('span', { class: 'note' }, `${mine.length} sighting${mine.length === 1 ? '' : 's'}`)),
        lines.length ? h('ul', {}, ...nodes(...lines)) : h('p', { class: 'muted' }, mine.length ? 'Nothing to check yet.' : 'None logged yet.'));
    };
    const chests = all.filter((o) => o.event === 'helltideChest' && o.place);
    const byPlace = new Map<string, number>();
    for (const c of chests) {
      const k = `${c.place} (${regionName(this.hooks.regions, c.region) ?? 'region not noted'})`;
      byPlace.set(k, (byPlace.get(k) ?? 0) + 1);
    }
    this.summary.replaceChildren(
      block('worldBoss', 'worldBoss', [['boss', 'Boss', Math.max(2, this.hooks.bosses.length)], ['place', 'Arena', regions]]),
      block('legion', 'legion', [['place', 'Place', regions], ['region', 'Region', regions]]),
      block('helltide', 'helltide', [['region', 'Region', regions]]),
      h('div', {},
        h('h3', {}, 'Helltide chests ', h('span', { class: 'note' }, `${chests.length} sighting${chests.length === 1 ? '' : 's'}`)),
        byPlace.size
          ? h('ul', {}, ...[...byPlace].sort((a, b) => b[1] - a[1]).map(([k, n]) => h('li', {}, `${k}: seen ${n} time${n === 1 ? '' : 's'}`)))
          : h('p', { class: 'muted' }, 'None logged yet. Each logged place becomes a candidate chest spot.')),
    );
  }

  private renderRecent(ctx: ViewContext): void {
    const local = new Set(this.hooks.local().map((o) => o.id));
    const all = this.hooks.all().slice(-12).reverse();
    this.recent.replaceChildren(...all.map((o) => {
      const t = Date.parse(o.at);
      const parts = [EVENT_NAMES[o.event], o.boss, o.place, regionName(this.hooks.regions, o.region)].filter(Boolean).join(' · ');
      const del = local.has(o.id) ? h('button', { class: 'link', type: 'button', 'aria-label': 'Delete this sighting' }, 'delete') : null;
      del?.addEventListener('click', () => {
        this.hooks.setLocal(this.hooks.local().filter((x) => x.id !== o.id));
        this.key = '';
        this.hooks.onChange();
      });
      return h('li', {}, `${calendarDate(t, ctx.timeZone)} ${clockTime(t, ctx.timeZone, ctx.clock)} · ${parts}${o.timing === 'during' ? ' (already running)' : ''}`,
        local.has(o.id) ? '' : h('span', { class: 'note' }, ' shared data'), del ? ' ' : '', del);
    }));
    if (!all.length) this.recent.replaceChildren(h('li', { class: 'muted' }, 'None yet.'));
  }

  private exportFile(): void {
    const list = this.hooks.local();
    if (!list.length) { this.say('Nothing to export yet.', false); return; }
    const now = Date.now();
    const blob = new Blob([`${JSON.stringify(toFile(list, now), null, 2)}\n`], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `d4-tracker-sightings-${new Date(now).toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    this.say(`Exported ${list.length} sighting${list.length === 1 ? '' : 's'}.`, true);
  }

  private async importFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      const parsed = parseFile(await file.text());
      const { merged, added, duplicates } = merge(this.hooks.local(), parsed.observations);
      const saved = this.hooks.setLocal(merged);
      this.key = '';
      this.hooks.onChange();
      this.say(`Imported ${added}, skipped ${duplicates} already here${parsed.rejected ? `, ${parsed.rejected} not readable` : ''}.${saved ? '' : ' The browser did not save them.'}`, saved);
    } catch (e) {
      this.say(e instanceof Error ? e.message : 'That file could not be read.', false);
    }
  }

  private say(text: string, ok: boolean): void {
    this.status.textContent = text;
    this.status.className = `status-line ${ok ? 'ok' : 'warn'}`;
  }

  private renderForm(event: ObservedEvent): void {
    const ctx = this.hooks.ctx();
    const utc = ctx.timeZone === 'UTC';
    const now = new Date(ctx.nowMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = utc ? now.getUTCFullYear() : now.getFullYear();
    const mo = (utc ? now.getUTCMonth() : now.getMonth()) + 1;
    const d = utc ? now.getUTCDate() : now.getDate();
    const hh = utc ? now.getUTCHours() : now.getHours();
    const mm = utc ? now.getUTCMinutes() : now.getMinutes();

    const what = h('select', { id: 'sight-event' }, ...(Object.keys(EVENT_NAMES) as ObservedEvent[]).map((e) =>
      h('option', { value: e, selected: e === event }, EVENT_NAMES[e])));
    const date = h('input', { type: 'date', id: 'sight-date', value: `${y}-${pad(mo)}-${pad(d)}`, required: true });
    const time = h('input', { type: 'time', id: 'sight-time', value: `${pad(hh)}:${pad(mm)}`, step: 60, required: true });
    const how = h('select', { id: 'sight-timing' },
      h('option', { value: 'start' }, 'It started then (or the in-game timer showed that start)'),
      h('option', { value: 'during' }, 'It was already running then'));
    const region = h('select', { id: 'sight-region' }, h('option', { value: '' }, 'Not noted'),
      ...this.hooks.regions.map((r) => h('option', { value: r.id }, r.name)));
    const listId = 'sight-places';
    const placeList = h('datalist', { id: listId });
    const place = h('input', { type: 'text', id: 'sight-place', list: listId, maxlength: 120, autocomplete: 'off' });
    const boss = h('select', { id: 'sight-boss' }, h('option', { value: '' }, 'Not noted'),
      ...this.hooks.bosses.map((b) => h('option', { value: b }, b)));
    const note = h('input', { type: 'text', id: 'sight-note', maxlength: 120 });
    const error = h('p', { class: 'status-line warn', role: 'alert' });

    const bossRow = h('label', { class: 'field' }, 'Boss', boss);
    const howRow = h('label', { class: 'field' }, 'Time is', how);
    const sync = () => {
      const e = what.value as ObservedEvent;
      bossRow.hidden = e !== 'worldBoss';
      howRow.hidden = e === 'helltideChest';
      placeList.replaceChildren(...this.hooks.places(e).map((p) => h('option', { value: p })));
    };
    what.addEventListener('change', sync);
    sync();

    const save = h('button', { class: 'btn', type: 'submit' }, 'Save');
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', () => this.dialog.close());
    const form = h('form', { method: 'dialog', class: 'dialog-body sight-form' },
      h('label', { class: 'field' }, 'What', what),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, `Date (${utc ? 'UTC' : 'your time'})`, date),
        h('label', { class: 'field' }, `Time (${utc ? 'UTC' : 'your time'})`, time)),
      howRow,
      h('label', { class: 'field' }, 'Region', region),
      h('label', { class: 'field' }, 'Place (arena, Legion site, landmark)', place, placeList),
      bossRow,
      h('label', { class: 'field' }, 'Note', note),
      error,
      h('div', { class: 'options' }, save, cancel),
    );
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const [Y, M, D] = date.value.split('-').map(Number);
      const [H, Mi] = time.value.split(':').map(Number);
      if (![Y, M, D, H, Mi].every((n) => Number.isFinite(n))) { error.textContent = 'Enter a date and a time.'; return; }
      const ms = utc ? Date.UTC(Y!, M! - 1, D!, H!, Mi!) : new Date(Y!, M! - 1, D!, H!, Mi!).getTime();
      const e = what.value as ObservedEvent;
      const raw = {
        id: newId(Date.now()),
        event: e,
        at: new Date(ms).toISOString(),
        timing: e === 'helltideChest' ? 'none' : how.value,
        region: region.value || undefined,
        place: place.value || undefined,
        boss: e === 'worldBoss' ? boss.value || undefined : undefined,
        note: note.value || undefined,
        recordedAt: new Date().toISOString(),
      };
      const o = cleanObservation(raw);
      if (!o) { error.textContent = 'That sighting could not be saved; check the fields.'; return; }
      const saved = this.hooks.setLocal([...this.hooks.local(), o]);
      this.key = '';
      this.hooks.onChange();
      this.say(saved ? `Logged: ${EVENT_NAMES[e]} at ${clockTime(ms, ctx.timeZone, ctx.clock)}.` : 'The browser did not save it (storage is blocked).', saved);
      this.dialog.close();
    });
    this.dialog.replaceChildren(
      h('div', { class: 'dialog-head' }, h('h2', { id: 'sighting-title' }, 'Log a sighting')),
      form,
    );
  }
}
