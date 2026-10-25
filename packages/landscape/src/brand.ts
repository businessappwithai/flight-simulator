/**
 * The BRAND block of the prompt: the continent is a silhouette that reads from orbit. Rectangles in brand units
 * (x east, y south, origin at the top-left of the silhouette); `lakes` are the eyes. Swap it for any logo, mascot or
 * icon whose shape reads from above.
 */
export interface BrandRect { x0: number; y0: number; x1: number; y1: number }
export interface Brand {
  name: string;
  /** Metres per brand unit. */
  unitM: number;
  land: BrandRect[];
  lakes: BrandRect[];
  /** The colour the continent should measure from orbit (#rrggbb). */
  color: string;
  /** Where the home runway is (brand units); default: in the south of the largest land rectangle. */
  airfield?: { x: number; y: number };
  /** Mountain ranges (polylines in brand units): the ridged uplift belts. Default: one across the largest rectangle. */
  ranges?: [number, number][][];
  /** Saddles cut into the ranges (brand units): the reveal flight threads the first one. */
  passes?: [number, number][];
  /** Table-land under the flight (mesas once eroded). */
  plateaus?: BrandRect[];
  /** Where the city grows (brand units): on the shore of the first lake by default. */
  city?: { x: number; y: number };
}

/** Clawd: a 12×8 body, two arm nubs, four legs as peninsulas; the two eyes are lakes. 16 × 10 units ≈ 120 × 75 km. */
export const CLAWD: Brand = {
  name: "Clawd",
  unitM: 7500,
  land: [
    { x0: 2, y0: 0, x1: 14, y1: 8 },
    { x0: 0, y0: 3, x1: 2, y1: 5 }, { x0: 14, y0: 3, x1: 16, y1: 5 },
    { x0: 3, y0: 8, x1: 4, y1: 10 }, { x0: 5, y0: 8, x1: 6, y1: 10 }, { x0: 10, y0: 8, x1: 11, y1: 10 }, { x0: 12, y0: 8, x1: 13, y1: 10 },
  ],
  lakes: [{ x0: 4, y0: 2, x1: 5, y1: 4 }, { x0: 11, y0: 2, x1: 12, y1: 4 }],
  color: "#D97757",
  airfield: { x: 4.5, y: 6.6 },
  ranges: [
    [[2.4, 5.3], [5, 5.05], [8, 5.35], [11, 5.1], [13.6, 5.25]],
    [[8.1, 0.5], [9.4, 2.6], [10.2, 4.4], [12.4, 7.6]],
  ],
  passes: [[4.5, 5.12]],
  plateaus: [{ x0: 6.3, y0: 6.1, x1: 9.6, y1: 7.7 }],
  city: { x: 5.3, y: 3.1 },
};

const rect = (r: unknown): r is BrandRect => {
  const o = r as BrandRect;
  return !!o && [o.x0, o.y0, o.x1, o.y1].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 64) && o.x1 > o.x0 && o.y1 > o.y0;
};

/** A brand from untrusted JSON (a page option), or null when it is not one. */
export function parseBrand(raw: unknown): Brand | null {
  const b = raw as Partial<Brand>;
  if (!b || typeof b !== "object") return null;
  if (!Array.isArray(b.land) || !b.land.length || b.land.length > 64 || !b.land.every(rect)) return null;
  const lakes = b.lakes ?? [];
  if (!Array.isArray(lakes) || lakes.length > 16 || !lakes.every(rect)) return null;
  const unitM = b.unitM ?? CLAWD.unitM;
  if (typeof unitM !== "number" || !(unitM >= 1000 && unitM <= 12000)) return null;
  const color = typeof b.color === "string" && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : CLAWD.color;
  const name = typeof b.name === "string" ? b.name.slice(0, 32) : "Brand";
  const land = b.land.map(r => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 })), lk = lakes.map(r => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }));
  const w = Math.max(...land.map(r => r.x1)) - Math.min(...land.map(r => r.x0)), h = Math.max(...land.map(r => r.y1)) - Math.min(...land.map(r => r.y0));
  if (Math.max(w, h) * unitM > 130_000) return null; // must fit the simulated domain with ocean around it
  const pt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 64);
  const xy = (p: unknown) => { const o = p as { x: number; y: number }; return o && pt([o.x, o.y]) ? { x: o.x, y: o.y } : undefined; };
  const ranges = Array.isArray(b.ranges) ? b.ranges.filter(r => Array.isArray(r) && r.length >= 2 && r.length <= 32 && r.every(pt)).slice(0, 8) : undefined;
  const passes = Array.isArray(b.passes) ? b.passes.filter(pt).slice(0, 8) : undefined;
  const plateaus = Array.isArray(b.plateaus) ? b.plateaus.filter(rect).slice(0, 8) : undefined;
  return { name, unitM, land, lakes: lk, color, ...(xy(b.airfield) ? { airfield: xy(b.airfield)! } : {}), ...(ranges?.length ? { ranges } : {}),
    ...(passes?.length ? { passes } : {}), ...(plateaus?.length ? { plateaus } : {}), ...(xy(b.city) ? { city: xy(b.city)! } : {}) };
}

/** The brand with every optional placement filled in (defaults derived from the silhouette). */
export function resolveBrand(b: Brand): Required<Brand> {
  const big = [...b.land].sort((p, q) => (q.x1 - q.x0) * (q.y1 - q.y0) - (p.x1 - p.x0) * (p.y1 - p.y0))[0]!;
  const cx = (big.x0 + big.x1) / 2, w = big.x1 - big.x0, h = big.y1 - big.y0;
  const airfield = b.airfield ?? { x: cx, y: big.y0 + 0.8 * h };
  const ry = big.y0 + 0.55 * h;
  const lake = b.lakes[0];
  return {
    ...b,
    airfield,
    ranges: b.ranges ?? [[[big.x0 + 0.1 * w, ry], [big.x1 - 0.1 * w, ry]]],
    passes: b.passes ?? [[airfield.x, ry]],
    plateaus: b.plateaus ?? [],
    city: b.city ?? (lake ? { x: lake.x1 + 0.55, y: (lake.y0 + lake.y1) / 2 } : { x: airfield.x, y: big.y0 + 0.3 * h }),
  };
}

/** Bounds of the silhouette in brand units. */
export function brandBounds(b: Brand) {
  return {
    x0: Math.min(...b.land.map(r => r.x0)), y0: Math.min(...b.land.map(r => r.y0)),
    x1: Math.max(...b.land.map(r => r.x1)), y1: Math.max(...b.land.map(r => r.y1)),
  };
}

/** Signed distance (m) to an axis-aligned rectangle: negative inside. */
export function rectDistance(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const dx = Math.abs(px - cx) - hx, dz = Math.abs(pz - cz) - hz;
  const ox = dx > 0 ? dx : 0, oz = dz > 0 ? dz : 0;
  const inside = dx > dz ? dx : dz;
  return Math.sqrt(ox * ox + oz * oz) + (inside < 0 ? inside : 0);
}
