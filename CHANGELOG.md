# Changelog

## v0.7.2 (2026-10-25)

- Coming up by event. Pick All, Helltide, World Boss or Legion above the list. One event picked
  lists only its starts, each with what is predicted for it on a line of its own: the Helltide's
  regions, the World Boss's boss, the Legion's candidates. World Boss looks a whole day ahead (about
  seven spawns); the others six hours. The pick is remembered.

## v0.7.1 (2026-10-25)

- Six Legion candidates. The Legion card's Location reads "6 candidates · predicted": the group's
  four base-game sites and the two expansion sites of its turns (Siege of Chakhir Ruins or Cosmic
  Archives with one group, Of Souls and Spirits or Pirate Invasion with the other). Open it for all
  six; the expansion site the order predicts is listed first, labeled Predicted. Later predictions
  count the same way.
- Cosmic Archives seen in game. Its Legion appeared at its predicted turn once its stronghold was
  cleared, after earlier turns showed no second Legion, so its line now says "shows once its
  stronghold is cleared". All four expansion sites have now been seen in game.

## v0.7.0 (2026-10-24)

- Expansion Legion intelligence. An expansion-region Legion runs beside the base-game one, and the
  Legion card now predicts its site, provisionally: one per Legion in a fixed order of four,
  repeating every 100 minutes (Siege of Chakhir Ruins, Of Souls and Spirits in Nahantu; Cosmic
  Archives, Pirate Invasion in Skovos), fitted to in-game checks. It sits inside the folded
  "4 candidates", on its own line, labeled Predicted. Coming up notes each Legion start's
  expansion region ("Legion starts (also Skovos)"), and Later predictions and About this card cover
  it.
  No Cosmic Archives marker has been seen in game, so its line says its visibility may depend on
  campaign or stronghold progress. A Legion you log as seen replaces the prediction. The radar
  lights nothing for it; the base-game countdown, groups and candidates are unchanged. The order
  can be switched off in the data on its own.
- Legion sites. Nahantu's Legions are Siege of Chakhir Ruins and Of Souls and Spirits (the earlier
  Chakhir, Viz-jun and Basin of Souls entries were two events under three names); Skovos's Pirate
  Invasion and Cosmic Archives are added. Twelve sites, matching the game's own list.
- Coming up looks 6 hours ahead (it showed at most 10 starts, under 3 hours). On a narrow screen a
  Legion row's "(also ...)" moves to the next line whole instead of splitting.

## v0.6.0 (2026-10-24)

- Helltide region predictions. The Helltide card names the region of the Helltide in progress,
  base-game and expansion, labeled Predicted, and the Event Radar lights it with a dashed,
  breathing outline marked (Predicted). The base-game Helltide moves one region along a fixed cycle
  every hour (Fractured Peaks, Scosglen, Dry Steppes, Kehjistan, Hawezar): community trackers'
  records of the current region fit it in every recorded hour since 2026-04-29 19:00 UTC (2,083
  hours). The expansion Helltide follows an hourly pattern (Skovos, none, Nahantu, none) with fewer
  checks behind it. Later Helltides' regions are under "Later predictions".
- Legion sites. The Legion card's Location reads "4 candidates · predicted"; open it for the
  sites. The base-game Legion comes from one of two groups of four, and the group alternates every
  Legion (community tracker records fit every recorded Legion since 2026-03-18). Which site it is,
  is not predicted, so the radar shows a Legion dot only for a site seen in game. An expansion
  Legion (Nahantu, Skovos) can run at the same time; one you log shows beside the candidates.
  Chakhir and Viz-jun (Nahantu) are now Legion sites in the data.
- Helltide is here: during a Helltide, select a region on the radar and mark it in one click. It
  lights as seen until the Helltide ends, and the card shows it. A mark corrects its own Helltide
  only; it does not move the cycle.
- When to look: from an hour before a World Boss the card says "Check in-game map for boss and
  location", and from ten minutes before a Legion "Check in-game map for exact location"; the hint
  goes when the event starts.
- World Boss arenas are no longer predicted, nor the region of a double spawn's second boss: no
  arena order holds in tracker records. The boss is still predicted, and the arena list stays.
- Less on the cards: a Boss or Location row with nothing known yet stays hidden (the reason is under
  About this card).
- The README screenshot shows v0.6.

## v0.5.0 (2026-10-24)

- World Boss predictions. The card names the boss and arena of the next spawn, labeled Predicted
  (later spawns' predictions are folded under "Later predictions"), and the Event Radar lights the
  arena's region with a gold dot marked (Predicted). They follow the 8-spawn boss order community
  trackers publish, with each spawn's arena, pinned to a spawn checked in game; each pin is used
  for 7 days, because first-hand reports show the order shifting between weeks. At a double spawn the second boss's region is predicted too (Nahantu and
  Skovos in turn); which boss it is, is not.
- What you see beats what is predicted: a boss you log for a spawn shows as seen, and the rotation
  re-pins to it in your browser. A boss someone told you about does neither; it stays in the
  prediction's note.
- Predictions say Predicted everywhere (cards, radar, phone summary), instead of Inferred.

## v0.4.0 (2026-10-24)

- What you log shows on the cards: the boss and arena you logged for a World Boss spawn, the
  region you marked for the Helltide in progress, the site of a Legion. Each says whether you saw
  it or someone told you, and it clears when that event is over. The World Boss card keeps what
  was seen on its Last line.
- Every fourth World Boss brings a second one in an expansion region. The card, its list of later
  spawns and Coming up say so (Inferred: every dated first-hand report of two at once since
  October 2024 falls on these spawns; Blizzard does not document it).
- Order predictions, from sightings only. The tracker looks for a repeating order of World Boss
  bosses and arenas, Helltide regions (base-game and expansion regions apart, since both can run
  at once) and Legion sites. An order counts only after it predicts 3 or more later sightings right,
  none wrong, with a lucky match under 1%; it is then Inferred, never Confirmed. A sighting that
  breaks it withdraws it and learning starts again from there. Orders can also be registered from a
  source (data/rotations.json) and are shown only once later sightings bear them out. None is
  registered or inferred today: the research found no order that holds.
- The Sanctuary Atlas is now the Sanctuary Event Radar: the seven regions at a glance, with a
  breathing orange-red outline on each region that has a Helltide on, a gold dot (boss and time)
  for the next World Boss from 30 minutes before (15 or 60 in the settings), and a violet dot for
  the next Legion from 10 minutes before. Markers pulse only when their event is close; nothing
  moves under reduced motion. A region lights only when its event's place is known, seen in game
  or predicted by an order the sightings bear out (labeled Inferred); a report, an unchecked
  third-party prediction or a region that merely has an arena never lights it, and lights go out
  when the event is over. The cards follow the same rule, so they tell the same story: a report
  nobody checked shows only as a note ("reported: ..., not checked"), and places show with their
  region ("Seared Basin, Kehjistan"). On a phone, where the labels in the drawing are too small,
  the lit events are also written out under it, one line per event type.
- A region's details (secondary) list its places and Helltide chest spots: "Active" when someone
  marked them during this Helltide, or "Not verified now", never "inactive". A mark lasts until the
  chests move (players report about half an hour in) or the Helltide ends. Chest types: Tortured
  Gift of Mysteries, Hell's Prize, and the other Tortured Gifts.
- Sightings record whether you saw it yourself or were told (only your own sightings count as
  evidence), the realm, Hardcore, and the chest type. Files are version 2; version 1 files still
  import. Records with unknown values, markup or out-of-range placements are refused or kept as
  plain text.
- The World Boss, Helltide and Legion notes say what the research found: no source documents or
  claims an order for any of them.
- The overview places the regions as published descriptions do: Scosglen in the north, the Dry
  Steppes and Kehjistan in the west, the Fractured Peaks toward the middle, Hawezar in the
  south-east, Nahantu the southernmost with its north-east reaching Hawezar, and the Skovos islands
  off Nahantu's western coast. A test checks each placement against its source.
- The World Boss and Legion start-time sources link to the README's explanation instead of naming
  a file that is not published.
- The README screenshot shows v0.4.
- Ashava is Confirmed in the World Boss roster, seen in game on 2026-10-24.
- A sighting can note where a prediction was first shown, apart from whether it was checked in
  game; one that was not checked is never used as evidence or shown on a card. Reports kept in the
  tracker's own data are not shown on the cards either; only your own are.
- The 8-spawn World Boss order other trackers publish is registered to be tested (it predicts
  nothing until our in-game sightings bear it out). Dated first-hand reports fit one place in it
  for two days at most.
- A start time's confirmation counts distinct spawns, dated by the spawn: two records of one spawn
  (a double spawn, or the same one logged twice) count once.

## v0.3.0 (2026-10-24)

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
