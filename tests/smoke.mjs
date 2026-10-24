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
    check('region, boss and locations show as Unknown', unknowns.length === 4 && unknowns.every((t) => t === 'Unknown'), JSON.stringify(unknowns));
    const rows = await page.eval(`[...document.querySelectorAll('.facts dd.unknown')].map(d => ({
      hint: d.querySelector('.hint').textContent, reason: d.title, height: d.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(d).lineHeight) }))`);
    check('each Unknown has a short hint and its full reason on hover', rows.every((r) => r.hint.startsWith(' · ') && r.reason.length > 30), JSON.stringify(rows));
    check('each Unknown takes one line', rows.every((r) => r.height <= r.line * 1.2), JSON.stringify(rows.map((r) => [r.height, r.line])));
    const about = await page.eval(`document.querySelector('.event[data-kind="worldBoss"] details.about').textContent`);
    check('the full reasons and order notes are under About', about.includes('contradicted by first-hand reports') && about.includes('Boss order: Unknown'), about.slice(0, 300));
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
    await page.waitFor(`${row('worldBoss', 'Boss')}.startsWith('Unknown')`, 4000).catch(() => {});
    check('after the spawn the next one is Unknown again', (await page.eval(row('worldBoss', 'Boss'))).startsWith('Unknown'));
    check('the Last line keeps what was seen', (await page.eval(row('worldBoss', 'Last'))).includes('Ashava, Caen Adar, Scosglen (seen)'), await page.eval(row('worldBoss', 'Last')));
    await page.close();
    const told = await open('2026-10-26T07:50:00Z', { timezone: 'UTC', before: seed([{ ...list[0], id: 'wb2', provenance: 'reported' }]) });
    const reported = await told.eval(row('worldBoss', 'Boss'));
    check('a secondhand report stays Unknown with a "reported, not checked" note, never shown as seen', reported.startsWith('Unknown') && reported.includes('reported: Ashava, not checked') && !reported.includes('seen in game'), reported);
    check('no prediction is shown without a tested order', !(await told.eval(text('.event[data-kind="worldBoss"]'))).includes('predicted'));
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
    await page.waitFor(`${row('helltide', 'Region')}.startsWith('Unknown')`, 4000).catch(() => {});
    check('the mark expires when the Helltide ends', (await page.eval(row('helltide', 'Region'))).startsWith('Unknown'));
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

    // Lead-up windows and expiry: 40 minutes before the World Boss nothing shows; the Legion 25 minutes out does not either.
    const early = await open('2026-10-24T10:20:00Z', { timezone: 'UTC', before: seed(scene) });
    check('no spawn marker before its lead-up window', (await dots(early)) === '', await dots(early));
    check('with only the Helltides lit, the summary has only the Helltide line', (await early.eval("[...document.querySelectorAll('.radar-summary li')].map(li => li.className).join(',')")) === 'helltide');
    await early.close();
    const longLead = await open('2026-10-24T10:05:00Z', { timezone: 'UTC', prefs: { radarLead: { worldBoss: 60, legion: 10 } }, before: seed(scene) });
    check('a longer lead-up shows the World Boss earlier, without a pulse until 30 minutes before', (await dots(longLead)) === 'boss:kehjistan:false,boss:nahantu:false', await dots(longLead));
    await longLead.close();
    const after = await open('2026-10-24T11:11:00Z', { timezone: 'UTC', width: 390, height: 844, mobile: true, before: seed(scene) });
    check('everything goes out once its event is over', (await dots(after)) === '' && (await lit(after)) === '', `${await dots(after)} / ${await lit(after)}`);
    check('with nothing lit there is no summary', (await after.eval("document.querySelector('.radar-summary')")) === null);
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
