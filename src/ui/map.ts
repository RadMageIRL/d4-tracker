// The Sanctuary map: an original schematic drawn from scratch, not game imagery. Each region is a
// tile; markers sit inside their region's tile in a row, because v0.1 has no licensed
// coordinates. Selecting a region or marker shows what is known about it. Phones get a two-column
// layout of the same tiles so the names stay readable.

import type { MapData, MapLayout, MapMarker, MapRegion } from '../data/map';
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
  helltide: 'Helltide regions',
};

const LAYER_SWATCH: Record<LayerId, string> = {
  regions: 'var(--text-dim)',
  worldBoss: 'var(--boss)',
  legion: 'var(--legion)',
  helltide: 'var(--helltide)',
};

const NARROW = '(max-width: 640px)';

/** A rounded rectangle as an SVG path. */
function tilePath(x: number, y: number, w: number, hgt: number, r = 10): string {
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hgt - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(hgt - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

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
  private regionEls = new Map<string, SVGElement>();
  private markerEls: { marker: MapMarker; el: SVGElement }[] = [];
  private labelEls: SVGElement[] = [];
  private selected: string | null = null;

  constructor(private data: MapData, private hooks: MapHooks) {
    for (const id of Object.keys(LAYER_LABELS) as LayerId[]) {
      const input = h('input', { type: 'checkbox', checked: hooks.layers()[id] });
      input.addEventListener('change', () => { hooks.setLayer(id, input.checked); this.applyLayers(); });
      this.chips.append(h('label', { class: 'chip' },
        input, h('span', { class: 'swatch', style: `background:${LAYER_SWATCH[id]}` }), LAYER_LABELS[id]));
    }
    this.el = h('div', {},
      h('h2', { id: 'map-title' }, 'Sanctuary', h('span', { class: 'note' }, 'schematic, not to scale')),
      h('p', { class: 'banner' }, data.banner),
      this.chips,
      h('div', { class: 'map-wrap' }, this.holder, this.info),
    );
    const query = typeof matchMedia === 'function' ? matchMedia(NARROW) : null;
    this.draw(query?.matches ? data.layouts.narrow : data.layouts.wide);
    query?.addEventListener('change', (e) => this.draw(e.matches ? data.layouts.narrow : data.layouts.wide));
    this.showIntro();
  }

  private draw(layout: MapLayout): void {
    this.regionEls.clear();
    this.markerEls = [];
    this.labelEls = [];
    const svg = s('svg', {
      class: 'map-svg', viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group', 'aria-label': 'Schematic map of Sanctuary',
    });
    for (const g of layout.groups) svg.append(s('text', { class: 'group', x: g.x, y: g.y }, g.label));
    for (const r of this.data.regions) {
      const at = layout.tiles[r.id];
      if (at) this.drawRegion(svg, r, at.x, at.y, layout);
    }
    this.holder.replaceChildren(svg);
    this.applyLayers();
    this.highlight(this.selected);
  }

  private drawRegion(svg: SVGElement, r: MapRegion, x: number, y: number, layout: MapLayout): void {
    const shape = s('path', {
      class: 'region', d: tilePath(x, y, layout.tileWidth, layout.tileHeight), tabindex: 0, role: 'button',
      'aria-label': `${r.name}: show details`,
    });
    activate(shape, () => this.selectRegion(r.id));
    this.regionEls.set(r.id, shape);
    const cx = x + layout.tileWidth / 2;
    const labelY = y + layout.tileHeight * 0.42;
    const label = s('text', { class: 'label', x: cx, y: labelY, 'text-anchor': 'middle' }, r.name);
    this.labelEls.push(label);
    svg.append(shape, label);
    const mine = this.data.markers.filter((m) => m.regionId === r.id);
    mine.forEach((m, i) => {
      const g = s('g', {
        class: `marker ${m.layer === 'worldBoss' ? 'boss' : 'legion'}`, tabindex: 0, role: 'button',
        'aria-label': `${m.name}, ${r.name}: show details`,
      }, s('circle', { cx: cx + (i - (mine.length - 1) / 2) * 22, cy: labelY + 22, r: 7 }), s('title', {}, m.name));
      activate(g, () => this.selectMarker(m));
      this.markerEls.push({ marker: m, el: g });
      svg.append(g);
    });
  }

  private applyLayers(): void {
    const on = this.hooks.layers();
    for (const label of this.labelEls) label.style.display = on.regions ? '' : 'none';
    for (const { marker, el } of this.markerEls) el.style.display = on[marker.layer] ? '' : 'none';
    for (const r of this.data.regions) this.regionEls.get(r.id)?.classList.toggle('hot', on.helltide && r.helltide);
  }

  private highlight(id: string | null): void {
    this.selected = id;
    for (const [rid, el] of this.regionEls) el.classList.toggle('selected', rid === id);
  }

  private showIntro(): void {
    this.highlight(null);
    this.info.replaceChildren(h('h3', {}, 'Select a region'), h('p', { class: 'muted' }, this.data.intro));
  }

  private selectRegion(id: string): void {
    if (this.selected === id) { this.showIntro(); return; }
    const r = this.data.regions.find((x) => x.id === id);
    if (!r) return;
    this.highlight(id);
    const markers = this.data.markers.filter((m) => m.regionId === id);
    this.info.replaceChildren(...nodes(
      h('h3', {}, r.name),
      h('p', { class: 'muted' }, r.note),
      r.waypoints.length
        ? h('p', {}, h('strong', {}, 'Waypoints: '), r.waypoints.join(', '), ' ', badge('From Blizzard', 'confirmed'))
        : h('p', { class: 'muted' }, 'No waypoints recorded for this region yet.'),
      r.helltide ? h('p', {}, r.helltideNote) : null,
      markers.length
        ? h('ul', {}, ...markers.map((m) => h('li', {}, `${m.layer === 'worldBoss' ? 'World Boss arena' : 'Legion site'}: ${m.name} `, badge('Name', m.confidence))))
        : h('p', { class: 'muted' }, 'No event sites recorded for this region yet.'),
    ));
  }

  private selectMarker(m: MapMarker): void {
    const r = this.data.regions.find((x) => x.id === m.regionId);
    this.highlight(m.regionId);
    this.info.replaceChildren(...nodes(
      h('h3', {}, m.name),
      h('p', { class: 'muted' }, `${m.layer === 'worldBoss' ? 'World Boss arena' : 'Legion site'} in ${r?.name ?? 'Sanctuary'}`),
      h('p', {}, m.detail, ' ', badge('Name', m.confidence)),
      m.source ? h('p', { class: 'muted' }, `Source: ${m.source}`) : null,
    ));
  }
}
