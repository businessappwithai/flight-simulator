/**
 * Mapbox Vector Tile (MVT 2.1) protobuf codec: decode for streaming, encode for baking archives and test fixtures.
 * Geometry stays in tile coordinates (0..extent, y down); `tileToLonLat` converts.
 */
import type { TileId } from "./tiles.ts";

export type MvtValue = string | number | boolean;
export type MvtPoint = [number, number];
export interface MvtFeature {
  id?: number;
  /** 1 point, 2 line, 3 polygon. */
  type: 1 | 2 | 3;
  properties: Record<string, MvtValue>;
  /** Points: one part per point; lines: one part per line; polygons: rings (exterior positive area, holes negative). */
  geometry: MvtPoint[][];
}
export interface MvtLayer { name: string; extent: number; features: MvtFeature[] }

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array, readonly end = buf.length) {}
  varint(): number {
    let result = 0, shift = 0, b: number;
    do {
      if (this.pos >= this.end) throw new Error("mvt: truncated varint");
      b = this.buf[this.pos++]!;
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return result;
  }
  sub(): Reader { const len = this.varint(), r = new Reader(this.buf, this.pos + len); r.pos = this.pos; this.pos += len; if (this.pos > this.end) throw new Error("mvt: truncated message"); return r; }
  string() { const r = this.sub(); return new TextDecoder().decode(this.buf.subarray(r.pos, r.end)); }
  skip(wire: number) {
    if (wire === 0) this.varint(); else if (wire === 1) this.pos += 8; else if (wire === 2) this.pos += this.varint(); else if (wire === 5) this.pos += 4;
    else throw new Error(`mvt: unsupported wire type ${wire}`);
  }
  packed(): number[] { const r = this.sub(), out: number[] = []; while (r.pos < r.end) out.push(r.varint()); return out; }
}
const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function value(r: Reader): MvtValue {
  const v = r.sub();
  let out: MvtValue = "";
  while (v.pos < v.end) {
    const tag = v.varint(), field = tag >> 3, wire = tag & 7;
    if (field === 1) out = v.string();
    else if (field === 2) { out = new DataView(v.buf.buffer, v.buf.byteOffset + v.pos, 4).getFloat32(0, true); v.pos += 4; }
    else if (field === 3) { out = new DataView(v.buf.buffer, v.buf.byteOffset + v.pos, 8).getFloat64(0, true); v.pos += 8; }
    else if (field === 4 || field === 5) out = v.varint();
    else if (field === 6) out = zigzag(v.varint());
    else if (field === 7) out = v.varint() !== 0;
    else v.skip(wire);
  }
  return out;
}
function geometry(cmds: number[]): MvtPoint[][] {
  const parts: MvtPoint[][] = [];
  let x = 0, y = 0, i = 0, cur: MvtPoint[] | undefined;
  while (i < cmds.length) {
    const c = cmds[i++]!, id = c & 7, count = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count; k++) {
        x += zigzag(cmds[i++]!); y += zigzag(cmds[i++]!);
        if (id === 1) { cur = [[x, y]]; parts.push(cur); } else cur!.push([x, y]);
      }
    } else if (id === 7) { if (cur?.length) cur.push([cur[0]![0], cur[0]![1]]); }
    else throw new Error(`mvt: bad command ${id}`);
  }
  return parts;
}

export function decodeMvt(bytes: Uint8Array): MvtLayer[] {
  const r = new Reader(bytes), layers: MvtLayer[] = [];
  while (r.pos < r.end) {
    const tag = r.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) { r.skip(tag & 7); continue; }
    const l = r.sub(), keys: string[] = [], values: MvtValue[] = [], raw: { id?: number; type: number; tags: number[]; geom: number[] }[] = [];
    let name = "", extent = 4096;
    while (l.pos < l.end) {
      const t = l.varint(), field = t >> 3;
      if (field === 1) name = l.string();
      else if (field === 3) keys.push(l.string());
      else if (field === 4) values.push(value(l));
      else if (field === 5) extent = l.varint();
      else if (field === 2) {
        const f = l.sub(), feat: { id?: number; type: number; tags: number[]; geom: number[] } = { type: 0, tags: [], geom: [] };
        while (f.pos < f.end) {
          const ft = f.varint(), ff = ft >> 3;
          if (ff === 1) feat.id = f.varint(); else if (ff === 2) feat.tags = f.packed(); else if (ff === 3) feat.type = f.varint(); else if (ff === 4) feat.geom = f.packed(); else f.skip(ft & 7);
        }
        raw.push(feat);
      } else l.skip(t & 7);
    }
    layers.push({
      name, extent,
      features: raw.filter(f => f.type >= 1 && f.type <= 3).map(f => {
        const properties: Record<string, MvtValue> = {};
        for (let k = 0; k + 1 < f.tags.length; k += 2) { const key = keys[f.tags[k]!], v = values[f.tags[k + 1]!]; if (key !== undefined && v !== undefined) properties[key] = v; }
        return { ...(f.id !== undefined ? { id: f.id } : {}), type: f.type as 1 | 2 | 3, properties, geometry: geometry(f.geom) };
      }),
    });
  }
  return layers;
}

/** Surveyor's-formula area in tile coordinates (y down): exterior rings are positive in MVT 2.x (clockwise on screen). */
export function ringArea(ring: readonly MvtPoint[]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i]!, q = ring[(i + 1) % ring.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
/** Split polygon rings into polygons: [exterior, ...holes][]. */
export function polygons(rings: readonly MvtPoint[][]): MvtPoint[][][] {
  const out: MvtPoint[][][] = [];
  for (const r of rings) { const a = ringArea(r); if (a > 0 || !out.length) out.push([r]); else if (a < 0) out[out.length - 1]!.push(r); }
  return out;
}
export function tileToLonLat(tile: TileId, extent: number, p: MvtPoint): [number, number] {
  const n = 2 ** tile.z, x = (tile.x + p[0] / extent) / n, y = (tile.y + p[1] / extent) / n;
  return [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
}
export function lonLatToTilePoint(tile: TileId, extent: number, lon: number, lat: number): MvtPoint {
  const n = 2 ** tile.z, φ = lat * Math.PI / 180;
  const x = ((lon + 180) / 360) * n, y = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n;
  return [Math.round((x - tile.x) * extent), Math.round((y - tile.y) * extent)];
}

// ---- Encoder
class Writer {
  bytes: number[] = [];
  varint(v: number) { while (v >= 0x80) { this.bytes.push((v % 128) | 0x80); v = Math.floor(v / 128); } this.bytes.push(v); }
  tag(field: number, wire: number) { this.varint(field * 8 + wire); }
  message(field: number, w: Writer) { this.tag(field, 2); this.varint(w.bytes.length); for (const b of w.bytes) this.bytes.push(b); }
  string(field: number, s: string) { const b = new TextEncoder().encode(s); this.tag(field, 2); this.varint(b.length); for (const x of b) this.bytes.push(x); }
  packed(field: number, vs: number[]) { const w = new Writer(); for (const v of vs) w.varint(v); this.message(field, w); }
}
const zz = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
function encodeGeometry(type: 1 | 2 | 3, parts: MvtPoint[][]) {
  const out: number[] = [];
  let x = 0, y = 0;
  const move = (p: MvtPoint) => { out.push(zz(p[0] - x), zz(p[1] - y)); x = p[0]; y = p[1]; };
  for (const part of parts) {
    const pts = type === 3 && part.length > 1 && part[0]![0] === part[part.length - 1]![0] && part[0]![1] === part[part.length - 1]![1] ? part.slice(0, -1) : part;
    if (!pts.length) continue;
    out.push((1 & 7) | (1 << 3)); move(pts[0]!);
    if (pts.length > 1) { out.push((2 & 7) | ((pts.length - 1) << 3)); for (const p of pts.slice(1)) move(p); }
    if (type === 3) out.push((7 & 7) | (1 << 3));
  }
  return out;
}
export function encodeMvt(layers: readonly MvtLayer[]): Uint8Array {
  const tile = new Writer();
  for (const layer of layers) {
    const l = new Writer(), keys = new Map<string, number>(), values = new Map<string, number>(), valueList: MvtValue[] = [];
    l.varint((15 << 3) | 0); l.varint(2);
    l.string(1, layer.name);
    const featureWriters: Writer[] = [];
    for (const f of layer.features) {
      const w = new Writer(), tags: number[] = [];
      for (const [k, v] of Object.entries(f.properties)) {
        if (!keys.has(k)) keys.set(k, keys.size);
        const vk = `${typeof v}:${v}`;
        if (!values.has(vk)) { values.set(vk, valueList.length); valueList.push(v); }
        tags.push(keys.get(k)!, values.get(vk)!);
      }
      if (f.id !== undefined) { w.tag(1, 0); w.varint(f.id); }
      if (tags.length) w.packed(2, tags);
      w.tag(3, 0); w.varint(f.type);
      w.packed(4, encodeGeometry(f.type, f.geometry));
      featureWriters.push(w);
    }
    for (const w of featureWriters) l.message(2, w);
    for (const k of keys.keys()) l.string(3, k);
    for (const v of valueList) {
      const w = new Writer();
      if (typeof v === "string") w.string(1, v);
      else if (typeof v === "boolean") { w.tag(7, 0); w.varint(v ? 1 : 0); }
      else if (Number.isInteger(v) && v >= 0) { w.tag(5, 0); w.varint(v); }
      else if (Number.isInteger(v)) { w.tag(6, 0); w.varint(zz(v)); }
      else { w.tag(3, 1); const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); for (const x of b) w.bytes.push(x); }
      l.message(4, w);
    }
    l.tag(5, 0); l.varint(layer.extent);
    tile.message(3, l);
  }
  return new Uint8Array(tile.bytes);
}
