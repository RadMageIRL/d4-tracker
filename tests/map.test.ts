import { describe, expect, it } from 'vitest';
import { MAP_DATA } from '../src/data';

const ids = MAP_DATA.regions.map((r) => r.id);

describe('map data', () => {
  it('has the seven regions as of Lord of Hatred', () => {
    expect(MAP_DATA.regions.map((r) => r.name)).toEqual(
      ['Fractured Peaks', 'Scosglen', 'Dry Steppes', 'Hawezar', 'Kehjistan', 'Nahantu', 'Skovos']);
  });

  it('attaches every marker to a region that exists, with a source', () => {
    for (const m of MAP_DATA.markers) {
      expect(ids).toContain(m.regionId);
      expect(m.source?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('lists exactly one World Boss arena per region', () => {
    const arenas = MAP_DATA.markers.filter((m) => m.layer === 'worldBoss').map((m) => m.regionId);
    expect([...arenas].sort()).toEqual([...ids].sort());
  });

  for (const [name, layout] of Object.entries(MAP_DATA.layouts)) {
    it(`${name} layout places every region once, inside the drawing, with no overlaps`, () => {
      expect(Object.keys(layout.tiles).sort()).toEqual([...ids].sort());
      const boxes = Object.values(layout.tiles).map((t) => ({ ...t, r: t.x + layout.tileWidth, b: t.y + layout.tileHeight }));
      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.r).toBeLessThanOrEqual(layout.width);
        expect(box.b).toBeLessThanOrEqual(layout.height);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, c = boxes[j]!;
          const apart = a.r <= c.x || c.r <= a.x || a.b <= c.y || c.b <= a.y;
          expect(apart).toBe(true);
        }
      }
    });
  }
});
