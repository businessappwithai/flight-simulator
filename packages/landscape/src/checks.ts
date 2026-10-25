/**
 * "Measure, don't guess": images and numbers that show what the simulation made before anything is rendered.
 */
import { DIRS } from "./erosion.ts";
import { GLOBAL_CELL_M, GLOBAL_NODES, type Landscape, type LandscapeTile, TILE_NODES } from "./landscape.ts";

/** Hillshade (sun from the north-west, 45° up) with water, rivers and hypsometric tint, as RGB bytes. */
export function hillshade(h: ArrayLike<number>, n: number, cell: number, opts: { logArea?: ArrayLike<number>; water?: (k: number) => number; river?: number; scale?: number } = {}): Uint8Array {
  const out = new Uint8Array(n * n * 3), scale = opts.scale ?? 1;
  const lx = -0.5, ly = -0.5, lz = Math.SQRT1_2; // light direction (x east, y south, z up), normalised below
  const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, v = h[k]! * scale;
    const e = h[j * n + Math.min(n - 1, i + 1)]! * scale, w = h[j * n + Math.max(0, i - 1)]! * scale;
    const s = h[Math.min(n - 1, j + 1) * n + i]! * scale, no = h[Math.max(0, j - 1) * n + i]! * scale;
    const gx = (e - w) / (2 * cell), gy = (s - no) / (2 * cell);
    const nl = Math.sqrt(gx * gx + gy * gy + 1), shade = Math.max(0, (-gx * lx - gy * ly + lz) / nl / ll);
    const water = opts.water ? opts.water(k) : 0;
    let r: number, g: number, b: number;
    if (v <= water + 0.05) {
      const depth = Math.min(1, (water - v) / 80);
      r = 30 + 40 * (1 - depth); g = 70 + 110 * (1 - depth); b = 120 + 70 * (1 - depth);
    } else {
      const t = Math.min(1, v / 2800);
      r = 170 + 60 * t; g = 100 + 30 * t; b = 70 + 40 * t;
      r *= 0.35 + 0.75 * shade; g *= 0.35 + 0.75 * shade; b *= 0.35 + 0.75 * shade;
      const la = opts.logArea?.[k] ?? 0;
      if (opts.river !== undefined && la > opts.river) { const m = Math.min(1, (la - opts.river) / 0.6); r += (60 - r) * m; g += (140 - g) * m; b += (200 - b) * m; }
    }
    out[k * 3] = Math.max(0, Math.min(255, r)); out[k * 3 + 1] = Math.max(0, Math.min(255, g)); out[k * 3 + 2] = Math.max(0, Math.min(255, b));
  }
  return out;
}

export function globalHillshade(l: Landscape, river = 8.6) {
  const n = GLOBAL_NODES;
  return hillshade(l.global, n, GLOBAL_CELL_M, { logArea: l.globalLogArea, river, water: k => l.waterLevel(l.x0 + (k % n) * GLOBAL_CELL_M, l.z0 + Math.floor(k / n) * GLOBAL_CELL_M) });
}
export function tileHillshade(l: Landscape, t: LandscapeTile, river = 6) {
  return hillshade(t.dm, TILE_NODES, t.cell, { scale: 0.1, logArea: t.logArea, river, water: k => l.waterLevel(t.x0 + (k % TILE_NODES) * t.cell, t.z0 + Math.floor(k / TILE_NODES) * t.cell) });
}

/**
 * How much the drainage follows the grid: the share of flow directions that are one of the 4 axis directions. Pure
 * steepest-descent (D8) routing on noisy ground gives long straight axis/diagonal streaks; slope²-weighted stochastic
 * receivers spread directions so this stays near the isotropic share (~0.5).
 */
export function axisShare(direction: Int8Array): number {
  let axis = 0, total = 0;
  for (let i = 0; i < direction.length; i++) { const d = direction[i]!; if (d < 0) continue; total++; if (d < 4) axis++; }
  return total ? axis / total : 0;
}

/** Numbers about the global field: land share, relief, lakes. */
export function landscapeStats(l: Landscape) {
  const n = GLOBAL_NODES;
  let land = 0, max = -Infinity, lake = 0, sum = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = l.global[j * n + i]!, w = l.waterLevel(l.x0 + i * GLOBAL_CELL_M, l.z0 + j * GLOBAL_CELL_M);
    if (w === l.lakeLevel) lake++;
    if (v > w) { land++; sum += v; if (v > max) max = v; }
  }
  return { landShare: land / (n * n), lakeShare: lake / (n * n), maxM: max, meanLandM: land ? sum / land : 0, padElevationM: l.padElevation };
}

export { DIRS };
