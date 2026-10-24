// Map content. Regions are original schematic tiles (drawn for this project, not traced from any
// game or third-party map). Markers are named places only, attached to a region, with no
// coordinates: v0.1 has no licensed position data.

export interface MapRegion {
  id: string;
  name: string;
  /** Waypoint names Blizzard has published for the region. */
  waypoints: string[];
  waypointSource: string;
  /** Can host a Helltide (per the sources in docs). */
  helltide: boolean;
  helltideNote: string;
  note: string;
}

export interface MapMarker {
  id: string;
  layer: 'worldBoss' | 'legion';
  regionId: string;
  name: string;
  confidence: 'confirmed' | 'inferred' | 'unknown';
  detail: string;
  source?: string;
}

export interface MapGroup {
  label: string;
  x: number;
  y: number;
}

/** Where the tiles sit for one screen shape. Coordinates are the SVG's own units. */
export interface MapLayout {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  /** Headings over groups of tiles. */
  groups: MapGroup[];
  /** Top-left corner of each region's tile, by region id. */
  tiles: Record<string, { x: number; y: number }>;
}

export interface MapData {
  banner: string;
  intro: string;
  regions: MapRegion[];
  markers: MapMarker[];
  /** wide: desktop and tablets; narrow: phones. */
  layouts: { wide: MapLayout; narrow: MapLayout };
}
