/**
 * Landscape evolution: tectonic uplift against implicit stream-power erosion (Braun & Willett 2013), routed over a
 * priority-flooded surface (Barnes et al. 2014) with stochastic receivers, plus hillslope diffusion.
 *
 *  - Priority-flood + ε fills every depression, so every cell drains to an outlet (the sea, a lake, a tile edge);
 *    its pop order is a topological order (each receiver pops before its donors).
 *  - Each cell sends its water to one lower neighbour picked at random with weight slope² (not always the steepest:
 *    that is what draws the diagonal D8 streaks), seeded per cell and iteration, so the result is reproducible.
 *  - h ← (h + U·dt + F·h_receiver) / (1 + F), F = K·dt·√A / distance, solved downstream first (unconditionally stable).
 *  - Hillslope diffusion rounds the ridges a little.
 *
 * Grids are square, row-major, `n × n` nodes spaced `dx` metres. Arithmetic is limited to IEEE-exact operations
 * (+ − × ÷ √), so the eroded heights are identical in every JavaScript engine.
 */
import { hash32 } from "./noise.ts";

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** A min-heap of (key, index) in typed arrays: deterministic (same operations, same order) and allocation-free. */
class Heap {
  keys: Float64Array; vals: Int32Array; size = 0;
  constructor(capacity: number) { this.keys = new Float64Array(capacity); this.vals = new Int32Array(capacity); }
  push(k: number, v: number) {
    let i = this.size++;
    const keys = this.keys, vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= k) break;
      keys[i] = keys[p]!; vals[i] = vals[p]!; i = p;
    }
    keys[i] = k; vals[i] = v;
  }
  pop(): number {
    const keys = this.keys, vals = this.vals, top = vals[0]!, n = --this.size;
    if (n > 0) {
      const k = keys[n]!, v = vals[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1, c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= k) break;
        keys[i] = keys[c]!; vals[i] = vals[c]!; i = c;
      }
      keys[i] = k; vals[i] = v;
    }
    return top;
  }
}

export interface ErosionInput {
  n: number;
  dx: number;
  /** Heights (m), eroded in place. */
  h: Float64Array;
  /** 1 where the cell is a fixed outlet (sea, lake, tile edge): never eroded, water leaves the grid there. */
  outlet: Uint8Array;
  /** Water level of each outlet (m): where rivers end (0 for the sea, the lake surface, the edge height). */
  base: Float64Array;
  /** Uplift per iteration (m), or none. */
  uplift?: Float64Array;
  /** K·dt of the stream-power law (per √m). */
  k: number;
  iterations: number;
  /** Explicit hillslope diffusion per iteration (fraction of the 4-neighbour Laplacian). */
  diffusion: number;
  seed: number;
  /**
   * Re-flood and re-pick receivers every this many iterations (default 1). In between, the previous routing is kept:
   * it is still a valid downstream-first order, and flooding is most of the cost.
   */
  floodEvery?: number;
  /** Called after each iteration (progress). */
  onIteration?: (i: number) => void;
}

export interface ErosionResult {
  /** Drainage area (m²) of the last iteration, including the cell itself. */
  area: Float64Array;
  /** Receiver of each cell (-1 for outlets and unreachable cells). */
  receiver: Int32Array;
  /** Direction index (0..7, see DIRS) each cell drains to, -1 for outlets. */
  direction: Int8Array;
  /** Filled surface (lakes: where filled > h). */
  filled: Float64Array;
}

// Each pass is its own small function: JavaScript engines optimise small monomorphic loops far better than one
// large function (measured: ~10× on JSC).
function flood(heap: Heap, h: Float64Array, uplift: Float64Array | undefined, hf: Float64Array, base: Float64Array, outlet: Uint8Array,
  visited: Uint8Array, land: Int32Array, seeds: Int32Array, off: Int32Array, order: Int32Array, N: number, eps: number): number {
  for (let q = 0; q < land.length; q++) visited[land[q]!] = 0;
  for (let q = 0; q < seeds.length; q++) { const i = seeds[q]!; visited[i] = 1; heap.push(base[i]!, i); }
  let count = 0;
  while (heap.size) {
    const c = heap.pop(), hc = hf[c]! + eps;
    if (!outlet[c]) order[count++] = c;
    for (let d = 0; d < 8; d++) {
      const j = c + off[d]!;
      if (j < 0 || j >= N || visited[j]) continue;
      visited[j] = 1;
      const lifted = uplift ? h[j]! + uplift[j]! : h[j]!;
      const v = lifted > hc ? lifted : hc;
      hf[j] = v;
      heap.push(v, j);
    }
  }
  return count;
}
function pickReceivers(order: Int32Array, count: number, hf: Float64Array, off: Int32Array, dist: Float64Array, w2: Float64Array,
  rcv: Int32Array, dir: Int8Array, rdist: Float64Array, it: number, seed: number) {
  for (let q = 0; q < count; q++) {
    const i = order[q]!, hi = hf[i]!;
    let total = 0;
    for (let d = 0; d < 8; d++) {
      const drop = hi - hf[i + off[d]!]!;
      if (drop > 0) { const s = drop / dist[d]!; w2[d] = s * s; total += s * s; } else w2[d] = 0;
    }
    let pick = hash32(i, it, seed) / 4294967296 * total, cd = -1;
    for (let d = 0; d < 8; d++) {
      if (w2[d]! > 0) { cd = d; pick -= w2[d]!; if (pick < 0) break; }
    }
    rcv[i] = cd < 0 ? -1 : i + off[cd]!; dir[i] = cd; rdist[i] = cd < 0 ? 0 : dist[cd]!;
  }
}
function accumulate(order: Int32Array, count: number, rcv: Int32Array, area: Float64Array, cellArea: number) {
  for (let i = 0; i < area.length; i++) area[i] = cellArea;
  for (let q = count - 1; q >= 0; q--) { const i = order[q]!, r = rcv[i]!; if (r >= 0) area[r] = area[r]! + area[i]!; }
}
function streamPower(order: Int32Array, count: number, rcv: Int32Array, rdist: Float64Array, area: Float64Array, h: Float64Array,
  uplift: Float64Array | undefined, outlet: Uint8Array, base: Float64Array, k: number) {
  for (let q = 0; q < count; q++) {
    const i = order[q]!, r = rcv[i]!;
    const hi = uplift ? h[i]! + uplift[i]! : h[i]!;
    if (r < 0) { h[i] = hi; continue; }
    const hr = outlet[r] ? base[r]! : h[r]!, f = k * Math.sqrt(area[i]!) / rdist[i]!;
    h[i] = (hi + f * hr) / (1 + f);
  }
}
function diffuse(h: Float64Array, tmp: Float64Array, land: Int32Array, seeds: Int32Array, base: Float64Array, n: number, c: number) {
  for (let q = 0; q < seeds.length; q++) tmp[seeds[q]!] = base[seeds[q]!]!;
  for (let q = 0; q < land.length; q++) tmp[land[q]!] = h[land[q]!]!;
  for (let q = 0; q < land.length; q++) { const i = land[q]!; h[i] = tmp[i]! + c * (tmp[i - 1]! + tmp[i + 1]! + tmp[i - n]! + tmp[i + n]! - 4 * tmp[i]!); }
}

export function erode(input: ErosionInput): ErosionResult {
  const { n, dx, h, outlet, base, uplift, k, iterations, diffusion, seed } = input, every = input.floodEvery ?? 1;
  const N = n * n, diag = dx * Math.SQRT2, cellArea = dx * dx;
  // The grid's border is always an outlet, so the neighbours of a land cell are always inside the grid.
  for (let i = 0; i < n; i++) {
    const edge = [i, (n - 1) * n + i, i * n, i * n + n - 1];
    for (let e = 0; e < 4; e++) { const c = edge[e]!; if (!outlet[c]) { outlet[c] = 1; base[c] = h[c]!; } }
  }
  const off = new Int32Array(8), dist = new Float64Array(8);
  for (let d = 0; d < 8; d++) { off[d] = DIRS[d]![1] * n + DIRS[d]![0]; dist[d] = d < 4 ? dx : diag; }
  let L = 0;
  for (let i = 0; i < N; i++) if (!outlet[i]) L++;
  const land = new Int32Array(L);
  for (let i = 0, q = 0; i < N; i++) if (!outlet[i]) land[q++] = i;
  // Outlets that touch the land seed the flood.
  const seedSet = new Uint8Array(N);
  for (let q = 0; q < L; q++) for (let d = 0; d < 8; d++) { const j = land[q]! + off[d]!; if (outlet[j]) seedSet[j] = 1; }
  let S = 0;
  for (let i = 0; i < N; i++) if (seedSet[i]) S++;
  const seeds = new Int32Array(S);
  for (let i = 0, q = 0; i < N; i++) if (seedSet[i]) seeds[q++] = i;
  const hf = new Float64Array(N), order = new Int32Array(L), rcv = new Int32Array(N).fill(-1), rdist = new Float64Array(N);
  const dir = new Int8Array(N).fill(-1), area = new Float64Array(N), visited = new Uint8Array(N), tmp = new Float64Array(N), w2 = new Float64Array(8);
  const heap = new Heap(L + S + 1);
  for (let i = 0; i < N; i++) if (outlet[i]) hf[i] = base[i]!;
  let count = 0;
  for (let it = 0; it < iterations; it++) {
    // 1. Priority-flood + ε from every outlet that touches the land; 2. stochastic receivers (slope²);
    // 3. drainage area, upstream first; 4. implicit stream power, downstream first; 5. hillslope diffusion.
    if (it % every === 0) {
      count = flood(heap, h, uplift, hf, base, outlet, visited, land, seeds, off, order, N, 1e-4);
      pickReceivers(order, count, hf, off, dist, w2, rcv, dir, rdist, it, seed);
      accumulate(order, count, rcv, area, cellArea);
    }
    streamPower(order, count, rcv, rdist, area, h, uplift, outlet, base, k);
    // Outlets enter the Laplacian at their water level (the sea floor must not drag the coast down).
    if (diffusion > 0) diffuse(h, tmp, land, seeds, base, n, diffusion);
    input.onIteration?.(it);
  }
  return { area, receiver: rcv, direction: dir, filled: hf };
}

export { DIRS };
