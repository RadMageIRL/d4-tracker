import { describe, expect, it } from 'vitest';
import { MAP_DATA } from '../src/data';
import { OVERVIEW_LAYOUT, OVERVIEW_VIEWBOX } from '../src/data/atlas-layout';

// The overview is a schematic, but where regions sit relative to each other must match what
// published sources say (each quote checked in the saved page, 2026-10-24). SVG y grows downward:
// "north of" means a smaller y. Kehjistan below the Dry Steppes is drawn but not asserted: no
// source checked so far says it.
const at = (id: string) => OVERVIEW_LAYOUT[id]!;
const northOf = (a: string, b: string) => at(a).y < at(b).y;
const westOf = (a: string, b: string) => at(a).x < at(b).x;
const CONTINENT = ['scosglen', 'fractured_peaks', 'dry_steppes', 'kehjistan', 'hawezar', 'nahantu'];

/** The points of an outline made of absolute M and L commands; one polygon per M. */
function polygons(d: string): [number, number][][] {
  return d.split('M').filter((s) => s.trim()).map((part) => {
    const nums = part.replace(/[LZ]/g, ' ').trim().split(/[\s,]+/).map(Number);
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
    return pts;
  });
}

function inside([x, y]: [number, number], poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

describe('the overview layout', () => {
  it('places every region once, and only real regions', () => {
    expect(Object.keys(OVERVIEW_LAYOUT).sort()).toEqual(MAP_DATA.regions.map((r) => r.id).sort());
  });

  it('keeps every outline inside the drawing', () => {
    for (const r of Object.values(OVERVIEW_LAYOUT)) {
      for (const [x, y] of polygons(r.d).flat()) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(OVERVIEW_VIEWBOX.width);
        expect(y).toBeLessThanOrEqual(OVERVIEW_VIEWBOX.height);
      }
    }
  });

  it('puts each label inside its own region and in no other', () => {
    for (const [id, r] of Object.entries(OVERVIEW_LAYOUT)) {
      const label: [number, number] = [r.x, r.y];
      expect(polygons(r.d).some((p) => inside(label, p))).toBe(true);
      for (const [other, o] of Object.entries(OVERVIEW_LAYOUT)) {
        if (other !== id) expect(polygons(o.d).some((p) => inside(label, p))).toBe(false);
      }
    }
  });
});

describe('where the regions sit, by the sources', () => {
  it('Scosglen is the northernmost ("Capping off the north is Scosglen", Windows Central 2023)', () => {
    for (const id of CONTINENT) if (id !== 'scosglen') expect(northOf('scosglen', id)).toBe(true);
  });

  it('Scosglen is north-west of the Fractured Peaks ("Northwest of the peaks", Prima Games)', () => {
    expect(northOf('scosglen', 'fractured_peaks') && westOf('scosglen', 'fractured_peaks')).toBe(true);
  });

  it('the Dry Steppes are south of Scosglen ("After Scosglen, you can head south", Prima Games)', () => {
    expect(northOf('scosglen', 'dry_steppes')).toBe(true);
  });

  it('the Dry Steppes and Kehjistan are on the western side, west of the Fractured Peaks and Hawezar (Windows Central; Insider Gaming)', () => {
    for (const w of ['dry_steppes', 'kehjistan']) for (const e of ['fractured_peaks', 'hawezar']) expect(westOf(w, e)).toBe(true);
  });

  it('Hawezar is to the south-east, beside the Fractured Peaks (Windows Central; Insider Gaming)', () => {
    expect(westOf('fractured_peaks', 'hawezar')).toBe(true);
    for (const id of ['scosglen', 'dry_steppes', 'kehjistan']) expect(westOf(id, 'hawezar')).toBe(true);
    expect(northOf('scosglen', 'hawezar') && northOf('fractured_peaks', 'hawezar')).toBe(true);
  });

  it('the Fractured Peaks are toward the middle ("towards the middle of the map", GamesRadar)', () => {
    const xs = CONTINENT.map((id) => at(id).x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Math.abs(at('fractured_peaks').x - mid)).toBeLessThan(OVERVIEW_VIEWBOX.width / 4);
  });

  it('Nahantu is the southernmost region of the continent, in its south-west half ("southernmost region of the eastern continent", PureDiablo; "located in the southwestern part", GamePressure)', () => {
    for (const id of CONTINENT) if (id !== 'nahantu') expect(northOf(id, 'nahantu')).toBe(true);
    expect(at('nahantu').x).toBeLessThan(OVERVIEW_VIEWBOX.width / 2);
  });

  it('Nahantu reaches Hawezar from its north-east (Kichuk, in the north-east, is "The getaway to Hawezar", Fextralife; GamePressure)', () => {
    const nahantu = polygons(at('nahantu').d)[0]!;
    const hawezar = polygons(at('hawezar').d)[0]!;
    const gap = Math.min(...nahantu.flatMap(([ax, ay]) => hawezar.map(([bx, by]) => Math.hypot(ax - bx, ay - by))));
    expect(gap).toBeLessThan(20);
    expect(westOf('nahantu', 'hawezar')).toBe(true);
  });

  it('Skovos is islands off Nahantu\'s western coast ("off the western coast of Nahantu", Maxroll 2026)', () => {
    expect(westOf('skovos', 'nahantu')).toBe(true);
    expect(polygons(at('skovos').d).length).toBeGreaterThan(1);
  });
});
