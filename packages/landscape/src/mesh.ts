/**
 * Render meshes for the simulated planet as `TerrainPatch`es (the same pipeline as real-world terrain): float32
 * vertices relative to a double-precision centre, lowered by the same curvature the physics uses, with skirts, base
 * colours, and per-vertex attributes for the terrain shader (river log-area, forest density). Detail tiles also carry
 * their trees (heights from that level, so trees sit on the surface that is drawn) and the city's buildings.
 *
 * Levels: the global field in 20.48 km chunks (z 10), L1 tiles at 160 m vertex spacing (z 12), L0 tiles at 20 m (z 14).
 */
import type { TerrainPatch } from "@flight/protocol";
import type { Ecology } from "./ecology.ts";
import { GLOBAL_CELL_M, GLOBAL_NODES, LEVELS, Landscape, TILE_NODES, type TileLevel, bilinear } from "./landscape.ts";
import { smoothstep } from "./noise.ts";

export const PATCH_Z = { GLOBAL: 10, L1: 12, L0: 14 } as const;
const CHUNK = 64, STRIDE = 2;

/** Base albedo (sRGB bytes) of bare ground: terracotta sandstone, paler soil on the flats, sand at the shore. */
function soil(h: number, water: number, forest: number, wet: number): [number, number, number] {
  let r = 150, g = 86, b = 60;
  const flat = 1 - smoothstep(water + 40, water + 500, h);
  r += (152 - r) * flat * 0.35; g += (112 - g) * flat * 0.35; b += (82 - b) * flat * 0.35;
  const high = smoothstep(1800, 3000, h);
  r += (128 - r) * high; g += (104 - g) * high; b += (88 - b) * high;
  // A thin beach at the waterline, then a darker sea bed under the shallow water.
  if (h <= water + 1.5) { const bed = smoothstep(water, water - 8, h); r += (176 - r) * 0.6; g += (150 - g) * 0.6; b += (112 - b) * 0.6; r += (112 - r) * bed; g += (104 - g) * bed; b += (86 - b) * bed; }
  // Far away, forest reads as a darker, greener ground; near, the instanced trees stand on it.
  const f = Math.min(1, forest * 0.75 + wet * 0.3);
  r += (52 - r) * f; g += (62 - g) * f; b += (38 - b) * f;
  return [r, g, b];
}

interface Field { n: number; cell: number; x0: number; z0: number; height: (a: number, b: number) => number; logArea: (a: number, b: number) => number }

function build(key: string, z: number, f: Field, l: Landscape, eco: Ecology | undefined, extras: Partial<TerrainPatch> = {}): TerrainPatch {
  const n = f.n, size = (n - 1) * f.cell, cx = f.x0 + size / 2, cz = f.z0 + size / 2;
  const cy = -l.padElevation - Landscape.drop(cx, cz);
  const skirt = z === PATCH_Z.L0 ? 25 : z === PATCH_Z.L1 ? 120 : 400;
  const verts = n * n + 8 * n;
  const positions = new Float32Array(verts * 3), colors = new Uint8Array(verts * 3), attrs = new Float32Array(verts * 2);
  const put = (v: number, x: number, h: number, zz: number, la: number) => {
    positions[v * 3] = x - cx; positions[v * 3 + 1] = h - l.padElevation - Landscape.drop(x, zz) - cy; positions[v * 3 + 2] = zz - cz;
    const water = l.waterLevel(x, zz), forest = eco ? eco.densityAt(x, zz) : 0, wet = smoothstep(z === PATCH_Z.GLOBAL ? 8.6 : 6.4, z === PATCH_Z.GLOBAL ? 9.6 : 7.4, la);
    const [r, g, b] = soil(h, water, forest, wet);
    colors[v * 3] = r; colors[v * 3 + 1] = g; colors[v * 3 + 2] = b;
    attrs[v * 2] = la; attrs[v * 2 + 1] = forest;
  };
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) put(b * n + a, f.x0 + a * f.cell, f.height(a, b), f.z0 + b * f.cell, f.logArea(a, b));
  // Skirts: each edge copied twice (top and dropped bottom), so no gap shows between levels or neighbours; the copies
  // keep the vertical skirt faces out of the surface's vertex normals (shared vertices would darken every tile edge).
  const edges: [number, number][][] = [[], [], [], []];
  for (let t = 0; t < n; t++) { edges[0]!.push([t, 0]); edges[1]!.push([n - 1, t]); edges[2]!.push([n - 1 - t, n - 1]); edges[3]!.push([0, n - 1 - t]); }
  let v = n * n;
  const skirtStart: number[] = [];
  for (const e of edges) {
    skirtStart.push(v);
    for (const drop of [0, skirt]) for (const [a, b] of e) { const src = b * n + a; positions[v * 3] = positions[src * 3]!; positions[v * 3 + 1] = positions[src * 3 + 1]! - drop; positions[v * 3 + 2] = positions[src * 3 + 2]!;
      colors.copyWithin(v * 3, src * 3, src * 3 + 3); attrs[v * 2] = attrs[src * 2]!; attrs[v * 2 + 1] = attrs[src * 2 + 1]!; v++; }
  }
  const idx: number[] = [];
  for (let b = 0; b < n - 1; b++) for (let a = 0; a < n - 1; a++) {
    const i = b * n + a;
    // Alternate the diagonal so the triangulation has no preferred direction.
    if ((a + b) & 1) idx.push(i, i + n, i + 1, i + 1, i + n, i + n + 1); else idx.push(i, i + n, i + n + 1, i, i + n + 1, i + 1);
  }
  edges.forEach((e, s) => {
    for (let t = 0; t < n - 1; t++) {
      const top0 = skirtStart[s]! + t, top1 = top0 + 1, bot0 = top0 + n, bot1 = bot0 + 1;
      idx.push(top0, top1, bot0, top1, bot1, bot0);
    }
  });
  return { key, z, center: [cx, cy, cz], positions, colors, indices: new Uint16Array(idx), attrs, ...extras };
}

/** One 20.48 km chunk of the global field (the whole planet view). `ci, cj` in 0..7. */
export function globalPatch(l: Landscape, eco: Ecology | undefined, ci: number, cj: number): TerrainPatch {
  const n = CHUNK + 1, i0 = ci * CHUNK, j0 = cj * CHUNK;
  return build(`G/${ci}/${cj}`, PATCH_Z.GLOBAL, {
    n, cell: GLOBAL_CELL_M, x0: l.x0 + i0 * GLOBAL_CELL_M, z0: l.z0 + j0 * GLOBAL_CELL_M,
    height: (a, b) => l.global[(j0 + b) * GLOBAL_NODES + i0 + a]!, logArea: (a, b) => l.globalLogArea[(j0 + b) * GLOBAL_NODES + i0 + a]!,
  }, l, eco);
}
export const GLOBAL_CHUNKS = (GLOBAL_NODES - 1) / CHUNK;

/** A detail tile (L1 or L0) with its trees and (L0 only) buildings. */
export function tilePatch(l: Landscape, eco: Ecology | undefined, level: TileLevel, i: number, j: number): TerrainPatch {
  const t = l.tile(level, i, j), n = (TILE_NODES - 1) / STRIDE + 1, cell = t.cell * STRIDE;
  const extras: Partial<TerrainPatch> = {};
  if (eco) {
    const size = LEVELS[level].size, x1 = t.x0 + size, z1 = t.z0 + size;
    const raw = eco.treesIn(t.x0, t.z0, x1, z1, level === "L1" ? 0.25 : 1), count = raw.length / 4;
    const trees = new Float32Array(count * 5);
    for (let q = 0; q < count; q++) {
      const x = raw[q * 4]!, z = raw[q * 4 + 1]!;
      // The surface this level draws (triangles of the stride-2 mesh ≈ bilinear over its own nodes).
      const y = bilinear(t.dm, TILE_NODES, (x - t.x0) / t.cell, (z - t.z0) / t.cell) / 10 - l.padElevation - Landscape.drop(x, z);
      trees.set([x, y, z, raw[q * 4 + 2]!, raw[q * 4 + 3]!], q * 5);
    }
    extras.trees = trees;
    const blds = eco.buildingsIn(t.x0, t.z0, x1, z1);
    if (blds.length) {
      const out = new Float32Array(blds.length * 6);
      blds.forEach((s, q) => out.set([s.x, s.base - l.padElevation - Landscape.drop(s.x, s.z), s.z, s.w, s.d, s.h], q * 6));
      extras.buildings = out;
    }
  }
  return build(`${level}/${i}/${j}`, PATCH_Z[level], {
    n, cell, x0: t.x0, z0: t.z0,
    height: (a, b) => t.dm[b * STRIDE * TILE_NODES + a * STRIDE]! / 10, logArea: (a, b) => t.logArea[b * STRIDE * TILE_NODES + a * STRIDE]!,
  }, l, eco, extras);
}
