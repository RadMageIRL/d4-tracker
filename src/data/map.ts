// Map content. The regions are drawn by the atlas art in src/assets/atlas (original, not traced
// from any game or third-party map). Markers are named places attached to a region; one gets a
// position only when a source supports it, and none has one yet.

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
  terrain: string;
}

export interface MapMarker {
  id: string;
  layer: 'worldBoss' | 'legion' | 'waypoint' | 'helltide';
  regionId: string;
  name: string;
  confidence: 'confirmed' | 'inferred' | 'unknown';
  detail: string;
  source?: string;
  /** When the record's sources were last checked (not proof that it was seen in game). */
  checkedOn?: string;
  /** Only set when a source supports a meaningful atlas placement. */
  position?: { x: number; y: number };
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
}
