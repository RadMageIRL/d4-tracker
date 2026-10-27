// Entry point: wires the data sources, the engine and the views, and runs the one-second tick.

import './styles.css';
import { IntelligenceDetailsSource } from './adapters/intelligence';
import { LocalScheduleSource } from './adapters/local-schedule';
import type { ScheduleSource } from './adapters/types';
import {
  bossNames, DETAIL_REASONS, eventDefinitions, EVENTS, knownPlaces, LOCATIONS, MAP_DATA, REGISTERED_RULES, resetBoundaries,
  HELLTIDE_CYCLES, LEGION_EXPANSION, LEGION_GROUPS, ROTATIONS, SEASONS, SHARED_SIGHTINGS, WORLD_BOSS_ROTATION,
} from './data';
import { chestSpots, chestState, type SharedSpot } from './engine/chests';
import { detectResume, estimateClock, SAMPLE_GAP_MS, type ClockEstimate, type ClockSample } from './engine/clock';
import { eventStatus, hasExtraSpawn, isInstant, type EventKind, type EventStatus } from './engine/events';
import { calendarDate, clockTime, spanWords, zoneName } from './engine/format';
import { icsCalendar, type CalendarEvent } from './engine/ics';
import { isFresh, NEWS_PATH, NEWS_REFRESH_MS, NEWS_TIMEOUT_MS, parseNews, type NewsItem } from './engine/news';
import { merge } from './engine/observations';
import { radarLights, type RadarLight } from './engine/radar';
import { activeOccurrence, lastStart, nextStart } from './engine/segments';
import { dueReminders, type ReminderRule, type ScheduleMap } from './engine/reminders';
import { daysSince } from './engine/seasons';
import { tabTitle } from './engine/title';
import { anchorEvidence, anchorProgress } from './engine/verification';
import { loadNews, saveNews } from './store/news';
import { loadObservations, saveObservations } from './store/observations';
import { DONE_KINDS, loadPrefs, PREFIX, savePrefs, type ComingUpChoice, type DoneKind, type Prefs } from './store/prefs';
import { EventCard, type OrderNote, type ViewContext } from './ui/cards';
import { byId, h, setText } from './ui/dom';
import { SanctuaryMap, type ChestView } from './ui/map';
import { NewsBar, type NewsStatus } from './ui/news';
import { showSystemNotification } from './ui/notify';
import { SeasonPanel } from './ui/season';
import { renderSettings } from './ui/settings';
import { SightingsPanel, timingSummary, type FormPreset } from './ui/sightings';
import { playChime, primeOnGesture } from './ui/sound';
import { NextStrip } from './ui/strip';
import { Timeline, type TimelineItem } from './ui/timeline';

const scheduleSource: ScheduleSource = new LocalScheduleSource(eventDefinitions());
const SHARED_IDS = new Set(SHARED_SIGHTINGS.map((o) => o.id));
const WORLD_BOSS = eventDefinitions().find((d) => d.kind === 'worldBoss');
const detailsSource = new IntelligenceDetailsSource({
  reasons: DETAIL_REASONS,
  sightings: () => everySighting(),
  segments: (kind) => segmentsOf(kind),
  registered: REGISTERED_RULES,
  boundaries: resetBoundaries(),
  regions: LOCATIONS.regions,
  arenas: LOCATIONS.worldBossArenas.map((a) => ({ name: a.name, region: a.region })),
  bosses: bossNames(),
  sites: LOCATIONS.legionSites.map((s) => ({ name: s.name, region: s.region })),
  isShared: (o) => SHARED_IDS.has(o.id),
  ...(WORLD_BOSS_ROTATION ? { rotation: WORLD_BOSS_ROTATION } : {}),
  helltideCycles: HELLTIDE_CYCLES,
  ...(LEGION_GROUPS ? { legionGroups: LEGION_GROUPS } : {}),
  ...(LEGION_EXPANSION ? { legionExpansion: LEGION_EXPANSION } : {}),
  ...(WORLD_BOSS?.extra ? { extra: { every: WORLD_BOSS.extra.every, has: (startMs: number) => hasExtraSpawn(WORLD_BOSS, startMs) } } : {}),
});

let prefs: Prefs = loadPrefs();
let sightings = loadObservations();
let mergedFor: unknown = null;
let mergedCache: ReturnType<typeof merge>['merged'] = [];
/** Shared and local sightings together, recomputed only when the local list changes. */
function everySighting() {
  if (mergedFor !== sightings) { mergedCache = merge(SHARED_SIGHTINGS, sightings).merged; mergedFor = sightings; }
  return mergedCache;
}
let clock: ClockEstimate | null = null;
let clockChecked: 'pending' | 'done' | 'unreliable' | 'failed' = 'pending';
let clockInFlight = false;
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
    extra: !!def.extra,
    onLog: () => sightingsPanel.openForm(def.kind, logPreset(def.kind)),
    ...(isDoneKind(def.kind) ? { onDone: (on: boolean) => markDone(def.kind as DoneKind, on) } : {}),
    onStar: (on) => change((p) => { p.starred[def.kind] = on; }),
  });
  cards.set(def.kind, card);
  cardsEl.append(card.el);
}
/** The next-event strip above the cards. Off for now (it repeated the cards' countdowns); true brings it back. */
const SHOW_NEXT_STRIP = false;
const strip = SHOW_NEXT_STRIP ? new NextStrip() : null;
if (strip) cardsEl.before(strip.el);

// Latest news, above the cards. It starts closed and asks for nothing until it is opened; then the
// headlines are kept in this browser for 15 minutes and asked for again while it stays open. Hidden
// in compact view and the pop-out, which keep to the countdowns.
const news: { items: NewsItem[] | null; fetchedAt: number | null; checkedAt: number; status: NewsStatus; loading: boolean } = {
  items: null, fetchedAt: null, checkedAt: -Infinity, status: 'idle', loading: false,
};
const newsBar = new NewsBar((open) => { if (open !== prefs.newsOpen) change((p) => { p.newsOpen = open; }); });
byId('app').prepend(newsBar.el);
newsBar.setOpen(prefs.newsOpen);
const newsShown = () => prefs.newsOpen && !prefs.compact && !popout;

/** The list from this site. A 404 page means this address does not pass it through (GitHub Pages);
 *  Blizzard's own "not found" comes back as JSON and counts as a failure. */
async function fetchNews(): Promise<{ missing?: true; items?: NewsItem[] }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NEWS_TIMEOUT_MS);
  try {
    const res = await fetch(NEWS_PATH, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (res.status === 404 && !(res.headers.get('Content-Type') ?? '').includes('json')) return { missing: true };
    return res.ok ? { items: parseNews(await res.json()) } : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

async function loadNewsNow(): Promise<void> {
  if (news.loading) return;
  const cache = loadNews();
  if (cache) Object.assign(news, { items: cache.items, fetchedAt: cache.fetchedAt, checkedAt: cache.fetchedAt, status: 'ok' });
  if (cache && isFresh(cache, Date.now())) { render(); return; }
  if (!location.protocol.startsWith('http')) { news.status = 'unavailable'; render(); return; }
  news.loading = true;
  news.checkedAt = Date.now();
  render();
  const result = await fetchNews();
  news.loading = false;
  if (result.missing) {
    news.status = 'unavailable';
  } else if (result.items?.length) {
    Object.assign(news, { items: result.items, fetchedAt: Date.now(), status: 'ok' });
    saveNews({ fetchedAt: news.fetchedAt!, items: result.items });
  } else {
    news.status = news.items ? 'stale' : 'failed';
  }
  render();
}

function isDoneKind(kind: EventKind): kind is DoneKind {
  return (DONE_KINDS as EventKind[]).includes(kind);
}

/** The player's own "done" on the last start of a spawn. It holds until the next start. */
function markDone(kind: DoneKind, on: boolean): void {
  const last = statusesAt(nowMs()).find((s) => s.kind === kind)?.previous;
  change((p) => { p.done[kind] = on && last ? last.startMs : null; });
}

/** Events whose last start the player marked done. */
function doneKinds(statuses: EventStatus[]): Set<EventKind> {
  return new Set(DONE_KINDS.filter((k) => {
    const last = statuses.find((s) => s.kind === k)?.previous;
    return !!last && prefs.done[k] === last.startMs;
  }));
}

const timeline = new Timeline((choice) => change((p) => { p.comingUp = choice; }),
  (pick, hours) => change((p) => { p.comingUpHours[pick] = hours; }), (items, pick) => addToCalendar(items, pick));
byId('timeline-panel').append(timeline.el);
const season = new SeasonPanel(SEASONS);
byId('season-panel').append(season.el);
const SHARED_CHESTS: SharedSpot[] = LOCATIONS.helltideChests.map((c) => ({
  id: c.id, region: c.region, name: c.name, type: c.type, confidence: c.confidence, checkedOn: c.checkedOn,
  source: c.sources.map((id) => LOCATIONS.sources[id]?.title).filter(Boolean).join('; '),
  ...(c.position ? { position: c.position } : {}),
}));
const chestTypeName = (id: string) => LOCATIONS.chestTypes.find((c) => c.id === id)?.name ?? id;

/** How long a spawn's marker stays after it starts, while the fight or event is under way. */
const RADAR_GRACE_MS = { worldBoss: 10 * 60000, legion: 5 * 60000 };

/** What the event radar lights now: the same sightings and trusted orders the cards use. */
function radarNow(): RadarLight[] {
  const now = nowMs();
  return radarLights({
    nowMs: now,
    sightings: everySighting(),
    segments: { helltide: segmentsOf('helltide'), worldBoss: segmentsOf('worldBoss'), legion: segmentsOf('legion') },
    leadMs: { worldBoss: prefs.radarLead.worldBoss * 60000, legion: prefs.radarLead.legion * 60000 },
    graceMs: RADAR_GRACE_MS,
    predict: (kind, startMs) => detailsSource.radarPredictions(kind, startMs, now),
    placeRegion: (kind, place) => detailsSource.placeRegion(kind, place),
    series: (region) => (LOCATIONS.regions.find((r) => r.id === region)?.release === 'base' ? 'base' : 'expansion'),
    isExtraSpawn: (o) => !detailsSource.isMainSpawn(o),
    isShared: (o) => SHARED_IDS.has(o.id),
  });
}
const realmFilter = () => (prefs.realm === 'any' ? undefined : prefs.realm);

function chestViews(regionId?: string): ChestView[] {
  const all = everySighting();
  const now = nowMs();
  const helltide = segmentsOf('helltide');
  return chestSpots(SHARED_CHESTS, all)
    .filter((c) => !regionId || c.region === regionId)
    .map((c) => ({ ...c, state: chestState(c, all, helltide, LOCATIONS.chestTypes, now, realmFilter()) }));
}

const map = new SanctuaryMap(MAP_DATA, {
  layers: () => prefs.layers,
  setLayer: (id, on) => change((p) => { p.layers[id] = on; }),
  confidences: () => prefs.confidences,
  setConfidence: (id, on) => change((p) => { p.confidences[id] = on; }),
  realm: () => prefs.realm,
  setRealm: (r) => change((p) => { p.realm = r; }),
  chests: chestViews,
  radar: radarNow,
  radarOn: () => prefs.radar,
  setRadar: (id, on) => change((p) => { p.radar[id] = on; }),
  leads: () => prefs.radarLead,
  helltideActive: () => !!activeOccurrence(segmentsOf('helltide'), nowMs()),
  markHelltide: (regionId) => {
    sightingsPanel.quickSave({
      event: 'helltide', at: new Date(nowMs()).toISOString(), timing: 'during', region: regionId,
      ...(realmFilter() ? { realm: realmFilter() } : {}),
    }, `Helltide marked in ${LOCATIONS.regions.find((r) => r.id === regionId)?.name ?? regionId} until it ends.`);
  },
  markActive: (c) => {
    sightingsPanel.quickSave({
      event: 'helltideChest', at: new Date(nowMs()).toISOString(), timing: 'during', region: c.region, place: c.name, chest: c.type,
      ...(realmFilter() ? { realm: realmFilter() } : {}),
    }, `Marked active: ${c.name} (${chestTypeName(c.type)}).`);
  },
  addSpot: (regionId, pos) => {
    const active = !!activeOccurrence(segmentsOf('helltide'), nowMs());
    sightingsPanel.openForm('helltideChest', {
      region: regionId, timing: active ? 'during' : 'none', ...(pos ? { pos } : {}),
      intro: 'Name the spot by the Helltide zone and the nearest landmark the in-game map labels (for example "Sarkova Pass, by the cellar"), so you can find it again.',
    });
  },
  placeSpot: (c, pos) => {
    sightingsPanel.quickSave({
      event: 'helltideChest', at: new Date(nowMs()).toISOString(), timing: 'none', region: c.region, place: c.name, chest: c.type, pos,
    }, `Placed ${c.name} on the map.`);
  },
  chestTypeName,
  ctx,
});
byId('map-panel').append(map.el);

const sightingsPanel = new SightingsPanel({
  local: () => sightings,
  all: everySighting,
  setLocal: (list) => { sightings = list; return saveObservations(list); },
  shared: SHARED_SIGHTINGS,
  segments: segmentsOf,
  regions: LOCATIONS.regions,
  bosses: bossNames(),
  places: knownPlaces,
  chestTypes: LOCATIONS.chestTypes,
  orders: (kind) => orderNotes(kind, nowMs(), ctx().timeZone),
  realm: () => (prefs.realm === 'any' ? undefined : prefs.realm),
  setRealm: (r) => { if (r && r !== prefs.realm) change((p) => { p.realm = r; }); },
  ctx,
  onChange: () => render(),
}, byId<HTMLDialogElement>('sighting-dialog'));
byId('sightings-panel').append(sightingsPanel.el);
byId('log-open').addEventListener('click', () => sightingsPanel.openForm());

/** What the sightings say about each order of one event, for the card's About section. */
function orderNotes(kind: EventKind, now: number, timeZone: string): OrderNote[] {
  const models = detailsSource.models(kind, now);
  const dataNotes = EVENTS.events.find((e) => e.id === kind)?.rotations ?? [];
  return detailsSource.specs(kind).map((spec) => {
    const m = models[spec.key]!;
    const dataNote = dataNotes.find((r) => r.field === spec.field)?.note;
    const parts = [m.state === 'no-data' && dataNote ? `${dataNote} No sightings yet.` : m.explanation];
    if (m.latestMs !== null) parts.push(`Latest sighting used: ${calendarDate(m.latestMs, timeZone)}.`);
    if (m.reported) parts.push(`${m.reported} secondhand report${m.reported === 1 ? '' : 's'} shown but not used.`);
    if (m.older) parts.push(`${m.older} sighting${m.older === 1 ? '' : 's'} from before the current season or schedule not used.`);
    return { label: spec.label, confidence: m.confidence, text: parts.join(' ') };
  }).concat(kind === 'worldBoss' ? rotationNotes(now, timeZone) : kind === 'legion' ? expansionNotes(timeZone) : []);
}

/** Coming up: a Legion start's predicted expansion region, compact ("also Skovos"); the card labels it Predicted. */
function expansionTimelineNote(kind: EventKind, startMs: number): string | null {
  const x = kind === 'legion' ? detailsSource.legionExpansionAt(startMs) : null;
  return x ? `also ${x.region}` : null;
}

/**
 * Coming up's "Add to calendar": the starts it lists, as an .ics file any calendar app imports, each
 * with a reminder at the player's own lead for that event (10 minutes when none is set). What is
 * predicted is written out and labeled; the UIDs are stable, so importing again updates a start.
 */
function addToCalendar(items: TimelineItem[], pick: ComingUpChoice): void {
  if (!items.length) return;
  const now = nowMs();
  const events: CalendarEvent[] = items.map((i) => {
    const predicted = pickedTimelineNote(i.kind, i.startMs, now);
    const leads = prefs.reminders[i.kind];
    const description = [
      predicted ? `Predicted: ${predicted} (worked out from a repeating order, not confirmed; check the in-game map).` : '',
      i.extra ? 'A second World Boss spawns in an expansion region at the same time.' : '',
      'From Diablo IV Tracker: https://radmagelabs.com/d4/',
    ].filter(Boolean).join('\n');
    return {
      uid: `${i.kind}-${i.startMs}@d4-tracker`,
      startMs: i.startMs,
      // A spawn has no known length: a 15-minute block marks it on the calendar.
      endMs: i.endMs > i.startMs ? i.endMs : i.startMs + 15 * 60000,
      summary: `Diablo IV: ${i.name}${i.extra ? ' (two)' : ''}`,
      description,
      alarmMinutes: leads.length ? Math.max(...leads) : 10,
    };
  });
  const name = `d4-${{ all: 'coming-up', starred: 'starred', helltide: 'helltide', worldBoss: 'world-boss', legion: 'legion' }[pick]}.ics`;
  const a = h('a', { href: URL.createObjectURL(new Blob([icsCalendar(events, now)], { type: 'text/calendar' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(pick === 'all' || pick === 'starred' ? null : pick, 'Calendar file saved', `${name} has ${events.length} event${events.length === 1 ? '' : 's'}. Open it to add them to your calendar.`);
}

/** Coming up, one event picked: what is predicted for each start (the Helltide's regions, the World
 *  Boss's boss, the Legion's candidates as in Later predictions); the cards label these Predicted. */
function pickedTimelineNote(kind: EventKind, startMs: number, now: number): string | null {
  const p = detailsSource.predicted(kind, startMs, now);
  return (kind === 'worldBoss' ? p.identity : p.location) ?? null;
}

/** Where the expansion Legion's predicted site comes from, for the Legion card's About section only. */
function expansionNotes(timeZone: string): OrderNote[] {
  const x = ROTATIONS.legion?.expansion;
  if (!x || !LEGION_EXPANSION) return [];
  return [{
    label: 'Expansion Legion', confidence: 'inferred', status: 'Predicted', aboutOnly: true,
    text: `${x.basis} Pinned to a Legion on ${calendarDate(LEGION_EXPANSION.cycle.pin.startMs, timeZone)}.`,
  }];
}

/** Where World Boss predictions come from, for the card's About section. */
function rotationNotes(now: number, timeZone: string): OrderNote[] {
  const r = detailsSource.rotationNote(now);
  if (!r) return [];
  const until = calendarDate(r.untilMs, timeZone);
  const pin = `Pinned to a spawn on ${calendarDate(r.pinMs, timeZone)}`;
  return [{
    label: 'Boss', confidence: r.predicting ? 'inferred' : 'unknown', status: r.predicting ? 'Predicted' : 'Not predicted',
    text: `${ROTATIONS.worldBoss?.basis ?? ''} ${pin}, ${r.predicting ? `predicted through ${until}` : `which ran out on ${until}`}. A boss logged as seen re-pins it.`,
  }];
}

/** What was seen (not predicted) at an earlier start, for the card's Last line. */
function lastNote(st: EventStatus, now: number): string | null {
  if (!st.previous) return null;
  const d = detailsSource.details(st.kind, st.previous, now);
  const parts = [d.identity, d.location].filter((f) => f?.known && f.basis !== 'predicted').map((f) => (f as { value: string }).value);
  if (!parts.length) return null;
  const reported = [d.identity, d.location].some((f) => f?.known && f.basis === 'reported');
  return `${parts.join(', ')}${reported ? ' (reported)' : ' (seen)'}`;
}

/** What a card's "Log a sighting" already knows: the spawn it is about, or that a Helltide is running. */
function logPreset(kind: EventKind): FormPreset {
  const segs = segmentsOf(kind);
  const now = nowMs();
  if (kind === 'helltide') {
    return activeOccurrence(segs, now)
      ? { timing: 'during', atMs: now, intro: 'Which region is the Helltide in? It shows on the card and the atlas until this Helltide ends. Two can run at once (a base-game region and an expansion region): log each.' }
      : {};
  }
  // The in-game map names a World Boss about an hour ahead; a Legion is marked shortly before.
  const ahead = kind === 'worldBoss' ? 75 * 60000 : 10 * 60000;
  const next = nextStart(segs, now);
  const last = lastStart(segs, now);
  const at = next && next.startMs - now <= ahead ? next.startMs : last?.startMs;
  return at === undefined ? {} : {
    atMs: at, timing: 'start',
    intro: kind === 'worldBoss'
      ? 'Log the boss and arena the game shows for this spawn; the card shows them as seen. A second boss in an expansion region (every fourth spawn) is its own sighting.'
      : 'Log the site the game marks for this Legion.',
  };
}

function laterNotes(st: EventStatus): (string | null)[] {
  return st.later.map((o) => (hasExtraSpawn(st.definition, o.startMs) ? 'two bosses' : null));
}

/** What is predicted for each later start, for the card's collapsed Later predictions. */
function laterPredictions(st: EventStatus, now: number): (string | null)[] {
  return st.later.map((o) => {
    const p = detailsSource.predicted(st.kind, o.startMs, now);
    const parts = [[p.identity, p.location].filter(Boolean).join(', '), p.second ? `second boss in ${p.second}` : ''].filter(Boolean);
    return parts.length ? parts.join('; ') : null;
  });
}

function extraNote(st: EventStatus): { text: string; confidence: 'confirmed' | 'inferred' | 'unknown' } | null {
  const x = st.definition.extra;
  if (!x || !st.next || !hasExtraSpawn(st.definition, st.next.startMs)) return null;
  return { text: 'a second World Boss in an expansion region', confidence: x.claim.confidence };
}

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
  refresh();
}

function refresh(): void {
  applyPrefs();
  render();
  const dialog = byId<HTMLDialogElement>('settings');
  if (dialog.open) openSettings(false);
}

// Another window of this page (the pop-out, or a second tab) saved its settings: a star, a done
// mark or a choice made there shows here too.
window.addEventListener('storage', (e) => {
  if (e.key !== `${PREFIX}prefs`) return;
  prefs = loadPrefs();
  newsBar.setOpen(prefs.newsOpen);
  refresh();
});

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
  if (clockChecked === 'pending') return 'Clock check: running (it takes a few seconds).';
  if (clockChecked === 'unreliable') return "Clock check: the server's time could not be read reliably here (a cache in between gave inconsistent answers), so times use this device's clock as it is.";
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
// Share always passes the canonical address, wherever the page was opened: the device's share sheet
// when there is one; otherwise, or if it fails, the link is copied. Closing the sheet does nothing.
byId('share').addEventListener('click', async () => {
  const url = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? 'https://radmagelabs.com/d4/';
  const data = { title: document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content ?? document.title, url };
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try { await navigator.share(data); return; } catch (e) { if (e instanceof Error && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast(null, 'Link copied', url); } catch { toast(null, 'Copy this link', url); }
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

function toast(kind: EventKind | null, title: string, body: string): void {
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
    if (prefs.reminderSound) playChime();
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
  const done = doneKinds(statuses);
  for (const st of statuses) {
    cards.get(st.kind)?.update(st, c, {
      isNext: soonest?.kind === st.kind,
      checkedDaysAgo: daysSince(st.definition.checkedOn, c.nowMs),
      sightings: timingSummary(allSightings, st.definition.segments, st.kind),
      anchorProgress: anchorProgress(anchorEvidence(allSightings, st.definition.segments, st.kind)),
      orders: orderNotes(st.kind, c.nowMs, c.timeZone),
      laterNotes: laterNotes(st),
      laterPredictions: laterPredictions(st, c.nowMs),
      lastNote: lastNote(st, c.nowMs),
      extra: extraNote(st),
      done: done.has(st.kind),
      starred: prefs.starred[st.kind],
    });
  }
  strip?.update(shown, done);
  timeline.update(shown, c, {
    choice: prefs.comingUp,
    hours: prefs.comingUpHours,
    notes: { all: expansionTimelineNote, one: (kind, startMs) => pickedTimelineNote(kind, startMs, c.nowMs) },
    done,
    starred: new Set(shown.map((s) => s.kind).filter((k) => prefs.starred[k])),
  });
  if (newsShown() && !news.loading && news.status !== 'unavailable' && Date.now() - news.checkedAt >= NEWS_REFRESH_MS) void loadNewsNow();
  newsBar.update({ status: news.loading && !news.items ? 'loading' : news.status, items: news.items, fetchedAt: news.fetchedAt }, c);
  season.update(c);
  sightingsPanel.update();
  map.update();
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

/** One same-origin HEAD request, with the device clock read around it. */
async function sampleClock(): Promise<ClockSample> {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.set('clock', String(Date.now()));
  const sentMs = Date.now();
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  return { sentMs, receivedMs: Date.now(), date: res.headers.get('Date'), age: res.headers.get('Age') };
}

// Clock check against this site's own server (same origin, nothing third-party). Once at load,
// every six hours, and after a resume (no sooner than minGapMs after the last one, never two at once).
async function checkClock(minGapMs = 0): Promise<void> {
  if (!location.protocol.startsWith('http')) { clockChecked = 'failed'; return; }
  if (clockInFlight || performance.now() - lastClockCheck < minGapMs) return;
  clockInFlight = true;
  lastClockCheck = performance.now();
  try {
    // Two readings a few seconds apart: only a header that moves with real time is trusted.
    const first = await sampleClock();
    await new Promise((done) => setTimeout(done, SAMPLE_GAP_MS));
    const second = await sampleClock();
    const estimate = estimateClock([first, second]);
    // An unreliable answer never moves the countdowns: the device clock is used as it is.
    clock = estimate;
    clockChecked = estimate ? 'done' : 'unreliable';
  } catch {
    if (!clock) clockChecked = 'failed';
  } finally {
    clockInFlight = false;
  }
  render();
}

applyPrefs();
primeOnGesture(() => prefs.reminderSound);
tick();
void checkClock();
window.setInterval(() => void checkClock(60000), 6 * 3600000);
