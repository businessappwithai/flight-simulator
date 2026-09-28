/**
 * Airports from OurAirports (https://ourairports.com/data/, public domain, updated daily): airports.csv and
 * runways.csv are parsed by header name, so both the older (`gps_code` only) and newer (`icao_code`) layouts work.
 * OSM aeroway polygons (runways, taxiways, aprons, terminals) can later be attached per airport for surface detail.
 */
import { type GeoPosition, destinationPoint, haversineDistance, initialBearing, normalizeBearing } from "./geodesy.ts";

const FT = 0.3048;
export type AirportType = "large_airport" | "medium_airport" | "small_airport" | "heliport" | "seaplane_base" | "balloonport" | "closed" | string;

export interface RunwayEnd { ident: string; position?: GeoPosition; headingDegT?: number; displacedThresholdM?: number }
export interface Runway { id: string; lengthM?: number; widthM?: number; surface: string; lighted: boolean; closed: boolean; le: RunwayEnd; he: RunwayEnd }
export interface Airport {
  id: string;
  ident: string;
  icao?: string;
  iata?: string;
  gps?: string;
  type: AirportType;
  name: string;
  position: GeoPosition;
  country: string;
  region: string;
  municipality: string;
  scheduledService: boolean;
  runways: Runway[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const num = (s: string | undefined) => (s === undefined || s === "" ? undefined : Number.isFinite(Number(s)) ? Number(s) : undefined);
const opt = (s: string | undefined) => (s ? s : undefined);
function end(r: Record<string, string>, p: "le" | "he"): RunwayEnd {
  const lat = num(r[`${p}_latitude_deg`]), lon = num(r[`${p}_longitude_deg`]), elev = num(r[`${p}_elevation_ft`]);
  const disp = num(r[`${p}_displaced_threshold_ft`]), hdg = num(r[`${p}_heading_degT`]);
  return {
    ident: r[`${p}_ident`] ?? "",
    ...(lat !== undefined && lon !== undefined ? { position: { lat, lon, altMsl: (elev ?? 0) * FT } } : {}),
    ...(hdg !== undefined ? { headingDegT: normalizeBearing(hdg) } : {}),
    ...(disp !== undefined ? { displacedThresholdM: disp * FT } : {}),
  };
}

export function parseOurAirports(airportsCsv: string, runwaysCsv = ""): Airport[] {
  const airports = new Map<string, Airport>();
  for (const r of parseCsvRecords(airportsCsv)) {
    const lat = num(r.latitude_deg), lon = num(r.longitude_deg);
    if (lat === undefined || lon === undefined || !r.ident) continue;
    const icao = opt(r.icao_code) ?? (/^[A-Z]{4}$/.test(r.ident) ? r.ident : undefined);
    airports.set(r.id || r.ident, {
      id: r.id || r.ident, ident: r.ident, ...(icao ? { icao } : {}), ...(opt(r.iata_code) ? { iata: r.iata_code } : {}), ...(opt(r.gps_code) ? { gps: r.gps_code } : {}),
      type: r.type ?? "", name: r.name ?? r.ident, position: { lat, lon, altMsl: (num(r.elevation_ft) ?? 0) * FT },
      country: r.iso_country ?? "", region: r.iso_region ?? "", municipality: r.municipality ?? "", scheduledService: r.scheduled_service === "yes", runways: [],
    });
  }
  const byIdent = new Map([...airports.values()].map(a => [a.ident, a]));
  for (const r of parseCsvRecords(runwaysCsv)) {
    const a = airports.get(r.airport_ref ?? "") ?? byIdent.get(r.airport_ident ?? "");
    if (!a) continue;
    const length = num(r.length_ft), width = num(r.width_ft);
    a.runways.push({
      id: r.id ?? `${a.ident}:${r.le_ident}/${r.he_ident}`, ...(length !== undefined ? { lengthM: length * FT } : {}), ...(width !== undefined ? { widthM: width * FT } : {}),
      surface: r.surface ?? "", lighted: r.lighted === "1", closed: r.closed === "1", le: end(r, "le"), he: end(r, "he"),
    });
  }
  return [...airports.values()];
}

/** Heading implied by a runway designator ("09L" → 90°, "36" → 360°); magnetic, so only a fallback. */
export function designatorHeading(ident: string): number | undefined {
  const m = /^(\d{1,2})[LRCT]?$/.exec(ident.trim().toUpperCase());
  return m ? normalizeBearing(Number(m[1]) * 10) : undefined;
}

export interface RunwayGeometry { airport: string; ident: string; le: GeoPosition; he: GeoPosition; headingDegT: number; lengthM: number; widthM: number; synthesized: boolean }

/**
 * Both runway ends as positions. Uses surveyed threshold coordinates when OurAirports has them; otherwise lays the
 * runway through the airport reference point along the true heading (or the designator), which is enough for
 * markers and approach geometry but flagged `synthesized` so physics does not treat it as surveyed.
 */
export function runwayGeometry(airport: Airport, rw: Runway): RunwayGeometry | undefined {
  const widthM = rw.widthM ?? 45, ident = `${rw.le.ident}/${rw.he.ident}`;
  if (rw.le.position && rw.he.position) {
    return { airport: airport.ident, ident, le: rw.le.position, he: rw.he.position, headingDegT: initialBearing(rw.le.position, rw.he.position), lengthM: haversineDistance(rw.le.position, rw.he.position), widthM, synthesized: false };
  }
  const heading = rw.le.headingDegT ?? (rw.he.headingDegT !== undefined ? normalizeBearing(rw.he.headingDegT + 180) : designatorHeading(rw.le.ident));
  if (heading === undefined || !rw.lengthM) return undefined;
  const c = airport.position;
  return { airport: airport.ident, ident, le: destinationPoint(c, heading + 180, rw.lengthM / 2), he: destinationPoint(c, heading, rw.lengthM / 2), headingDegT: heading, lengthM: rw.lengthM, widthM, synthesized: true };
}

/** Airport streaming tiers by distance: what an AirportStreamer should have loaded for this airport. */
export type AirportDetail = "METADATA" | "MARKER" | "BASIC" | "FULL" | "HIGHEST";
export function airportDetail(distanceM: number): AirportDetail {
  return distanceM < 3_000 ? "HIGHEST" : distanceM < 15_000 ? "FULL" : distanceM < 50_000 ? "BASIC" : distanceM <= 150_000 ? "MARKER" : "METADATA";
}
/** Detailed airport geometry can be dropped once the airport is this far behind the aircraft. */
export const AIRPORT_UNLOAD_BEHIND_M = 40_000;

export interface NearbyAirport { airport: Airport; distanceM: number; bearingDeg: number }

/** Lookup by code and fast nearest-airport queries on a 1° grid. */
export class AirportIndex {
  readonly #byCode = new Map<string, Airport>();
  readonly #cells = new Map<string, Airport[]>();
  constructor(readonly airports: readonly Airport[]) {
    // Priority on collisions: ICAO, then ident, then IATA, then GPS code.
    for (const pass of ["gps", "iata", "ident", "icao"] as const) for (const a of airports) { const c = a[pass]; if (c) this.#byCode.set(c.toUpperCase(), a); }
    for (const a of airports) { const k = cell(a.position.lat, a.position.lon); (this.#cells.get(k) ?? this.#cells.set(k, []).get(k)!).push(a); }
  }
  get size() { return this.airports.length; }
  find(code: string) { return this.#byCode.get(code.trim().toUpperCase()); }
  require(code: string) { const a = this.find(code); if (!a) throw new Error(`unknown airport: ${code}`); return a; }

  /** Airports within `radiusM`, nearest first (ties broken by ident, so results are deterministic). */
  within(p: { lat: number; lon: number }, radiusM: number, filter: (a: Airport) => boolean = () => true): NearbyAirport[] {
    const dLat = Math.ceil(radiusM / 111_000) + 1, dLon = Math.min(180, Math.ceil(radiusM / (111_000 * Math.max(0.01, Math.cos(p.lat * Math.PI / 180)))) + 1);
    const lat0 = Math.floor(p.lat), lon0 = Math.floor(p.lon), out: NearbyAirport[] = [], seen = new Set<string>();
    for (let y = lat0 - dLat; y <= lat0 + dLat; y++) for (let x = lon0 - dLon; x <= lon0 + dLon; x++) {
      const k = `${y}:${((((x + 180) % 360) + 360) % 360) - 180}`;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const a of this.#cells.get(k) ?? []) {
        if (!filter(a)) continue;
        const d = haversineDistance(p, a.position);
        if (d <= radiusM) out.push({ airport: a, distanceM: d, bearingDeg: initialBearing(p, a.position) });
      }
    }
    return out.sort((a, b) => a.distanceM - b.distanceM || (a.airport.ident < b.airport.ident ? -1 : 1));
  }
  nearest(p: { lat: number; lon: number }, count = 5, filter?: (a: Airport) => boolean, maxRadiusM = 2_000_000): NearbyAirport[] {
    for (let r = 50_000; ; r *= 2) {
      const found = this.within(p, Math.min(r, maxRadiusM), filter);
      if (found.length >= count || r >= maxRadiusM) return found.slice(0, count);
    }
  }
}
const cell = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`;

/** Airports a transport-category aircraft could divert to: open, runway ≥ minRunwayM. */
export const isAlternateCandidate = (minRunwayM = 1800) => (a: Airport) =>
  (a.type === "large_airport" || a.type === "medium_airport") && a.runways.some(r => !r.closed && (r.lengthM ?? 0) >= minRunwayM);
