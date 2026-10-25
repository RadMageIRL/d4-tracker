// Browser checks on the production build, in headless Chrome. Run `npm run build` first.
//
// Serves dist/ under /d4-tracker/ (a GitHub Pages style project path) from a tiny local server
// whose Date header follows the same shifted clock as the page, then checks rollover, time zones,
// unknown states, reminders, settings, layouts and that no request leaves the site.
//
//   node tests/smoke.mjs            run the checks
//   node tests/smoke.mjs --shots D  also save screenshots into folder D

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './lib/cdp.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/index.html is missing: run `npm run build` first.');
  process.exit(1);
}
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

// The GitHub Pages project path, and the path radmagelabs.com will proxy. Both are served.
const BASES = ['/d4-tracker/', '/d4/'];
const BASE = BASES[0];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
// The server's idea of "now" = real time + serverShiftMs. Each check sets it to match the page.
let serverShiftMs = 0;
// How a cache in front of the server answers, with a copy stored CACHE_AGE_S before the mode was set:
//   'none'         no cache: the current Date, no Age
//   'cdn'          the current Date plus the copy's growing Age (GitHub Pages' CDN, measured live)
//   'standard'     the copy's original Date plus its growing Age (the standard behavior)
//   'stale'        the copy's original Date and no Age (a misbehaving cache)
//   'inconsistent' a Date that jumps by up to an hour on every answer, and a nonsense Age
let cacheMode = 'none';
let storedAt = null;
const CACHE_AGE_S = 120;
function setCache(mode) { cacheMode = mode; storedAt = null; }
const server = createServer((req, res) => {
  const now = Date.now() + serverShiftMs;
  if (storedAt === null) storedAt = now - CACHE_AGE_S * 1000;
  const ageS = String(Math.floor((now - storedAt) / 1000));
  const dateMs = { none: now, cdn: now, standard: storedAt, stale: storedAt, inconsistent: now + Math.round((Math.random() - 0.5) * 7200000) }[cacheMode];
  const date = new Date(dateMs).toUTCString();
  const age = { none: {}, cdn: { Age: ageS }, standard: { Age: ageS }, stale: {}, inconsistent: { Age: String(Math.floor(Math.random() * 1e6)) } }[cacheMode];
  const url = new URL(req.url, 'http://x');
  const base = BASES.find((b) => url.pathname.startsWith(b));
  if (!base) { res.writeHead(404, { Date: date }); res.end(); return; }
  let rel = normalize(decodeURIComponent(url.pathname.slice(base.length)) || 'index.html');
  if (rel.startsWith('..')) { res.writeHead(400, { Date: date }); res.end(); return; }
  let file = join(root, rel);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404, { Date: date }); res.end(); return; }
  res.writeHead(200, { Date: date, ...age, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const appUrl = origin + BASE;

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = await launchChrome();

/** A fresh page whose clock reads `at` on load, with optional saved prefs and time zone. */
async function open(at, { prefs, timezone, width = 1440, height = 900, mobile = false, serverSkewMs = 0, before } = {}) {
  const page = await chrome.newPage();
  await page.viewport(width, height, mobile);
  if (timezone) await page.emulate({ timezone, locale: 'en-US' });
  else await page.emulate({ locale: 'en-US' });
  serverShiftMs = Date.parse(at) - Date.now() + serverSkewMs;
  await page.startClockAt(Date.parse(at));
  if (prefs) await page.beforeLoad(`localStorage.setItem('d4-tracker:v1:prefs', ${JSON.stringify(JSON.stringify(prefs))});`);
  if (before) await page.beforeLoad(before);
  await page.goto(appUrl);
  await page.waitFor("document.querySelector('.event .big') && document.querySelector('.event .big').textContent !== '--:--'");
  return page;
}

const text = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '')`;
/** Select a region on the radar (its events), then open its places and chest spots. */
async function openPlaces(page, name) {
  await page.eval(`[...document.querySelectorAll('.atlas-region')].find(x => x.getAttribute('aria-label').startsWith('${name}')).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await page.eval(`[...document.querySelectorAll('.map-info button')].find(b => b.textContent === 'Places and chest spots').click()`);
}
// The shared sightings in data/ grow as real ones are added, so expectations are computed from them.
const SHARED = JSON.parse(readFileSync(new URL('../data/observations.json', import.meta.url), 'utf8')).observations;
const sharedStarts = (event) => SHARED.filter((o) => o.event === event && o.timing === 'start' && o.provenance !== 'reported')
  .map((o) => new Date(o.at).toISOString());
/** The card's progress line toward confirming a start time, for these matched starts (distinct, by day). */
function progressText(starts) {
  const s = new Set(starts);
  const days = new Set([...s].map((x) => x.slice(0, 10)));
  return `${Math.min(s.size, 3)} of 3 matching in-game starts, on ${Math.min(days.size, 2)} of 2 days`;
}
const wbBlock = text('#sightings-panel .sight-summary > div:first-child');
const card = (kind, sel) => text(`.event[data-kind="${kind}"] ${sel}`);

try {
  // 1. Helltide rollover: 2 s before the hour it is waiting, then it turns active with 55 min left.
  {
    const page = await open('2026-10-24T14:59:58Z', { timezone: 'UTC' });
    const before = { pill: await page.eval(card('helltide', '.pill')), big: await page.eval(card('helltide', '.big')) };
    check('helltide waits before the hour', before.pill === 'Soon' && /^0:0[12]$/.test(before.big), JSON.stringify(before));
    await page.waitFor(`${card('helltide', '.pill')} === 'Active'`, 5000).catch(() => {});
    const after = { pill: await page.eval(card('helltide', '.pill')), big: await page.eval(card('helltide', '.big')) };
    check('helltide turns active on the hour', after.pill === 'Active' && /^5[45]:\d\d$/.test(after.big), JSON.stringify(after));
    await sleep(150);
    const bar = await page.eval(`(() => { const b = document.querySelector('.event[data-kind="helltide"] .progress > span');
      return b.getBoundingClientRect().width / b.parentElement.getBoundingClientRect().width; })()`);
    check('progress bar starts empty at the rollover, without sliding back', bar < 0.05, `fraction ${bar}`);
    const label = await page.eval(card('helltide', '.big-label'));
    check('helltide end time is :55', label.includes('3:55'), label);
    const wb = await page.eval(card('worldBoss', '.big-label'));
    check('world boss next spawn 18:00 UTC', /6:00\s?PM/.test(wb), wb);
    const lastWb = await page.eval(`[...document.querySelectorAll('.event[data-kind="worldBoss"] dd')].map(d => d.textContent).join('|')`);
    check('world boss last spawn 14:30 UTC, about 30 min ago', /2:30\s?PM \((29|30) min ago\)/.test(lastWb), lastWb);
    const unknowns = await page.eval(`[...document.querySelectorAll('.facts dd.unknown')].map(d => d.firstChild.textContent)`);
    const shownUnknowns = await page.eval(`[...document.querySelectorAll('.facts dd.unknown')].filter(d => d.checkVisibility()).length`);
    check('no Unknown row is shown: the World Boss arena row waits out of sight', unknowns.length === 1 && shownUnknowns === 0
      && await page.eval(`[...document.querySelectorAll('.event[data-kind="worldBoss"] .facts dt')].find(d => d.textContent === 'Location').hidden`), `${JSON.stringify(unknowns)} shown ${shownUnknowns}`);
    const legionBox = await page.eval(`(() => { const d = document.querySelector('.event[data-kind="legion"] details.candidates'); if (!d) return null;
      const li = [...d.querySelectorAll('li')]; return { open: d.open, summary: d.querySelector('summary').textContent, items: li.map(x => x.textContent).join(' | '),
      shown: li[0].checkVisibility(), row: d.closest('dd').textContent.startsWith(d.querySelector('summary').textContent) }; })()`);
    check('the Legion card shows "4 candidates · predicted", folded', !!legionBox && !legionBox.open && !legionBox.shown && legionBox.summary === '4 candidates · predicted' && legionBox.row, JSON.stringify(legionBox));
    check('and folds the next Legion\'s group: group A for 15:20', legionBox?.items === "Kor Dragan, Fractured Peaks | Carrowcrest Ruins, Scosglen | Dilapidated Aqueducts, Kehjistan | Alcarnus, Kehjistan", legionBox?.items);
    const legionOpened = await page.eval(`(() => { const d = document.querySelector('.event[data-kind="legion"] details.candidates'); d.open = true; const s = d.querySelector('li').checkVisibility(); d.open = false; return s; })()`);
    check('opening it shows the sites', legionOpened === true, String(legionOpened));
    check('the Legion countdown stays the big number', /^\d+:\d\d$/.test(await page.eval(card('legion', '.big'))), await page.eval(card('legion', '.big')));
    const helltideRegion = await page.eval(`[...document.querySelectorAll('.event[data-kind="helltide"] .facts dt')].find(d => d.textContent === 'Region')?.nextElementSibling?.textContent ?? ''`);
    check('the Helltide in progress shows its predicted region', helltideRegion === 'Scosglen · predicted', helltideRegion);
    const predicted = await page.eval(`[...document.querySelectorAll('.event[data-kind="worldBoss"] .facts dd.basis-predicted')].map(d => d.textContent)`);
    check('the next World Boss shows the predicted boss, labeled predicted, and no predicted arena', predicted.length === 1 && predicted[0] === 'Azmodan · predicted', JSON.stringify(predicted));
    const laterList = await page.eval(`[...document.querySelectorAll('.event[data-kind="worldBoss"] .next-list li')].map(li => li.textContent).join(' | ')`);
    check('the later spawns stay short: times, and "two bosses" on a double spawn', laterList === '9:30 PM | 1:00 AM Tomorrow · two bosses | 4:30 AM Tomorrow', laterList);
    const folded = await page.eval(`(() => { const d = document.querySelector('.event[data-kind="worldBoss"] details.later-predictions');
      return d ? { hidden: d.hidden, open: d.open, summary: d.querySelector('summary').textContent, items: [...d.querySelectorAll('li')].map(li => li.textContent),
        itemShown: d.querySelector('li').checkVisibility() } : null; })()`);
    check('later predictions are folded away under a disclosure', !!folded && !folded.hidden && !folded.open && !folded.itemShown && folded.summary === 'Later predictions', JSON.stringify(folded));
    const opened = await page.eval(`(() => { const d = document.querySelector('.event[data-kind="worldBoss"] details.later-predictions'); d.open = true;
      const shown = d.querySelector('li').checkVisibility(); d.open = false; return shown; })()`);
    check('opening it shows them', opened === true, String(opened));
    check('and list each later spawn\'s predicted boss', JSON.stringify(folded?.items) === JSON.stringify([
      '9:30 PM · Azmodan', '1:00 AM Tomorrow · Wandering Death', '4:30 AM Tomorrow · Wandering Death']), JSON.stringify(folded?.items));
    const helltideLater = await page.eval(`[...document.querySelectorAll('.event[data-kind="helltide"] details.later-predictions li')].map(li => li.textContent).join(' | ')`);
    check('the Helltide card folds its later predictions away too, expansion regions included', helltideLater === '5:00 PM · Kehjistan | 6:00 PM · Hawezar and Nahantu | 7:00 PM · Fractured Peaks', helltideLater);
    const legionLater = await page.eval(`[...document.querySelectorAll('.event[data-kind="legion"] details.later-predictions li')].map(li => li.textContent).join(' | ')`);
    check('the Legion card folds later Legions\' groups away, alternating', legionLater === '3:45 PM · 4 candidates: Hawezar, Dry Steppes | 4:10 PM · 4 candidates: Fractured Peaks, Scosglen, Kehjistan | 4:35 PM · 4 candidates: Hawezar, Dry Steppes', legionLater);
    const rows = await page.eval(`[...document.querySelectorAll('.facts dd.unknown')].map(d => ({
      hint: d.querySelector('.hint').textContent, reason: d.title, height: d.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(d).lineHeight) }))`);
    check('each Unknown has a short hint and its full reason on hover', rows.every((r) => r.hint.startsWith(' · ') && r.reason.length > 30), JSON.stringify(rows));
    check('each Unknown takes one line', rows.every((r) => r.height <= r.line * 1.2), JSON.stringify(rows.map((r) => [r.height, r.line])));
    const about = await page.eval(`document.querySelector('.event[data-kind="worldBoss"] details.about').textContent`);
    check('About says where the World Boss prediction comes from and until when', about.includes('Boss: Predicted') && about.includes('Pinned to a spawn on Oct 24, 2026, predicted through Oct 31, 2026'), about.slice(-700));
    check('an inferred start time shows what confirms it', about.includes(progressText(sharedStarts('worldBoss'))), about.slice(0, 400));
    const link = await page.eval(`[...document.querySelectorAll('footer a')].map(a => a.href)`);
    check('footer links to radmagelabs.com', link.includes('https://radmagelabs.com/'), JSON.stringify(link));
    await page.waitFor("document.querySelector('#clock-sub').textContent.includes('UTC')");
    const external = page.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:'));
    check('no request leaves the site', external.length === 0, JSON.stringify(external));
    check('no page errors', page.problems.length === 0, JSON.stringify(page.problems));
    if (shots) await page.screenshot(join(shots, 'desktop.png'), true);
  }

  // 2. Time zones: the same instant in Kolkata (UTC+5:30) and New York.
  {
    const page = await open('2026-10-24T14:10:00Z', { timezone: 'Asia/Kolkata' });
    const next = await page.eval(card('helltide', '.facts dd'));
    check('Kolkata sees the next Helltide at 8:30 PM', /8:30\s?PM/.test(next), next);
    const wb = await page.eval(card('worldBoss', '.big-label'));
    check('Kolkata sees the World Boss at 8:00 PM', /8:00\s?PM/.test(wb), wb);
    const sub = await page.eval(text('#clock-sub'));
    check('Kolkata clock names its zone', /GMT\+5:30|IST/.test(sub), sub);
  }
  {
    const page = await open('2026-10-24T14:10:00Z', { timezone: 'America/New_York', prefs: { zone: 'utc', clock: '24h' } });
    const wb = await page.eval(card('worldBoss', '.big-label'));
    check('UTC view in 24 h shows the next World Boss at 14:30', wb.includes('14:30'), wb);
  }

  // 3. Clock check: a server 30 s ahead of the device is detected and corrected.
  {
    const page = await open('2026-10-24T14:59:00Z', { timezone: 'UTC', serverSkewMs: 30000 });
    await page.waitFor("document.querySelector('#clock-sub').textContent.includes('corrected')", 9000).catch(() => {});
    const sub = await page.eval(text('#clock-sub'));
    check('clock correction is shown', sub.includes('corrected'), sub);
    const big = await page.eval(card('helltide', '.big'));
    // Device says 14:59:00+, corrected time is 14:59:30+, so about 0:30 is left.
    check('countdown uses the corrected clock', /^0:(2\d|30)$/.test(big), big);
  }

  // 3b. Behind a cache. A right clock is never "corrected" whichever way the cache treats Date
  // (GitHub Pages' CDN sends the current Date with Age; v0.2.0 added the Age and shifted every
  // countdown by it). A wrong clock is still caught behind both well-behaved kinds. Stale and
  // inconsistent answers are refused and never move the countdowns.
  const clockLine = async (page) => {
    await page.waitFor("!document.getElementById('settings').open && true");
    await sleep(6500); // a check takes two readings 5 s apart
    await page.eval("document.getElementById('settings-open').click()");
    const line = (await page.eval("document.getElementById('settings').textContent")).match(/Clock check:[^.]*\./)?.[0] ?? '';
    await page.eval("document.getElementById('settings').close()");
    return line;
  };
  for (const mode of ['none', 'cdn', 'standard']) {
    setCache(mode);
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC' });
    const line = await clockLine(page);
    check(`cache "${mode}": a right clock is left alone`, line.includes('agrees with the server'), line);
  }
  for (const [mode, skew] of [['cdn', 30000], ['standard', -30000]]) {
    setCache(mode);
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', serverSkewMs: skew });
    const line = await clockLine(page);
    // Date + Age has two seconds of resolution, so the smallest fitting correction can be 28 s.
    check(`cache "${mode}": a clock 30 s ${skew > 0 ? 'slow' : 'fast'} is still corrected`, /about (2[89]|3[0-2]) s/.test(line), line);
  }
  for (const [mode, skew] of [['stale', 0], ['stale', 45000], ['inconsistent', 0]]) {
    setCache(mode);
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', serverSkewMs: skew });
    const line = await clockLine(page);
    const sub = await page.eval(text('#clock-sub'));
    check(`cache "${mode}"${skew ? ' with the clock 45 s off' : ''}: refused, no correction`, line.includes('could not be read reliably') && !sub.includes('corrected'), `${line} | ${sub}`);
  }
  setCache('none');

  // 4. Reminders: a 5-minute Legion reminder fires as a toast and a system notification.
  {
    await chrome.grantNotifications(origin);
    const record = `(() => { const Real = window.Notification; window.__notes = [];
      class Spy extends Real { constructor(t, o) { super(t, o); window.__notes.push(t); } }
      Object.defineProperty(Spy, 'permission', { get: () => Real.permission });
      Spy.requestPermission = (...a) => Real.requestPermission(...a);
      window.Notification = Spy; })();`;
    const page = await open('2026-10-24T15:14:58Z', {
      timezone: 'UTC', prefs: { reminders: { legion: [5] }, systemNotifications: true }, before: record,
    });
    await page.waitFor("document.querySelector('.toast')", 6000).catch(() => {});
    const toast = await page.eval(text('.toast'));
    check('legion reminder toast at 15:15', /Legion starts in 5 min/.test(toast), toast);
    const notes = await page.eval('window.__notes');
    check('system notification sent once', notes.length === 1 && /Legion/.test(notes[0]), JSON.stringify(notes));
    await sleep(1500);
    check('no duplicate toast', (await page.eval("document.querySelectorAll('.toast').length")) === 1);
  }

  // 5. Settings: compact toggle persists, hiding a card works, light theme applies before paint.
  {
    const page = await open('2026-10-24T15:00:00Z', { timezone: 'UTC' });
    await page.eval("document.getElementById('compact-toggle').click()");
    const saved = await page.eval("JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).compact");
    check('compact is saved', saved === true);
    await page.reload();
    await page.waitFor("document.querySelector('.event .big').textContent !== '--:--'");
    check('compact survives a reload', await page.eval("document.documentElement.classList.contains('compact')"));
    check('compact hides the map', await page.eval("getComputedStyle(document.getElementById('lower')).display === 'none'"));
    await page.viewport(900, 900);
    const tallest = await page.eval("Math.max(...[...document.querySelectorAll('.event')].map(e => e.getBoundingClientRect().height))");
    check('compact cards stay short in a tall window', tallest < 170, `${Math.round(tallest)} px`);
    if (shots) { await page.viewport(900, 260); await page.screenshot(join(shots, 'compact.png'), true); }
    await page.eval("document.getElementById('settings-open').click()");
    check('settings dialog opens', await page.eval("document.getElementById('settings').open"));
    await page.eval(`[...document.querySelectorAll('#settings label.chip')].find(l => l.textContent === 'Legion').querySelector('input').click()`);
    check('hiding Legion hides its card', await page.eval(`document.querySelector('.event[data-kind="legion"]').hidden`));
  }
  // 5b. The reminder choices, and the player's own "done" mark. The next-event strip is off.
  {
    const page = await open('2026-10-24T15:00:00Z', { timezone: 'UTC', prefs: {} });
    check('no next-event strip above the cards', await page.eval("!document.querySelector('.next-strip')"));
    await page.eval("document.getElementById('settings-open').click()");
    const leads = await page.eval(`[...document.querySelectorAll('#settings fieldset')].find(f => f.querySelector('legend').textContent === 'Reminders').textContent`);
    check('reminders offer 15, 10 and 5 minutes before the World Boss, Legion and Helltide, and a sound',
      (leads.match(/15 min before10 min before5 min before/g) ?? []).length === 3 && leads.includes('When it begins') && leads.includes('Play a sound with each reminder')
      && leads.includes('not guaranteed'), leads.slice(0, 300));
  }
  {
    const page = await open('2026-10-24T15:25:00Z', { timezone: 'UTC', prefs: {} });
    const btn = `document.querySelector('.event[data-kind="legion"] .done-toggle')`;
    check('the Legion card offers "Mark done" on its last start', (await page.eval(`${btn}.textContent`)) === 'Mark done');
    await page.eval(`${btn}.click()`);
    const last = await page.eval(`[...document.querySelectorAll('.event[data-kind="legion"] .facts dt')].find(d => d.textContent === 'Last').nextElementSibling.textContent`);
    check('marked: the last start says it was marked by you, with Undo', /^3:20 PM \(5 min ago\) · done, marked by youUndo$/.test(last), last);
    const rows = () => page.eval(`[...document.querySelectorAll('#timeline-panel li')].map(li => li.dataset.kind + (li.classList.contains('done') ? '*' : '')).join()`);
    const dimmed = await rows();
    check('Coming up dims the Legion rows, and only those', dimmed.split(',').every((r) => r.startsWith('legion') === r.endsWith('*')) && dimmed.includes('legion*'), dimmed);
    check('the mark is the 15:20 start, kept in the settings', (await page.eval(`JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).done.legion`)) === Date.parse('2026-10-24T15:20:00Z'));
    check('the World Boss is not marked', (await page.eval(`document.querySelector('.event[data-kind="worldBoss"] .done-toggle').textContent`)) === 'Mark done');
    await page.eval(`(() => { const prev = Date.now; Date.now = () => prev() + ${20 * 60000 + 1000}; })()`);
    await page.waitFor(`${btn}.textContent === 'Mark done'`, 6000).catch(() => {});
    check('the next Legion start clears the mark by itself', (await page.eval(`${btn}.textContent`)) === 'Mark done' && !(await rows()).includes('*'), await rows());
  }
  // 5c. Stars, Coming up's Starred list, another window kept in step, and Add to calendar.
  {
    // Calendar downloads are caught instead of saved: the anchor's file name and the file's text.
    const catchFiles = `(() => { window.__files = []; const make = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return make(b); };
      const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {
        if (this.download) { window.__files.push({ name: this.download, blob: window.__blob }); return; } return click.call(this); }; })();`;
    const lastFile = "(() => { const f = window.__files.at(-1); return f ? f.blob.text().then(text => ({ name: f.name, text })) : null; })()";
    const a = await open('2026-10-24T15:00:00Z', { timezone: 'UTC', prefs: {}, before: catchFiles });
    const star = (kind) => `document.querySelector('.event[data-kind="${kind}"] .star-btn')`;
    const pick = (p) => a.eval(`document.querySelector('.tl-picks [data-pick="${p}"]').click()`);
    const kinds = (page) => page.eval(`[...new Set([...document.querySelectorAll('#timeline-panel li')].map(li => li.dataset.kind))].join()`);
    check('each card has a star, off, labeled and not pressed', (await a.eval(`[...document.querySelectorAll('.star-btn')].map(b => b.textContent + b.getAttribute('aria-pressed') + b.getAttribute('aria-label')).join('|')`))
      === '☆falseStar Helltide|☆falseStar World Boss|☆falseStar Legion');
    check('the stars add no height to the cards\' heads', (await a.eval(`[...document.querySelectorAll('.event-head')].every(e => e.getBoundingClientRect().height <= e.querySelector('.pill').getBoundingClientRect().height + 1)`)));
    await pick('starred');
    check('Starred with nothing starred says how to star', (await a.eval(text('#timeline-panel .help'))).startsWith('Nothing starred yet.')
      && (await a.eval("document.querySelectorAll('#timeline-panel li').length")) === 0 && (await a.eval("document.querySelector('.tl-calendar').hidden")));
    // A second window, as the pop-out opens it: it takes the saved settings and follows changes.
    const b = await open('2026-10-24T15:00:00Z', { timezone: 'UTC' });
    await b.goto('about:blank');
    await b.goto(`${appUrl}#compact`);
    await b.waitFor("document.querySelector('.event .big') && document.querySelector('.event .big').textContent !== '--:--'");
    await a.eval(`${star('worldBoss')}.click()`);
    check('starring presses the star', (await a.eval(`${star('worldBoss')}.textContent + ${star('worldBoss')}.getAttribute('aria-pressed')`)) === '★true');
    check('Starred lists the World Boss alone, six hours ahead by default', (await kinds(a)) === 'worldBoss' && (await a.eval("document.querySelector('.tl-hours').value")) === '6');
    await b.waitFor(`${star('worldBoss')}.getAttribute('aria-pressed') === 'true'`, 5000).catch(() => {});
    check('the pop-out window follows the star', (await b.eval(`${star('worldBoss')}.getAttribute('aria-pressed')`)) === 'true');
    await b.eval(`${star('legion')}.click()`);
    await a.waitFor(`${star('legion')}.getAttribute('aria-pressed') === 'true'`, 5000).catch(() => {});
    check('and a star set in the pop-out shows in the main window', (await a.eval(`${star('legion')}.getAttribute('aria-pressed')`)) === 'true');
    check('Starred then lists the World Boss and Legion', (await kinds(a)) === 'legion,worldBoss', await kinds(a));
    check('stars leave reminders alone', JSON.stringify(await a.eval(`JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).reminders`)) === '{"worldBoss":[],"legion":[],"helltide":[]}');
    await a.eval("document.querySelector('.tl-calendar').click()");
    const starredFile = await a.eval(lastFile);
    check('Add to calendar in Starred saves the starred starts', starredFile?.name === 'd4-starred.ics' && !/Helltide/.test(starredFile.text)
      && /SUMMARY:Diablo IV: World Boss/.test(starredFile.text) && /SUMMARY:Diablo IV: Legion/.test(starredFile.text), starredFile?.name);
    // The second window seeds no settings of its own, so a reload there reads only what was saved.
    await b.reload();
    await b.waitFor("document.querySelector('.event .big') && document.querySelector('.event .big').textContent !== '--:--'");
    check('stars and the Starred pick survive a reload', (await b.eval(`[...document.querySelectorAll('.star-btn')].map(b => b.getAttribute('aria-pressed')).join()`)) === 'false,true,true'
      && (await b.eval(`document.querySelector('.tl-picks [data-pick="starred"]').getAttribute('aria-pressed')`)) === 'true');
    await pick('worldBoss');
    await a.eval("document.querySelector('.tl-calendar').click()");
    const wb = await a.eval(lastFile);
    const events = (wb?.text.match(/BEGIN:VEVENT/g) ?? []).length;
    check('Add to calendar with World Boss picked: its 7 spawns, each a 15-minute block with its predicted boss and a 10-minute reminder',
      wb?.name === 'd4-world-boss.ics' && events === 7 && (wb.text.match(/TRIGGER:-PT10M/g) ?? []).length === 7
      && /DTSTART:20261024T180000Z\r\nDTEND:20261024T181500Z/.test(wb.text) && /DESCRIPTION:Predicted: \S/.test(wb.text), `${wb?.name} ${events}`);
    check('and says the file was saved', /d4-world-boss\.ics has 7 events/.test(await a.eval(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')`)));
    await pick('helltide');
    await a.eval("document.querySelector('.tl-calendar').click()");
    const ht = await a.eval(lastFile);
    check('a Helltide is its 55-minute window', ht?.name === 'd4-helltide.ics' && /DTSTART:20261024T160000Z\r\nDTEND:20261024T165500Z/.test(ht.text), ht?.name);
    await a.eval(`${star('worldBoss')}.click()`);
    await a.eval(`${star('legion')}.click()`);
    await pick('starred');
    check('unstarring everything brings back the empty Starred list', (await a.eval(text('#timeline-panel .help'))).startsWith('Nothing starred yet.'));
  }
  {
    const page = await open('2026-10-24T15:00:00Z', { prefs: { theme: 'light' } });
    check('light theme applied', (await page.eval("document.documentElement.dataset.theme")) === 'light');
    if (shots) await page.screenshot(join(shots, 'light.png'), true);
  }

  // 5b. The active event breathes; reduced motion stops the animation. The tab title counts down.
  {
    const page = await open('2026-10-24T15:00:00Z', { timezone: 'UTC' });
    const anim = (kind) => `getComputedStyle(document.querySelector('.event[data-kind="${kind}"]')).animationName`;
    check('active Helltide card breathes', (await page.eval(anim('helltide'))) === 'breathe');
    check('waiting cards do not', (await page.eval(anim('worldBoss'))) === 'none');
    check('the soonest event is outlined', await page.eval(`document.querySelector('.event[data-kind="legion"]').classList.contains('is-next')`));
    const title = await page.eval('document.title');
    check('tab title counts down to the next event', /^Legion (20:00|19:5\d) - Diablo IV Tracker$/.test(title), title);
    await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    check('reduced motion: no breathing', (await page.eval(anim('helltide'))) === 'none');
    check('reduced motion: still outlined', (await page.eval(`getComputedStyle(document.querySelector('.event[data-kind="helltide"]')).boxShadow`)) !== 'none');
  }

  // 5c. Time zone changed while the page is open (travel, or a system setting).
  {
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'America/New_York' });
    const before = await page.eval(card('worldBoss', '.big-label'));
    check('New York sees the World Boss at 2:00 PM', /2:00\s?PM/.test(before), before);
    await page.setTimezone('Asia/Tokyo');
    await page.waitFor(`/3:00\\s?AM/.test(${card('worldBoss', '.big-label')})`, 4000).catch(() => {});
    const after = await page.eval(card('worldBoss', '.big-label'));
    // 18:00 UTC is 3:00 AM on the 25th in Tokyo, the same Tokyo day as 15:10 UTC (00:10 on the 25th).
    check('after switching to Tokyo it shows 3:00 AM today, without a reload', /3:00\s?AM$/.test(after), after);
  }

  // 5d. Sleep and wake: two hours pass with no ticks. Countdowns jump to the right values, stale
  // reminders are dropped, and the clock is checked again.
  {
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', prefs: { reminders: { legion: [5] } } });
    const clockRequests = () => page.requests.filter((u) => u.includes('clock=')).length;
    await page.waitFor("document.querySelector('#clock-sub').textContent.includes('UTC')");
    await sleep(7000); // past the first check (two readings 5 s apart) and the gap between checks
    const before = clockRequests();
    serverShiftMs += 2 * 3600000;
    await page.eval(`(() => { const prev = Date.now; Date.now = () => prev() + ${2 * 3600000}; })()`);
    await sleep(1600);
    const big = await page.eval(card('legion', '.big'));
    check('after waking, Legion counts to 17:25', /^1[45]:\d\d$/.test(big), big);
    check('no stale reminders fire after waking', (await page.eval("document.querySelectorAll('.toast').length")) === 0);
    check('the clock is checked again after waking', clockRequests() > before, `${before} -> ${clockRequests()}`);
  }

  // 5e. The system clock jumps 30 s (a time sync) while the server stays put: detected and corrected.
  {
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC' });
    await sleep(7000); // past the first check (two readings 5 s apart) and the gap between checks
    await page.eval(`(() => { const prev = Date.now; Date.now = () => prev() + 30000; })()`);
    await page.waitFor("document.querySelector('#clock-sub').textContent.includes('corrected')", 9000).catch(() => {});
    check('a clock jump is detected and corrected', (await page.eval(text('#clock-sub'))).includes('corrected'));
    const big = await page.eval(card('legion', '.big'));
    check('countdown follows the server, not the jumped clock', /^9:[45]\d$/.test(big), big);
  }

  // 5f. Sightings: log one, keep it across a reload, import a file, refuse the same file twice.
  {
    const page = await open('2026-10-24T18:20:00Z', { timezone: 'UTC', prefs: { zone: 'utc' } });
    await page.eval(`document.querySelector('.event[data-kind="legion"] .log-link').click()`);
    check('a card link opens the form for that event', (await page.eval("document.getElementById('sighting-dialog').open && document.getElementById('sight-event').value")) === 'legion');
    await page.eval("document.getElementById('sighting-dialog').close()");
    await page.eval("document.getElementById('log-open').click()");
    check('the header button opens the sighting form', await page.eval("document.getElementById('sighting-dialog').open"));
    await page.eval(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
      set('sight-event', 'worldBoss'); set('sight-date', '2026-10-24'); set('sight-time', '18:00');
      set('sight-timing', 'start'); set('sight-boss', 'Avarice'); set('sight-region', 'scosglen'); set('sight-place', 'Caen Adar');
      document.querySelector('#sighting-dialog form').requestSubmit();
    })()`);
    await sleep(300);
    const status = await page.eval(text('#sightings-panel .status-line'));
    check('logging a sighting confirms it', /Logged: World Boss at 6:00\s?PM/.test(status), status);
    const n = sharedStarts('worldBoss').length + 1;
    const summary = await page.eval(wbBlock);
    check('a sighting on the schedule agrees', summary.includes(`Start times: ${n} of ${n} agree with the schedule.`), summary.slice(0, 200));
    const about = await page.eval(`document.querySelector('.event[data-kind="worldBoss"] details.about').textContent`);
    check('the card reports the sighting', about.includes(`Your sightings: ${n} of ${n} agree`), about.slice(-200));
    await page.reload();
    await page.waitFor("document.querySelector('.event .big').textContent !== '--:--'");
    check('sightings survive a reload', (await page.eval(wbBlock)).includes(`${n} of ${n} agree`));
    const fixture = fileURLToPath(new URL('./fixtures/sightings-import.json', import.meta.url));
    await page.setFiles('#sightings-panel input[type=file]', [fixture]);
    await page.waitFor(`${text('#sightings-panel .status-line')}.startsWith('Imported')`, 4000).catch(() => {});
    const first = await page.eval(text('#sightings-panel .status-line'));
    check('importing a file adds its sightings', first.startsWith('Imported 2, skipped 0'), first);
    const flagged = await page.eval(text('#sightings-panel .sight-summary'));
    check('a sighting 11 minutes off the schedule is flagged', flagged.includes('11 min after the nearest calculated start'), flagged.slice(0, 400));
    const expected = progressText([...sharedStarts('worldBoss'), '2026-10-24T18:00:00.000Z', '2026-10-24T14:30:00.000Z']);
    check('progress toward confirming the World Boss start time is shown (distinct starts, by day)',
      flagged.includes(`Start time confirmation: ${expected}`), `${expected} / ${flagged.slice(0, 500)}`);
    check('places seen are listed as existing, apart from any order',
      ['Places seen in game (each sighting confirms the place exists): ', 'Saraan Caldera (1)', 'Caen Adar (1)'].every((s) => flagged.includes(s)), flagged.slice(0, 600));
    await page.setFiles('#sightings-panel input[type=file]', [fixture]);
    await page.waitFor(`${text('#sightings-panel .status-line')}.includes('skipped 2')`, 4000).catch(() => {});
    const second = await page.eval(text('#sightings-panel .status-line'));
    check('importing the same file again adds nothing', second.startsWith('Imported 0, skipped 2'), second);
    await page.eval(`[...document.querySelectorAll('#sightings-panel button')].find(b => b.textContent === 'Export').click()`);
    await sleep(300);
    const exported = await page.eval(text('#sightings-panel .status-line'));
    check('export works under the CSP', exported === 'Exported 3 sightings.', exported);
    check('no CSP violations on the sightings page', !page.problems.some((p) => /Content Security Policy|Refused/i.test(p)), JSON.stringify(page.problems));
    check('sightings pages make no outside requests', page.requests.every((u) => u.startsWith(origin) || u.startsWith('blob:') || u.startsWith('data:')));
  }

  // 5g. The pop-out window is compact without changing the saved preference.
  {
    const page = await chrome.newPage();
    serverShiftMs = 0; // this page runs on the real clock
    await page.viewport(760, 200);
    await page.goto(`${appUrl}#compact`);
    await page.waitFor("document.querySelector('.event .big').textContent !== '--:--'");
    check('pop-out is compact', await page.eval("document.documentElement.classList.contains('compact') && document.documentElement.classList.contains('popout')"));
    check('pop-out hides its own buttons', await page.eval("getComputedStyle(document.getElementById('popout-open')).display === 'none'"));
    const saved = await page.eval("localStorage.getItem('d4-tracker:v1:prefs')");
    check('pop-out does not save compact', saved === null || JSON.parse(saved).compact !== true, saved);
    check('pop-out fits a 200 px window without scrolling', await page.eval('document.documentElement.scrollHeight <= innerHeight'));
    check('pop-out hides the log button', await page.eval("getComputedStyle(document.getElementById('log-open')).display === 'none'"));
    if (shots) await page.screenshot(join(shots, 'popout.png'));
    await page.viewport(400, 300);
    await sleep(200);
    const fit = await page.eval('[document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth]');
    check('a narrow pop-out (400 x 300) stacks rows without scrolling', fit[0] <= fit[1] && fit[2] <= fit[3], JSON.stringify(fit));
    if (shots) await page.screenshot(join(shots, 'popout-narrow.png'));
  }

  // 5h. Under the proposed radmagelabs.com path: /d4/ (served the way the proxy will present it).
  {
    const page = await chrome.newPage();
    serverShiftMs = 0;
    await page.viewport(1440, 900);
    await page.goto(`${origin}/d4/`);
    await page.waitFor("document.querySelector('.event .big') && document.querySelector('.event .big').textContent !== '--:--'");
    await page.waitFor("document.querySelector('#clock-sub').textContent.includes('UTC')");
    await sleep(500);
    const clockReq = page.requests.find((u) => u.includes('clock='));
    check('under /d4/ the clock check asks /d4/ itself', !!clockReq && new URL(clockReq).pathname === '/d4/', clockReq);
    check('under /d4/ nothing fails to load', page.problems.length === 0, JSON.stringify(page.problems));
    const links = await page.eval(`[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))`);
    check('every link is absolute (https) or in-page, so any base path works', links.every((h) => /^https:\/\//.test(h) || h.startsWith('blob:') || h.startsWith('#')), JSON.stringify(links.filter((h) => !/^https:/.test(h))));
    const canonical = await page.eval(`document.querySelector('link[rel=canonical]')?.href`);
    check('the canonical address is radmagelabs.com/d4/', canonical === 'https://radmagelabs.com/d4/', canonical);
  }

  // 5i. The Content-Security-Policy in the built page blocks any outside request.
  {
    const page = await chrome.newPage();
    await page.goto(appUrl);
    await page.waitFor("document.querySelector('.event .big') && document.querySelector('.event .big').textContent !== '--:--'");
    check('the built page carries a CSP', await page.eval(`!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
    // no-cors: without a CSP this resolves (an opaque response), so only the CSP can make it fail.
    const outside = await page.eval(`fetch('https://example.com/', { mode: 'no-cors' }).then(() => 'reached', () => 'blocked')`);
    check('the CSP blocks a request to another site', outside === 'blocked', outside);
    const sameOrigin = await page.eval(`fetch(location.href, { method: 'HEAD' }).then((r) => 'ok ' + r.status, () => 'blocked')`);
    check('the CSP still allows the clock check to its own address', sameOrigin === 'ok 200', sameOrigin);
    check('no outside request went out', page.requests.every((u) => u.startsWith(origin) || !/^https?:/.test(u)), JSON.stringify(page.requests.filter((u) => !u.startsWith(origin))));
  }

  // 6. Opened straight from disk (file://), with no web server.
  {
    const page = await chrome.newPage();
    await page.viewport(1440, 900);
    await page.goto(pathToFileURL(join(root, 'index.html')).href);
    await page.waitFor("document.querySelector('.event .big') && document.querySelector('.event .big').textContent !== '--:--'", 5000).catch(() => {});
    const big = await page.eval(card('helltide', '.big'));
    check('runs from file:// with no server', /^\d+:\d\d(:\d\d)?$/.test(big), big);
    check('file:// page has no errors', page.problems.length === 0, JSON.stringify(page.problems));
    const web = page.requests.filter((u) => /^https?:/.test(u));
    check('file:// page makes no network requests', web.length === 0, JSON.stringify(web));
    await page.eval("document.getElementById('settings-open').click()");
    const data = await page.eval("document.getElementById('settings').textContent");
    check('settings explain the clock check needs a server', data.includes('needs the page to come from a web server'), data.slice(-300));
  }

  // 7. Phone width: no sideways scrolling; the scalable overview and regional atlas stay usable.
  {
    // A first visit: no sightings left over from the earlier checks in this browser.
    const page = await open('2026-10-24T15:00:00Z', { width: 390, height: 844, mobile: true, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    const overflow = await page.eval('document.documentElement.scrollWidth - innerWidth');
    check('no horizontal scroll at 390 px', overflow <= 0, `overflow ${overflow}px`);
    const vb = await page.eval("document.querySelector('.map-svg').getAttribute('viewBox')");
    check('phone atlas uses a scalable overview', vb === '0 0 760 430', vb);
    await openPlaces(page, 'Fractured Peaks');
    check('phone can open a region\'s places and chest spots', await page.eval("document.querySelector('.regional-art') !== null"));
    await page.eval("document.querySelector('.atlas-back').click()");
    check('regional atlas return restores overview', await page.eval("document.querySelector('.atlas-overview') !== null"));
    await page.eval("[...document.querySelectorAll('.layers label')].find(x => x.textContent.includes('Waypoints')).querySelector('input').click()");
    check('marker layer toggles persist through region view', await page.eval("JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).layers.waypoint === false"));
    if (shots) await page.screenshot(join(shots, 'phone.png'), true);
  }

  // 8. v0.4: what was seen, the World Boss double spawn, Helltide regions and chest spots.
  const seed = (list) => `localStorage.setItem('d4-tracker:v1:observations', ${JSON.stringify(JSON.stringify(list))});`;
  const row = (kind, label) => `([...document.querySelectorAll('.event[data-kind="${kind}"] .facts dt')].find(d => d.textContent === '${label}')?.nextElementSibling?.textContent ?? '')`;
  const advance = (page, ms) => page.eval(`(() => { const prev = Date.now; Date.now = () => prev() + ${ms}; })()`);

  // 8a. Every fourth World Boss brings a second one in an expansion region (11:00 UTC on the 24th is one).
  {
    const page = await open('2026-10-24T09:00:00Z', { timezone: 'UTC', before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    const also = await page.eval(row('worldBoss', 'Also'));
    // Shown, not just present in the page: the line is hidden on ordinary spawns.
    const alsoShown = await page.eval(`(() => { const dt = [...document.querySelectorAll('.event[data-kind="worldBoss"] .facts dt')].find(d => d.textContent === 'Also');
      return !!dt && dt.offsetParent !== null && dt.nextElementSibling.offsetParent !== null; })()`);
    check('a double-spawn World Boss says a second one comes, as Inferred', alsoShown && also.includes('a second World Boss in an expansion region') && also.includes('Inferred'), also);
    check('the timeline marks the double spawn', (await page.eval(text('#timeline-panel'))).includes('World Boss spawns (two)'));
    const plain = await open('2026-10-24T05:00:00Z', { timezone: 'UTC', before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('an ordinary World Boss hides the Also line', await plain.eval(`[...document.querySelectorAll('.event[data-kind="worldBoss"] .facts dt')].find(d => d.textContent === 'Also').hidden`));
    if (shots) await page.screenshot(join(shots, 'v04-dashboard.png'), { height: 560 });
    await page.close();
    await plain.close();
  }

  // 8b. A boss logged for a spawn shows on the card as seen until that spawn is over, then on the Last line.
  {
    // On the 26th, away from the real shared sightings: 08:30 and the next spawn at 12:00 UTC.
    const list = [{ id: 'wb1', event: 'worldBoss', at: '2026-10-26T08:30:00Z', timing: 'start', boss: 'Ashava', place: 'Caen Adar', region: 'scosglen', recordedAt: '2026-10-26T07:35:00Z' }];
    const page = await open('2026-10-26T07:50:00Z', { timezone: 'UTC', before: seed(list) });
    const boss = await page.eval(row('worldBoss', 'Boss'));
    check('a boss you logged for this spawn shows as seen', boss.startsWith('Ashava') && boss.includes('seen in game'), boss);
    check('its arena shows as seen', (await page.eval(row('worldBoss', 'Location'))).startsWith('Caen Adar'));
    await advance(page, 45 * 60000);
    await page.waitFor(`${row('worldBoss', 'Boss')}.includes('predicted')`, 4000).catch(() => {});
    // Ashava at Caen Adar re-pins the rotation: the next spawn is the second Ashava, in Kehjistan.
    const next = await page.eval(row('worldBoss', 'Boss'));
    check('after the spawn the next one is predicted from the boss you saw', next === 'Ashava · predicted', next);
    check('the Last line keeps what was seen', (await page.eval(row('worldBoss', 'Last'))).includes('Ashava, Caen Adar, Scosglen (seen)'), await page.eval(row('worldBoss', 'Last')));
    await page.close();
    const told = await open('2026-10-26T07:50:00Z', { timezone: 'UTC', before: seed([{ ...list[0], id: 'wb2', provenance: 'reported' }]) });
    const reported = await told.eval(row('worldBoss', 'Boss'));
    // Not checked in game, so it neither shows as seen nor moves the rotation: 08:30 stays Wandering Death.
    check('a secondhand report is never shown as seen and does not move the prediction', reported === 'Wandering Death · predicted', reported);
    const title = await told.eval(`([...document.querySelectorAll('.event[data-kind="worldBoss"] .facts dt')].find(d => d.textContent === 'Boss')?.nextElementSibling?.title ?? '')`);
    check('the report is kept in the prediction\'s note', title.includes('Reported to you, not checked in game: Ashava'), title);
    await told.close();
  }

  // 8c. Marking the Helltide region: on the card and the atlas until that Helltide ends.
  {
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    await page.eval(`document.querySelector('.event[data-kind="helltide"] .log-link').click()`);
    check('the Helltide card opens the form as already running', (await page.eval("document.getElementById('sight-event').value + '/' + document.getElementById('sight-timing').value")) === 'helltide/during');
    await page.eval(`(() => { const r = document.getElementById('sight-region'); r.value = 'hawezar'; document.querySelector('#sighting-dialog form').requestSubmit(); })()`);
    await sleep(300);
    check('the region you marked shows on the Helltide card as seen', (await page.eval(row('helltide', 'Region'))).startsWith('Hawezar · seen in game'), await page.eval(row('helltide', 'Region')));
    check('the radar lights that region', await page.eval("document.querySelector('.atlas-region.hawezar').classList.contains('radar-helltide')"));
    await advance(page, 50 * 60000);
    await page.waitFor(`${row('helltide', 'Region')}.includes('predicted')`, 4000).catch(() => {});
    // The next Helltide (16:00) is predicted again: the mark does not move the cycle.
    check('the mark expires when the Helltide ends, and the next one is predicted', (await page.eval(row('helltide', 'Region'))) === 'Dry Steppes and Skovos · predicted', await page.eval(row('helltide', 'Region')));
    check('and the radar light goes out with it', !(await page.eval("document.querySelector('.atlas-region.hawezar').classList.contains('radar-helltide')")));
    await page.close();
  }

  // 8d. Chest spots: listed, marked active, expiring when chests move, placed on the drawing, filtered.
  {
    const spot = { id: 'ch1', event: 'helltideChest', at: '2026-10-23T12:00:00Z', timing: 'none', region: 'fractured_peaks', place: 'Sarkova Pass, by the cellar', chest: 'mystery', recordedAt: '2026-10-23T12:00:00Z' };
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', before: seed([spot]) });
    const openRegion = (name) => openPlaces(page, name);
    check('the radar overview stays free of chest counts', !(await page.eval(text('.atlas-overview'))).includes('chest spot'));
    await openRegion('Fractured Peaks');
    const chestRow = `([...document.querySelectorAll('.chest-list li')].find(li => li.textContent.includes('Sarkova Pass'))?.textContent ?? '')`;
    check('a spot you logged is listed in its region, not verified now', (await page.eval(chestRow)).includes('Not verified now'), await page.eval(chestRow));
    check('without a placement it has no pin', (await page.eval("document.querySelectorAll('.regional-art .pin').length")) === 0);
    await page.eval(`[...document.querySelectorAll('.chest-list li')].find(li => li.textContent.includes('Sarkova Pass')).querySelector('button.small').click()`);
    await sleep(200);
    check('Mark active now makes it active until the chests move at :30', /Active: you saw it at 3:1\d\s?PM, until about 3:30\s?PM/.test(await page.eval(chestRow)), await page.eval(chestRow));
    // Place it: start placing, then click the drawing 40% across and halfway down.
    await page.eval(`[...document.querySelectorAll('.chest-list li')].find(li => li.textContent.includes('Sarkova Pass')).querySelectorAll('button.small')[1].click()`);
    await page.eval(`(() => { const el = document.querySelector('.regional-art'); const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5 })); })()`);
    await sleep(200);
    const pin = await page.eval(`(() => { const p = document.querySelector('.regional-art .pin.chest.active'); return p ? [parseFloat(p.style.left), parseFloat(p.style.top)] : null; })()`);
    check('placing a spot puts an active pin where you clicked', !!pin && Math.abs(pin[0] - 40) < 1 && Math.abs(pin[1] - 50) < 1, JSON.stringify(pin));
    const stored = JSON.parse(await page.eval("localStorage.getItem('d4-tracker:v1:observations')"));
    check('the placement is saved with the drawing it was made on', stored.some((o) => o.pos && /^fractured_peaks:[0-9a-f]{8}$/.test(o.pos.art)), JSON.stringify(stored.map((o) => o.pos)));
    await page.eval(`document.querySelector('.regional-art .pin.chest')?.click()`);
    const detail = await page.eval(text('.map-info'));
    check('clicking a pin shows where the spot came from and its status', detail.includes('From your own sightings only (3 so far)') && detail.includes('Placed on this drawing'), detail.slice(0, 300));
    await page.eval(`[...document.querySelectorAll('.map-info button.link')].find(b => b.textContent.startsWith('Back to')).click()`);
    await page.eval(`[...document.querySelectorAll('.conf-filter label')].find(l => l.textContent === 'Confirmed').querySelector('input').click()`);
    await sleep(100);
    check('hiding Confirmed hides your confirmed spot', (await page.eval(chestRow)) === '' && (await page.eval("document.querySelectorAll('.regional-art .pin.chest').length")) === 0);
    check('and leaves the Inferred places listed', (await page.eval(text('.atlas-location-list'))).includes('World Boss arena'));
    await page.eval(`[...document.querySelectorAll('.conf-filter label')].find(l => l.textContent === 'Confirmed').querySelector('input').click()`);
    if (shots) await page.screenshot(join(shots, 'v04-atlas-chests.png'), true);
    await advance(page, 21 * 60000);
    await page.waitFor(`${chestRow}.includes('Not verified now')`, 4000).catch(() => {});
    check('a mark expires when the chests move, and says not verified, never inactive', (await page.eval(chestRow)).includes('Not verified now') && !(await page.eval(text('.map-info'))).toLowerCase().includes('inactive'));
    await page.eval(`[...document.querySelectorAll('.layers label')].find(x => x.textContent.includes('Helltide chests')).querySelector('input').click()`);
    check('turning the chest layer off removes the chest section', (await page.eval("document.querySelector('.chest-section')")) === null);
    check('the chest pages make no outside requests', page.requests.every((u) => u.startsWith(origin) || u.startsWith('blob:') || u.startsWith('data:')));
    await page.close();
  }

  // 8e. Realms: a chest marked on Seasonal is not shown as active for Eternal.
  {
    const mark = { id: 'r1', event: 'helltideChest', at: '2026-10-24T15:05:00Z', timing: 'during', region: 'kehjistan', place: 'Gea Kul gate', chest: 'mystery', realm: 'seasonal', recordedAt: '2026-10-24T15:05:00Z' };
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', prefs: { realm: 'eternal' }, before: seed([mark]) });
    await openPlaces(page, 'Kehjistan');
    check('a Seasonal mark is not active for an Eternal player', (await page.eval(text('.chest-list'))).includes('Not verified now'));
    await page.eval(`(() => { const s = document.querySelector('.chest-section select'); s.value = 'seasonal'; s.dispatchEvent(new Event('change')); })()`);
    await sleep(100);
    check('and is active for a Seasonal player', (await page.eval(text('.chest-list'))).includes('Active: you saw it'));
    await page.close();
  }

  // 8g. Phone: a region's chest list and its buttons fit without sideways scrolling.
  {
    const spots = ['Amber Sands, by the cellar', 'Ragged Coastline, north of the waypoint, past the broken bridge'].map((place, i) =>
      ({ id: `ph${i}`, event: 'helltideChest', at: '2026-10-23T12:00:00Z', timing: 'none', region: 'kehjistan', place, chest: 'tortured-gift', recordedAt: '2026-10-23T12:00:00Z' }));
    const page = await open('2026-10-24T15:10:00Z', { width: 390, height: 844, mobile: true, before: seed(spots) });
    await openPlaces(page, 'Kehjistan');
    const overflow = await page.eval('document.documentElement.scrollWidth - innerWidth');
    check('a region with chest spots has no horizontal scroll at 390 px', overflow <= 0 && (await page.eval("document.querySelectorAll('.chest-list li').length")) === 2, `overflow ${overflow}px`);
    await page.close();
  }

  // 8f. A hostile import: markup stays text, bad records are refused, nothing is polluted.
  {
    const page = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    const fixture = fileURLToPath(new URL('./fixtures/sightings-malicious.json', import.meta.url));
    await page.setFiles('#sightings-panel input[type=file]', [fixture]);
    await page.waitFor(`${text('#sightings-panel .status-line')}.startsWith('Imported')`, 4000).catch(() => {});
    const status = await page.eval(text('#sightings-panel .status-line'));
    check('a hostile file imports only its clean record and refuses the rest', status.startsWith('Imported 1, skipped 0 already here, 5 not readable'), status);
    await openPlaces(page, 'Kehjistan');
    await page.eval("document.querySelector('.sight-recent').open = true");
    check('markup in a record shows as text and runs nothing', await page.eval("document.title !== 'pwned' && !document.querySelector('img[src=x]') && document.querySelector('.chest-list').textContent.includes('<img src=x')"));
    check('nothing is polluted by the file', await page.eval('({}).polluted === undefined'));
    await page.close();
  }

  // 9. The event radar: lights only what is known, for its window, the same story as the cards.
  {
    const S = (id, rest) => ({ id, recordedAt: '2026-10-24T10:30:00Z', ...rest });
    const scene = [
      S('h1', { event: 'helltide', at: '2026-10-24T10:03:00Z', timing: 'during', region: 'hawezar' }),
      S('h2', { event: 'helltide', at: '2026-10-24T10:05:00Z', timing: 'during', region: 'nahantu' }),
      S('b1', { event: 'worldBoss', at: '2026-10-24T11:00:00Z', timing: 'start', boss: 'Ashava', place: 'Seared Basin', region: 'kehjistan' }),
      S('b2', { event: 'worldBoss', at: '2026-10-24T11:00:00Z', timing: 'start', boss: 'Avarice', place: 'The Cauldron', region: 'nahantu' }),
      S('l1', { event: 'legion', at: '2026-10-24T10:45:00Z', timing: 'start', place: 'Kor Dragan', region: 'fractured_peaks' }),
      S('r1', { event: 'worldBoss', at: '2026-10-24T11:00:00Z', timing: 'start', boss: 'Azmodan', region: 'scosglen', provenance: 'reported' }),
    ];
    const lit = (page) => page.eval("[...document.querySelectorAll('.atlas-region.radar-helltide')].map(g => g.classList[1]).sort().join(',')");
    const dots = (page) => page.eval("[...document.querySelectorAll('.radar-dot')].map(d => `${d.classList.contains('boss') ? 'boss' : 'legion'}:${d.dataset.region}:${d.classList.contains('pulse')}`).sort().join(',')");

    const page = await open('2026-10-24T10:40:00Z', { timezone: 'UTC', before: seed(scene) });
    check('the radar lights both regions with a Helltide on', (await lit(page)) === 'hawezar,nahantu', await lit(page));
    check('gold dots for both World Bosses and a violet dot for the Legion, all pulsing this close',
      (await dots(page)) === 'boss:kehjistan:true,boss:nahantu:true,legion:fractured_peaks:true', await dots(page));
    check('a reported region stays dark: no light and no dot in Scosglen',
      !(await page.eval("document.querySelector('.atlas-region.scosglen').classList.contains('radar-helltide') || !!document.querySelector('.radar-dot[data-region=\"scosglen\"]')")));
    const card = await page.eval(row('worldBoss', 'Location'));
    check('the World Boss card and the radar tell the same story', card.startsWith('Seared Basin, Kehjistan') && (await dots(page)).includes('boss:kehjistan'), card);
    check('several events in one region keep their own indicators', await page.eval("document.querySelector('.atlas-region.nahantu').classList.contains('radar-helltide') && !!document.querySelector('.radar-dot.boss[data-region=\"nahantu\"]')"));
    await page.eval("[...document.querySelectorAll('.atlas-region')].find(x => x.getAttribute('aria-label').startsWith('Kehjistan')).dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    const panel = await page.eval(text('.map-info'));
    check('selecting a region lists its events with time and confidence', panel.includes('World Boss: Ashava, Kehjistan, 11:00 AM: seen in game (Confirmed)'), panel);
    const ring = await page.eval("(() => { const g = document.querySelector('.atlas-region.kehjistan'); g.focus(); return getComputedStyle(g).outlineStyle; })()");
    check('a clicked region shows no focus rectangle', ring === 'none', ring);
    const keyboard = await page.eval("(() => { const g = document.querySelector('.atlas-region.dry_steppes'); g.focus({ focusVisible: true }); return `${g.matches(':focus-visible')}|${getComputedStyle(g).outlineStyle}|${getComputedStyle(g.querySelector('path')).strokeWidth}`; })()");
    check('keyboard focus still shows, as the region\'s own outline', keyboard === 'true|none|3px', keyboard);
    check('a marker carries a tooltip with the event, time and confidence', (await page.eval("document.querySelector('.radar-dot.legion title').textContent")).includes('Legion: Kor Dragan, Fractured Peaks, 10:45 AM: seen in game (Confirmed)'));
    await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const motion = await page.eval(`(() => { const a = document.querySelector('.atlas-region.radar-helltide path'); const b = document.querySelector('.radar-dot.pulse .ring');
      return a && b ? getComputedStyle(a).animationName + '/' + getComputedStyle(b).animationName : 'missing'; })()`);
    check('reduced motion: nothing breathes or pulses', motion === 'none/none', motion);
    await page.eval("[...document.querySelectorAll('.radar-chips label')].find(l => l.textContent.includes('World Bosses')).querySelector('input').click()");
    check('the phone summary is not shown on a desktop', await page.eval("!!document.querySelector('.radar-summary') && getComputedStyle(document.querySelector('.radar-summary')).display === 'none'"));
    check('turning World Bosses off removes their dots, and is remembered', !(await dots(page)).includes('boss') && await page.eval("JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).radar.worldBoss === false"));
    if (shots) await page.screenshot(join(shots, 'radar.png'), { height: 1240 });
    await page.close();

    // The World Boss arena is not predicted: a predicted boss alone puts nothing on the radar, and the
    // card points to the in-game map instead. (Fresh prefs: World Bosses were just switched off.)
    const ahead = await open('2026-10-24T17:40:00Z', { timezone: 'UTC', prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('a predicted boss alone puts no World Boss dot on the radar', !(await dots(ahead)).includes('boss'), await dots(ahead));
    const legend = (p) => p.eval("[...document.querySelectorAll('.radar-legend li')].map(li => li.className + ': ' + li.textContent).join(' | ')");
    check('the legend lists only what the radar shows: the Helltide, and no dots', (await legend(ahead)) === 'helltide: Red outline: a Helltide is on there now.', await legend(ahead));
    const outline = await ahead.eval("(() => { const p = document.querySelector('.atlas-region.radar-helltide path'); if (!p) return 'no lit region'; const s = getComputedStyle(p); return `${s.stroke}|${s.strokeDasharray}`; })()");
    check('the Helltide region has a red dashed outline', outline.startsWith('rgb(224, 50, 43)|') && !outline.endsWith('|none'), outline);
    check('the card keeps the predicted boss and hides the unknown arena', (await ahead.eval(row('worldBoss', 'Boss'))) === 'Azmodan · predicted'
      && await ahead.eval(`[...document.querySelectorAll('.event[data-kind="worldBoss"] .facts dt')].find(d => d.textContent === 'Location').hidden`), await ahead.eval(row('worldBoss', 'Boss')));
    if (shots) await ahead.screenshot(join(shots, 'radar-predicted.png'), { height: 1240 });
    await ahead.close();
    const double = await open('2026-10-25T00:40:00Z', { timezone: 'UTC', width: 390, height: 844, mobile: true, prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('a double spawn lights no predicted region either', !(await dots(double)).includes('boss'), await dots(double));
    const line = await double.eval("[...document.querySelectorAll('.radar-summary li')].filter(li => li.offsetParent !== null).map(li => li.textContent).join(' | ')");
    check('the phone summary lists the predicted Helltides and no World Boss', line === 'Helltide: Fractured Peaks (Predicted), Skovos (Predicted) · until 12:55 AM', line);
    await double.close();

    // The map hint: under the World Boss countdown from 60 minutes before, under the Legion's from 10,
    // gone at the start. Checked across each threshold and each start on a running clock.
    const hint = (p, kind) => p.eval(`(() => { const e = document.querySelector('.event[data-kind="${kind}"] .map-hint'); return e && e.checkVisibility() ? e.textContent : ''; })()`);
    const HINT = 'Check in-game map for exact location';
    const WB_HINT = 'Check in-game map for boss and location';
    const big = (p, kind) => p.eval(text(`.event[data-kind="${kind}"] .big`));
    const secs = (s) => s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
    const wbEdge = await open('2026-10-24T16:59:57Z', { timezone: 'UTC', prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('no map hint with more than 60 minutes to the World Boss', (await hint(wbEdge, 'worldBoss')) === '', await hint(wbEdge, 'worldBoss'));
    await wbEdge.waitFor(`!!document.querySelector('.event[data-kind="worldBoss"] .map-hint')?.checkVisibility()`, 6000).catch(() => {});
    check('the World Boss map hint appears at 60 minutes: boss and location', (await hint(wbEdge, 'worldBoss')) === WB_HINT && secs(await big(wbEdge, 'worldBoss')) <= 3600, `${await hint(wbEdge, 'worldBoss')} ${await big(wbEdge, 'worldBoss')}`);
    check('the Helltide card never shows it', (await hint(wbEdge, 'helltide')) === '');
    await wbEdge.close();
    const wbStart = await open('2026-10-24T17:59:57Z', { timezone: 'UTC', prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('the World Boss hint stays up to the spawn', (await hint(wbStart, 'worldBoss')) === WB_HINT);
    await wbStart.waitFor(`!document.querySelector('.event[data-kind="worldBoss"] .map-hint')?.checkVisibility()`, 6000).catch(() => {});
    check('and goes at the spawn, as the countdown rolls over to the next one', (await hint(wbStart, 'worldBoss')) === '' && secs(await big(wbStart, 'worldBoss')) > 12500, await big(wbStart, 'worldBoss'));
    await wbStart.close();
    const lgEdge = await open('2026-10-24T19:44:57Z', { timezone: 'UTC', prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('no map hint with more than 10 minutes to the Legion', (await hint(lgEdge, 'legion')) === '', await hint(lgEdge, 'legion'));
    await lgEdge.waitFor(`!!document.querySelector('.event[data-kind="legion"] .map-hint')?.checkVisibility()`, 6000).catch(() => {});
    check('the Legion map hint appears at 10 minutes: exact location', (await hint(lgEdge, 'legion')) === HINT && secs(await big(lgEdge, 'legion')) <= 600, await big(lgEdge, 'legion'));
    await lgEdge.close();
    const lgStart = await open('2026-10-24T19:54:57Z', { timezone: 'UTC', width: 390, height: 844, mobile: true, prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    const hintBox = await lgStart.eval(`(() => { const e = document.querySelector('.event[data-kind="legion"] .map-hint'); const r = e.getBoundingClientRect(); return { h: r.height, line: parseFloat(getComputedStyle(e).lineHeight) || 18, right: r.right }; })()`);
    check('on a phone the hint is one line and the page does not scroll sideways', (await hint(lgStart, 'legion')) === HINT && hintBox.h <= hintBox.line * 1.4
      && (await lgStart.eval('document.documentElement.scrollWidth - innerWidth')) <= 0, JSON.stringify(hintBox));
    await lgStart.waitFor(`!document.querySelector('.event[data-kind="legion"] .map-hint')?.checkVisibility()`, 6000).catch(() => {});
    check('the Legion hint goes at the start; the next Legion is 25 minutes off', (await hint(lgStart, 'legion')) === '' && secs(await big(lgStart, 'legion')) > 1400, await big(lgStart, 'legion'));
    await lgStart.close();
    const compactHint = await open('2026-10-24T19:50:00Z', { timezone: 'UTC', prefs: { compact: true } });
    check('compact view keeps to the countdowns: no map hint there', (await hint(compactHint, 'legion')) === '');
    await compactHint.close();

    // One click marks the Helltide in progress: the region lights and breathes until it ends, and the card agrees.
    const mark = await open('2026-10-24T15:10:00Z', { timezone: 'UTC', prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('before any mark, the predicted region is lit, dashed and labeled Predicted', (await lit(mark)) === 'scosglen'
      && await mark.eval("document.querySelector('.atlas-region.scosglen').classList.contains('inferred')")
      && (await mark.eval(text('.radar-text.helltide'))).endsWith('(Predicted)'), `${await lit(mark)} ${await mark.eval(text('.radar-text.helltide'))}`);
    await mark.eval("document.querySelector('.atlas-region.hawezar').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    const offered = await mark.eval("[...document.querySelectorAll('.map-info button')].map(b => b.textContent).join('|')");
    check('a selected region offers "Helltide is here" while a Helltide is on', offered.startsWith('Helltide is here|'), offered);
    await mark.eval("[...document.querySelectorAll('.map-info button')].find(b => b.textContent === 'Helltide is here')?.click()");
    await mark.waitFor("!!document.querySelector('.atlas-region.hawezar.radar-helltide')", 3000).catch(() => {});
    check('one click lights that region, in place of the prediction', (await lit(mark)) === 'hawezar'
      && !(await mark.eval("document.querySelector('.atlas-region.hawezar').classList.contains('inferred')")), await lit(mark));
    const breath = await mark.eval("(() => { const a = document.querySelector('.atlas-region.hawezar.radar-helltide path')?.getAnimations()[0]; return a ? `${a.animationName}:${a.playState}` : 'none'; })()");
    check('and its outline breathes', breath === 'radar-breathe:running', breath);
    check('the Helltide card shows the region as seen', (await mark.eval(row('helltide', 'Region'))) === 'Hawezar · seen in game', await mark.eval(row('helltide', 'Region')));
    check('once marked, the button goes', !(await mark.eval(text('.map-info'))).includes('Helltide is here'), await mark.eval(text('.map-info')));
    await advance(mark, 46 * 60000);
    await mark.waitFor("!document.querySelector('.atlas-region.radar-helltide')", 4000).catch(() => {});
    check('the light goes out when the Helltide ends', (await lit(mark)) === '', await lit(mark));
    check('and between Helltides there is nothing to mark', !(await mark.eval(text('.map-info'))).includes('Helltide is here'), await mark.eval(text('.map-info')));
    await mark.close();

    // Legion candidates: the next Legion's group on the card, switching at its start; never a radar light.
    const cands = (p) => p.eval(`[...document.querySelectorAll('.event[data-kind="legion"] details.candidates li')].map(li => li.textContent).join(' | ')`);
    const lgNext = await open('2026-10-24T19:54:57Z', { timezone: 'UTC', prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    check('the Legion card lists the four possible sites of the next Legion (group B at 19:55)', (await cands(lgNext)) === "Haunted Wreckage, Hawezar | Crusader's Monument, Hawezar | Norgoi Vigil, Dry Steppes | Temple of Rot, Dry Steppes", await cands(lgNext));
    check('a group of candidates puts no Legion dot on the radar', !(await dots(lgNext)).includes('legion'), await dots(lgNext));
    await lgNext.waitFor(`[...document.querySelectorAll('.event[data-kind="legion"] details.candidates li')][0]?.textContent === 'Kor Dragan, Fractured Peaks'`, 6000).catch(() => {});
    check('at its start the card moves on to the next Legion and its group (A, 20:20)', (await cands(lgNext)) === "Kor Dragan, Fractured Peaks | Carrowcrest Ruins, Scosglen | Dilapidated Aqueducts, Kehjistan | Alcarnus, Kehjistan", await cands(lgNext));
    await lgNext.close();
    const lgSeen = await open('2026-10-24T19:50:00Z', { timezone: 'UTC', prefs: {}, before: seed([S('lg1', { event: 'legion', at: '2026-10-24T19:55:00Z', timing: 'start', place: 'Haunted Wreckage', region: 'hawezar' })]) });
    const lgLegend = await lgSeen.eval("[...document.querySelectorAll('.radar-legend li')].map(li => li.className).join(',')");
    check('with a Legion seen in game, the legend adds the violet dot', lgLegend === 'helltide,legion', lgLegend);
    check('a Legion site seen in game shows on the card in place of the candidates', (await lgSeen.eval(row('legion', 'Location'))) === 'Haunted Wreckage, Hawezar · seen in game', await lgSeen.eval(row('legion', 'Location')));
    check('and lights a Legion dot in its region', (await dots(lgSeen)).includes('legion:hawezar'), await dots(lgSeen));
    await lgSeen.close();
    const lgBoth = await open('2026-10-24T20:15:00Z', { timezone: 'UTC', prefs: {}, before: seed([S('lg2', { event: 'legion', at: '2026-10-24T20:20:00Z', timing: 'start', place: 'Chakhir', region: 'nahantu' })]) });
    const bothSummary = await lgBoth.eval(text('.event[data-kind="legion"] details.candidates summary'));
    check('an expansion Legion seen at the same time keeps the base-game candidates and shows beside them', bothSummary === '4 candidates · predicted · also Chakhir, Nahantu (seen)', bothSummary);
    check('and lights its own Legion dot, in Nahantu', (await dots(lgBoth)).includes('legion:nahantu'), await dots(lgBoth));
    check('before the expansion order\'s pin, no expansion site is predicted', (await lgBoth.eval("document.querySelector('.event[data-kind=\"legion\"] .candidates-expansion').hidden")) === true);
    await lgBoth.close();

    // The expansion Legion's predicted site: inside the folded candidates, apart from them, labeled Predicted.
    const xLine = '.event[data-kind="legion"] details.candidates .candidates-expansion';
    const lgX = await open('2026-10-25T00:25:00Z', { timezone: 'UTC', prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    const xBox = await lgX.eval(`(() => { const d = document.querySelector('.event[data-kind="legion"] details.candidates'); const x = d.querySelector('.candidates-expansion');
      const folded = x.checkVisibility(); d.open = true; const r = { summary: d.querySelector('summary').textContent, folded, opened: x.checkVisibility(), text: [...x.children].map(p => p.textContent).join(' | '),
        inList: !!x.closest('ul'), items: d.querySelectorAll('li').length }; d.open = false; return r; })()`);
    check('the summary counts six candidates, four base-game and two expansion', xBox.summary === '6 candidates · predicted', JSON.stringify(xBox));
    check('the predicted expansion site is folded away with the candidates', xBox.folded === false && xBox.opened === true, JSON.stringify(xBox));
    check('it is its own line after the four candidates, not one of them', !xBox.inList && xBox.items === 4, JSON.stringify(xBox));
    check('Cosmic Archives (00:30 UTC) shows as Predicted with its visibility caveat, then the group\'s other expansion site',
      xBox.text === 'Expansion: Cosmic Archives, Skovos · Predicted · shows once its stronghold is cleared | Expansion: Siege of Chakhir Ruins, Nahantu', xBox.text);
    check('a predicted expansion site puts no Legion dot on the radar', !(await dots(lgX)).includes('legion'), await dots(lgX));
    const xTrust = await lgX.eval(text('.event[data-kind="legion"] .trust'));
    check('and adds no badge to the Legion card\'s trust row', !xTrust.includes('Expansion'), xTrust);
    const xAbout = await lgX.eval(text('.event[data-kind="legion"] details.about'));
    check('About this card explains the expansion order, labeled Predicted', /Expansion Legion: Predicted/.test(xAbout) && xAbout.includes('repeating every 100 minutes'), xAbout.slice(0, 400));
    const xLater = await lgX.eval(`[...document.querySelectorAll('.event[data-kind="legion"] details.later-predictions li')].map(li => li.textContent).join(' | ')`);
    check('later Legions list their expansion site after the group\'s regions', xLater.includes('6 candidates: Hawezar, Dry Steppes; also Pirate Invasion, Skovos')
      && xLater.includes('6 candidates: Fractured Peaks, Scosglen, Kehjistan; also Siege of Chakhir Ruins, Nahantu'), xLater);
    const xRows = await lgX.eval(`[...document.querySelectorAll('#timeline-panel li')].map(li => li.dataset.kind + ':' + li.children[1].textContent)`);
    const xLegionRows = xRows.filter((r) => r.startsWith('legion:')).slice(0, 3).join(' | ');
    check('Coming up notes each Legion start\'s predicted expansion region, compactly, without "predicted"', xLegionRows
      === 'legion:Legion starts (also Skovos) | legion:Legion starts (also Skovos) | legion:Legion starts (also Nahantu)', xLegionRows);
    check('and adds nothing to the other events\' rows', xRows.filter((r) => !r.startsWith('legion:')).every((r) => !r.includes('(also ')), JSON.stringify(xRows));
    // A Coming up note may move to the next line (how much fits depends on the system's fonts), but
    // only whole: never split across lines, on a desktop or on a phone.
    const split = `[...document.querySelectorAll('#timeline-panel .tl-note')].filter(n => n.getClientRects().length !== 1).map(n => n.textContent)`;
    const deskNotes = await lgX.eval("document.querySelectorAll('#timeline-panel .tl-note').length");
    check('on a desktop no expansion note is split across lines', deskNotes > 0 && (await lgX.eval(split)).length === 0, `${deskNotes} notes; split ${JSON.stringify(await lgX.eval(split))}`);
    const xPhone = await open('2026-10-25T00:25:00Z', { timezone: 'UTC', width: 390, height: 844, mobile: true, prefs: {}, before: "localStorage.removeItem('d4-tracker:v1:observations')" });
    const phoneNotes = await xPhone.eval("document.querySelectorAll('#timeline-panel .tl-note').length");
    check('on a 390 px phone no expansion note is split across lines', phoneNotes > 0 && (await xPhone.eval(split)).length === 0, `${phoneNotes} notes; split ${JSON.stringify(await xPhone.eval(split))}`);
    await xPhone.close();
    const spanOf = () => lgX.eval(`(() => { const li = [...document.querySelectorAll('#timeline-panel li')]; const s = document.querySelector('.tl-hours');
      return { hours: s.value, offered: [...s.options].map(o => o.textContent).join('/'), rows: li.length, lastIn: Number(li.at(-1).dataset.start) - Date.now() }; })()`);
    const span = await spanOf();
    check('Coming up covers the next 6 hours by default, with 6 to 24 offered', span.hours === '6' && span.offered === '6 hours/12 hours/18 hours/24 hours'
      && span.rows > 10 && span.lastIn > 5 * 3600000 && span.lastIn <= 6 * 3600000 + 1000, JSON.stringify(span));
    const setHours = (n) => lgX.eval(`(() => { const s = document.querySelector('.tl-hours'); s.value = '${n}'; s.dispatchEvent(new Event('change')); })()`);
    await setHours(12);
    const twelve = await spanOf();
    check('choosing 12 hours lists twelve hours of starts', twelve.hours === '12' && twelve.lastIn > 11 * 3600000 && twelve.lastIn <= 12 * 3600000 + 1000, JSON.stringify(twelve));
    await setHours(6);
    // One event picked: only its starts, each with its prediction on a line of its own; the World Boss looks a day ahead.
    const picks = () => lgX.eval(`[...document.querySelectorAll('.tl-picks button')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(',')`);
    const pickRows = () => lgX.eval(`[...document.querySelectorAll('#timeline-panel li')].map(li => li.dataset.kind + ':' + (li.querySelector('.tl-detail')?.textContent ?? ''))`);
    check('Coming up offers All, Starred (a star), Helltide, World Boss and Legion, with All picked', (await picks()) === 'All*,★,Helltide,World Boss,Legion', await picks());
    await lgX.eval(`document.querySelector('.tl-picks [data-pick="worldBoss"]').click()`);
    const wbRows = await pickRows();
    const wbSpan = await spanOf();
    check('World Boss picked: its 7 spawns in the next 24 hours by default, each with its predicted boss', wbSpan.hours === '24' && wbRows.length === 7
      && wbRows.every((r) => /^worldBoss:\S/.test(r)), `${JSON.stringify(wbSpan)} ${JSON.stringify(wbRows)}`);
    check('the World Boss offers up to 72 hours', wbSpan.offered === '6 hours/12 hours/24 hours/48 hours/72 hours', wbSpan.offered);
    await setHours(72);
    check('72 hours of World Bosses is 21 spawns, and each pick keeps its own choice', (await pickRows()).length === 21
      && JSON.stringify(await lgX.eval(`JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).comingUpHours`)) === '{"all":6,"starred":6,"helltide":6,"worldBoss":72,"legion":6}');
    await setHours(24);
    await lgX.eval(`document.querySelector('.tl-picks [data-pick="helltide"]').click()`);
    const htRows = await pickRows();
    check('Helltide picked: each hour with its regions', htRows.length === 6 && htRows[0] === 'helltide:Scosglen' && htRows[1] === 'helltide:Dry Steppes and Nahantu', JSON.stringify(htRows));
    check('the pick is kept in the settings', (await lgX.eval(`JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).comingUp`)) === 'helltide');
    await lgX.eval(`document.querySelector('.tl-picks [data-pick="all"]').click()`);
    check('All shows every event again', (await picks()).startsWith('All*') && new Set((await pickRows()).map((r) => r.split(':')[0])).size === 3);
    await advance(lgX, 5 * 60000 + 1000);
    await lgX.waitFor(`document.querySelector('${xLine}')?.textContent.startsWith('Expansion: Pirate Invasion')`, 6000).catch(() => {});
    check('at its start the card moves on to the next expansion site (Pirate Invasion, 00:55), without a caveat',
      (await lgX.eval(`document.querySelector('${xLine}').firstChild.textContent`)) === 'Expansion: Pirate Invasion, Skovos · Predicted', await lgX.eval(`document.querySelector('${xLine}').textContent`));
    check('then group B\'s other expansion site, Of Souls and Spirits', (await lgX.eval(`document.querySelector('${xLine}').lastChild.textContent`)) === 'Expansion: Of Souls and Spirits, Nahantu',
      await lgX.eval(`document.querySelector('${xLine}').textContent`));
    await lgX.close();
    const lgXSeen = await open('2026-10-24T23:35:00Z', { timezone: 'UTC', prefs: {}, before: seed([S('lg3', { event: 'legion', at: '2026-10-24T23:40:00Z', timing: 'start', place: 'Siege of Chakhir Ruins', region: 'nahantu' })]) });
    const xSeenSummary = await lgXSeen.eval(text('.event[data-kind="legion"] details.candidates summary'));
    check('an expansion Legion seen in game replaces the predicted one', xSeenSummary === '4 candidates · predicted · also Siege of Chakhir Ruins, Nahantu (seen)'
      && (await lgXSeen.eval(`document.querySelector('${xLine}').hidden`)) === true, xSeenSummary);
    await lgXSeen.close();

    // Lead-up windows and expiry: 40 minutes before the World Boss nothing shows; the Legion 25 minutes out does not either.
    const early = await open('2026-10-24T10:20:00Z', { timezone: 'UTC', before: seed(scene) });
    check('no spawn marker before its lead-up window', (await dots(early)) === '', await dots(early));
    check('with only the Helltides lit, the summary has only the Helltide line', (await early.eval("[...document.querySelectorAll('.radar-summary li')].map(li => li.className).join(',')")) === 'helltide');
    await early.close();
    const longLead = await open('2026-10-24T10:05:00Z', { timezone: 'UTC', prefs: { radarLead: { worldBoss: 60, legion: 10 } }, before: seed(scene) });
    check('a longer lead-up shows the World Boss earlier, without a pulse until 30 minutes before', (await dots(longLead)) === 'boss:kehjistan:false,boss:nahantu:false', await dots(longLead));
    await longLead.close();
    const after = await open('2026-10-24T11:11:00Z', { timezone: 'UTC', width: 390, height: 844, mobile: true, before: seed(scene) });
    // At 11:11 the 10:00 Helltide and the 11:00 spawn are over; only the 11:00 Helltide's prediction is lit.
    check('everything seen goes out once its event is over', (await dots(after)) === '' && (await lit(after)) === 'dry_steppes', `${await dots(after)} / ${await lit(after)}`);
    const afterSummary = await after.eval("[...document.querySelectorAll('.radar-summary li')].map(li => li.className + ': ' + li.textContent).join(' | ')");
    check('and the summary has just that line, labeled Predicted', afterSummary.startsWith('helltide: ') && afterSummary.includes('Dry Steppes (Predicted)') && !afterSummary.includes('|'), afterSummary);
    await after.close();

    // Phone and compact.
    const phone = await open('2026-10-24T10:40:00Z', { timezone: 'UTC', width: 390, height: 844, mobile: true, before: seed(scene) });
    check('the radar fits a phone without sideways scrolling', (await phone.eval('document.documentElement.scrollWidth - innerWidth')) <= 0 && (await lit(phone)) === 'hawezar,nahantu');
    const summary = await phone.eval("[...document.querySelectorAll('.radar-summary li')].filter(li => li.offsetParent !== null).map(li => li.textContent).join(' | ')");
    check('on a phone, one summary line per event type, exactly what the radar lights',
      summary === 'Helltide: Hawezar, Nahantu · until 10:55 AM | World Boss 11:00 AM: Ashava, Kehjistan; Avarice, Nahantu | Legion 10:45 AM: Kor Dragan, Fractured Peaks', summary);
    await phone.eval("[...document.querySelectorAll('.radar-chips label')].find(l => l.textContent.includes('Legion')).querySelector('input').click()");
    check('switching an event off removes its summary line too', !(await phone.eval(text('.radar-summary'))).includes('Legion'));
    if (shots) await phone.screenshot(join(shots, 'radar-phone.png'), true);
    await phone.close();
    const compact = await open('2026-10-24T10:40:00Z', { timezone: 'UTC', prefs: { compact: true }, before: seed(scene) });
    check('compact view keeps to the countdowns: the radar is hidden there', await compact.eval("getComputedStyle(document.getElementById('map-panel')).display === 'none' || document.getElementById('lower').offsetParent === null"));
    check('the radar makes no errors in compact view', compact.problems.length === 0, JSON.stringify(compact.problems));
    await compact.close();
  }
} finally {
  await chrome.close();
  server.close();
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
