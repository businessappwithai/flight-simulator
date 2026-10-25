/**
 * The simulated planet as the simulator worker uses it (the counterpart of GeoWorld for real terrain):
 *  - physics: `ground` / `landable` for DeterministicSimulation (pure functions of the seed: no clock hold needed);
 *  - rendering: LOD patches streamed around a focus (the aircraft, or the reveal camera), with ring boxes so a
 *    coarser level hides where a finer one is drawn;
 *  - the reveal shot (camera keys planned over the final terrain, with its clearance table) and status for the page.
 */
import { type LandscapeInfo, type LandscapeStatus, type RevealKey, type TerrainPatch, REVEAL, curvatureDrop, revealFrame, revealPoint } from "@flight/protocol";
import { type Brand, CLAWD } from "./brand.ts";
import { Ecology } from "./ecology.ts";
import { DOMAIN_M, GLOBAL_CELL_M, GLOBAL_NODES, LANDSCAPE_VERSION, LEVELS, Landscape, PLANET_RADIUS_M, type TileLevel } from "./landscape.ts";
import { GLOBAL_CHUNKS, globalPatch, tilePatch } from "./mesh.ts";

export interface PlanetOptions { seed: bigint; brand?: Brand; iterations?: number; onProgress?: (phase: string, fraction: number) => void }

/** Clearance the reveal camera keeps over the final terrain (m) on every frame. */
export const REVEAL_MIN_CLEARANCE_M = 350;

export class Planet {
  readonly land: Landscape;
  readonly eco: Ecology;
  readonly generateMs: number;
  readonly info: LandscapeInfo;
  manifest?: string;
  readonly #sent = new Set<string>();
  #rings: LandscapeStatus["rings"] = {};

  constructor(o: PlanetOptions) {
    const t0 = Date.now();
    this.land = new Landscape({ seed: o.seed, brand: o.brand ?? CLAWD, iterations: o.iterations, onProgress: o.onProgress });
    o.onProgress?.("ecology", 0);
    this.eco = new Ecology(this.land);
    o.onProgress?.("reveal", 0);
    this.info = this.#plan();
    this.generateMs = Date.now() - t0;
    o.onProgress?.("ready", 1);
  }

  /** SHA-256 over seed, brand, generator version and the global field in decimetres (what every tile is refined from). */
  async computeManifest(): Promise<string> {
    const dm = new Int32Array(this.land.global.length);
    for (let i = 0; i < dm.length; i++) dm[i] = Math.round(this.land.global[i]! * 10);
    const head = new TextEncoder().encode(JSON.stringify({ v: LANDSCAPE_VERSION, seed: String(this.land.seed), brand: this.land.brand, nodes: GLOBAL_NODES }));
    const bytes = new Uint8Array(head.length + dm.byteLength);
    bytes.set(head); bytes.set(new Uint8Array(dm.buffer), head.length);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return (this.manifest = [...hash].map(b => b.toString(16).padStart(2, "0")).join(""));
  }

  readonly ground = (x: number, z: number) => this.land.ground(x, z);
  readonly landable = (x: number, z: number) => this.land.landable(x, z);

  // ---- The reveal shot ----------------------------------------------------------------------------------------------
  /** Highest ground (m above sea level, water surface included) within `r` m of (x, z), on the L1 field. */
  #highest(x: number, z: number, r: number) {
    let top = -Infinity;
    for (let b = -r; b <= r; b += 80) for (let a = -r; a <= r; a += 80) {
      const h = Math.max(this.land.levelHeight("L1", x + a, z + b), this.land.waterLevel(x + a, z + b));
      if (h > top) top = h;
    }
    return top;
  }
  /** Clearance of the camera over the final terrain on each frame of the shot (m). */
  clearanceTable(camera: readonly RevealKey[], frames = revealFrame(REVEAL.duration)): Float64Array {
    const out = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      const p = revealPoint(camera, (f) / REVEAL.fps);
      out[f] = p.alt - this.#highest(p.x, p.z, p.alt < 6000 ? 160 : 0);
    }
    return out;
  }

  #plan(): LandscapeInfo {
    const l = this.land, b = l.brand, P = l.padElevation, R = REVEAL;
    const [px, pz] = l.unitToWorld(b.passes[0]![0], b.passes[0]![1]);
    const [cx, cz] = l.unitToWorld(b.city.x, b.city.y);
    const lake = b.lakes[0]!, [lx, lz] = l.unitToWorld((lake.x0 + lake.x1) / 2, (lake.y0 + lake.y1) / 2);
    const bounds = b.land.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const [mx, mz] = l.unitToWorld((bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2);
    const start: [number, number] = [0, 4200];
    const saddle = this.#highest(px, pz, 400), cityGround = this.#highest(cx, cz, 400);
    const camera: RevealKey[] = [
      { t: 0, x: start[0], z: start[1], alt: P + 2300 },
      { t: R.terrainStart, x: start[0], z: start[1], alt: P + 2300 },
      { t: 6.0, x: px, z: pz, alt: saddle + 450 },
      { t: 8.0, x: (px + cx) / 2, z: (pz + cz) / 2, alt: Math.max(this.#highest((px + cx) / 2, (pz + cz) / 2, 1500) + 450, cityGround + 600) },
      { t: 10.0, x: cx, z: cz, alt: cityGround + 600 },
      { t: R.climbStart, x: lx, z: lz, alt: l.lakeLevel + 600 },
      { t: R.reveal, x: mx, z: mz + 108_000, alt: 90_000 },
      { t: R.duration, x: mx, z: mz + 108_000, alt: 90_000 },
    ];
    // Plan the shot over the final terrain: wherever a frame comes closer than the minimum, lift the keys around it.
    let table = this.clearanceTable(camera);
    for (let round = 0; round < 40; round++) {
      let worst = 0;
      for (let f = 1; f < table.length; f++) if (table[f]! < table[worst]!) worst = f;
      if (table[worst]! >= REVEAL_MIN_CLEARANCE_M + 5) break;
      // Lift the two keys around the lowest frame, each by its share of the deficit.
      const t = worst / REVEAL.fps, k = camera.findIndex(c => c.t > t), a = camera[k - 1]!, c = camera[k]!;
      const s = (t - a.t) / (c.t - a.t), lift = REVEAL_MIN_CLEARANCE_M + 40 - table[worst]!;
      if (a.alt < 20_000) a.alt += lift * (1 - s) + 10;
      if (c.alt < 20_000) c.alt += lift * s + 10;
      // Held keys must stay identical (a hold has no motion).
      camera[0]!.alt = camera[1]!.alt;
      table = this.clearanceTable(camera);
    }
    let minF = 0;
    for (let f = 1; f < table.length; f++) if (table[f]! < table[minF]!) minF = f;
    const target: RevealKey[] = [
      { t: 0, x: px, z: pz, alt: saddle },
      { t: R.terrainStart, x: px, z: pz, alt: saddle },
      { t: 6.0, x: cx, z: cz, alt: cityGround },
      { t: 10.0, x: lx, z: lz - 6000, alt: l.lakeLevel },
      { t: R.climbStart, x: lx, z: lz - 12_000, alt: l.lakeLevel },
      { t: R.reveal, x: mx, z: mz, alt: 1 },
      { t: R.duration, x: mx, z: mz, alt: 1 },
    ];
    const n = GLOBAL_NODES, heights = new Float32Array(n * n);
    for (let i = 0; i < heights.length; i++) heights[i] = l.global[i]!;
    const u = b.unitM;
    return {
      seed: String(l.seed), brand: b.name, color: b.color, padElevationM: P, lakeLevelM: l.lakeLevel, planetRadiusM: PLANET_RADIUS_M,
      heights, size: n, cell: GLOBAL_CELL_M, x0: l.x0, z0: l.z0,
      lakes: b.lakes.map(r => { const [a, c] = l.unitToWorld(r.x0, r.y0); return [a, c, a + (r.x1 - r.x0) * u, c + (r.y1 - r.y0) * u] as [number, number, number, number]; }),
      centre: [mx, mz], buildOrigin: [start[0], start[1] - 6000], city: [cx, cz],
      camera, target, clearance: { minM: Math.round(table[minF]!), frame: minF + 1 },
    };
  }

  // ---- Streaming ----------------------------------------------------------------------------------------------------
  /**
   * Patches to add and keys to drop for a focus point (three.js x, z; altitude above sea level). Generating a detail
   * tile takes ~0.3 s, so at most `budget` new tiles are generated per call (cached tiles are meshed freely).
   */
  stream(x: number, z: number, alt: number, budget = 1): { add: TerrainPatch[]; remove: string[] } {
    const l = this.land, ground = Math.max(l.globalHeight(x, z), 0), agl = alt - ground;
    const want = new Map<string, () => TerrainPatch>();
    for (let cj = 0; cj < GLOBAL_CHUNKS; cj++) for (let ci = 0; ci < GLOBAL_CHUNKS; ci++) want.set(`G/${ci}/${cj}`, () => globalPatch(l, this.eco, ci, cj));
    const ring = (level: TileLevel): string[] => {
      const [i, j] = l.tileIndex(level, x, z), max = l.tileCount(level), keys: string[] = [];
      for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) {
        if (a < 0 || b < 0 || a >= max || b >= max) continue;
        const key = `${level}/${a}/${b}`;
        keys.push(key);
        want.set(key, () => tilePatch(l, this.eco, level, a, b));
      }
      return keys;
    };
    const l1 = agl < 40_000 ? ring("L1") : [], l0 = agl < 5_000 ? ring("L0") : [];
    const remove = [...this.#sent].filter(k => !want.has(k));
    for (const k of remove) this.#sent.delete(k);
    const add: TerrainPatch[] = [];
    let generated = 0;
    // Nearest first: the ring under the focus, then outwards; the global chunks are cheap and go first of all.
    const rank = (k: string) => k.startsWith("G/") ? 0 : k.startsWith("L1/") ? 2 : 1;
    const dist = (k: string) => {
      const [lv, a, b] = k.split("/"), size = lv === "G" ? DOMAIN_M / GLOBAL_CHUNKS : LEVELS[lv as TileLevel].size;
      const ccx = l.x0 + (Number(a) + 0.5) * size, ccz = l.z0 + (Number(b) + 0.5) * size;
      return (ccx - x) ** 2 + (ccz - z) ** 2;
    };
    const order = [...want.keys()].filter(k => !this.#sent.has(k)).sort((p, q) => rank(p) - rank(q) || dist(p) - dist(q));
    for (const k of order) {
      const [lv, a, b] = k.split("/");
      if (lv !== "G" && !l.cached(lv as TileLevel, Number(a), Number(b))) { if (generated >= budget) continue; generated++; }
      add.push(want.get(k)!()); this.#sent.add(k);
    }
    const box = (level: TileLevel, keys: string[]): [number, number, number, number] | undefined => {
      if (!keys.length || !keys.every(k => this.#sent.has(k))) return undefined;
      const size = LEVELS[level].size, idx = keys.map(k => k.split("/").slice(1).map(Number) as [number, number]);
      const i0 = Math.min(...idx.map(p => p[0])), j0 = Math.min(...idx.map(p => p[1])), i1 = Math.max(...idx.map(p => p[0])) + 1, j1 = Math.max(...idx.map(p => p[1])) + 1;
      return [l.x0 + i0 * size, l.z0 + j0 * size, l.x0 + i1 * size, l.z0 + j1 * size];
    };
    this.#rings = { ...(box("L1", l1) ? { l1: box("L1", l1)! } : {}), ...(box("L0", l0) ? { l0: box("L0", l0)! } : {}) };
    return { add, remove };
  }
  /** Forget what was sent (the page cleared its meshes). */
  resetStream() { this.#sent.clear(); this.#rings = {}; }
  get rings() { return this.#rings; }

  status(simX: number, simY: number, simZ: number): Omit<LandscapeStatus, "state" | "progress" | "phase"> {
    const l = this.land, x = -simX, z = simZ;
    const r = Math.sqrt(x * x + z * z);
    let surface: LandscapeStatus["surface"] = "TERRAIN", elevation: number | null = null;
    if (r <= 3200) { surface = this.landable(simX, simZ) ? "RUNWAY" : "AIRFIELD"; elevation = l.padElevation; }
    else {
      // Status only: read the cached detail if it is there, never generate a tile for it.
      const [i, j] = l.tileIndex("L0", x, z), h = l.cached("L0", i, j) ? l.height(x, z) : l.globalHeight(x, z), w = l.waterLevel(x, z), top = l.cityTopAt(x, z);
      elevation = Math.max(h, w);
      if (top !== null && top >= elevation) { surface = "BUILDING"; elevation = top; } else if (w >= h) surface = "WATER";
    }
    const groundY = elevation - l.padElevation - curvatureDrop(x, z);
    const tiles = l.generatedTiles, lakes = l.brand.lakes.length;
    return {
      seed: String(l.seed), brand: l.brand.name, generateMs: this.generateMs, ...(this.manifest ? { manifest: this.manifest } : {}),
      tiles, trees: this.eco.treeTotal, buildings: this.eco.buildings.length,
      actors: GLOBAL_CHUNKS * GLOBAL_CHUNKS + (DOMAIN_M / LEVELS.L1.size) ** 2 + (DOMAIN_M / LEVELS.L0.size) ** 2 + this.eco.treeTotal + this.eco.buildings.length + lakes + 1,
      terrainElevationM: Math.round(elevation * 10) / 10, aglM: Math.round((simY - groundY) * 10) / 10, surface, rings: this.#rings,
    };
  }
}
