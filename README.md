# Diablo IV Tracker

Helltide, World Boss and Legion countdowns for Diablo IV, in your own time zone, sized for a second
monitor. It is one static page: no account, no backend, no ads, no tracking, and it makes no
requests to any other site (its Content-Security-Policy blocks them). The one thing it fetches is
Latest news, and only once you open it, from its own address. Every timer is calculated in your
browser from rules kept in this repository; it does not depend on any other tracker.

Live at https://radmagelabs.com/d4/

![Diablo IV Tracker v0.7.6 at 8:21 PM UTC on a first visit: the Latest news bar from Blizzard News, closed, above the cards; an active Helltide with 33:47 left, predicted in Fractured Peaks and Skovos, which the Sanctuary Event Radar outlines in red; the World Boss in 38:47 with its predicted boss, Wandering Death, a second World Boss in an expansion region, a Mark done link on the last spawn and a prompt to check the in-game map for boss and location; the next Legion in 8:47 with its six candidate sites folded, four base-game and two expansion, and a prompt to check the in-game map; six hours of coming-up starts with a how-far-ahead dropdown, Add to calendar, and All, starred, Helltide, World Boss and Legion picks, each Legion with its predicted expansion region; the empty sightings log; the Season 15 panel with the 3.3.0 PTR running; and the footer, ending with Source on GitHub, Share, Feedback and Buy me a coffee](screenshots/dashboard.png)

## What it shows

- **Helltide.** Whether one is active (its card breathes while it is), the time left and when it
  ends, the next start, and the three after that. Mark the region it is in (a base-game and an
  expansion Helltide can run at once) and the card and the radar show it until that Helltide ends.
- **World Boss.** A countdown to the next spawn, when the last one spawned, the next three, and
  the predicted boss. Every fourth spawn brings a second World Boss in an expansion region, and the
  card says so. From an hour before a spawn the card says to check the in-game map, which then shows
  the boss and its arena.
- **Legion.** A countdown to the next Legion event, when the last one started, the next three, and
  its six candidate sites, four base-game and two expansion. From ten minutes before, the card says
  to check the in-game map.
- **Done.** Once you have done a World Boss or a Legion, mark it done on its card. The card says
  "done, marked by you" (the tracker cannot see the game), Coming up dims that event, and the mark
  clears by itself when the next one starts.
- **Coming up.** Every start in the next six hours in one list. Pick Helltide, World Boss or Legion
  to list only that event's starts, each with what is predicted for it: the Helltide's regions, the
  World Boss's boss, the Legion's candidates. The dropdown beside the heading sets how far ahead
  each list looks, 6 to 24 hours (the World Boss starts at a day and goes up to 72 hours), and
  each list remembers its own. Star an event (☆ beside
  its name on its card) and the ★ pick lists just your starred events. **Add to calendar** saves
  what the list shows as a calendar file (.ics) for Google Calendar, Outlook or Apple Calendar: each
  start with its prediction written out and a reminder (your own reminder time for that event,
  otherwise 10 minutes before). Importing it again updates those starts instead of adding copies.
- **Latest news.** A bar above the cards, closed until you open it, with the eight newest posts
  from Blizzard News (patch notes, PTRs, season updates and the rest), each with its category, its
  date and a link to the post on news.blizzard.com. Opening it asks radmagelabs.com, which passes
  Blizzard's Diablo IV news list through, so your browser does not contact Blizzard. The headlines
  are kept in this browser for 15 minutes, the bar remembers whether you left it open, and compact
  view and the pop-out leave it out. At radmageirl.github.io it links to Blizzard News instead.
- **Season.** The live season, when it started and how many days in it is, its end and the next
  season's start once Blizzard announces them, and announced windows such as a PTR while they are
  coming up or running. Folded under Past seasons: every past season with its dates and length,
  and every window that has ended.
- **Sanctuary Event Radar.** The seven regions at a glance: a region with a Helltide on breathes
  red (a dashed outline, as the game's map draws it), and a World Boss or Legion seen in game is a
  gold or violet dot in its region (from 30 minutes before a World Boss, or 15 or 60 as you choose,
  and 10 minutes before a Legion). The legend lists only what is shown. A marker pulses
  only when its event is close. A region lights when its event's place is seen in game or
  predicted (labeled Predicted), the same as on the cards. Unlit means not known yet. During a
  Helltide, select the region the game shows and choose **Helltide is here**: it lights as seen
  until the Helltide ends. On a phone the same events are written out under it, one line each.
  Regions sit where published descriptions place them (a test checks each), but it is a regional
  overview, not a navigation map.
- **Places and chest spots** (a region's details, secondary): its waypoints, World Boss arena and
  Legion sites with their sources, and the Helltide chest spots you log. Mark a chest active when
  you see it and it shows as active until the chests move (players report about half an hour in)
  or the Helltide ends; otherwise it says "not verified now", never "inactive".
- **Sightings.** Log what you see in game (a spawn time, the boss, the arena, the Helltide region,
  a chest spot). The tracker checks your times against its schedule, re-pins the World Boss
  rotation to what you saw, and tests for other repeating orders.
- **Reminders.** 15, 10 or 5 minutes before a World Boss, a Legion or a Helltide (and when a
  Helltide begins), in the page with an optional sound and, if you allow them, as system
  notifications. Your choices are kept in this browser.
- **Tab title.** While the tab is in the background, the next event's countdown (or a chosen
  event's) in whole minutes. With the tab in view the title is the page's own name, since the
  countdowns are on the page. The pop-out window's title counts down all the time.
- **Second monitor.** Compact view, or **Pop out** for a small window with just the countdowns. A
  star or a done mark set in one window shows in the other.
- **Settings.** Show or hide each panel, dark (default) or light, 12- or 24-hour clock, your time
  zone or UTC. Saved in this browser only.

## How sure each piece is

Every piece of data carries one of three labels, shown as badges on the page:

- **Confirmed**: in Blizzard's own words (patch notes, announcements), quoted and linked in the
  data, or seen in game by us.
- **Inferred**: consistent across secondary sources or reasoning, not yet confirmed by Blizzard or
  by our own observation.
- **Unknown**: not available. Shown as Unknown with the reason; never guessed.

| Event | Interval | Where the cycle starts |
| --- | --- | --- |
| Helltide | every hour, active 55 minutes (Confirmed, patch 1.3.0) | on the hour, UTC (Confirmed, same note) |
| World Boss | every 3.5 hours (Confirmed, patch 1.2.0) | Unix time mod 12600 = 10800, e.g. 04:00, 07:30, 11:00 UTC on 2026-10-24 (Inferred) |
| Legion | every 25 minutes (Confirmed, patch 1.2.0) | Unix time mod 1500 = 1200, e.g. 01:35, 02:00, 02:25 UTC (Inferred) |

Blizzard publishes the intervals but not where the World Boss and Legion cycles start. Those start
points are marked Inferred until our own in-game sightings confirm them: **at least three in-game
starts that match the schedule, on at least two different (UTC) days, and none that disagree.** The
data checks refuse a Confirmed start point without that, and the cards show the progress.

Every fourth World Boss spawn (Unix time mod 50400 = 10800, every 14 hours) brings a second boss in
an expansion region. That is Inferred: Blizzard does not document it, and every dated first-hand
report of two at once on Blizzard's forums, from October 2024 to September 2026, falls on these
spawns.

**Predicted** marks a World Boss's boss worked out from a rotation rather than seen. Blizzard
documents no order, so a prediction is never Confirmed and can be wrong. The tracker follows the
8-spawn boss order community trackers publish, pinned to a spawn checked in game
(`data/rotations.json`). First-hand reports show the place in that order shifting between weeks, so
each pin is used for 7 days. A boss you log as seen re-pins it, in your browser. The arena is not
predicted: tracker records follow no arena order, and every boss turns up in every region. The game
names both the boss and the arena on its map about an hour before the spawn.

Helltide regions are Predicted too. The base-game Helltide moves one region along a fixed cycle
every hour (Fractured Peaks, Scosglen, Dry Steppes, Kehjistan, Hawezar, then again), so it never
stays in one region two hours running: community trackers' records of the current region fit this
in every recorded hour since 2026-04-29 19:00 UTC, 2,083 hours across two season starts. The
expansion Helltide follows an hourly pattern (Skovos, none, Nahantu, none) that has fewer checks
behind it. A region you mark shows as seen for that Helltide only; it does not move the cycle. A
new Helltide schedule (Season 16 moves expansion Helltides to the half hour) stops the predictions
until the cycles are pinned again.

Legion sites are predicted as a group. The base-game Legion comes from one of two groups of four
sites (Kor Dragan, Carrowcrest Ruins, Dilapidated Aqueducts, Alcarnus; or Haunted Wreckage,
Crusader's Monument, Norgoi Vigil, Temple of Rot), and the group alternates every Legion: community
tracker records of the group fit this for every recorded Legion since 2026-03-18. The Legion card
shows "6 candidates", folded, labeled Predicted: the group's four sites and two expansion sites.
Which base-game site it is, is not predicted, so the radar shows a Legion only once its site is
seen. An expansion-region Legion runs at the same time, and its site is predicted on its own,
provisionally: one per Legion in a fixed order of four, repeating every 100 minutes (Siege of
Chakhir Ruins, Of Souls and Spirits in Nahantu; Cosmic Archives, Pirate Invasion in Skovos), fitted
to in-game checks. The predicted one is listed first, labeled Predicted, then the other expansion
site of that group's turns; neither lights anything on the radar. Cosmic Archives shows in game
only once its stronghold is cleared: its turns showed no second Legion before that, and it appeared
at its predicted turn after. One you log as seen shows beside the candidates instead.

Without these models in the data, the tracker looks for a repeating order in your own sightings
instead. Such an order is never Confirmed, however many sightings fit: only Blizzard's own words
could confirm it. It becomes Inferred only after it predicts later sightings: **at least three
correct predictions, none wrong, on sightings it was not found in, with a lucky match under 1%**
(judged against a guesser who knows how often each value has turned up). A sighting that breaks it
withdraws it, and learning starts again from there, with a stricter bar each time.

Announced changes are part of the data. **Pending: the Season 16 Helltide change.** Blizzard's
3.3.0 PTR notes say Helltides will start on the hour in base-game zones and on the half hour in
expansion zones. Blizzard has not announced when Season 16 starts, so the tracker keeps the
current schedule (every Helltide on the hour), the Helltide card says so, and no date is guessed.
Once the date is announced, an update adds it: the current schedule ends then, the base-game
Helltide keeps its times on the hour, and the expansion Helltide gets its own times on the half
hour. The tracker counts one Helltide schedule at a time today, so that last part needs code as
well as data. Helltide region predictions stop at the switch until the new cycles are checked in
game.

## What it does not know

- **Which site the Legion is at.** The card lists the four possible sites of the base-game
  Legion; the game marks the site shortly before it starts: log it and the card shows it.
- **Which arena the World Boss uses.** The in-game map shows it about an hour before the spawn.
- **Which World Boss, and which Helltide regions, for certain.** They are predicted, not known: the
  World Boss order has shifted between weeks before, and the Helltide cycle could change with a
  patch.
- **Which chests are active right now.** Chest spots are a fixed set in each Helltide zone and the
  active ones move during a Helltide, by players' reports. Only someone in that Helltide can say
  which are active; a region's details keep the spots you log and let you mark the active ones.
- **Realmwalkers.** Not tracked: they were seasonal. In Season 6 one spawned every 15 minutes in a
  rotating region; in Season 14 they came out of Pandemonium Ruptures. Neither runs in Season 15,
  and nothing in the game schedules them now, so there is no time to count down to. They will be
  looked at again when Season 16's mechanics are announced.

## Time and clocks

Times are kept in UTC and shown in your zone, so they are right in zones with half-hour offsets (a
Helltide starts at :30 in India), across daylight saving changes, and when you change time zone
while the page is open. When the page comes from a web server, it compares the computer's clock
with that server's own clock (no time service), once at load, every six hours, and after the
computer wakes or its clock is changed. Caches in front of a web server report time differently
(GitHub Pages' cache sends the current time with the copy's age), so each check takes two readings
a few seconds apart and trusts only a server time that moved in step with real time. If the
computer is a couple of seconds or more off, the countdowns are corrected and the header says so;
if the answers are inconsistent, nothing is corrected and the settings say why.

## Reminders: what to expect

Reminders come from this page's own timers, so they are not guaranteed:

- They work only while the page is open in a browser tab.
- The sound plays once you have clicked anywhere in the page since opening it (browsers keep a
  page silent until then).
- In a background tab the browser can hold timers back, so a reminder can be up to about a minute
  late, and the tab title shows whole minutes. A reminder that would be more than 3 minutes late
  (the computer was asleep) is skipped.
- Closing the tab or the browser stops them; nothing is sent from anywhere else.
- System notifications also need your browser's permission. Without it, or in browsers that do not
  allow notifications from web pages (Safari on iPhone outside an installed web app, Android
  Chrome), reminders show in the page only. The settings say which case you are in.

## Sightings

**Log a sighting** records the event, the start time from the game (or "already running"), the
region, place, boss or chest type, the realm and Hardcore, and whether you saw it yourself or
someone told you, in your browser only. What someone told you is shown as reported and never used
as evidence. **Export** saves them as a JSON file (version 2; version 1 files still import);
**Import** merges a file back, skips duplicates and refuses records it cannot read. Sightings added
to `data/observations.json` in this repository are loaded for everyone. A World Boss you saw
yourself re-pins the rotation; a reported one does not. Orders someone describes can be added to
`data/rotations.json` to be tested; they show only once later sightings bear them out.

The analysis is deliberately cautious. A start time more than 2 minutes from the schedule is
flagged. An order is looked for only when every position in a cycle has been seen at least twice,
and counts only after it predicts later sightings, as above. Sightings from before the current
season are not used, and a known upcoming season start ends any prediction.

## Feedback

To report a problem or suggest something, open an issue on [GitHub Issues](https://github.com/RadMageIRL/d4-tracker/issues). If you'd like to support future projects, you can [buy me a coffee](https://buymeacoffee.com/radmageirl).

## Running it without a web server

`npm run build` puts everything into one file, `dist/index.html`. Open it straight from disk and it
runs; copy that one file anywhere and it still runs. Only the clock check needs a web server.

## Development

Needs Node 20.19+ or 22.12+.

```
npm install
npm run dev        # local server with reload, http://localhost:5173/ (passes news.json through)
npm test           # unit tests and the data checks (vitest)
npm run typecheck
npm run build      # type check, then dist/index.html
npm run smoke      # browser checks on dist/ in headless Chrome (run the build first)
npm run preview    # serve dist/ locally (or just open dist/index.html)
```

`npm run smoke` needs Chrome or Edge (or `CHROME_PATH`). It serves the build under a project path
with a shifted clock and checks: the Helltide rollover, other time zones and a zone change while
open, the clock correction, sleep and wake, a system clock jump, reminders with notifications
allowed, the breathing card and reduced motion, the tab title, logging, exporting and importing
sightings, the settings, compact and pop-out views, the phone layout, opening the file from disk,
the World Boss double spawn, a logged boss and a marked Helltide region showing until their event
ends, the event radar (the right regions lit, two Helltides at once, lead-up windows, pulses only
near the event, expiry, the same story as the cards, reduced motion, phone and compact), chest
spots marked active, expiring and placed on the drawing, realms kept apart, a hostile import file,
Latest news (closed and silent until opened, the headlines from a saved copy of Blizzard's list, the
kept copy, Blizzard not answering, GitHub Pages, opened from disk, compact and pop-out), and that no
request leaves the site. `-- --shots DIR` saves screenshots.

Layout:

```
data/          the tracker's own data: events, seasons, locations, the World Boss rotation, shared sightings (JSON)
src/data/      the data's types and checks (a bad edit fails the build) and loader
src/engine/    schedules, event state, seasons, clock check, reminders, sightings analysis, the
               World Boss rotation, order predictions, chest spots, title, news list reading
src/adapters/  where data comes from: local schedules; details from sightings and predictions
src/ui/        cards, timeline, season panel, map, sightings, settings, notifications, news bar
src/store/     preferences, sightings and the latest headlines in localStorage (key prefix d4-tracker:v1:)
tests/         unit tests, fixtures and the browser smoke test
```

## Keeping the data current

The data lives in `data/` with a checked date and sources on every record; the page shows how
long ago it was checked and flags anything older than 60 days. After a patch or a season change:

- `data/seasons.json`: add an announced season end, start or PTR window. A window that has ended
  stays in the file; the page moves it under Past seasons by itself.
- `data/events.json`: close a schedule with `until` and add the next one with `from` when a timing
  change goes live.
- `data/locations.json`: add waypoints, arenas, Legion sites or chest spots, marked Confirmed only
  with a Blizzard quote or our own sighting (a chest spot only with our own sighting).
- `data/rotations.json`: when a World Boss is seen in game that the rotation got wrong, move the
  pin to that spawn (`pin.start` and its `position` in the cycle); when a pin runs out, add a new
  one. Do the same for a Helltide region (`helltide.base` or `helltide.expansion`) checked in game
  that the cycle got wrong, and after a new Helltide schedule starts. Register an order someone describes, with its source and the day it was added; only
  sightings after that day test it. Add a reset when a patch is known to restart an order.

`npm test` checks every file: confirmed claims need a Blizzard source (with its quoted words) or
our own observation, dates must be UTC instants, schedules must not overlap, season times must fall
on their announced Pacific day, and no data file may link to a competing tracker.

## Deploying

`dist/index.html` is the whole site and works at any address; its canonical address is
https://radmagelabs.com/d4/. `.github/workflows/pages.yml`
builds, tests and deploys it to GitHub Pages when run by hand from the Actions tab (it does not run
on push); the repository's Pages source must be set to "GitHub Actions".

GitHub Pages serves it at https://radmageirl.github.io/d4-tracker/, and https://radmagelabs.com/d4/
serves the same file through the RadMage Labs site. Browsers keep settings and sightings per
address, so each address has its own.

Latest news reads `news.json` next to the page. Blizzard's Diablo IV news list
(https://news.blizzard.com/en-us/api/feed/diablo-4) does not allow cross-origin reads, so
radmagelabs.com rewrites `/d4/news.json` to it. GitHub Pages cannot, so at `/d4-tracker/` the bar
links to Blizzard News instead. The list is the one Blizzard's own news page reads, not a published
feed: if it changes, the bar says the news could not load and links to Blizzard News, and the
timers carry on. `npm run dev` and `npm run preview` pass `news.json` through the same way.

## Dependencies and licenses

The built page contains no third-party code and loads nothing at run time: it is this project's
own code, styles and data in one file. There are no runtime dependencies. The development tools,
which are not shipped, are:

| Package | License | Used for |
| --- | --- | --- |
| vite | MIT | the dev server and the build |
| vitest | MIT | the unit tests |
| typescript | Apache-2.0 | type checking |

With their own dependencies that is 81 packages in `package-lock.json`: 44 MIT, 23 Apache-2.0
(TypeScript and its per-platform binaries, and two small helpers), 12 MPL-2.0 (lightningcss, the CSS
minifier Vite uses, and its per-platform binaries), 1 ISC and 1 BSD-3-Clause. The browser tests drive
an installed Chrome directly and add no packages.

## License

MIT, see [LICENSE](LICENSE). The license covers the code and this project's own data compilation.
Diablo, its place and character names, and the short Blizzard quotations in `data/` belong to
Blizzard Entertainment.

Diablo IV Tracker is an unofficial fan tool, not affiliated with or endorsed by Blizzard
Entertainment. Diablo and Blizzard Entertainment are trademarks or registered trademarks of
Blizzard Entertainment, Inc. in the U.S. and/or other countries.
