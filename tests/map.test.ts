import { describe, expect, it } from 'vitest';
import { MAP_DATA } from '../src/data';
import { ATLAS_ART } from '../src/data/atlas-art';

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

  it('has an original local SVG for the overview and every region', () => {
    expect(Object.keys(ATLAS_ART).sort()).toEqual(['dry_steppes', 'fractured_peaks', 'hawezar', 'kehjistan', 'nahantu', 'sanctuary', 'scosglen', 'skovos']);
    for (const svg of Object.values(ATLAS_ART)) {
      expect(svg).toMatch(/<svg/);
      expect(svg).not.toMatch(/<(script|image|foreignObject)\b|\b(?:href|src)=["']https?:/i);
    }
  });

  it('keeps places without supported display coordinates in the list', () => {
    expect(MAP_DATA.markers.every((m) => m.position === undefined)).toBe(true);
    expect(MAP_DATA.markers.some((m) => m.layer === 'waypoint')).toBe(true);
  });
});
