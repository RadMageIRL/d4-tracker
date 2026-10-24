// An original, deliberately non-navigational atlas. Geographic art and location facts stay
// separate: a name with no independently supported display position remains list-only.
import { ATLAS_ART } from '../data/atlas-art';
import type { MapData, MapMarker, MapRegion } from '../data/map';
import type { LayerId } from '../store/prefs';
import { badge } from './cards';
import { h, nodes, s } from './dom';

export interface MapHooks {
  layers: () => Record<LayerId, boolean>;
  setLayer: (id: LayerId, on: boolean) => void;
}

const LAYER_LABELS: Record<LayerId, string> = {
  regions: 'Region names',
  worldBoss: 'World Boss arenas',
  legion: 'Legion sites',
  waypoint: 'Waypoints',
  helltide: 'Helltide regions',
};

const LAYER_SWATCH: Record<LayerId, string> = {
  regions: 'var(--text-dim)',
  worldBoss: 'var(--boss)',
  legion: 'var(--legion)',
  waypoint: '#6fa9b7',
  helltide: 'var(--helltide)',
};

function activate(el: Element, run: () => void): void {
  el.addEventListener('click', (e) => { e.stopPropagation(); run(); });
  el.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') { e.preventDefault(); run(); }
  });
}

export class SanctuaryMap {
  readonly el: HTMLElement;
  private holder = h('div', {});
  private info = h('div', { class: 'map-info', 'aria-live': 'polite' });
  private chips = h('div', { class: 'layers', role: 'group', 'aria-label': 'Map layers' });
  private selected: string | null = null;

  constructor(private data: MapData, private hooks: MapHooks) {
    for (const id of Object.keys(LAYER_LABELS) as LayerId[]) {
      const input = h('input', { type: 'checkbox', checked: hooks.layers()[id] });
      input.addEventListener('change', () => { hooks.setLayer(id, input.checked); this.applyLayers(); });
      this.chips.append(h('label', { class: 'chip' },
        input, h('span', { class: 'swatch', style: `background:${LAYER_SWATCH[id]}` }), LAYER_LABELS[id]));
    }
    this.el = h('div', {},
      h('h2', { id: 'map-title' }, 'Sanctuary Atlas', h('span', { class: 'note' }, 'stylized reference, not navigation-accurate')),
      h('p', { class: 'banner' }, data.banner),
      this.chips,
      h('div', { class: 'map-wrap' }, this.holder, this.info),
    );
    this.drawOverview();
    this.showIntro();
  }

  private drawOverview(): void {
    this.selected = null;
    const svg = s('svg', { class: 'map-svg atlas-overview', viewBox: '0 0 760 430', role: 'group', 'aria-label': 'Stylized overview of Sanctuary. Select a region for its atlas.' });
    svg.innerHTML = (ATLAS_ART.sanctuary ?? '').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, '');
    const positions: Record<string, [number, number, string]> = {
      scosglen: [174, 120, 'M85 63 169 45 244 81 246 145 196 177 109 161 70 113Z'], fractured_peaks: [304, 110, 'M247 81 312 53 382 79 409 136 362 181 279 164 246 145Z'], dry_steppes: [190, 240, 'M89 176 175 170 249 204 242 281 165 307 94 270 73 220Z'], kehjistan: [317, 295, 'M240 211 330 188 402 232 397 324 318 353 241 310 218 260Z'], hawezar: [446, 222, 'M399 160 481 145 548 190 531 273 459 299 395 258Z'], nahantu: [500, 320, 'M414 287 495 267 573 302 590 363 522 389 445 367 408 329Z'], skovos: [625, 325, 'M594 299 650 282 700 311 690 355 632 370 591 340Z'],
    };
    for (const r of this.data.regions) {
      const [x, y, d] = positions[r.id]!;
      const group = s('g', { class: `atlas-region ${r.id} ${r.helltide && this.hooks.layers().helltide ? 'hot' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${r.name}, ${r.terrain}: open regional atlas` });
      activate(group, () => this.openRegion(r.id));
      group.append(s('path', { d }), s('text', { class: 'atlas-label', x, y, 'text-anchor': 'middle' }, r.name));
      const exists = this.data.markers.some((m) => m.regionId === r.id);
      if (exists) group.append(s('circle', { class: 'atlas-known', cx: x + 42, cy: y - 16, r: 4 }));
      svg.append(group);
    }
    this.holder.replaceChildren(svg);
  }

  private applyLayers(): void {
    if (this.selected) {
      const region = this.data.regions.find((r) => r.id === this.selected);
      if (region) this.showRegionInfo(region);
    } else this.drawOverview();
  }

  private showIntro(): void {
    this.selected = null;
    this.info.replaceChildren(h('h3', {}, 'Select a region'), h('p', { class: 'muted' }, this.data.intro));
  }

  private openRegion(id: string): void {
    const r = this.data.regions.find((x) => x.id === id);
    if (!r) return;
    this.selected = id;
    this.drawRegion(r);
    this.showRegionInfo(r);
  }

  private drawRegion(r: MapRegion): void {
    const art = ATLAS_ART[r.id];
    const wrapper = h('div', { class: 'regional-art', role: 'img', 'aria-label': `${r.name}, original stylized regional terrain illustration` });
    wrapper.innerHTML = art ?? '';
    const back = h('button', { class: 'btn atlas-back', type: 'button' }, '← Sanctuary overview');
    back.addEventListener('click', () => { this.drawOverview(); this.showIntro(); });
    this.holder.replaceChildren(back, wrapper);
  }

  private showRegionInfo(r: MapRegion): void {
    const markers = this.data.markers.filter((m) => m.regionId === r.id && this.hooks.layers()[m.layer]);
    this.info.replaceChildren(...nodes(
      h('h3', {}, r.name),
      h('p', { class: 'muted' }, `${r.terrain}. ${r.note}`),
      r.helltide ? h('p', {}, r.helltideNote) : null,
      markers.length
        ? h('ul', { class: 'atlas-location-list' }, ...markers.map((m) => {
          const b = h('button', { class: `location-item ${m.layer}`, type: 'button' }, `${this.typeLabel(m.layer)}: ${m.name}`, ' ', badge(m.confidence, m.confidence));
          b.addEventListener('click', () => this.selectMarker(m)); return h('li', {}, b);
        }))
        : h('p', { class: 'muted' }, 'No locations in the enabled layers for this region.'),
      h('p', { class: 'atlas-placement-note' }, 'List-only locations have no reliable display coordinate yet; no pin has been invented for them.'),
    ));
  }

  private typeLabel(layer: MapMarker['layer']): string { return ({ worldBoss: 'World Boss arena', legion: 'Legion site', waypoint: 'Waypoint', helltide: 'Helltide' } as Record<string, string>)[layer] ?? layer; }

  private selectMarker(m: MapMarker): void {
    const r = this.data.regions.find((x) => x.id === m.regionId);
    this.info.replaceChildren(...nodes(
      h('h3', {}, m.name),
      h('p', { class: 'muted' }, `${this.typeLabel(m.layer)} in ${r?.name ?? 'Sanctuary'}`),
      h('p', {}, m.detail, ' ', badge(m.confidence, m.confidence)),
      m.source ? h('p', { class: 'muted' }, `Source: ${m.source}`) : null,
      m.checkedOn ? h('p', { class: 'muted' }, `Sources checked: ${m.checkedOn}`) : null,
      !m.position ? h('p', { class: 'atlas-placement-note' }, 'Display position: unknown, so it is kept in the list rather than placed misleadingly.') : null,
    ));
  }
}
