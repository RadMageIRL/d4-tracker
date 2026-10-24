# Diablo IV Tracker

Helltide, World Boss and Legion countdowns for Diablo IV, in your own time zone, sized for a second
monitor. It is one static page: no account, no backend, no ads, no tracking, and it makes no
requests to any other site (its Content-Security-Policy blocks them). Every timer is calculated in
your browser from rules kept in this repository; it does not depend on any other tracker.

Live at https://radmagelabs.com/d4/ (planned).

![Diablo IV Tracker at 3:00 PM UTC: a Helltide just began with 55:00 left and its card glows, the World Boss spawns in 3 hours, the next Legion is in 20 minutes, with confidence badges, the schematic Sanctuary map, the sightings log, the coming-up timeline and the Season 15 panel](screenshots/dashboard.png)

## What it shows

- **Helltide.** Whether one is active (its card breathes while it is), the time left and when it
  ends, the next start, and the three after that.
- **World Boss.** A countdown to the next spawn, when the last one spawned, and the next three.
- **Legion.** A countdown to the next Legion event, when the last one started, and the next three.
- **Coming up.** Every start in the next four hours in one list.
- **Season.** The live season, when it started and how many days in it is, its end and the next
  season's start once Blizzard announces them, announced windows such as a PTR, and every past
  season with its dates and length.
- **Sanctuary.** A prototype map of the seven regions with Blizzard's published waypoints and
  layers for World Boss arenas, Legion sites and Helltide regions.
- **Sightings.** Log what you see in game (a spawn time, the boss, the arena, the Helltide region,
  a chest spot). The tracker checks your times against its schedule and looks for repeating
  rotations, and says when there is not enough data to tell.
- **Reminders.** World Boss 15, 10 or 5 minutes before, Legion 5 minutes before, Helltide when it
  begins, in the page and, if you allow them, as system notifications.
- **Tab title.** The next event's countdown (or a chosen event's) in the browser tab.
- **Second monitor.** Compact view, or **Pop out** for a small window with just the countdowns.
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

Places and rotations are separate questions. One sighting confirms that a place exists and is used.
A repeating order of places or bosses is never Confirmed from sightings, however many: only
Blizzard's own words could confirm it. Strong, repeated evidence can make it Inferred at most.

Announced changes are part of the data. Season 16 starts Helltides on the hour in base-game zones
and on the half hour in expansion zones (3.3.0 PTR notes); once its date is announced, the new
schedule is added with that date and the switch happens on its own.

## What it does not know

- **Which region has the Helltide**, **which World Boss and arena**, and **where the Legion is.**
  No public source forecasts these; the game shows them shortly before or as they start. If a
  rotation exists, logged sightings can establish it over time.
- **Where the active mystery chests are.** Logged sightings build a list of places chests have
  been seen, not where they are right now.

## Time and clocks

Times are kept in UTC and shown in your zone, so they are right in zones with half-hour offsets (a
Helltide starts at :30 in India), across daylight saving changes, and when you change time zone
while the page is open. When the page comes from a web server, it compares the computer's clock
with that server's own clock (no time service), once at load, every six hours, and after the
computer wakes or its clock is changed. If the computer is 2 seconds or more off, the countdowns
are corrected and the header says so.

## Reminders: what to expect

Reminders come from this page's own timers, so:

- They work only while the page is open in a browser tab.
- In a background tab the browser can hold timers back, so a reminder can be up to about a minute
  late, and the tab title shows whole minutes. A reminder that would be more than 3 minutes late
  (the computer was asleep) is skipped.
- Closing the tab or the browser stops them; nothing is sent from anywhere else.
- System notifications also need your browser's permission. Without it, or in browsers that do not
  allow notifications from web pages (Safari on iPhone outside an installed web app, Android
  Chrome), reminders show in the page only. The settings say which case you are in.

## Sightings

**Log a sighting** records the event, the start time from the game (or "already running"), the
region, place and boss, in your browser only. **Export** saves them as a JSON file; **Import**
merges a file back and skips duplicates. Sightings added to `data/observations.json` in this
repository are loaded for everyone.

The analysis is deliberately cautious. A start time more than 2 minutes from the schedule is
flagged. A rotation is tested only when every position in a cycle has been seen at least twice,
reported only when chance would rarely fit that well, and described as "consistent so far", never
as proven.

## Running it without a web server

`npm run build` puts everything into one file, `dist/index.html`. Open it straight from disk and it
runs; copy that one file anywhere and it still runs. Only the clock check needs a web server.

## Development

Needs Node 20.19+ or 22.12+.

```
npm install
npm run dev        # local server with reload, http://localhost:5173/
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
and that no request leaves the site. `-- --shots DIR` saves screenshots.

Layout:

```
data/          the tracker's own data: events, seasons, locations, shared sightings (JSON)
src/data/      the data's types and checks (a bad edit fails the build) and loader
src/engine/    schedules, event state, seasons, clock check, reminders, sightings analysis, title
src/adapters/  where data comes from: local schedules; details stay unknown until a source exists
src/ui/        cards, timeline, season panel, map, sightings, settings, notifications
src/store/     preferences and sightings in localStorage (key prefix d4-tracker:v1:)
tests/         unit tests, fixtures and the browser smoke test
```

## Keeping the data current

The data lives in `data/` with a checked date and sources on every record; the page shows how
long ago it was checked and flags anything older than 60 days. After a patch or a season change:

- `data/seasons.json`: add an announced season end, start or PTR window.
- `data/events.json`: close a schedule with `until` and add the next one with `from` when a timing
  change goes live.
- `data/locations.json`: add waypoints, arenas, Legion sites or chest spots, marked Confirmed only
  with a Blizzard quote or our own sighting.

`npm test` checks every file: confirmed claims need a Blizzard source (with its quoted words) or
our own observation, dates must be UTC instants, schedules must not overlap, season times must fall
on their announced Pacific day, and no data file may link to a competing tracker.

## Deploying

`dist/index.html` is the whole site and works at any address; its canonical address is
https://radmagelabs.com/d4/. `.github/workflows/pages.yml`
builds, tests and deploys it to GitHub Pages when run by hand from the Actions tab (it does not run
on push); the repository's Pages source must be set to "GitHub Actions".

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
