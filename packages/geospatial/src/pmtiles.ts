/**
 * PMTiles v3: one static archive, read with HTTP range requests (no tile server). Reader for streaming, writer for
 * baking regional archives and test fixtures. https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */
import type { TileId } from "./tiles.ts";

export const PMTILES_HEADER_BYTES = 127;
export enum Compression { Unknown = 0, None = 1, Gzip = 2, Brotli = 3, Zstd = 4 }
export interface PMTilesHeader {
  rootDirectoryOffset: number; rootDirectoryLength: number; metadataOffset: number; metadataLength: number;
  leafDirectoryOffset: number; leafDirectoryLength: number; tileDataOffset: number; tileDataLength: number;
  addressedTiles: number; tileEntries: number; tileContents: number; clustered: boolean;
  internalCompression: Compression; tileCompression: Compression; tileType: number;
  minZoom: number; maxZoom: number; minLon: number; minLat: number; maxLon: number; maxLat: number;
  centerZoom: number; centerLon: number; centerLat: number;
}
export interface DirectoryEntry { tileId: number; offset: number; length: number; runLength: number }

/** Hilbert tile id: all tiles of lower zooms first, then the Hilbert index within the zoom. */
export function zxyToTileId(z: number, x: number, y: number): number {
  if (z > 26) throw new Error("pmtiles: zoom above 26 not supported");
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) throw new Error(`pmtiles: tile ${z}/${x}/${y} out of range`);
  let acc = (4 ** z - 1) / 3, tx = x, ty = y;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0, ry = (ty & s) > 0 ? 1 : 0;
    acc += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { tx = s - 1 - (tx % s); ty = s - 1 - (ty % s); } [tx, ty] = [ty, tx]; }
  }
  return acc;
}

const u64 = (v: DataView, o: number) => v.getUint32(o + 4, true) * 2 ** 32 + v.getUint32(o, true);
export function parseHeader(bytes: Uint8Array): PMTilesHeader {
  if (bytes.length < PMTILES_HEADER_BYTES || new TextDecoder().decode(bytes.subarray(0, 7)) !== "PMTiles") throw new Error("pmtiles: not a PMTiles archive");
  if (bytes[7] !== 3) throw new Error(`pmtiles: version ${bytes[7]} not supported (need 3)`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rootDirectoryOffset: u64(v, 8), rootDirectoryLength: u64(v, 16), metadataOffset: u64(v, 24), metadataLength: u64(v, 32),
    leafDirectoryOffset: u64(v, 40), leafDirectoryLength: u64(v, 48), tileDataOffset: u64(v, 56), tileDataLength: u64(v, 64),
    addressedTiles: u64(v, 72), tileEntries: u64(v, 80), tileContents: u64(v, 88), clustered: bytes[96] === 1,
    internalCompression: bytes[97]!, tileCompression: bytes[98]!, tileType: bytes[99]!, minZoom: bytes[100]!, maxZoom: bytes[101]!,
    minLon: v.getInt32(102, true) / 1e7, minLat: v.getInt32(106, true) / 1e7, maxLon: v.getInt32(110, true) / 1e7, maxLat: v.getInt32(114, true) / 1e7,
    centerZoom: bytes[118]!, centerLon: v.getInt32(119, true) / 1e7, centerLat: v.getInt32(123, true) / 1e7,
  };
}

function readVarint(b: Uint8Array, p: { pos: number }) {
  let r = 0, s = 0, x: number;
  do { if (p.pos >= b.length) throw new Error("pmtiles: truncated directory"); x = b[p.pos++]!; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80);
  return r;
}
export function parseDirectory(b: Uint8Array): DirectoryEntry[] {
  const p = { pos: 0 }, n = readVarint(b, p);
  if (n > 1e7) throw new Error("pmtiles: directory too large");
  const e: DirectoryEntry[] = Array.from({ length: n }, () => ({ tileId: 0, offset: 0, length: 0, runLength: 0 }));
  let last = 0;
  for (const x of e) { last += readVarint(b, p); x.tileId = last; }
  for (const x of e) x.runLength = readVarint(b, p);
  for (const x of e) x.length = readVarint(b, p);
  for (let i = 0; i < n; i++) { const v = readVarint(b, p); e[i]!.offset = v === 0 && i > 0 ? e[i - 1]!.offset + e[i - 1]!.length : v - 1; }
  return e;
}
function findEntry(entries: readonly DirectoryEntry[], tileId: number): DirectoryEntry | undefined {
  let lo = 0, hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, c = entries[mid]!.tileId;
    if (c < tileId) lo = mid + 1; else if (c > tileId) hi = mid - 1; else return entries[mid];
  }
  if (hi >= 0) { const e = entries[hi]!; if (e.runLength === 0 || tileId - e.tileId < e.runLength) return e; }
  return undefined;
}

export async function decompress(data: Uint8Array, c: Compression): Promise<Uint8Array> {
  if (c === Compression.None || c === Compression.Unknown) {
    // Some servers hand out gzip without saying so: detect the magic number.
    if (data[0] === 0x1f && data[1] === 0x8b) return decompress(data, Compression.Gzip);
    return data;
  }
  if (c !== Compression.Gzip) throw new Error(`pmtiles: compression ${Compression[c]} not supported`);
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Byte-range source: an HTTP URL (Range requests) or anything else that can read a slice. */
export type RangeReader = (offset: number, length: number, signal?: AbortSignal) => Promise<Uint8Array>;
export function httpRangeReader(url: string, f: typeof fetch = fetch): RangeReader {
  return async (offset, length, signal) => {
    const res = await f(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal });
    if (!res.ok) throw new Error(`pmtiles: HTTP ${res.status} for ${url}`);
    const b = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range returns the whole file with 200: slice it ourselves.
    return res.status === 200 && b.length > length ? b.subarray(offset, offset + length) : b;
  };
}

export class PMTilesReader {
  #header?: Promise<{ header: PMTilesHeader; root: DirectoryEntry[] }>;
  readonly #leaves = new Map<number, Promise<DirectoryEntry[]>>();
  constructor(readonly read: RangeReader) {}
  header() {
    return (this.#header ??= (async () => {
      const first = await this.read(0, 16384);
      const header = parseHeader(first);
      const rootBytes = header.rootDirectoryOffset + header.rootDirectoryLength <= first.length
        ? first.subarray(header.rootDirectoryOffset, header.rootDirectoryOffset + header.rootDirectoryLength)
        : await this.read(header.rootDirectoryOffset, header.rootDirectoryLength);
      return { header, root: parseDirectory(await decompress(rootBytes, header.internalCompression)) };
    })().catch(e => { this.#header = undefined; throw e; }));
  }
  /** Decompressed tile bytes, or undefined when the archive has no such tile. */
  async tile(t: TileId, signal?: AbortSignal): Promise<Uint8Array | undefined> {
    const { header, root } = await this.header();
    if (t.z < header.minZoom || t.z > header.maxZoom) return undefined;
    const id = zxyToTileId(t.z, t.x, t.y);
    let dir = root;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(dir, id);
      if (!e) return undefined;
      if (e.runLength > 0) return decompress(await this.read(header.tileDataOffset + e.offset, e.length, signal), header.tileCompression);
      const off = header.leafDirectoryOffset + e.offset;
      let leaf = this.#leaves.get(off);
      if (!leaf) {
        leaf = this.read(off, e.length, signal).then(b => decompress(b, header.internalCompression)).then(parseDirectory);
        this.#leaves.set(off, leaf);
        leaf.catch(() => this.#leaves.delete(off));
      }
      dir = await leaf;
    }
    throw new Error("pmtiles: directory nesting too deep");
  }
}

// ---- Writer (baking and fixtures)
function writeVarint(out: number[], v: number) { while (v >= 0x80) { out.push((v % 128) | 0x80); v = Math.floor(v / 128); } out.push(v); }
function serializeDirectory(entries: readonly DirectoryEntry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) { writeVarint(out, e.tileId - last); last = e.tileId; }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => writeVarint(out, i > 0 && e.offset === entries[i - 1]!.offset + entries[i - 1]!.length ? 0 : e.offset + 1));
  return new Uint8Array(out);
}
export interface WriteOptions {
  /** Compress directories and tile data (the archive stores tiles as given; pass already-compressed tiles). */
  compress?: (b: Uint8Array) => Uint8Array;
  tileCompression?: Compression;
  metadata?: unknown;
  /** Force leaf directories of at most this many entries (default: single root directory). */
  leafSize?: number;
  bounds?: [number, number, number, number];
}
/** Builds a clustered PMTiles v3 archive from MVT tiles (`tiles` are stored as given). */
export function writePMTiles(tiles: readonly { tile: TileId; data: Uint8Array }[], o: WriteOptions = {}): Uint8Array {
  const compress = o.compress ?? (b => b), sorted = tiles.map(t => ({ id: zxyToTileId(t.tile.z, t.tile.x, t.tile.y), ...t })).sort((a, b) => a.id - b.id);
  const data: Uint8Array[] = [], entries: DirectoryEntry[] = [];
  let offset = 0;
  for (const t of sorted) { entries.push({ tileId: t.id, offset, length: t.data.length, runLength: 1 }); data.push(t.data); offset += t.data.length; }
  let root: Uint8Array, leaves = new Uint8Array(0);
  if (o.leafSize && entries.length > o.leafSize) {
    const leafParts: Uint8Array[] = [], rootEntries: DirectoryEntry[] = [];
    let lo = 0;
    for (let i = 0; i < entries.length; i += o.leafSize) {
      const chunk = entries.slice(i, i + o.leafSize), bytes = compress(serializeDirectory(chunk));
      rootEntries.push({ tileId: chunk[0]!.tileId, offset: lo, length: bytes.length, runLength: 0 });
      leafParts.push(bytes); lo += bytes.length;
    }
    root = compress(serializeDirectory(rootEntries));
    leaves = concat(leafParts);
  } else root = compress(serializeDirectory(entries));
  const meta = compress(new TextEncoder().encode(JSON.stringify(o.metadata ?? {})));
  const tileData = concat(data), header = new Uint8Array(PMTILES_HEADER_BYTES), v = new DataView(header.buffer);
  header.set(new TextEncoder().encode("PMTiles"), 0); header[7] = 3;
  const set64 = (off: number, n: number) => { v.setUint32(off, n % 2 ** 32, true); v.setUint32(off + 4, Math.floor(n / 2 ** 32), true); };
  const rootOff = PMTILES_HEADER_BYTES, metaOff = rootOff + root.length, leafOff = metaOff + meta.length, dataOff = leafOff + leaves.length;
  set64(8, rootOff); set64(16, root.length); set64(24, metaOff); set64(32, meta.length); set64(40, leafOff); set64(48, leaves.length);
  set64(56, dataOff); set64(64, tileData.length); set64(72, entries.length); set64(80, entries.length); set64(88, entries.length);
  header[96] = 1; header[97] = o.compress ? Compression.Gzip : Compression.None; header[98] = o.tileCompression ?? Compression.None; header[99] = 1;
  const zs = sorted.map(t => t.tile.z);
  header[100] = zs.length ? Math.min(...zs) : 0; header[101] = zs.length ? Math.max(...zs) : 0;
  const [w, s, e, n] = o.bounds ?? [-180, -85, 180, 85];
  v.setInt32(102, Math.round(w * 1e7), true); v.setInt32(106, Math.round(s * 1e7), true); v.setInt32(110, Math.round(e * 1e7), true); v.setInt32(114, Math.round(n * 1e7), true);
  header[118] = header[101]!; v.setInt32(119, Math.round(((w + e) / 2) * 1e7), true); v.setInt32(123, Math.round(((s + n) / 2) * 1e7), true);
  return concat([header, root, meta, leaves, tileData]);
}
function concat(parts: readonly Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
