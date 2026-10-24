// Where each region sits on the stylized Sanctuary overview (the SVG's own units, 760 x 430). Still
// a schematic, not the game's map: only the regions' places relative to each other are meant, and
// tests/atlas-geography.test.ts checks those against what published sources say (see that file).
//
// x, y: the label's center. d: the region's outline (absolute M and L commands only).

export interface OverviewRegion {
  x: number;
  y: number;
  d: string;
}

export const OVERVIEW_VIEWBOX = { width: 760, height: 430 };

export const OVERVIEW_LAYOUT: Record<string, OverviewRegion> = {
  // The northernmost region, north-west of the Fractured Peaks.
  scosglen: { x: 305, y: 88, d: 'M196 96 L208 60 L264 34 L342 40 L404 58 L418 100 L382 128 L300 140 L236 124 Z' },
  // In the middle, east of the Dry Steppes and Kehjistan, beside Hawezar.
  fractured_peaks: { x: 412, y: 200, d: 'M308 154 L392 142 L466 148 L520 178 L512 234 L452 258 L374 254 L312 224 Z' },
  // The west side, south of Scosglen.
  dry_steppes: { x: 190, y: 188, d: 'M76 150 L150 126 L232 128 L300 156 L304 222 L246 250 L150 248 L80 210 Z' },
  // The west side, below the Dry Steppes.
  kehjistan: { x: 192, y: 298, d: 'M82 216 L150 252 L246 254 L306 228 L314 280 L270 300 L250 334 L196 352 L126 344 L78 304 Z' },
  // The south-east, beside the Fractured Peaks.
  hawezar: { x: 575, y: 266, d: 'M520 178 L592 188 L654 222 L668 280 L630 332 L558 342 L480 320 L456 284 L512 236 Z' },
  // The southernmost region of the continent, in its south-west half; its north-east leads to Hawezar.
  nahantu: { x: 360, y: 342, d: 'M270 300 L330 276 L430 282 L476 316 L452 384 L364 404 L286 394 L250 352 Z' },
  // Islands off Nahantu's western coast.
  skovos: { x: 152, y: 400, d: 'M92 382 L146 372 L204 384 L212 410 L158 424 L100 418 Z M226 414 L244 406 L258 416 L244 424 Z' },
};
