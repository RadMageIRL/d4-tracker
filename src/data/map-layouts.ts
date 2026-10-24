// Where the map's region tiles sit: three columns on wide screens, two on phones. Coordinates are
// the SVG's own units. An original diagram grouped by release, not a geographic map.

import type { MapData } from './map';

export const MAP_LAYOUTS: MapData['layouts'] = {
    wide: {
      width: 556, height: 290, tileWidth: 120, tileHeight: 100,
      groups: [
        { label: 'BASE GAME', x: 16, y: 26 },
        { label: 'VESSEL OF HATRED', x: 420, y: 26 },
        { label: 'LORD OF HATRED', x: 420, y: 168 },
      ],
      tiles: {
        fractured_peaks: { x: 16, y: 36 }, scosglen: { x: 148, y: 36 }, dry_steppes: { x: 280, y: 36 },
        hawezar: { x: 16, y: 178 }, kehjistan: { x: 148, y: 178 },
        nahantu: { x: 420, y: 36 }, skovos: { x: 420, y: 178 },
      },
    },
    narrow: {
      width: 284, height: 468, tileWidth: 120, tileHeight: 88,
      groups: [
        { label: 'BASE GAME', x: 16, y: 18 },
        { label: 'VESSEL OF HATRED', x: 16, y: 348 },
        { label: 'LORD OF HATRED', x: 148, y: 348 },
      ],
      tiles: {
        fractured_peaks: { x: 16, y: 28 }, scosglen: { x: 148, y: 28 },
        dry_steppes: { x: 16, y: 128 }, hawezar: { x: 148, y: 128 },
        kehjistan: { x: 16, y: 228 },
        nahantu: { x: 16, y: 358 }, skovos: { x: 148, y: 358 },
      },
    },
  };
