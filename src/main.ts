// Entry point: wires the data sources, the engine and the views, and runs the one-second tick.

import './styles.css';
import { LocalScheduleSource } from './adapters/local-schedule';
import { OfflineDetailsSource } from './adapters/offline-details';
import type { DetailsSource, ScheduleSource } from './adapters/types';
import {
  bossNames, DETAIL_REASONS, eventDefinitions, EVENTS, knownPlaces, LOCATIONS, MAP_DATA, SEASONS, SHARED_SIGHTINGS,
} from './data';
import { detectResume, estimateClock, type ClockEstimate } from './engine/clock';
import { eventStatus, isInstant, type EventKind, type EventStatus } from './engine/events';
import { clockTime, spanWords, zoneName } from './engine/format';
import { merge } from './engine/observations';
import { dueReminders, type ReminderRule, type ScheduleMap } from './engine/reminders';
import { daysSince } from './engine/seasons';
import { tabTitle } from './engine/title';
import { anchorEvidence, anchorProgress } from './engine/verification';
import { loadObservations, saveObservations } from './store/observations';
import { loadPrefs, savePrefs, type Prefs } from './store/prefs';
import { EventCard, type ViewContext } from './ui/cards';
import { byId, h, setText } from './ui/dom';
import { SanctuaryMap } from './ui/map';
import { showSystemNotification } from './ui/notify';
import { SeasonPanel } from './ui/season';
import { renderSettings } from './ui/settings';
import { SightingsPanel, timingSummary } from './ui/sightings';
import { Timeline } from './ui/timeline';

const scheduleSource: ScheduleSource = new LocalScheduleSource(eventDefinitions());
const detailsSource: DetailsSource = new OfflineDetailsSource(DETAIL_REASONS);

let prefs: Prefs = loadPrefs();
let sightings = loadObservations();
let clock: ClockEstimate | null = null;
let clockChecked: 'pending' | 'done' | 'failed' = 'pending';
/** performance.now() of the last clock check: a steady clock, unaffected by the jumps it detects. */
let lastClockCheck = -Infinity;

// A pop-out window (opened by the Pop out button) is always compact, without changing the saved
// preference of the main window.
const popout = location.hash === '#compact';

/** The browser's zone, read each time: it changes if the player changes the system time zone. */
function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function nowMs(): number {
  return Date.now() + (clock?.offsetMs ?? 0);
}

function ctx(): ViewContext {
  return { nowMs: nowMs(), timeZone: prefs.zone === 'utc' ? 'UTC' : localZone(), clock: prefs.clock };
}

function segmentsOf(kind: EventKind) {
  return scheduleSource.definitions(nowMs()).find((d) => d.kind === kind)?.segments ?? [];
}

// Views

const cardsEl = byId('cards');
const cards = new Map<EventKind, EventCard>();
for (const def of scheduleSource.definitions(nowMs())) {
  const card = new EventCard(def.kind, def.name, {
    identity: def.kind === 'worldBoss',
    instant: isInstant(def, nowMs()),
    onLog: () => sightingsPanel.openForm(def.kind),
  });
  cards.set(def.kind, card);
  cardsEl.append(card.el);
}

const timeline = new Timeline();
byId('timeline-panel').append(timeline.el);
const season = new SeasonPanel(SEASONS);
byId('season-panel').append(season.el);
const map = new SanctuaryMap(MAP_DATA, {
  layers: () => prefs.layers,
  setLayer: (id, on) => change((p) => { p.layers[id] = on; }),
});
byId('map-panel').append(map.el);
let mergedFor: unknown = null;
let mergedCache: ReturnType<typeof merge>['merged'] = [];
/** Shared and local sightings together, recomputed only when the local list changes. */
function everySighting() {
  if (mergedFor !== sightings) { mergedCache = merge(SHARED_SIGHTINGS, sightings).merged; mergedFor = sightings; }
  return mergedCache;
}

const sightingsPanel = new SightingsPanel({
  local: () => sightings,
  all: everySighting,
  setLocal: (list) => { sightings = list; return saveObservations(list); },
  shared: SHARED_SIGHTINGS,
  segments: segmentsOf,
  regions: LOCATIONS.regions,
  bosses: bossNames(),
  places: knownPlaces,
  ctx,
  onChange: () => render(),
}, byId<HTMLDialogElement>('sighting-dialog'));
byId('sightings-panel').append(sightingsPanel.el);
byId('log-open').addEventListener('click', () => sightingsPanel.openForm());

const ROTATION_FIELD = { boss: 'Boss order', place: 'Place order', region: 'Region order' } as const;
const rotationNotes = Object.fromEntries(EVENTS.events.map((e) => [e.id,
  e.rotations.map((r) => `${ROTATION_FIELD[r.field]} (${r.confidence}): ${r.note}`)])) as Record<EventKind, string[]>;

function applyPrefs(): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', prefs.theme);
  root.classList.toggle('compact', prefs.compact || popout);
  root.classList.toggle('popout', popout);
  byId('compact-toggle').setAttribute('aria-pressed', String(prefs.compact));
  for (const [kind, card] of cards) card.el.hidden = !prefs.cards[kind];
  byId('map-panel').hidden = !prefs.cards.map;
  byId('timeline-panel').hidden = !prefs.cards.season;
  byId('season-panel').hidden = !prefs.cards.season;
  byId('sightings-panel').hidden = !prefs.cards.sightings;
  byId('lower').hidden = !prefs.cards.map && !prefs.cards.season && !prefs.cards.sightings;
}

function change(mutate: (p: Prefs) => void): void {
  mutate(prefs);
  savePrefs(prefs);
  applyPrefs();
  render();
  const dialog = byId<HTMLDialogElement>('settings');
  if (dialog.open) openSettings(false);
}

// Settings

function dataLines(): string[] {
  const lines = scheduleSource.definitions(nowMs()).map((d) => {
    const seg = d.segments[0];
    return `${d.name}: interval ${seg?.interval.confidence ?? 'unknown'}, start time ${seg?.phase.confidence ?? 'unknown'}. Checked ${d.checkedOn}.`;
  });
  lines.push(`Location and boss details: ${detailsSource.label}.`);
  lines.push(clockLine());
  return lines;
}

function clockLine(): string {
  if (location.protocol === 'file:') return 'Clock check: needs the page to come from a web server, so opened as a file it uses this device\'s clock as it is.';
  if (clockChecked === 'pending') return 'Clock check: running.';
  if (clockChecked === 'failed' || !clock) return 'Clock check: not available here, so times use this device\'s clock as it is.';
  if (clock.applied) {
    const dir = clock.measuredMs > 0 ? 'slow' : 'fast';
    return `Clock check: this device's clock is about ${Math.round(Math.abs(clock.measuredMs) / 1000)} s ${dir}; countdowns are corrected for it.`;
  }
  return 'Clock check: this device\'s clock agrees with the server to within about 2 seconds.';
}

function openSettings(show = true): void {
  const dialog = byId<HTMLDialogElement>('settings');
  const scroll = dialog.querySelector('.dialog-body')?.scrollTop ?? 0;
  renderSettings(dialog, { prefs: () => prefs, change, dataLines });
  const body = dialog.querySelector('.dialog-body');
  if (body) body.scrollTop = scroll;
  if (show && !dialog.open) dialog.showModal();
}

byId('settings-open').addEventListener('click', () => openSettings());
byId('compact-toggle').addEventListener('click', () => change((p) => { p.compact = !p.compact; }));
byId('popout-open').addEventListener('click', () => {
  const url = new URL(location.href);
  url.hash = 'compact';
  window.open(url.href, 'd4-tracker-compact', 'popup=yes,width=760,height=200');
});

// Reminders

const toasts = byId('toasts');
let lastReminderCheck = nowMs();
/** Reminder ids already fired, with their event start, so the list can be pruned. */
const fired = new Map<string, number>();

function reminderRules(): ReminderRule[] {
  const out: ReminderRule[] = [];
  for (const kind of ['worldBoss', 'legion', 'helltide'] as const) {
    for (const leadMinutes of prefs.reminders[kind]) out.push({ kind, leadMinutes });
  }
  return out;
}

function toast(kind: EventKind, title: string, body: string): void {
  const close = h('button', { type: 'button', 'aria-label': 'Dismiss' }, '×');
  const el = h('div', { class: 'toast', 'data-kind': kind, role: 'status' }, h('div', {}, h('strong', {}, title), body), close);
  close.addEventListener('click', () => el.remove());
  toasts.append(el);
  setTimeout(() => el.remove(), 5 * 60000);
}

function checkReminders(now: number, statuses: EventStatus[]): void {
  const schedules: ScheduleMap = {};
  for (const st of statuses) schedules[st.kind] = st.definition.segments;
  for (const r of dueReminders(schedules, reminderRules(), lastReminderCheck, now)) {
    if (fired.has(r.id)) continue;
    fired.set(r.id, r.eventStartMs);
    const name = statuses.find((s) => s.kind === r.kind)?.name ?? r.kind;
    const left = r.eventStartMs - now;
    const verb = r.kind === 'worldBoss' ? 'spawns' : r.kind === 'helltide' ? 'begins' : 'starts';
    const title = left > 0 ? `${name} ${verb} in ${spanWords(left)}` : `${name} ${r.kind === 'helltide' ? 'has begun' : 'is starting'}`;
    const c = ctx();
    const body = `At ${clockTime(r.eventStartMs, c.timeZone, c.clock)}.`;
    toast(r.kind, title, body);
    if (prefs.systemNotifications) showSystemNotification(title, body, r.id);
  }
  lastReminderCheck = Math.max(lastReminderCheck, now);
  // A tab left open for days should not keep every id it ever fired.
  for (const [id, start] of fired) if (start < now - 3600000) fired.delete(id);
}

// Tick

function statusesAt(now: number): EventStatus[] {
  return scheduleSource.definitions(now).map((def) => {
    const st = eventStatus(def, detailsSource.details(def.kind, null, now), now);
    return { ...st, details: detailsSource.details(def.kind, st.active ?? st.next, now) };
  });
}

function render(): void {
  const c = ctx();
  const statuses = statusesAt(c.nowMs);
  const shown = statuses.filter((s) => prefs.cards[s.kind]);
  const soonest = shown.filter((s) => s.phase !== 'unknown' && s.msToNext !== null)
    .reduce<EventStatus | null>((b, s) => (!b || s.msToNext! < b.msToNext! ? s : b), null);
  const allSightings = everySighting();
  for (const st of statuses) {
    cards.get(st.kind)?.update(st, c, {
      isNext: soonest?.kind === st.kind,
      checkedDaysAgo: daysSince(st.definition.checkedOn, c.nowMs),
      sightings: timingSummary(allSightings, st.definition.segments, st.kind),
      anchorProgress: anchorProgress(anchorEvidence(allSightings, st.definition.segments, st.kind)),
      rotationNotes: rotationNotes[st.kind] ?? [],
    });
  }
  timeline.update(shown, c);
  season.update(c);
  sightingsPanel.update();
  setText(byId('clock-now'), clockTime(c.nowMs, c.timeZone, c.clock, true));
  const zone = localZone();
  const other = prefs.zone === 'utc' ? `${clockTime(c.nowMs, zone, c.clock)} ${zoneName(c.nowMs, zone)}` : `${clockTime(c.nowMs, 'UTC', c.clock)} UTC`;
  const sub = byId('clock-sub');
  setText(sub, `${zoneName(c.nowMs, c.timeZone)} · ${other}${clock?.applied ? ' · corrected' : ''}`);
  sub.classList.toggle('warn', !!clock?.applied);
  const title = tabTitle(shown, prefs.title, document.visibilityState === 'visible');
  if (document.title !== title) document.title = title;
  checkReminders(c.nowMs, statuses);
}

let timer = 0;
let lastWall = Date.now();
let lastSteady = performance.now();

function tick(): void {
  const wall = Date.now();
  const steady = performance.now();
  // After sleep, or when the system clock is changed, check the clock again before trusting it.
  const resumed = detectResume(lastWall, lastSteady, wall, steady);
  if (resumed) void checkClock(resumed === 'clock-jump' ? 5000 : 60000);
  lastWall = wall;
  lastSteady = steady;
  render();
  // Wake just after the next whole second, so the display changes in step with real seconds.
  timer = window.setTimeout(tick, 1000 - (nowMs() % 1000) + 5);
}

document.addEventListener('visibilitychange', () => {
  window.clearTimeout(timer);
  tick();
});

// Clock check against this site's own server (same origin, nothing third-party). Once at load,
// every six hours, and after a resume; never more than once a minute.
async function checkClock(minGapMs = 0): Promise<void> {
  if (!location.protocol.startsWith('http')) { clockChecked = 'failed'; return; }
  if (performance.now() - lastClockCheck < minGapMs) return;
  lastClockCheck = performance.now();
  try {
    const url = new URL(location.href);
    url.hash = '';
    url.searchParams.set('clock', String(Date.now()));
    const sent = Date.now();
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const received = Date.now();
    const estimate = estimateClock(sent, received, res.headers.get('Date'), res.headers.get('Age'));
    if (estimate) {
      clock = estimate;
      clockChecked = 'done';
    } else if (!clock) {
      clockChecked = 'failed';
    }
  } catch {
    if (!clock) clockChecked = 'failed';
  }
  render();
}

applyPrefs();
tick();
void checkClock();
window.setInterval(() => void checkClock(60000), 6 * 3600000);
detailsSource.start?.(() => render());
