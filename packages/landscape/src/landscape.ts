/**
 * The simulated planet: a continent shaped by a BRAND silhouette, built by uplift and erosion rather than painted
 * with noise, at three levels of detail that agree with each other.
 *
 *  - Global: 513² nodes at 320 m over a 163.84 km square, uplift + implicit stream-power erosion (~3 s).
 *  - L1 tiles: 20.48 km at 80 m, the global field sampled linearly (never cubic: cubic B-splines melt ridges into
 *    dunes), ridged detail, and a second stream-power pass that carves V-valleys.
 *  - L0 tiles: 2.56 km at 10 m, refined again from L1 the same way. Physics reads L0 only.
 *
 * Every tile is a pure function of (seed, brand, tile index), generated on first use, so physics never depends on
 * what happened to be generated or cached before. Tile edges equal the un-eroded refinement of the parent, so
 * neighbouring tiles agree exactly on their shared edge. Heights are kept in whole decimetres.
 *
 * Coordinates are the renderer's (three.js) frame: x east, z south, y up, the home runway at the origin.
 * The simulation's frame mirrors x (three.js x = −simulation x); `ground` takes simulation coordinates.
 */
import { PLANET_BLEND_M, PLANET_FLAT_RADIUS_M, PLANET_RADIUS_M, curvatureDrop } from "@flight/protocol";
import { SplitMix64 } from "@flight/simulation";
import { type Brand, CLAWD, brandBounds, rectDistance, resolveBrand } from "./brand.ts";
import { erode } from "./erosion.ts";
import { fbm, ridged, smoothstep, valueNoise } from "./noise.ts";

export { PLANET_RADIUS_M };
export const DOMAIN_M = 163_840;
export const GLOBAL_NODES = 513;
export const GLOBAL_CELL_M = DOMAIN_M / (GLOBAL_NODES - 1);
export const TILE_NODES = 257;
export const LEVELS = { L1: { cell: 80, size: 20_480 }, L0: { cell: 10, size: 2_560 } } as const;
export type TileLevel = keyof typeof LEVELS;
/** Base level the eye lakes give the rivers during erosion (m above sea level); the surface settles at or below it. */
export const LAKE_BASE_M = 60;
/** The home airfield is flat (y = 0 exactly) within this radius, blending into the landscape over BLEND_M. */
export const FLAT_RADIUS_M = PLANET_FLAT_RADIUS_M, BLEND_M = PLANET_BLEND_M;
const MARGIN = 24, EDGE_BLEND = 8;
/** Bump when the generator changes: it is part of every manifest. */
export const LANDSCAPE_VERSION = 1;

export interface LandscapeOptions {
  seed: bigint;
  brand?: Brand;
  /** Global erosion iterations (default 120). */
  iterations?: number;
  onProgress?: (phase: string, fraction: number) => void;
}

export interface LandscapeTile {
  level: TileLevel;
  i: number;
  j: number;
  /** North-west corner (three.js x, z). */
  x0: number;
  z0: number;
  cell: number;
  /** TILE_NODES² heights in decimetres above sea level, row-major from the north-west corner. */
  dm: Int32Array;
  /** log10 of the drainage area (m²) per node, accumulated within the tile and its margin (rivers; render only). */
  logArea: Float32Array;
}

const sq = (v: number) => v * v;
/** Distance from (px, pz) to the segment a–b. */
function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az, l = vx * vx + vz * vz;
  let t = l > 0 ? (wx * vx + wz * vz) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.sqrt(sq(px - ax - t * vx) + sq(pz - az - t * vz));
}

export class Landscape {
  readonly seed: bigint;
  readonly brand: Required<Brand>;
  /** North-west corner of the domain (three.js x, z). */
  readonly x0: number;
  readonly z0: number;
  /** Ground elevation of the home airfield (m above sea level, whole decimetres). */
  readonly padElevation: number;
  /** Surface of the lakes (m above sea level, whole decimetres): just below the lowest shore, so no lake is perched. */
  readonly lakeLevel: number;
  /** Global heights (m above sea level, whole decimetres), GLOBAL_NODES², row-major from the north-west. */
  readonly global: Float64Array;
  readonly globalLogArea: Float32Array;
  readonly seeds: Int32Array;
  readonly #tiles = new Map<string, LandscapeTile>();
  readonly #order: string[] = [];
  #last: Partial<Record<TileLevel, LandscapeTile>> = {};
  /** Brand placement: three.js coordinates of brand unit (0, 0). */
  readonly #bx: number;
  readonly #bz: number;

  constructor(o: LandscapeOptions) {
    this.seed = o.seed;
    this.brand = resolveBrand(o.brand ?? CLAWD);
    const rng = new SplitMix64(o.seed ^ 0x6c616e64736361n), seeds = new Int32Array(16);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Number(rng.nextUint64() >> 32n) | 0;
    this.seeds = seeds;
    const u = this.brand.unitM, b = brandBounds(this.brand);
    this.#bx = -this.brand.airfield.x * u; this.#bz = -this.brand.airfield.y * u;
    this.x0 = this.#bx + (b.x0 + b.x1) / 2 * u - DOMAIN_M / 2;
    this.z0 = this.#bz + (b.y0 + b.y1) / 2 * u - DOMAIN_M / 2;
    const g = this.#generateGlobal(o.iterations ?? 120, o.onProgress);
    this.global = g.h; this.globalLogArea = g.logArea; this.padElevation = g.pad; this.lakeLevel = g.lake;
  }

  /** Brand units → three.js (x, z). */
  unitToWorld(x: number, y: number): [number, number] { return [this.#bx + x * this.brand.unitM, this.#bz + y * this.brand.unitM]; }

  // ---- The silhouette ------------------------------------------------------------------------------------------
  /** Signed distance to the coastline (m, negative on land), with a natural, seed-dependent coast. */
  coastDistance(x: number, z: number): number {
    const u = this.brand.unitM;
    let d = Infinity;
    for (const r of this.brand.land) {
      const v = rectDistance(x, z, this.#bx + r.x0 * u, this.#bz + r.y0 * u, this.#bx + r.x1 * u, this.#bz + r.y1 * u);
      if (v < d) d = v;
    }
    const s = this.seeds;
    return d + (fbm(x / 7000, z / 7000, s[0]!, 4) - 0.5) * 2600 + (valueNoise(x / 1400, z / 1400, s[1]!) - 0.5) * 500;
  }
  /** Signed distance to the nearest lake shore (m, negative in the lake). */
  lakeDistance(x: number, z: number): number {
    const u = this.brand.unitM;
    let d = Infinity;
    for (const r of this.brand.lakes) {
      const v = rectDistance(x, z, this.#bx + r.x0 * u, this.#bz + r.y0 * u, this.#bx + r.x1 * u, this.#bz + r.y1 * u);
      if (v < d) d = v;
    }
    return d + (valueNoise(x / 900, z / 900, this.seeds[2]!) - 0.5) * 260;
  }
  /** Water surface over (x, z): the lake level in a lake, sea level elsewhere (m above sea level). */
  waterLevel(x: number, z: number) { return this.lakeDistance(x, z) < 0 ? this.lakeLevel : 0; }

  /** Tectonic uplift per global iteration (m): ranges as ridged belts, a plateau, low plains. */
  uplift(x: number, z: number): number {
    const coast = this.coastDistance(x, z);
    if (coast >= 0) return 0;
    const u = this.brand.unitM, s = this.seeds;
    let belt = 0;
    for (const line of this.brand.ranges) {
      let d = Infinity;
      for (let i = 1; i < line.length; i++) {
        const [ax, az] = this.unitToWorld(line[i - 1]![0], line[i - 1]![1]), [bx, bz] = this.unitToWorld(line[i]![0], line[i]![1]);
        const v = segmentDistance(x, z, ax, az, bx, bz);
        if (v < d) d = v;
      }
      const w = 0.95 * u, t = d < w ? 1 - sq(d / w) : 0;
      if (t > belt) belt = t;
    }
    // Saddles: the ranges are notched where the flight crosses them, the notch stretched across the range so a
    // valley runs right through the belt.
    let notch = 1;
    for (const p of this.#passGeometry()) {
      const dx = x - p.x, dz = z - p.z, along = dx * p.ux + dz * p.uz, across = (dx * -p.uz + dz * p.ux) / 3.2;
      notch = Math.min(notch, 0.3 + 0.7 * smoothstep(900, 3600, Math.sqrt(along * along + across * across)));
    }
    // Crests vary along the belt (ridged, ~8 km) and from range to range (1/55 km).
    const crest = 0.55 + 0.45 * ridged(x / 8200, z / 8200, s[3]!), broad = 0.7 + 0.3 * valueNoise(x / 55_000, z / 55_000, s[4]!);
    let plateau = 0;
    for (const r of this.brand.plateaus) {
      const d = rectDistance(x, z, this.#bx + r.x0 * u, this.#bz + r.y0 * u, this.#bx + r.x1 * u, this.#bz + r.y1 * u);
      plateau = Math.max(plateau, 1 - smoothstep(-2500, 800, d));
    }
    const inland = smoothstep(0, 7000, -coast), lake = smoothstep(500, 5000, this.lakeDistance(x, z));
    const plains = 2 + 3.2 * fbm(x / 16_000, z / 16_000, s[5]!, 3);
    return inland * lake * (plains + 52 * belt * belt * crest * broad * notch + 9 * plateau);
  }

  #passes?: { x: number; z: number; ux: number; uz: number }[];
  /** Each pass with the direction of the range it cuts (unit vector along the nearest range segment). */
  #passGeometry() {
    return (this.#passes ??= this.brand.passes.map(p => {
      const [x, z] = this.unitToWorld(p[0], p[1]);
      let best = Infinity, ux = 1, uz = 0;
      for (const line of this.brand.ranges) for (let i = 1; i < line.length; i++) {
        const [ax, az] = this.unitToWorld(line[i - 1]![0], line[i - 1]![1]), [bx, bz] = this.unitToWorld(line[i]![0], line[i]![1]);
        const d = segmentDistance(x, z, ax, az, bx, bz);
        if (d < best) { best = d; const l = Math.sqrt(sq(bx - ax) + sq(bz - az)); ux = (bx - ax) / l; uz = (bz - az) / l; }
      }
      return { x, z, ux, uz };
    }));
  }

  // ---- Global simulation ---------------------------------------------------------------------------------------
  #generateGlobal(iterations: number, progress?: (phase: string, fraction: number) => void) {
    const n = GLOBAL_NODES, N = n * n, dx = GLOBAL_CELL_M;
    const h = new Float64Array(N), outlet = new Uint8Array(N), base = new Float64Array(N), up = new Float64Array(N);
    progress?.("uplift", 0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = this.x0 + i * dx, z = this.z0 + j * dx, k = j * n + i, coast = this.coastDistance(x, z), lake = this.lakeDistance(x, z);
      if (coast >= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        // The sea: a turquoise shelf a few kilometres wide, then the deep ocean.
        outlet[k] = 1; base[k] = 0;
        h[k] = coast < 0 ? -10 : coast < 4500 ? -(8 + 52 * smoothstep(0, 4500, coast)) : -(60 + 2900 * smoothstep(4500, 17_000, coast));
      } else if (lake < 0) {
        outlet[k] = 1; base[k] = LAKE_BASE_M;
        h[k] = LAKE_BASE_M - (4 + 46 * smoothstep(0, 2200, -lake));
      } else {
        up[k] = this.uplift(x, z);
        h[k] = LAKE_BASE_M * smoothstep(0, 9000, -coast) + 3 + 12 * valueNoise(x / 2000, z / 2000, this.seeds[6]!);
      }
    }
    const result = erode({ n, dx, h, outlet, base, uplift: up, k: 0.07, iterations, diffusion: 0.012, floodEvery: 2, seed: this.seeds[7]!,
      onIteration: i => { if (i % 10 === 0) progress?.("erosion", i / iterations); } });
    // The home airfield: flat at the mean ground height around it.
    let sum = 0, count = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = this.x0 + i * dx, z = this.z0 + j * dx;
      if (x * x + z * z <= FLAT_RADIUS_M * FLAT_RADIUS_M) { sum += h[j * n + i]!; count++; }
    }
    const pad = Math.round((count ? sum / count : 50) * 10) / 10;
    // The lake surface: 2 m below the lowest land on any lake shore (and never above the base level erosion used).
    let shore = LAKE_BASE_M + 2;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (outlet[k] || h[k]! <= 0) continue;
      if (base[k - 1] === LAKE_BASE_M && outlet[k - 1] || base[k + 1] === LAKE_BASE_M && outlet[k + 1] || base[k - n] === LAKE_BASE_M && outlet[k - n] || base[k + n] === LAKE_BASE_M && outlet[k + n]) shore = Math.min(shore, h[k]!);
    }
    const lake = Math.round((shore - 2) * 10) / 10;
    const logArea = new Float32Array(N);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      h[k] = this.#quantize(this.#padBlend(this.x0 + i * dx, this.z0 + j * dx, h[k]!, pad));
      logArea[k] = outlet[k] ? 0 : Math.log10(result.area[k]!);
    }
    progress?.("erosion", 1);
    return { h, logArea, pad, lake };
  }

  #quantize(v: number) { return Math.round(v * 10) / 10; }
  /** Heights near the runway blend into the flat airfield (the same smoothstep the real-world anchor uses). */
  #padBlend(x: number, z: number, v: number, pad = this.padElevation) {
    const r = Math.sqrt(x * x + z * z);
    if (r <= FLAT_RADIUS_M) return pad;
    const t = Math.min(1, (r - FLAT_RADIUS_M) / BLEND_M), b = t * t * (3 - 2 * t);
    return pad + b * (v - pad);
  }
  /** Fraction of the landscape (vs. the flat airfield) at (x, z): 0 on the airfield, 1 beyond the blend. */
  static padWeight(x: number, z: number) {
    const r = Math.sqrt(x * x + z * z);
    if (r <= FLAT_RADIUS_M) return 0;
    const t = Math.min(1, (r - FLAT_RADIUS_M) / BLEND_M);
    return t * t * (3 - 2 * t);
  }

  /** Global height (m above sea level), bilinear; outside the domain, the deep ocean floor. */
  globalHeight(x: number, z: number): number {
    const fx = (x - this.x0) / GLOBAL_CELL_M, fz = (z - this.z0) / GLOBAL_CELL_M, n = GLOBAL_NODES;
    if (!(fx >= 0 && fz >= 0 && fx <= n - 1 && fz <= n - 1)) return -3000;
    return bilinear(this.global, n, fx, fz);
  }
  globalLog(x: number, z: number): number {
    const fx = (x - this.x0) / GLOBAL_CELL_M, fz = (z - this.z0) / GLOBAL_CELL_M, n = GLOBAL_NODES;
    if (!(fx >= 0 && fz >= 0 && fx <= n - 1 && fz <= n - 1)) return 0;
    return bilinear(this.globalLogArea, n, fx, fz);
  }

  // ---- Detail tiles --------------------------------------------------------------------------------------------
  /** Tile index containing (x, z) at a level. */
  tileIndex(level: TileLevel, x: number, z: number): [number, number] {
    const s = LEVELS[level].size;
    return [Math.floor((x - this.x0) / s), Math.floor((z - this.z0) / s)];
  }
  tileCount(level: TileLevel) { return DOMAIN_M / LEVELS[level].size; }
  /** Tiles generated so far (any level). */
  get generatedTiles() { return this.#order.length; }

  tile(level: TileLevel, i: number, j: number): LandscapeTile {
    const key = `${level}/${i}/${j}`;
    const hit = this.#tiles.get(key);
    if (hit) return hit;
    const t = this.#refine(level, i, j);
    this.#tiles.set(key, t); this.#order.push(key);
    // Bounded cache: tiles are pure, so an evicted tile is regenerated identically when needed again.
    while (this.#order.length > 96) { const old = this.#order.shift()!; this.#tiles.delete(old); }
    return t;
  }
  /** Generated tiles currently cached (for streaming: what is cheap to mesh now). */
  cached(level: TileLevel, i: number, j: number) { return this.#tiles.has(`${level}/${i}/${j}`); }

  /** Height of a level at (x, z), bilinear over its tile (generating it if needed). */
  levelHeight(level: TileLevel, x: number, z: number): number {
    const { size, cell } = LEVELS[level];
    const fx = (x - this.x0) / size, fz = (z - this.z0) / size, count = DOMAIN_M / size;
    if (!(fx >= 0 && fz >= 0 && fx < count && fz < count)) return this.globalHeight(x, z);
    const i = Math.floor(fx), j = Math.floor(fz);
    let t = this.#last[level];
    if (!t || t.i !== i || t.j !== j) { t = this.tile(level, i, j); this.#last[level] = t; }
    return bilinear(t.dm, TILE_NODES, (x - t.x0) / cell, (z - t.z0) / cell) / 10;
  }
  /** The finest height (L0, 10 m) at (x, z), m above sea level. */
  height(x: number, z: number) { return this.levelHeight("L0", x, z); }

  /**
   * The parent field for refinement, interpolated with Catmull-Rom: it passes through every parent node (ridges keep
   * their crests, unlike an approximating cubic B-spline, which melts them into dunes) and has no slope breaks at
   * cell edges (bilinear upsampling leaves a visible facet per parent cell). Final heights are still sampled linearly.
   */
  #parentHeight(level: TileLevel, x: number, z: number) {
    if (level === "L1") {
      const fx = (x - this.x0) / GLOBAL_CELL_M, fz = (z - this.z0) / GLOBAL_CELL_M, n = GLOBAL_NODES;
      if (!(fx >= 1 && fz >= 1 && fx <= n - 3 && fz <= n - 3)) return this.globalHeight(x, z);
      return catmullRom(this.#globalNode, fx, fz);
    }
    const cell = LEVELS.L1.cell, fx = (x - this.x0) / cell, fz = (z - this.z0) / cell, n = DOMAIN_M / cell;
    if (!(fx >= 1 && fz >= 1 && fx <= n - 2 && fz <= n - 2)) return this.globalHeight(x, z);
    return catmullRom(this.#l1Node, fx, fz);
  }
  readonly #globalNode = (i: number, j: number) => this.global[j * GLOBAL_NODES + i]!;
  /** An L1 node by its domain-wide index (tiles share their edge nodes, so either tile answers alike). */
  readonly #l1Node = (i: number, j: number) => {
    const per = TILE_NODES - 1, ti = Math.min(Math.floor(i / per), this.tileCount("L1") - 1), tj = Math.min(Math.floor(j / per), this.tileCount("L1") - 1);
    let t = this.#last.L1;
    if (!t || t.i !== ti || t.j !== tj) { t = this.tile("L1", ti, tj); this.#last.L1 = t; }
    return t.dm[(j - tj * per) * TILE_NODES + (i - ti * per)]! / 10;
  };

  /** Ridged detail added to the linear upsample (m): wavelengths 2560/1280/640 m on L1, 320/90/20 m on L0. */
  #detail(level: TileLevel, x: number, z: number) {
    const s = this.seeds;
    return level === "L1"
      ? 150 * (ridged(x / 2560, z / 2560, s[8]!) - 0.4) + 60 * (ridged(x / 1280, z / 1280, s[9]!) - 0.4) + 24 * (ridged(x / 640, z / 640, s[10]!) - 0.4)
      : 34 * (ridged(x / 320, z / 320, s[11]!) - 0.4) + 11 * (ridged(x / 90, z / 90, s[12]!) - 0.4) + 2.6 * (ridged(x / 20, z / 20, s[13]!) - 0.4);
  }
  /** 0 where the ground must stay calm (the city, the airfield), else 1. */
  #calm(x: number, z: number) {
    const [cx, cz] = this.unitToWorld(this.brand.city.x, this.brand.city.y), dc = Math.sqrt(sq(x - cx) + sq(z - cz));
    return smoothstep(2600, 4200, dc) * smoothstep(FLAT_RADIUS_M, FLAT_RADIUS_M + BLEND_M, Math.sqrt(x * x + z * z));
  }

  #refine(level: TileLevel, ti: number, tj: number): LandscapeTile {
    const { cell, size } = LEVELS[level], x0 = this.x0 + ti * size, z0 = this.z0 + tj * size;
    const n = TILE_NODES + 2 * MARGIN, N = n * n;
    const h = new Float64Array(N), base = new Float64Array(N), outlet = new Uint8Array(N), pre = new Float64Array(N), parent = new Float64Array(N), water = new Float64Array(N);
    // The parent sampled linearly at every node, then ridged detail where the land is rough (slope from the parent).
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const x = x0 + (a - MARGIN) * cell, z = z0 + (b - MARGIN) * cell, k = b * n + a;
      parent[k] = this.#parentHeight(level, x, z); water[k] = this.waterLevel(x, z);
    }
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const x = x0 + (a - MARGIN) * cell, z = z0 + (b - MARGIN) * cell, k = b * n + a, p = parent[k]!, w = water[k]!;
      let v = p;
      if (p > w + 0.5) {
        const al = a > 0 ? k - 1 : k, ar = a < n - 1 ? k + 1 : k, bu = b > 0 ? k - n : k, bd = b < n - 1 ? k + n : k;
        const gx = (parent[ar]! - parent[al]!) / ((ar - al) * cell), gz = (parent[bd]! - parent[bu]!) / ((bd - bu) / n * cell);
        const slope = Math.sqrt(gx * gx + gz * gz);
        const rough = (0.15 + 0.85 * smoothstep(0.03, 0.4, slope)) * smoothstep(w + 2, w + 160, p) * this.#calm(x, z);
        if (rough > 0) v = p + rough * this.#detail(level, x, z);
      }
      h[k] = v; pre[k] = v;
      if (a === 0 || b === 0 || a === n - 1 || b === n - 1) { outlet[k] = 1; base[k] = v > w ? v : w; }
      else if (v <= w) { outlet[k] = 1; base[k] = w; }
    }
    const r = erode({ n, dx: cell, h, outlet, base, k: 0.016, iterations: 40, diffusion: 0.01, floodEvery: 4, seed: this.seeds[14]! ^ (ti * 7919 + tj * 104729 + (level === "L1" ? 1 : 2)) });
    const dm = new Int32Array(TILE_NODES * TILE_NODES), logArea = new Float32Array(TILE_NODES * TILE_NODES);
    for (let b = 0; b < TILE_NODES; b++) for (let a = 0; a < TILE_NODES; a++) {
      const k = (b + MARGIN) * n + (a + MARGIN), x = x0 + a * cell, z = z0 + b * cell;
      const edge = Math.min(a, b, TILE_NODES - 1 - a, TILE_NODES - 1 - b), w = smoothstep(0, EDGE_BLEND, edge);
      const v = pre[k]! + w * (h[k]! - pre[k]!);
      dm[b * TILE_NODES + a] = Math.round(this.#padBlend(x, z, v) * 10);
      logArea[b * TILE_NODES + a] = outlet[k] ? 0 : Math.log10(r.area[k]!);
    }
    return { level, i: ti, j: tj, x0, z0, cell, dm, logArea };
  }

  // ---- Physics -------------------------------------------------------------------------------------------------
  /**
   * The simulation's ground (m relative to the runway, y = 0): the 10 m landscape or the water over it, lowered by
   * the planet's curvature, and exactly 0 on the airfield. Takes simulation coordinates (x mirrored).
   */
  readonly ground = (simX: number, simZ: number): number => {
    const x = -simX, z = simZ, w = Landscape.padWeight(x, z);
    if (w === 0) return 0;
    const h = this.height(x, z), water = this.waterLevel(x, z), top = h > water ? h : water;
    const city = this.cityTopAt(x, z);
    const surface = city !== null && city > top ? city : top;
    return surface - this.padElevation - curvatureDrop(x, z);
  };
  /** Only the runway itself is landable away from the flat airfield. */
  readonly landable = (simX: number, simZ: number) => Math.abs(simX) <= 15 && simZ >= -320 && simZ <= 520;

  /** Curvature drop (m) of the rendered surface at (x, z): the same parabola physics uses. */
  static drop(x: number, z: number) { return curvatureDrop(x, z); }

  // The city is filled in by ecology.ts (it needs the landscape first).
  cityTopAt: (x: number, z: number) => number | null = () => null;
}

/** Catmull-Rom (interpolating, C¹) over a node accessor at fractional node coordinates. */
export function catmullRom(node: (i: number, j: number) => number, fx: number, fz: number): number {
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const wu = cr(u), wv = cr(v);
  let s = 0;
  for (let b = 0; b < 4; b++) {
    let row = 0;
    for (let a = 0; a < 4; a++) row += wu[a]! * node(i - 1 + a, j - 1 + b);
    s += wv[b]! * row;
  }
  return s;
}
function cr(t: number) {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

/** Bilinear interpolation over a square grid of `n` nodes per row (clamped to the last cell). */
export function bilinear(a: ArrayLike<number>, n: number, fx: number, fz: number): number {
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i >= n - 1) i = n - 2; if (j >= n - 1) j = n - 2;
  if (i < 0) i = 0; if (j < 0) j = 0;
  const u = fx - i, v = fz - j, k = j * n + i;
  const a00 = a[k]!, a10 = a[k + 1]!, a01 = a[k + n]!, a11 = a[k + n + 1]!;
  return a00 + (a10 - a00) * u + (a01 - a00) * v + (a00 - a10 - a01 + a11) * u * v;
}
