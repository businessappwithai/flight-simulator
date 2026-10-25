/**
 * The simulated planet as the page sees it, and the one timeline of its build-and-reveal sequence.
 *
 * The timeline is shared by the picture (fronts, camera, editor), the sound and the checks (the camera clearance
 * table is computed over the same path the page flies), so every beat happens on the same frame everywhere:
 * frame = round(t · 60) + 1. Build stages are *fronts*, radii that grow over time, not keyframes: thousands of
 * things (vertices, trees, buildings) animate from a handful of numbers.
 */

/** Real-world anchoring vs. the simulated planet (`SET_WORLD.world`). */
export type WorldKind = "real" | "landscape";

/** Where the planet stands, carried on WORLD events while `world: "landscape"`. */
export interface LandscapeStatus {
  state: "GENERATING" | "READY" | "ERROR";
  detail?: string;
  seed: string;
  brand: string;
  /** Generation progress (0..1) and the step being run ("uplift", "erosion", "tiles", "ecology"). */
  progress: number;
  phase: string;
  generateMs?: number;
  /** SHA-256 over seed, brand, generator version and the global height field (decimetres). */
  manifest?: string;
  /** Detail tiles generated so far (physics and rendering alike). */
  tiles: number;
  trees: number;
  buildings: number;
  /** Everything placed in the world (tiles + trees + buildings + lakes + rivers + the ocean): the Outliner's count. */
  actors: number;
  terrainElevationM: number | null;
  aglM: number | null;
  /** What is under the aircraft. */
  surface: "AIRFIELD" | "RUNWAY" | "TERRAIN" | "WATER" | "BUILDING";
  /**
   * Where finer levels are drawn (three.js x0, z0, x1, z1): a coarser level hides itself inside these boxes so two
   * levels never overlap. Absent until the ring is complete.
   */
  rings: { l1?: [number, number, number, number]; l0?: [number, number, number, number] };
}

/** One camera key of the reveal: three.js x, z, altitude above sea level (m) and time (s). */
export interface RevealKey { t: number; x: number; z: number; alt: number }
/** The planet's constants and the reveal shot, sent once when the landscape is READY. */
export interface LandscapeInfo {
  seed: string;
  brand: string;
  /** #rrggbb the continent should measure from orbit. */
  color: string;
  padElevationM: number;
  lakeLevelM: number;
  planetRadiusM: number;
  /** The global height field (m above sea level), `size`² nodes from (x0, z0) every `cell` m (for water depth, the planet disc). */
  heights: Float32Array;
  size: number;
  cell: number;
  x0: number;
  z0: number;
  /** Lakes as boxes (three.js x0, z0, x1, z1): the eyes. */
  lakes: [number, number, number, number][];
  /** Centre of the continent (three.js x, z). */
  centre: [number, number];
  /** Where the build fronts start (the ground under the opening camera) and where the city grows. */
  buildOrigin: [number, number];
  city: [number, number];
  /** The reveal camera path and look-at path. */
  camera: RevealKey[];
  target: RevealKey[];
  /** Lowest clearance of the camera over the final terrain on any frame of the shot (m), and that frame. */
  clearance: { minM: number; frame: number };
}

/** The planet's radius (m): small enough that the curvature reads from orbit. */
export const PLANET_RADIUS_M = 400_000;
/** The home airfield is flat (y = 0) within this radius and blends into the landscape over the next BLEND_M. */
export const PLANET_FLAT_RADIUS_M = 3200, PLANET_BLEND_M = 2600;
/**
 * How far the surface at (x, z) (three.js, m from the runway) sits below the runway's tangent plane: the planet's
 * curvature as a parabola, faded to 0 on the flat airfield. Physics, meshes and the camera all use this one function.
 * Only + − × ÷ √: identical in every engine.
 */
export function curvatureDrop(x: number, z: number, radius = PLANET_RADIUS_M): number {
  const r2 = x * x + z * z, r = Math.sqrt(r2);
  if (r <= PLANET_FLAT_RADIUS_M) return 0;
  const t = Math.min(1, (r - PLANET_FLAT_RADIUS_M) / PLANET_BLEND_M), w = t * t * (3 - 2 * t);
  return w * r2 / (2 * radius);
}

/** Beats of the reveal (seconds), from the prompt pack's page 6. */
export const REVEAL = {
  duration: 18,
  fps: 60,
  typeStart: 0.3, typeEnd: 1.5, prompt: "build a world. make it look like me",
  enter: 1.8,
  panelsStart: 1.86, panelsEnd: 2.4,
  terrainStart: 2.4, terrainEnd: 5.4,
  waterStart: 5.6, waterEnd: 7.6,
  riversStart: 6.6, riversEnd: 9.0,
  forestStart: 7.9, forestEnd: 11.5,
  cityStart: 10.1, cityEnd: 12.2,
  climbStart: 12.3, climbEnd: 15.0,
  reveal: 15.0,
  blinkStart: 16.09, blinkEnd: 16.26,
  backStart: 16.7, backEnd: 17.25,
  outlinerStart: 17.0, outlinerEnd: 17.9,
  chime: 17.85,
} as const;

/** Frame number of a time (1-based, 60 fps), as the prompt pack counts them. */
export const revealFrame = (t: number) => Math.round(t * REVEAL.fps) + 1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, t: number) => { const x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); };

/** The build state at time t of the reveal (all complete when not revealing: t ≥ duration or t = Infinity). */
export interface RevealState {
  /** Editor UI: panels on screen (1) to slid off (0), and the viewport hole's size (0 = docked, 1 = full frame). */
  panels: number;
  /** Characters of the prompt typed so far. */
  typed: number;
  /** Fronts (m from the build origin): terrain heave/clay and the full material behind it. */
  clayR: number;
  pbrR: number;
  /** How far the water has risen (0 dry → 1 at level). */
  water: number;
  /** River reveal threshold (log10 m²): channels with a smaller drainage area than this are lit (sources first). */
  riverLog: number;
  /** Forest front (m from the build origin) and city growth front (m from the city centre). */
  forestR: number;
  cityR: number;
  /** 0 → 1 over the climb to orbit (exposure ramp, haze fade, albedo tint). */
  climb: number;
  /** Eye-lake squash (1 = open, 0 = shut). */
  eyes: number;
  /** Outliner flood (0 → 1). */
  outliner: number;
}
export function revealState(t: number): RevealState {
  const R = REVEAL, done = !(t < R.duration);
  if (done) return { panels: 0, typed: R.prompt.length, clayR: 1e7, pbrR: 1e7, water: 1, riverLog: 99, forestR: 1e7, cityR: 1e7, climb: 0, eyes: 1, outliner: 1 };
  const grow = (a: number, b: number, far: number) => (t < a ? 0 : t >= b ? far : far * Math.pow((t - a) / (b - a), 1.6));
  // Clay first, the full material 0.45 s behind it; after the terrain beat both keep growing to the whole planet.
  const clay = t < R.terrainEnd ? grow(R.terrainStart, R.terrainEnd, 42_000) : 42_000 + (t - R.terrainEnd) * 60_000;
  const pbr = t - 0.45 < R.terrainEnd ? grow(R.terrainStart + 0.45, R.terrainEnd + 0.45, 42_000) : 42_000 + (t - 0.45 - R.terrainEnd) * 60_000;
  const back = smooth(R.backStart, R.backEnd, t);
  return {
    panels: Math.max(1 - smooth(R.panelsStart, R.panelsEnd, t), back),
    typed: Math.round(R.prompt.length * clamp01((t - R.typeStart) / (R.typeEnd - R.typeStart))),
    clayR: clay, pbrR: pbr,
    water: smooth(R.waterStart, R.waterEnd, t),
    riverLog: t < R.riversStart ? 0 : 4.6 + 6 * clamp01((t - R.riversStart) / (R.riversEnd - R.riversStart)),
    forestR: grow(R.forestStart, R.forestEnd, 90_000),
    cityR: grow(R.cityStart, R.cityEnd, 4_200),
    climb: smooth(R.climbStart, R.climbEnd, t),
    eyes: t >= R.blinkStart && t <= R.blinkEnd ? Math.abs(Math.cos(Math.PI * (t - R.blinkStart) / (R.blinkEnd - R.blinkStart))) : 1,
    outliner: clamp01((t - R.outlinerStart) / (R.outlinerEnd - R.outlinerStart)),
  };
}

/**
 * Time-parameterised cubic Hermite (Catmull-Rom tangents) through keys in (x, z, ln altitude): altitude changes
 * exponentially, so 600 m over the city and 90 km over the planet are both smooth. Repeated keys hold still.
 */
export function revealPoint(keys: readonly RevealKey[], t: number): { x: number; z: number; alt: number } {
  if (t <= keys[0]!.t) return { x: keys[0]!.x, z: keys[0]!.z, alt: keys[0]!.alt };
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return { x: last.x, z: last.z, alt: last.alt };
  let k = 0;
  while (k < keys.length - 2 && t > keys[k + 1]!.t) k++;
  const p0 = keys[Math.max(0, k - 1)]!, p1 = keys[k]!, p2 = keys[k + 1]!, p3 = keys[Math.min(keys.length - 1, k + 2)]!;
  const dt = p2.t - p1.t, s = (t - p1.t) / dt, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const tangent = (a: RevealKey, b: RevealKey, c: RevealKey, f: (k: RevealKey) => number) => {
    // A held key (same value on either side) has no velocity; otherwise the slope across its neighbours.
    if (f(a) === f(b) || f(b) === f(c)) return 0;
    return (f(c) - f(a)) / (c.t - a.t);
  };
  const lerp = (f: (k: RevealKey) => number) => h00 * f(p1) + h10 * dt * tangent(p0, p1, p2, f) + h01 * f(p2) + h11 * dt * tangent(p1, p2, p3, f);
  return { x: lerp(k => k.x), z: lerp(k => k.z), alt: Math.exp(lerp(k => Math.log(k.alt))) };
}

/** Lens (mm, 36 mm sensor width) over the shot: 24 mm low, 34 mm at the reveal, a slow push to 34.6 mm over the hold. */
export function revealLens(t: number): number {
  const R = REVEAL;
  if (t < R.climbStart) return 24;
  if (t < R.reveal) return 24 + 10 * smooth(R.climbStart, R.reveal, t);
  return 34 + 0.6 * clamp01((t - R.reveal) / (R.duration - R.reveal));
}
/** Vertical field of view (degrees) of a lens for an aspect ratio (36 mm horizontal sensor fit). */
export const lensFov = (mm: number, aspect: number) => 2 * Math.atan(18 / mm / aspect) * 180 / Math.PI;

/** Camera shutter (fraction of a frame) for motion blur: only on the climb (0.5 → 0.14); crisp elsewhere. */
export function revealShutter(t: number): number {
  const R = REVEAL;
  if (t < R.climbStart || t > R.climbEnd) return 0;
  return 0.5 + (0.14 - 0.5) * clamp01((t - R.climbStart) / (R.climbEnd - R.climbStart));
}
