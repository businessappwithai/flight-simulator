/**
 * What grows on the simulated land, decided from the terrain alone (deterministic from the seed):
 *  - a forest of pines and junipers on the mid slopes, cottonwood ribbons along the rivers, bare rock up high, on
 *    cliffs and on the airfield;
 *  - a city of towers on the shore of the first lake, tallest downtown.
 * Trees are counted per 320 m global cell, so the total is known without placing them all; they are placed (and
 * get their height from whichever level of detail draws them) only for the tiles being shown.
 */
import { GLOBAL_CELL_M, GLOBAL_NODES, type Landscape } from "./landscape.ts";
import { hash32, hashFloat, smoothstep } from "./noise.ts";

/** Most trees in one 320 m cell (fully forested). */
export const MAX_TREES_PER_CELL = 380;
export const TREE_KINDS = { PINE: 0, JUNIPER: 1, COTTONWOOD: 2 } as const;
const LOT_M = 110, CITY_TARGET = 4861;

export interface Building { x: number; z: number; w: number; d: number; h: number; base: number }

export class Ecology {
  /** Tree density per global node (0..1) and how many trees each cell holds. */
  readonly density: Float32Array;
  readonly counts: Uint16Array;
  readonly treeTotal: number;
  readonly buildings: Building[];
  readonly #lots = new Map<number, Building[]>();
  readonly #seed: number;

  constructor(readonly land: Landscape) {
    this.#seed = land.seeds[15]!;
    const n = GLOBAL_NODES, cell = GLOBAL_CELL_M;
    this.buildings = this.#city();
    this.density = new Float32Array(n * n); this.counts = new Uint16Array(n * n);
    let total = 0;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i, x = land.x0 + i * cell, z = land.z0 + j * cell;
      const d = this.densityAt(x, z, k);
      this.density[k] = d;
      const c = Math.floor(d * MAX_TREES_PER_CELL + hashFloat(i, j, this.#seed));
      this.counts[k] = c; total += c;
    }
    this.treeTotal = total;
    land.cityTopAt = (x, z) => this.cityTopAt(x, z);
  }

  /** Forest density from altitude, slope, moisture (drainage area) and what else is there. */
  densityAt(x: number, z: number, k = -1): number {
    const l = this.land, n = GLOBAL_NODES;
    const h = k >= 0 ? l.global[k]! : l.globalHeight(x, z), water = l.waterLevel(x, z);
    if (h <= water + 2) return 0;
    const i = k >= 0 ? k % n : Math.round((x - l.x0) / GLOBAL_CELL_M), j = k >= 0 ? (k - i) / n : Math.round((z - l.z0) / GLOBAL_CELL_M);
    const at = (a: number, b: number) => l.global[Math.max(0, Math.min(n - 1, b)) * n + Math.max(0, Math.min(n - 1, a))]!;
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * GLOBAL_CELL_M), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * GLOBAL_CELL_M);
    const slope = Math.sqrt(gx * gx + gz * gz);
    const wet = smoothstep(8.2, 9.4, l.globalLogArea[j * n + i] ?? 0);
    // Pines and junipers between the dry lowland and the bare summits; nothing on cliffs; cottonwoods by rivers.
    const band = smoothstep(380, 900, h) * (1 - smoothstep(2100, 2700, h));
    const steep = 1 - smoothstep(0.45, 0.8, slope);
    const patches = smoothstep(0.35, 0.65, hashNoise(x / 9000, z / 9000, this.#seed));
    const r = Math.sqrt(x * x + z * z), clear = smoothstep(3800, 5200, r) * (this.#nearCity(x, z) ? 0 : 1);
    return Math.min(1, (band * steep * (0.25 + 0.75 * patches) + 0.9 * wet * (1 - smoothstep(1400, 2000, h))) * clear);
  }

  #nearCity(x: number, z: number) {
    const [cx, cz] = this.land.unitToWorld(this.land.brand.city.x, this.land.brand.city.y);
    return (x - cx) * (x - cx) + (z - cz) * (z - cz) < 3300 * 3300;
  }

  /**
   * Trees in the axis-aligned box, as [x, z, height, kind] per tree (y is left to the level that draws them).
   * `keep` thins them (1 = all) for coarse levels.
   */
  treesIn(x0: number, z0: number, x1: number, z1: number, keep = 1): Float32Array {
    const l = this.land, n = GLOBAL_NODES, cell = GLOBAL_CELL_M, out: number[] = [];
    const i0 = Math.max(1, Math.floor((x0 - l.x0) / cell - 0.5)), i1 = Math.min(n - 2, Math.ceil((x1 - l.x0) / cell + 0.5));
    const j0 = Math.max(1, Math.floor((z0 - l.z0) / cell - 0.5)), j1 = Math.min(n - 2, Math.ceil((z1 - l.z0) / cell + 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i, c = this.counts[k]!;
      if (!c) continue;
      const wet = smoothstep(8.2, 9.4, l.globalLogArea[k]!);
      for (let t = 0; t < c; t++) {
        const hsh = hash32(k, t, this.#seed);
        if (keep < 1 && (hsh & 1023) >= keep * 1024) continue;
        const x = l.x0 + (i - 0.5 + hashFloat(k, t * 2 + 1, this.#seed)) * cell, z = l.z0 + (j - 0.5 + hashFloat(k, t * 2 + 2, this.#seed)) * cell;
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
        const r = (hsh >>> 10) / 4194304, kind = r < wet * 0.8 ? TREE_KINDS.COTTONWOOD : r < 0.62 ? TREE_KINDS.PINE : TREE_KINDS.JUNIPER;
        const size = kind === TREE_KINDS.PINE ? 9 + 14 * hashFloat(k, t + 777, this.#seed) : kind === TREE_KINDS.JUNIPER ? 3.5 + 4 * hashFloat(k, t + 777, this.#seed) : 10 + 9 * hashFloat(k, t + 777, this.#seed);
        out.push(x, z, size, kind);
      }
    }
    return new Float32Array(out);
  }

  // ---- The city -------------------------------------------------------------------------------------------------
  #city(): Building[] {
    const l = this.land, [cx, cz] = l.unitToWorld(l.brand.city.x, l.brand.city.y), seed = this.#seed ^ 0x51ab;
    // Lots on a 110 m grid, nearest the centre first, on dry gentle ground.
    const lots: [number, number, number][] = [];
    const R = 34;
    for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) {
      const x = cx + a * LOT_M, z = cz + b * LOT_M, d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
      if (d > R * LOT_M) continue;
      if (l.lakeDistance(x, z) < 70 || l.coastDistance(x, z) > -400) continue;
      lots.push([d + 220 * hashFloat(a, b, seed), a, b]);
    }
    lots.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const out: Building[] = [];
    for (const [, a, b] of lots) {
      if (out.length >= CITY_TARGET) break;
      const x = cx + a * LOT_M, z = cz + b * LOT_M, base = l.levelHeight("L1", x, z);
      if (base <= l.waterLevel(x, z) + 1) continue;
      const slope = Math.abs(l.levelHeight("L1", x + 40, z) - l.levelHeight("L1", x - 40, z)) / 80 + Math.abs(l.levelHeight("L1", x, z + 40) - l.levelHeight("L1", x, z - 40)) / 80;
      if (slope > 0.2) continue;
      const d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz)), downtown = 1 - smoothstep(0, 1700, d);
      const parcels = hashFloat(a, b, seed + 1) < 0.25 + 0.5 * downtown ? 1 : hashFloat(a, b, seed + 2) < 0.5 ? 2 : 4;
      const lot: Building[] = [];
      for (let p = 0; p < parcels && out.length < CITY_TARGET; p++) {
        const half = 45, cols = parcels === 4 ? 2 : parcels, rows = parcels === 4 ? 2 : 1;
        const pw = (2 * half) / cols, pd = (2 * half) / rows, px = x - half + pw * ((p % cols) + 0.5), pz = z - half + pd * (Math.floor(p / cols) + 0.5);
        const r = hashFloat(a * 4 + p, b, seed + 3);
        const h = downtown > 0.05 ? 18 + downtown * downtown * (40 + 190 * r) : 7 + 16 * r;
        const bld = { x: px, z: pz, w: pw * (0.62 + 0.25 * hashFloat(a, b * 4 + p, seed + 4)), d: pd * (0.62 + 0.25 * hashFloat(a, b * 4 + p, seed + 5)), h, base };
        lot.push(bld); out.push(bld);
      }
      this.#lots.set(lotKey(a, b), lot);
    }
    this.#centre = [cx, cz];
    return out;
  }
  #centre: [number, number] = [0, 0];

  /** Roof height (m above sea level) of a building at (x, z), or null where there is none. */
  cityTopAt(x: number, z: number): number | null {
    const a = Math.round((x - this.#centre[0]) / LOT_M), b = Math.round((z - this.#centre[1]) / LOT_M);
    const lot = this.#lots.get(lotKey(a, b));
    if (!lot) return null;
    let top: number | null = null;
    for (const s of lot) if (Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2) { const t = s.base + s.h; if (top === null || t > top) top = t; }
    return top;
  }

  /** Buildings whose centre is in the box. */
  buildingsIn(x0: number, z0: number, x1: number, z1: number): Building[] {
    return this.buildings.filter(b => b.x >= x0 && b.x < x1 && b.z >= z0 && b.z < z1);
  }
}

const lotKey = (a: number, b: number) => (a + 512) * 1024 + (b + 512);
function hashNoise(x: number, z: number, seed: number) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hashFloat(xi, zi, seed), b = hashFloat(xi + 1, zi, seed), c = hashFloat(xi, zi + 1, seed), d = hashFloat(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
