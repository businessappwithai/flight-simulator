/**
 * Meshes for buildings (extruded footprints) and airport surfaces (runways, taxiways, aprons, helipads, edge lights)
 * in the renderer's frame. Flat-shaded, non-indexed triangles; the page computes normals and draws both sides.
 */
import type { FeaturePatch, Vec3Tuple } from "@flight/protocol";
import type { SimVector } from "./anchor.ts";
import { FEATURE_ZOOM } from "./features-world.ts";
import { type LonLat, type VectorFeatures, hash32, triangulate } from "./vector.ts";
import { lonLatToTile, tileKey } from "./tiles.ts";

export interface MeshContext {
  /** lon/lat → local simulation coordinates (x, z used; y is the height of the anchor plane there). */
  toLocal(lon: number, lat: number): SimVector;
  /** Terrain height (local y) under local (x, z); the flat airfield returns 0. */
  terrainY(x: number, z: number): number;
  /** True on the procedural airfield, where real buildings are not drawn. */
  onAirfield(x: number, z: number): boolean;
}

const WALLS: [number, number, number][] = [[214, 208, 196], [198, 192, 182], [228, 222, 208], [184, 180, 174], [206, 196, 180], [170, 176, 186]];
class Builder {
  pos: number[] = []; col: number[] = []; lights: number[] = [];
  constructor(readonly center: SimVector) {}
  /** Local vector → three.js coordinates relative to the patch centre. */
  #p(v: SimVector) { return [-(v.x - this.center.x), v.y - this.center.y, v.z - this.center.z]; }
  tri(a: SimVector, b: SimVector, c: SimVector, rgb: readonly number[]) { for (const v of [a, b, c]) { this.pos.push(...this.#p(v)); this.col.push(rgb[0]!, rgb[1]!, rgb[2]!); } }
  quad(a: SimVector, b: SimVector, c: SimVector, d: SimVector, rgb: readonly number[]) { this.tri(a, b, c, rgb); this.tri(a, c, d, rgb); }
  light(v: SimVector) { this.lights.push(...this.#p(v)); }
  patch(key: string, layer: FeaturePatch["layer"]): FeaturePatch {
    const c: Vec3Tuple = [-this.center.x, this.center.y, this.center.z];
    return { key, layer, center: c, positions: new Float32Array(this.pos), colors: new Uint8Array(this.col), ...(this.lights.length ? { lights: new Float32Array(this.lights) } : {}) };
  }
}
const open = (r: LonLat[]) => (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.slice(0, -1) : r);
const centreOf = (v: VectorFeatures, ctx: MeshContext) => {
  const n = 2 ** v.tile.z, lon = ((v.tile.x + 0.5) / n) * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (v.tile.y + 0.5)) / n))) * 180 / Math.PI;
  const c = ctx.toLocal(lon, lat);
  return { x: c.x, y: ctx.terrainY(c.x, c.z), z: c.z };
};

/** Extruded buildings owned by this tile (footprint centre inside it), skipping the procedural airfield. */
export function buildingsMesh(v: VectorFeatures, ctx: MeshContext): FeaturePatch {
  const b = new Builder(centreOf(v, ctx));
  let count = 0;
  for (const bld of v.buildings) {
    const ring = open(bld.rings[0]!);
    if (ring.length < 3) continue;
    const cLon = ring.reduce((s, p) => s + p[0], 0) / ring.length, cLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    if (v.tile.z === FEATURE_ZOOM) { const t = lonLatToTile(cLon, cLat, FEATURE_ZOOM); if (t.x !== v.tile.x || t.y !== v.tile.y) continue; }
    const c = ctx.toLocal(cLon, cLat);
    if (ctx.onAirfield(c.x, c.z)) continue;
    const base = ctx.terrainY(c.x, c.z) - 0.5, top = base + 0.5 + bld.heightM;
    const pts = ring.map(p => ctx.toLocal(p[0], p[1]));
    const h = hash32(bld.id), wall = WALLS[h % WALLS.length]!, shade = 0.9 + ((h >>> 8) % 20) / 100;
    const wc = wall.map(x => Math.min(255, Math.round(x * shade))), roof = wall.map(x => Math.round(x * 0.62));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
      b.quad({ x: p.x, y: base, z: p.z }, { x: q.x, y: base, z: q.z }, { x: q.x, y: top, z: q.z }, { x: p.x, y: top, z: p.z }, wc);
    }
    const xy = pts.flatMap(p => [p.x, p.z]), idx = triangulate(xy);
    for (let i = 0; i < idx.length; i += 3) { const [a, d, e] = [pts[idx[i]!]!, pts[idx[i + 1]!]!, pts[idx[i + 2]!]!]; b.tri({ x: a.x, y: top, z: a.z }, { x: d.x, y: top, z: d.z }, { x: e.x, y: top, z: e.z }, roof); }
    count++;
  }
  void count;
  return b.patch(`buildings:${tileKey(v.tile)}`, "buildings");
}

const SURFACE: Record<string, [number, number, number]> = { runway: [54, 56, 60], taxiway: [82, 84, 88], apron: [118, 120, 122], helipad: [96, 96, 96] };
/** Runways and taxiways as strips along their centrelines, aprons and helipads as polygons, runway edge lights. */
export function aerowaysMesh(v: VectorFeatures, ctx: MeshContext): FeaturePatch {
  const b = new Builder(centreOf(v, ctx));
  const surfaceY = (x: number, z: number, lift: number) => ctx.terrainY(x, z) + (ctx.onAirfield(x, z) ? 0.03 + lift / 10 : 0.2 + lift);
  // Draw order by lift: aprons lowest, then taxiways, then runways, so overlaps do not flicker.
  const lift = { apron: 0, helipad: 0.02, taxiway: 0.04, runway: 0.08 } as const;
  for (const a of v.aeroways) {
    const rgb = SURFACE[a.kind]!, l = lift[a.kind];
    if (a.rings) {
      const pts = open(a.rings[0]!).map(p => ctx.toLocal(p[0], p[1]));
      if (pts.length < 3) continue;
      const idx = triangulate(pts.flatMap(p => [p.x, p.z]));
      for (let i = 0; i < idx.length; i += 3) {
        const t = [pts[idx[i]!]!, pts[idx[i + 1]!]!, pts[idx[i + 2]!]!].map(p => ({ x: p.x, y: surfaceY(p.x, p.z, l), z: p.z }));
        b.tri(t[0]!, t[1]!, t[2]!, rgb);
      }
    } else if (a.line) {
      const pts = a.line.map(p => ctx.toLocal(p[0], p[1])), w = a.widthM / 2;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]!, q = pts[i]!, dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const nx = -dz / len * w, nz = dx / len * w, at = (s: SimVector, sx: number, sz: number) => ({ x: s.x + sx, y: surfaceY(s.x + sx, s.z + sz, l), z: s.z + sz });
        b.quad(at(p, nx, nz), at(q, nx, nz), at(q, -nx, -nz), at(p, -nx, -nz), rgb);
        if (a.kind !== "runway") continue;
        // Centreline dashes (30 m every 60 m) and edge lights every 60 m.
        const ux = dx / len, uz = dz / len, cx = -uz * 0.6, cz = ux * 0.6;
        for (let s = 15; s + 30 <= len; s += 60) {
          const s0 = { x: p.x + ux * s, z: p.z + uz * s }, s1 = { x: p.x + ux * (s + 30), z: p.z + uz * (s + 30) };
          const y0 = surfaceY(s0.x, s0.z, l) + 0.02, y1 = surfaceY(s1.x, s1.z, l) + 0.02;
          b.quad({ x: s0.x + cx, y: y0, z: s0.z + cz }, { x: s1.x + cx, y: y1, z: s1.z + cz }, { x: s1.x - cx, y: y1, z: s1.z - cz }, { x: s0.x - cx, y: y0, z: s0.z - cz }, [236, 236, 230]);
        }
        for (let s = 0; s <= len; s += 60) for (const side of [1, -1]) {
          const x = p.x + ux * s + side * nx * 1.05, z = p.z + uz * s + side * nz * 1.05;
          b.light({ x, y: surfaceY(x, z, l) + 0.4, z });
        }
      }
    }
  }
  return b.patch(`airports:${tileKey(v.tile)}`, "airports");
}
