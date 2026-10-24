# Changelog

## v0.3.0 (unreleased)

- Sanctuary Atlas replaces the schematic map: a stylized overview of the seven regions and an
  original illustration for each one (Fractured Peaks, Scosglen, Dry Steppes, Kehjistan, Hawezar,
  Nahantu and Skovos), opened from the overview with the mouse or keyboard, with a button back.
  All of it is drawn for this project and built into the page: no outside images, fonts, scripts
  or map services.
- Layers for waypoints, World Boss arenas, Legion sites and the regions that can host a Helltide.
  Each place shows its sources, its confidence and when its sources were checked. A place is
  pinned only when a source supports its position; none does yet, so every place is listed by
  name instead.
- Tests that the atlas art has no scripts or outside links, and browser checks for opening a
  region and going back on a phone.

## v0.2.0 (2026-10-23)

First public release, at radmagelabs.com/d4/ and radmageirl.github.io/d4-tracker/.

- Independence: every timer comes from rules kept in this repository (data/*.json); the page names
  and links no other tracker, and a test enforces it. The season panel links only Blizzard's pages.
- Data model: events, seasons and locations are JSON files where every record says Confirmed
  (Blizzard's own words, quoted, or our own sighting), Inferred, or Unknown, with its sources and
  the date it was checked. The build refuses data that breaks the rules.
- Confidence badges on every card and in the season panel; "How this is timed" shows Blizzard's
  quoted words and links; each card says how long ago its data was checked and flags it after 60
  days.
- Schedules can change on a date: the Season 16 Helltide split (base-game zones on the hour,
  expansion zones on the half hour) goes in as a dated schedule once Blizzard announces the date.
- Sightings log: record what the game showed (start time, boss, arena, region, chest spot) in the
  browser; export and import JSON files; sightings are checked against the schedule, and repeating
  rotations are reported only with enough evidence, never as proven.
- Map: Blizzard's published waypoints for each region, and a confidence badge on every arena and
  Legion site.
- The active event's card breathes (a slow glow in its color; steady under reduced motion), and the
  soonest event gets a quiet outline.
- Tab title countdown: the next event, or a chosen one, or off. Whole minutes in a background tab.
- Pop out: a small compact window for a second monitor, without changing the main window's view.
- Clock check: takes two readings of its own server's time 5 seconds apart and trusts a server time
  only if it moved in step with real time: Date when it advances, Date plus Age when only that
  advances (the cache in front of GitHub Pages sends the current time in Date together with the
  copy's Age). Frozen, jumping or malformed answers correct nothing. It checks again after the
  computer wakes or its clock is changed.
- The browser tests serve the page the way five kinds of server answer: no cache, a cache like
  GitHub's, a standard cache, a stale cache without Age, and inconsistent headers.
- The time zone is read live, so changing it while the page is open takes effect at once.
- Long-open tabs no longer keep every reminder they have fired.
- Renamed to d4-tracker (storage keys d4-tracker:v1:).
- A GitHub Pages workflow that runs by hand only, after the tests.
- Verification rules: an inferred start time becomes Confirmed only with 3 matching in-game starts
  on 2 different days and none against; a place is confirmed to exist by one sighting; a repeating
  order is never Confirmed from sightings. The data checks enforce all three, and the cards show the
  progress toward confirming a start time.
- Unknown details take one line ("Unknown · shown in game when it begins"); the full reasons and the
  rotation status are under "About this card".
- Log a sighting from the header or from any card (it opens for that event).
- The breathing glow is gentler and slower.
- Compact view in a narrow window lists one row per event, so a small pop-out never scrolls.
- The built page carries a Content-Security-Policy: nothing can load or connect outside its own
  address.
- Canonical address https://radmagelabs.com/d4/.

## v0.1 (unreleased)

First working version, local only.

- Helltide, World Boss and Legion cards: live countdowns that update every second, active or
  waiting state, when the current Helltide ends, the last World Boss and Legion start, and the next
  three starts of each.
- Schedules are calculated in the browser from Blizzard's cadences (Helltide hourly for 55
  minutes, World Boss every 3.5 hours, Legion every 25 minutes) and the cycle start points that
  community trackers agree on, checked 2026-10-23. Times are kept in UTC and shown in your time
  zone or in UTC, with a 12- or 24-hour clock.
- Helltide region, World Boss name and arena, and Legion location show as Unknown with the reason,
  since no public source forecasts them.
- The Helltide card notes the Season 16 change announced in the 3.3.0 PTR notes (expansion zones at
  :30); live servers keep the hourly schedule until then.
- Clock check: the page compares the computer's clock with its own web server's and corrects the
  countdowns when they differ by 2 seconds or more.
- Coming up: every start in the next four hours in one list.
- Season panel: the live season (Season 15, Season of Hell's Legacy) with its start and days in,
  the end and next season once announced, the Season 16 PTR window with a countdown, and every past
  season with its dates and length.
- Sanctuary map: an original schematic of the seven regions grouped by release, with layers for
  World Boss arenas, Legion sites and Helltide regions, and details with sources on selection. A
  two-column layout on phones.
- Reminders: World Boss 15, 10 or 5 minutes before, Legion 5 minutes before, Helltide when it
  begins, shown in the page and, with permission, as system notifications. The settings say what
  the browser can and cannot deliver.
- Settings: show or hide each card, compact view, dark or light theme, saved in this browser.
- Compact view keeps the cards short (countdown, time and progress only) however tall the window.
- The build is one self-contained file, dist/index.html, that runs when opened straight from disk
  with no web server, as well as on any host.
- Unit tests for the schedule math, boundaries, time zones, reminders, seasons and saved settings,
  and browser checks on the built site.
