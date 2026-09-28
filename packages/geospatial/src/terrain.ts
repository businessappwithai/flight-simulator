/**
 * Terrain from Mapzen Terrain Tiles ("Terrarium" encoding, AWS Open Data: s3://elevation-tiles-prod), a global DEM
 * composed from SRTM, USGS 3DEP, GMTED2010, ETOPO1, ArcticDEM and regional sources (keep their attribution; see
 * `DATA_SOURCES`). Terrarium PNGs store height as  h = R·256 + G + B/256 − 32768  metres.
 */
import type { LocalVector } from "./floating-origin.ts";
import type { FloatingOrigin } from "./floating-origin.ts";
import { type TileId, lonLatToTileFraction, tileBounds } from "./tiles.ts";

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRARIUM_MAX_ZOOM = 15;
export const terrariumUrl = (t: TileId, template = TERRARIUM_URL) => template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));

/** Decode RGBA (or RGB with `channels = 3`) Terrarium pixels to heights in metres. */
export function decodeTerrarium(pixels: ArrayLike<number>, width: number, height: number, channels = 4): Float32Array {
  if (pixels.length < width * height * channels) throw new Error(`terrarium: expected ${width * height * channels} bytes, got ${pixels.length}`);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const o = i * channels;
    out[i] = pixels[o]! * 256 + pixels[o + 1]! + pixels[o + 2]! / 256 - 32768;
  }
  return out;
}
export function encodeTerrarium(h: number): [number, number, number] {
  const v = Math.max(0, Math.min(65535.996, h + 32768)), r = Math.floor(v / 256), g = Math.floor(v - r * 256);
  return [r, g, Math.round((v - r * 256 - g) * 256) & 255];
}

/** A decoded DEM tile with bilinear sampling in Web-Mercator pixel space. */
export class TerrainTile {
  constructor(readonly tile: TileId, readonly width: number, readonly height: number, readonly heights: Float32Array) {
    if (heights.length !== width * height) throw new Error("terrain: size mismatch");
  }
  static fromTerrarium(tile: TileId, pixels: ArrayLike<number>, width: number, height: number, channels = 4) {
    return new TerrainTile(tile, width, height, decodeTerrarium(pixels, width, height, channels));
  }
  get byteLength() { return this.heights.byteLength; }
  contains(lat: number, lon: number) {
    const b = tileBounds(this.tile);
    return lat <= b.north && lat >= b.south && lon >= b.west && lon <= b.east;
  }
  /** Elevation in metres at a lon/lat inside the tile (clamped to the edge outside it). */
  sample(lat: number, lon: number): number {
    const f = lonLatToTileFraction(lon, lat, this.tile.z);
    // Pixel centres sit at +0.5; clamp so edge pixels extend to the tile border.
    const px = Math.max(0, Math.min(this.width - 1, (f.x - this.tile.x) * this.width - 0.5));
    const py = Math.max(0, Math.min(this.height - 1, (f.y - this.tile.y) * this.height - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(this.width - 1, x0 + 1), y1 = Math.min(this.height - 1, y0 + 1);
    const tx = px - x0, ty = py - y0, h = this.heights, w = this.width;
    const top = h[y0 * w + x0]! * (1 - tx) + h[y0 * w + x1]! * tx, bottom = h[y1 * w + x0]! * (1 - tx) + h[y1 * w + x1]! * tx;
    return top * (1 - ty) + bottom * ty;
  }
  stats() {
    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of this.heights) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    return { min, max, mean: sum / this.heights.length };
  }
}

export interface TerrainMesh {
  /** Vertex positions in renderer-local coordinates (x east, y up, z −north) relative to the floating origin. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Floating-origin epoch the positions were computed in; rebuild or offset when the origin moves. */
  epoch: number;
  segments: number;
}

/**
 * Grid mesh over a DEM tile in the floating origin's frame. Vertices are placed on the ellipsoid (lat, lon, h), so
 * Earth curvature is included and neighbouring tiles share exact edge vertices.
 */
export function terrainMesh(t: TerrainTile, origin: FloatingOrigin, segments = 32, verticalScale = 1): TerrainMesh {
  const b = tileBounds(t.tile), n = segments + 1, positions = new Float32Array(n * n * 3), indices = new Uint32Array(segments * segments * 6);
  const z = t.tile.z, N = 2 ** z;
  for (let j = 0; j < n; j++) {
    const yTile = t.tile.y + j / segments, lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * yTile) / N))) * 180 / Math.PI;
    for (let i = 0; i < n; i++) {
      const lon = b.west + (b.east - b.west) * (i / segments);
      const v: LocalVector = origin.toLocal({ lat, lon, altMsl: t.sample(lat, lon) * verticalScale });
      positions.set([v.x, v.y, v.z], (j * n + i) * 3);
    }
  }
  let k = 0;
  for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
    const a = j * n + i, b2 = a + 1, c = a + n, d = c + 1;
    indices.set([a, c, b2, b2, c, d], k); k += 6;
  }
  return { positions, indices, epoch: origin.epoch, segments };
}

/**
 * Minimal PNG decoder (8-bit greyscale/RGB/RGBA, non-interlaced) for Terrarium tiles in workers and Bun where no
 * canvas is available. `inflate` is zlib inflate (e.g. `node:zlib` inflateSync, or pako in a browser).
 */
export function decodePng(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): { width: number; height: number; channels: number; pixels: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((v, i) => bytes[i] === v)) throw new Error("png: bad signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8, width = 0, height = 0, channels = 0, palette: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos), type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)), data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8); height = view.getUint32(pos + 12);
      const depth = data[8], color = data[9], interlace = data[12];
      if (depth !== 8 || interlace !== 0) throw new Error(`png: unsupported depth ${depth} / interlace ${interlace}`);
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color!] ?? 0;
      if (!channels) throw new Error(`png: unsupported colour type ${color}`);
      if (color === 3) palette = new Uint8Array(0);
    } else if (type === "PLTE") palette = data.slice();
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflate(concat(idat)), stride = width * channels, out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels]! : 0, b = y > 0 ? out[row - stride + x]! : 0, c = x >= channels && y > 0 ? out[row - stride + x - channels]! : 0;
      let v = src[x]!;
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`png: bad filter ${filter}`);
      out[row + x] = v & 255;
    }
  }
  if (palette) { // expand indexed colour to RGB
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) rgb.set(palette.subarray(out[i]! * 3, out[i]! * 3 + 3), i * 3);
    return { width, height, channels: 3, pixels: rgb };
  }
  return { width, height, channels, pixels: out };
}
function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** `TileSource` for Terrarium PNGs over HTTP. `decode` turns PNG bytes into pixels (canvas, ImageBitmap or `decodePng`). */
export function terrariumSource(opts: {
  fetch?: typeof fetch;
  template?: string;
  maxZoom?: number;
  decode: (png: Uint8Array) => { width: number; height: number; channels: number; pixels: ArrayLike<number> } | Promise<{ width: number; height: number; channels: number; pixels: ArrayLike<number> }>;
}) {
  const f = opts.fetch ?? fetch;
  return {
    layer: "terrain" as const,
    maxZoom: opts.maxZoom ?? TERRARIUM_MAX_ZOOM,
    async load(tile: TileId, signal: AbortSignal) {
      const res = await f(terrariumUrl(tile, opts.template), { signal });
      if (!res.ok) throw new Error(`terrain ${tile.z}/${tile.x}/${tile.y}: HTTP ${res.status}`);
      const img = await opts.decode(new Uint8Array(await res.arrayBuffer()));
      return TerrainTile.fromTerrarium(tile, img.pixels, img.width, img.height, img.channels);
    },
    sizeOf: (t: TerrainTile) => t.byteLength,
  };
}
