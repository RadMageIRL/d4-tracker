// An original, deliberately non-navigational atlas. Geographic art and location facts stay
// separate: a name with no independently supported display position remains list-only.
//
// Chest spots come from our shared data and the player's own sightings. A spot gets a pin on a
// regional drawing only when someone who saw it placed it on that very drawing (the pin carries
// the drawing's fingerprint, so a redrawn map sends it back to the list). "Not verified" means
// nobody marked it during this Helltide, never that the chest is gone.
import { ATLAS_ART } from '../data/atlas-art';
import { OVERVIEW_LAYOUT, OVERVIEW_VIEWBOX } from '../data/atlas-layout';
import type { MapData, MapMarker, MapRegion } from '../data/map';
import { artHash, type ChestSpot, type ChestState } from '../engine/chests';
import { summaryLines, type RadarLight, type SummaryLine } from '../engine/radar';
import { clockTime } from '../engine/format';
import type { ArtPosition } from '../engine/observations';
import { RADAR_IDS, type ConfidenceId, type LayerId, type RadarId, type RealmChoice } from '../store/prefs';
import { badge, CONFIDENCE_LABEL, confidenceBadge, type ViewContext } from './cards';
import { h, nodes, s } from './dom';

export interface ChestView extends ChestSpot {
  state: ChestState;
}

export interface MapHooks {
  layers: () => Record<LayerId, boolean>;
  setLayer: (id: LayerId, on: boolean) => void;
  confidences: () => Record<ConfidenceId, boolean>;
  setConfidence: (id: ConfidenceId, on: boolean) => void;
  realm: () => RealmChoice;
  setRealm: (r: RealmChoice) => void;
  /** What the event radar lights now (src/engine/radar.ts): the same rule as the cards. */
  radar: () => RadarLight[];
  /** Which events the radar shows. */
  radarOn: () => Record<RadarId, boolean>;
  setRadar: (id: RadarId, on: boolean) => void;
  /** Minutes before a spawn its marker appears. */
  leads: () => { worldBoss: number; legion: number };
  /** Chest spots in one region (or every region), with their state now. */
  chests: (regionId?: string) => ChestView[];
  /** A Helltide is in progress, so a chest can be marked active. */
  helltideActive: () => boolean;
  markActive: (spot: ChestView) => void;
  addSpot: (regionId: string, pos?: ArtPosition) => void;
  placeSpot: (spot: ChestView, pos: ArtPosition) => void;
  chestTypeName: (id: string) => string;
  ctx: () => ViewContext;
}

const LAYER_LABELS: Record<LayerId, string> = {
  regions: 'Region names',
  worldBoss: 'World Boss arenas',
  legion: 'Legion sites',
  waypoint: 'Waypoints',
  helltide: 'Helltide regions',
  chests: 'Helltide chests',
};

const LAYER_SWATCH: Record<LayerId, string> = {
  regions: 'var(--text-dim)',
  worldBoss: 'var(--boss)',
  legion: 'var(--legion)',
  waypoint: '#6fa9b7',
  helltide: 'var(--helltide)',
  chests: 'var(--chest)',
};

const RADAR_LABELS: Record<RadarId, string> = { helltide: 'Helltides', worldBoss: 'World Bosses', legion: 'Legion' };
const RADAR_SWATCH: Record<RadarId, string> = { helltide: 'var(--helltide)', worldBoss: 'var(--boss)', legion: 'var(--legion)' };

/**
 * A marker pulses only when its event needs attention: an active Helltide breathes; a spawn pulses
 * in its last stretch before it starts (and while it is under way). A marker shown earlier, with a
 * longer lead-up chosen in the settings, stays still.
 */
export const PULSE_BEFORE_MS = { worldBoss: 30 * 60000, legion: 10 * 60000 };

const CONFIDENCE_IDS: ConfidenceId[] = ['confirmed', 'inferred', 'unknown'];

function activate(el: Element, run: () => void): void {
  el.addEventListener('click', (e) => { e.stopPropagation(); run(); });
  el.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') { e.preventDefault(); run(); }
  });
}

/** The fingerprint a pin needs to sit on this region's current drawing. */
export function artId(regionId: string): string {
  return `${regionId}:${artHash(ATLAS_ART[regionId] ?? '')}`;
}

export class SanctuaryMap {
  readonly el: HTMLElement;
  private holder = h('div', {});
  private info = h('div', { class: 'map-info', 'aria-live': 'polite' });
  private radarChips = h('div', { class: 'layers radar-chips', role: 'group', 'aria-label': 'Events on the radar' });
  private chips = h('div', { class: 'layers', role: 'group', 'aria-label': 'Place layers' });
  private confChips = h('div', { class: 'layers conf-filter', role: 'group', 'aria-label': 'Show by confidence' });
  /** The region whose places and chest spots are open (the secondary view), or null on the radar. */
  private selected: string | null = null;
  /** The region whose events are shown under the radar, or null for the legend. */
  private focus: string | null = null;
  /** The spot being placed, or 'new' for a new spot, while the player picks a point on the drawing. */
  private placing: ChestView | 'new' | null = null;
  private stateKey = '';
  private detail: { kind: 'marker'; marker: MapMarker } | { kind: 'chest'; key: string } | null = null;

  constructor(private data: MapData, private hooks: MapHooks) {
    for (const id of RADAR_IDS) {
      const input = h('input', { type: 'checkbox', checked: hooks.radarOn()[id] });
      input.addEventListener('change', () => { hooks.setRadar(id, input.checked); this.refresh(); });
      this.radarChips.append(h('label', { class: 'chip' },
        input, h('span', { class: 'swatch', style: `background:${RADAR_SWATCH[id]}` }), RADAR_LABELS[id]));
    }
    for (const id of Object.keys(LAYER_LABELS) as LayerId[]) {
      const input = h('input', { type: 'checkbox', checked: hooks.layers()[id] });
      input.addEventListener('change', () => { hooks.setLayer(id, input.checked); this.refresh(); });
      this.chips.append(h('label', { class: 'chip' },
        input, h('span', { class: 'swatch', style: `background:${LAYER_SWATCH[id]}` }), LAYER_LABELS[id]));
    }
    this.confChips.append(h('span', { class: 'note' }, 'Show'));
    for (const id of CONFIDENCE_IDS) {
      const input = h('input', { type: 'checkbox', checked: hooks.confidences()[id] });
      input.addEventListener('change', () => { hooks.setConfidence(id, input.checked); this.refresh(); });
      this.confChips.append(h('label', { class: `chip conf-chip conf-${id}` }, input, CONFIDENCE_LABEL[id]));
    }
    this.el = h('div', {},
      h('h2', { id: 'map-title' }, 'Sanctuary Event Radar'),
      h('p', { class: 'radar-note' }, data.banner),
      this.radarChips,
      h('div', { class: 'map-wrap' }, this.holder, this.info),
      h('details', { class: 'radar-more' },
        h('summary', {}, 'Places and chest spots'),
        h('p', { class: 'help' }, 'For the region details (select a region, then "Places and chest spots"): which places to list, and at which confidence.'),
        this.chips, this.confChips),
    );
    this.drawOverview();
    this.showIntro();
  }

  /** Called every tick: redraw only when what is shown (a light, a pulse, a mark, an expiry) changed. */
  update(): void {
    const key = this.currentKey();
    if (key === this.stateKey) return;
    this.refresh();
  }

  /** The lights the radar shows now, for the events switched on. */
  private lights(): RadarLight[] {
    const on = this.hooks.radarOn();
    return this.hooks.radar().filter((l) => on[l.kind]);
  }

  private pulsing(l: RadarLight, nowMs: number): boolean {
    return l.kind === 'helltide' || nowMs >= l.startMs - PULSE_BEFORE_MS[l.kind];
  }

  private currentKey(): string {
    const now = this.hooks.ctx().nowMs;
    const lights = this.lights().map((l) => [l.kind, l.region, l.label, l.basis, l.confidence, l.startMs, l.extra, this.pulsing(l, now)].join(':'));
    const chests = this.selected
      ? this.hooks.chests(this.selected).map((c) => `${c.key}:${c.state.state}:${c.position?.art ?? ''}${c.position?.x ?? ''}`)
      : [];
    const ctx = this.hooks.ctx();
    return [this.selected, this.focus, lights.join(','), chests.join('|'), this.hooks.realm(), this.hooks.helltideActive(),
      ctx.timeZone, ctx.clock, JSON.stringify(this.hooks.leads())].join('#');
  }

  private refresh(): void {
    this.stateKey = this.currentKey();
    if (this.selected) {
      const region = this.data.regions.find((r) => r.id === this.selected);
      if (!region) return;
      this.drawRegion(region);
      if (this.detail?.kind === 'chest') {
        const key = this.detail.key;
        const spot = this.hooks.chests(region.id).find((c) => c.key === key);
        if (spot) { this.selectChest(spot); return; }
      }
      if (this.detail?.kind === 'marker') { this.selectMarker(this.detail.marker); return; }
      this.showRegionInfo(region);
    } else {
      this.drawOverview();
      if (this.focus) this.showFocus(this.focus); else this.showIntro();
    }
  }

  private shown(confidence: ConfidenceId): boolean {
    return this.hooks.confidences()[confidence];
  }

  /** "11:00 AM", in the player's zone and clock. */
  private at(ms: number): string {
    const ctx = this.hooks.ctx();
    return clockTime(ms, ctx.timeZone, ctx.clock);
  }

  /** One line for a light, used in the tooltip and the region panel. */
  private describe(l: RadarLight): string {
    const how = l.basis === 'seen' ? 'seen in game (Confirmed)' : `predicted (${CONFIDENCE_LABEL[l.confidence]})`;
    const region = this.data.regions.find((r) => r.id === l.region)?.name ?? l.region;
    if (l.kind === 'helltide') return `Helltide in ${region}, until ${this.at(l.untilMs)}: ${how}`;
    const what = l.kind === 'worldBoss' ? `${l.extra ? 'Second World Boss' : 'World Boss'}${l.label ? `: ${l.label}` : ''}` : `Legion${l.label ? `: ${l.label}` : ''}`;
    return `${what}, ${region}, ${this.at(l.startMs)}: ${how}`;
  }

  private drawOverview(): void {
    this.selected = null;
    this.placing = null;
    this.stateKey = this.currentKey();
    const svg = s('svg', { class: 'map-svg atlas-overview', viewBox: '0 0 760 430', role: 'group', 'aria-label': 'Sanctuary event radar. Select a region for its events.' });
    svg.innerHTML = (ATLAS_ART.sanctuary ?? '').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, '');
    const lights = this.lights();
    const now = this.hooks.ctx().nowMs;
    // Markers and their labels go on a layer above every region, so no region's shape covers them.
    const overlay = s('g', { class: 'radar-overlay' });
    for (const r of this.data.regions) {
      const { x, y, d } = OVERVIEW_LAYOUT[r.id]!;
      const here = lights.filter((l) => l.region === r.id);
      const helltide = here.filter((l) => l.kind === 'helltide');
      const spawns = [...here.filter((l) => l.kind === 'worldBoss'), ...here.filter((l) => l.kind === 'legion')];
      const classes = ['atlas-region', r.id, helltide.length ? 'radar-helltide' : '',
        helltide.length && helltide.every((l) => l.basis === 'predicted') ? 'inferred' : ''].filter(Boolean).join(' ');
      const summary = here.length ? here.map((l) => this.describe(l)).join('. ') : 'nothing known here right now';
      const group = s('g', { class: classes, tabindex: 0, role: 'button', 'aria-label': `${r.name}: ${summary}. Select for details.` });
      activate(group, () => { this.focus = r.id; this.showFocus(r.id); });
      group.append(s('title', {}, `${r.name}: ${summary}`), s('path', { d }), s('text', { class: 'atlas-label', x, y, 'text-anchor': 'middle' }, r.name));
      // Rows under the name (above it near the bottom edge): the Helltide, then each spawn.
      const rows: SVGElement[] = [];
      if (helltide.length) {
        const predicted = helltide.every((l) => l.basis === 'predicted');
        rows.push(s('text', { class: 'radar-text helltide', 'text-anchor': 'middle' }, `Helltide until ${this.at(helltide[0]!.untilMs)}${predicted ? ' (Inferred)' : ''}`));
      }
      for (const l of spawns) {
        // Short on the map: the boss, or just "Legion" (the site is on the card and in the details).
        const name = l.kind === 'worldBoss' ? (l.label ?? 'World Boss') : 'Legion';
        const dot = s('g', {
          class: `radar-dot ${l.kind === 'worldBoss' ? 'boss' : 'legion'}${this.pulsing(l, now) ? ' pulse' : ''}${l.basis === 'predicted' ? ' inferred' : ''}`,
          'data-region': r.id,
        },
          s('title', {}, this.describe(l)),
          s('circle', { class: 'ring', r: 8 }), s('circle', { class: 'core', r: 6 }),
          s('text', { class: 'radar-text', x: 12, y: 4 }, `${name} ${this.at(l.startMs)}${l.basis === 'predicted' ? ' (Inferred)' : ''}`));
        activate(dot, () => { this.focus = r.id; this.showFocus(r.id); });
        rows.push(dot);
      }
      const up = y + 20 + 18 * rows.length > OVERVIEW_VIEWBOX.height;
      rows.forEach((row, i) => {
        const ry = up ? y - 20 - 18 * i : y + 20 + 18 * i;
        if (row.tagName === 'text') { row.setAttribute('x', String(x)); row.setAttribute('y', String(ry)); row.setAttribute('data-region', r.id); }
        else row.setAttribute('transform', `translate(${x - 46} ${ry - 4})`);
        overlay.append(row);
      });
      svg.append(group);
    }
    svg.append(overlay);
    this.holder.replaceChildren(...nodes(svg, this.summary(lights)));
  }

  /**
   * On a phone the labels inside the drawing are too small to read, so the same lights are also
   * written out under it, one line per event type (hidden on wider screens by the stylesheet).
   * Nothing lit, no summary.
   */
  private summary(lights: RadarLight[]): HTMLElement | null {
    const lines = summaryLines(lights);
    if (!lines.length) return null;
    const regionName = (id: string) => this.data.regions.find((r) => r.id === id)?.name ?? id;
    const inferred = (l: RadarLight) => (l.basis === 'predicted' ? ' (Inferred)' : '');
    const text = (line: SummaryLine): string => {
      const ls = line.lights;
      if (line.kind === 'helltide') {
        return `Helltide: ${ls.map((l) => `${regionName(l.region)}${inferred(l)}`).join(', ')} · until ${this.at(ls[0]!.untilMs)}`;
      }
      const name = line.kind === 'worldBoss' ? 'World Boss' : 'Legion';
      const where = ls.map((l) => `${l.label ? `${l.label}, ` : ''}${regionName(l.region)}${inferred(l)}`).join('; ');
      return `${name} ${this.at(ls[0]!.startMs)}: ${where}`;
    };
    return h('ul', { class: 'radar-summary', 'aria-label': 'Events on the radar' },
      ...lines.map((line) => h('li', { class: line.kind }, text(line))));
  }

  private showIntro(): void {
    this.focus = null;
    this.detail = null;
    const lead = this.hooks.leads();
    this.info.replaceChildren(...nodes(
      h('ul', { class: 'radar-legend' },
        h('li', { class: 'helltide' }, h('span', { class: 'key' }), 'An orange-red outline: a Helltide is on there now.'),
        h('li', { class: 'boss' }, h('span', { class: 'key' }), `A gold dot: the next World Boss, from ${lead.worldBoss} minutes before it spawns.`),
        h('li', { class: 'legion' }, h('span', { class: 'key' }), `A violet dot: the next Legion, from ${lead.legion} minutes before it starts.`)),
      h('p', { class: 'muted' }, this.data.intro),
    ));
  }

  /** The events of one region, under the radar, with the way to its places and chest spots. */
  private showFocus(id: string): void {
    const r = this.data.regions.find((x) => x.id === id);
    if (!r) { this.showIntro(); return; }
    const here = this.lights().filter((l) => l.region === id);
    const places = h('button', { class: 'btn small', type: 'button' }, 'Places and chest spots');
    places.addEventListener('click', () => this.openRegion(id));
    const all = h('button', { class: 'link', type: 'button' }, 'All regions');
    all.addEventListener('click', () => this.showIntro());
    this.info.replaceChildren(...nodes(
      h('h3', {}, r.name),
      here.length
        ? h('ul', { class: 'radar-events' }, ...here.map((l) => h('li', { class: l.kind }, this.describe(l))))
        : h('p', { class: 'muted' }, 'Nothing known here right now. A region lights only when its event was seen in game or is predicted by an order your sightings bear out.'),
      h('div', { class: 'options' }, places, all),
    ));
  }

  private openRegion(id: string): void {
    const r = this.data.regions.find((x) => x.id === id);
    if (!r) return;
    this.selected = id;
    this.detail = null;
    this.placing = null;
    this.stateKey = this.currentKey();
    this.drawRegion(r);
    this.showRegionInfo(r);
  }

  private drawRegion(r: MapRegion): void {
    const art = ATLAS_ART[r.id];
    const wrapper = h('div', { class: `regional-art${this.placing ? ' placing' : ''}`, role: 'img', 'aria-label': `${r.name}, original stylized regional terrain illustration` });
    wrapper.innerHTML = art ?? '';
    const here = artId(r.id);
    // Pins: places with a position on this very drawing, filtered like the list.
    const markers = this.data.markers.filter((m) => m.regionId === r.id && m.position && this.hooks.layers()[m.layer] && this.shown(m.confidence));
    for (const m of markers) {
      const pin = h('button', { class: `pin ${m.layer}`, type: 'button', style: `left:${m.position!.x * 100}%;top:${m.position!.y * 100}%`, 'aria-label': `${this.typeLabel(m.layer)}: ${m.name}` });
      pin.addEventListener('click', (e) => { e.stopPropagation(); this.selectMarker(m); });
      wrapper.append(pin);
    }
    if (this.hooks.layers().chests) {
      for (const c of this.hooks.chests(r.id)) {
        if (!c.position || c.position.art !== here || !this.shown(c.confidence)) continue;
        const active = c.state.state === 'active';
        const pin = h('button', {
          class: `pin chest${active ? ' active' : ''}`, type: 'button', style: `left:${c.position.x * 100}%;top:${c.position.y * 100}%`,
          'aria-label': `${this.hooks.chestTypeName(c.type)} spot: ${c.name}, ${active ? 'marked active' : 'not verified now'}`,
        });
        pin.addEventListener('click', (e) => { e.stopPropagation(); this.selectChest(c); });
        wrapper.append(pin);
      }
    }
    wrapper.addEventListener('click', (e) => {
      if (!this.placing) return;
      const box = wrapper.getBoundingClientRect();
      const pos: ArtPosition = {
        art: here,
        x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
        y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
      };
      const target = this.placing;
      this.placing = null;
      if (target === 'new') this.hooks.addSpot(r.id, pos);
      else this.hooks.placeSpot(target, pos);
      this.refresh();
    });
    const back = h('button', { class: 'btn atlas-back', type: 'button' }, '← Event radar');
    back.addEventListener('click', () => { this.drawOverview(); if (this.focus) this.showFocus(this.focus); else this.showIntro(); });
    const placingNote = this.placing
      ? h('p', { class: 'status-line warn place-hint' }, 'Click the drawing where the chest is. ', this.cancelPlacing())
      : null;
    this.holder.replaceChildren(...nodes(back, placingNote, wrapper));
  }

  private cancelPlacing(): HTMLElement {
    const b = h('button', { class: 'link', type: 'button' }, 'Cancel');
    b.addEventListener('click', (e) => { e.stopPropagation(); this.placing = null; this.refresh(); });
    return b;
  }

  private startPlacing(target: ChestView | 'new'): void {
    this.placing = target;
    const region = this.data.regions.find((r) => r.id === this.selected);
    if (region) this.drawRegion(region);
  }

  private showRegionInfo(r: MapRegion): void {
    this.detail = null;
    const markers = this.data.markers.filter((m) => m.regionId === r.id && this.hooks.layers()[m.layer] && this.shown(m.confidence));
    const now = this.lights().find((l) => l.kind === 'helltide' && l.region === r.id);
    this.info.replaceChildren(...nodes(
      h('h3', {}, r.name),
      h('p', { class: 'muted' }, `${r.terrain}. ${r.note}`),
      now ? h('p', { class: 'helltide-now' }, `Helltide here now: ${now.basis === 'seen' ? 'you saw it during this Helltide' : `predicted (${CONFIDENCE_LABEL[now.confidence]})`}. It clears when this Helltide ends.`) : null,
      r.helltide && this.hooks.layers().helltide ? h('p', {}, r.helltideNote) : null,
      markers.length
        ? h('ul', { class: 'atlas-location-list' }, ...markers.map((m) => {
          const b = h('button', { class: `location-item ${m.layer}`, type: 'button' }, `${this.typeLabel(m.layer)}: ${m.name}`, ' ', confidenceBadge(m.confidence));
          b.addEventListener('click', () => this.selectMarker(m)); return h('li', {}, b);
        }))
        : h('p', { class: 'muted' }, 'No places in the layers and confidence levels shown.'),
      h('p', { class: 'atlas-placement-note' }, 'List-only places have no reliable display position yet; no pin has been invented for them.'),
      this.hooks.layers().chests ? this.chestSection(r) : null,
    ));
  }

  private chestSection(r: MapRegion): HTMLElement {
    const all = this.hooks.chests(r.id);
    const spots = all.filter((c) => this.shown(c.confidence));
    const realm = h('select', { 'aria-label': 'Realm' },
      ...([['any', 'Either realm'], ['seasonal', 'Seasonal'], ['eternal', 'Eternal']] as const).map(([v, label]) =>
        h('option', { value: v, selected: this.hooks.realm() === v }, label)));
    realm.addEventListener('change', () => { this.hooks.setRealm(realm.value as RealmChoice); this.refresh(); });
    const add = h('button', { class: 'btn', type: 'button' }, 'Add a chest spot');
    add.addEventListener('click', () => this.hooks.addSpot(r.id));
    const addOnMap = h('button', { class: 'btn', type: 'button' }, 'Add one on the map');
    addOnMap.addEventListener('click', () => this.startPlacing('new'));
    const ctx = this.hooks.ctx();
    return h('section', { class: 'chest-section', 'aria-label': `Helltide chests in ${r.name}` },
      h('h4', {}, 'Helltide chests ', h('span', { class: 'note' }, `${spots.length} spot${spots.length === 1 ? '' : 's'}`), ' ', realm),
      spots.length
        ? h('ul', { class: 'chest-list' }, ...spots.map((c) => this.chestRow(c, ctx)))
        : h('p', { class: 'muted' }, all.length ? 'No chest spots at the confidence levels shown.' : 'No chest spots recorded here yet. Add the spots you see in game; each one stays as a candidate for later Helltides.'),
      h('div', { class: 'options' }, add, addOnMap),
      h('p', { class: 'atlas-placement-note' },
        '"Not verified now" means nobody marked it during this Helltide, not that it is empty. A mark lasts until the chest moves (players report about half an hour in) or the Helltide ends. Marks stay in this browser.'),
    );
  }

  private stateText(c: ChestView, ctx: ViewContext): string {
    if (c.state.state !== 'active') return 'Not verified now';
    const who = c.state.basis === 'seen' ? 'you saw it' : 'reported to you';
    return `Active: ${who} at ${clockTime(c.state.seenMs, ctx.timeZone, ctx.clock)}, until about ${clockTime(c.state.untilMs, ctx.timeZone, ctx.clock)}`;
  }

  private chestRow(c: ChestView, ctx: ViewContext): HTMLElement {
    const active = c.state.state === 'active';
    const open = h('button', { class: `location-item chest${active ? ' active' : ''}`, type: 'button' },
      c.name, h('span', { class: 'note' }, ` · ${this.hooks.chestTypeName(c.type)}`), ' ', confidenceBadge(c.confidence));
    open.addEventListener('click', () => this.selectChest(c));
    const mark = h('button', { class: 'btn small', type: 'button', disabled: !this.hooks.helltideActive() || (active && c.state.state === 'active' && c.state.basis === 'seen'),
      title: this.hooks.helltideActive() ? 'You see it in game now' : 'No Helltide is in progress' }, 'Mark active now');
    mark.addEventListener('click', () => { this.hooks.markActive(c); this.refresh(); });
    const place = h('button', { class: 'btn small', type: 'button' }, c.position?.art === artId(c.region) ? 'Move pin' : 'Place on map');
    place.addEventListener('click', () => { this.detail = { kind: 'chest', key: c.key }; this.startPlacing(c); });
    return h('li', { class: active ? 'active' : '' }, open, h('span', { class: `chest-state${active ? ' active' : ''}` }, this.stateText(c, ctx)), mark, place);
  }

  private typeLabel(layer: MapMarker['layer']): string { return ({ worldBoss: 'World Boss arena', legion: 'Legion site', waypoint: 'Waypoint', helltide: 'Helltide' } as Record<string, string>)[layer] ?? layer; }

  private selectMarker(m: MapMarker): void {
    this.detail = { kind: 'marker', marker: m };
    const r = this.data.regions.find((x) => x.id === m.regionId);
    this.info.replaceChildren(...nodes(
      h('h3', {}, m.name),
      h('p', { class: 'muted' }, `${this.typeLabel(m.layer)} in ${r?.name ?? 'Sanctuary'}`),
      h('p', {}, m.detail, ' ', confidenceBadge(m.confidence)),
      m.source ? h('p', { class: 'muted' }, `Source: ${m.source}`) : null,
      m.checkedOn ? h('p', { class: 'muted' }, `Sources checked: ${m.checkedOn}`) : null,
      !m.position ? h('p', { class: 'atlas-placement-note' }, 'Display position: unknown, so it is kept in the list rather than placed misleadingly.') : null,
      this.backToRegion(),
    ));
  }

  private selectChest(c: ChestView): void {
    this.detail = { kind: 'chest', key: c.key };
    const r = this.data.regions.find((x) => x.id === c.region);
    const ctx = this.hooks.ctx();
    const here = artId(c.region);
    const where = !c.position ? 'Not placed on the map: shown in the list only.'
      : c.position.art === here ? 'Placed on this drawing by someone who saw it (approximate).'
        : 'Placed on an earlier version of this drawing: place it again to show a pin.';
    const origin = c.origin === 'shared'
      ? `In the tracker's own data${c.source ? ` (${c.source})` : ''}${c.checkedOn ? `, checked ${c.checkedOn}` : ''}.`
      : `From your own sightings only (${c.sightings} so far). ${c.confidence === 'confirmed' ? 'You saw it yourself, so it is Confirmed for you.' : 'Only reported to you, so it stays Unknown until you see it.'}`;
    this.info.replaceChildren(...nodes(
      h('h3', {}, c.name),
      h('p', { class: 'muted' }, `${this.hooks.chestTypeName(c.type)} spot in ${r?.name ?? 'Sanctuary'}`),
      h('p', {}, badge('Spot', c.confidence), ' ', h('span', { class: `chest-state${c.state.state === 'active' ? ' active' : ''}` }, this.stateText(c, ctx))),
      h('p', { class: 'muted' }, origin),
      c.lastSeenMs !== null ? h('p', { class: 'muted' }, `Last sighting: ${new Date(c.lastSeenMs).toISOString().slice(0, 10)}`) : null,
      h('p', { class: 'atlas-placement-note' }, where),
      this.backToRegion(),
    ));
  }

  private backToRegion(): HTMLElement {
    const b = h('button', { class: 'link', type: 'button' }, `Back to ${this.data.regions.find((x) => x.id === this.selected)?.name ?? 'the region'}`);
    b.addEventListener('click', () => {
      const r = this.data.regions.find((x) => x.id === this.selected);
      if (r) this.showRegionInfo(r); else this.showIntro();
    });
    return this.selected ? b : h('span', {});
  }
}
