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
    check('the full reasons and rotation notes are under About', about.includes('trackers that guess disagree') && about.includes('Boss order (unknown)'), about.slice(0, 300));
    check('an inferred start time shows what confirms it', about.includes('0 of 3 matching in-game starts, on 0 of 2 days'), about.slice(0, 400));
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
    const summary = await page.eval(text('#sightings-panel .sight-summary'));
    check('a sighting on the schedule agrees', summary.includes('Start times: 1 of 1 agree with the schedule.'), summary.slice(0, 200));
    const about = await page.eval(`document.querySelector('.event[data-kind="worldBoss"] details.about').textContent`);
    check('the card reports the sighting', about.includes('Your sightings: 1 of 1 agree'), about.slice(-200));
    await page.reload();
    await page.waitFor("document.querySelector('.event .big').textContent !== '--:--'");
    check('sightings survive a reload', (await page.eval(text('#sightings-panel .sight-summary'))).includes('1 of 1 agree'));
    const fixture = fileURLToPath(new URL('./fixtures/sightings-import.json', import.meta.url));
    await page.setFiles('#sightings-panel input[type=file]', [fixture]);
    await page.waitFor(`${text('#sightings-panel .status-line')}.startsWith('Imported')`, 4000).catch(() => {});
    const first = await page.eval(text('#sightings-panel .status-line'));
    check('importing a file adds its sightings', first.startsWith('Imported 2, skipped 0'), first);
    const flagged = await page.eval(text('#sightings-panel .sight-summary'));
    check('a sighting 11 minutes off the schedule is flagged', flagged.includes('11 min after the nearest calculated start'), flagged.slice(0, 400));
    check('progress toward confirming the World Boss start time is shown (2 starts, one day)',
      flagged.includes('Start time confirmation: 2 of 3 matching in-game starts, on 1 of 2 days'), flagged.slice(0, 500));
    check('places seen are listed as existing, apart from any order',
      flagged.includes('Places seen in game (each sighting confirms the place exists): Saraan Caldera (1), Caen Adar (1)'), flagged.slice(0, 600));
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
    await page.eval("[...document.querySelectorAll('.atlas-region')].find(x => x.getAttribute('aria-label').startsWith('Fractured Peaks')).dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    check('phone can open a regional atlas', await page.eval("document.querySelector('.regional-art') !== null"));
    await page.eval("document.querySelector('.atlas-back').click()");
    check('regional atlas return restores overview', await page.eval("document.querySelector('.atlas-overview') !== null"));
    await page.eval("[...document.querySelectorAll('.layers label')].find(x => x.textContent.includes('Waypoints')).querySelector('input').click()");
    check('marker layer toggles persist through region view', await page.eval("JSON.parse(localStorage.getItem('d4-tracker:v1:prefs')).layers.waypoint === false"));
    if (shots) await page.screenshot(join(shots, 'phone.png'), true);
  }
} finally {
  await chrome.close();
  server.close();
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
