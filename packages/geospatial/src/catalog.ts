/**
 * Compact airport catalogue: every OurAirports airport a fixed-wing aircraft can use (large/medium/small with an
 * open runway of at least 1,500 ft), ~27k airports, shipped as gzipped JSON next to the simulator worker and loaded
 * in the background. Built by `scripts/build-airport-catalog.ts` from the public-domain OurAirports CSVs.
 */
import type { Airport, Runway, RunwayEnd } from "./airports.ts";
import { haversineDistance } from "./geodesy.ts";

const FT = 0.3048;
const TYPES = ["large_airport", "medium_airport", "small_airport"] as const;
/** [ident, iata, name, municipality, country, lat, lon, elevationFt, type, runways[]] */
type CompactAirport = [string, string, string, string, string, number, number, number, number, CompactRunway[]];
/** [leIdent, heIdent, lengthFt, widthFt, surface, lighted, leLat, leLon, heLat, heLon, leHeadingT, heHeadingT] (empty = unknown) */
type CompactRunway = [string, string, number, number, string, 0 | 1, number | null, number | null, number | null, number | null, number | null, number | null];
export interface AirportCatalogJson { version: 1; source: string; generated: string; airports: CompactAirport[] }

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Airports worth offering as departure/destination: fixed-wing fields with an open runway ≥ minRunwayFt. */
export function catalogFilter(a: Airport, minRunwayFt = 1500) {
  return (TYPES as readonly string[]).includes(a.type) && a.runways.some(r => !r.closed && (r.lengthM ?? 0) >= minRunwayFt * FT);
}

export function encodeCatalog(airports: readonly Airport[], source: string, generated: string): AirportCatalogJson {
  const out: CompactAirport[] = [];
  for (const a of airports) {
    const rws: CompactRunway[] = a.runways.filter(r => !r.closed).map(r => [
      r.le.ident, r.he.ident, Math.round((r.lengthM ?? 0) / FT), Math.round((r.widthM ?? 0) / FT), r.surface, r.lighted ? 1 : 0,
      r.le.position ? r5(r.le.position.lat) : null, r.le.position ? r5(r.le.position.lon) : null,
      r.he.position ? r5(r.he.position.lat) : null, r.he.position ? r5(r.he.position.lon) : null,
      r.le.headingDegT !== undefined ? r1(r.le.headingDegT) : null, r.he.headingDegT !== undefined ? r1(r.he.headingDegT) : null,
    ]);
    out.push([a.ident, a.iata ?? "", a.name, a.municipality, a.country, r5(a.position.lat), r5(a.position.lon), Math.round(a.position.altMsl / FT), Math.max(0, (TYPES as readonly string[]).indexOf(a.type)), rws]);
  }
  return { version: 1, source, generated, airports: out };
}

export function decodeCatalog(json: AirportCatalogJson): Airport[] {
  if (json?.version !== 1 || !Array.isArray(json.airports)) throw new Error("airport catalogue: unsupported format");
  return json.airports.map(([ident, iata, name, municipality, country, lat, lon, elevFt, type, rws]) => {
    const altMsl = elevFt * FT;
    const end = (id: string, la: number | null, lo: number | null, hdg: number | null): RunwayEnd => ({
      ident: id, ...(la !== null && lo !== null ? { position: { lat: la, lon: lo, altMsl } } : {}), ...(hdg !== null ? { headingDegT: hdg } : {}),
    });
    const runways: Runway[] = rws.map((r, i) => ({
      id: `${ident}:${i}`, ...(r[2] ? { lengthM: r[2] * FT } : {}), ...(r[3] ? { widthM: r[3] * FT } : {}), surface: r[4], lighted: r[5] === 1, closed: false,
      le: end(r[0], r[6], r[7], r[10]), he: end(r[1], r[8], r[9], r[11]),
    }));
    const icao = /^[A-Z]{4}$/.test(ident) ? ident : undefined;
    return { id: ident, ident, ...(icao ? { icao } : {}), ...(iata ? { iata } : {}), type: TYPES[type] ?? "small_airport", name, position: { lat, lon, altMsl }, country, region: "", municipality, scheduledService: type <= 1, runways };
  });
}

export interface AirportMatch { ident: string; name: string; municipality: string; country: string; iata?: string; type: string; lat: number; lon: number; runways: string[] }
const match = (a: Airport): AirportMatch => ({ ident: a.ident, name: a.name, municipality: a.municipality, country: a.country, ...(a.iata ? { iata: a.iata } : {}), type: a.type, lat: a.position.lat, lon: a.position.lon, runways: a.runways.filter(r => !r.closed).flatMap(r => [r.le.ident, r.he.ident]) });

/**
 * Airport search for the picker: exact code (ICAO/ident/IATA) first, then prefix, then words of the name or city,
 * larger airports first; optionally sorted by distance from `near`.
 */
export function searchAirports(airports: readonly Airport[], query: string, limit = 20, near?: { lat: number; lon: number }): AirportMatch[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const rank = (a: Airport) => {
    const codes = [a.ident, a.icao, a.iata].filter(Boolean) as string[];
    if (codes.includes(q)) return 0;
    if (codes.some(c => c.startsWith(q))) return 1;
    const text = `${a.name} ${a.municipality}`.toUpperCase();
    if (text.split(/[^A-Z0-9]+/).some(w => w.startsWith(q))) return 2;
    return text.includes(q) ? 3 : -1;
  };
  const size = (a: Airport) => ({ large_airport: 0, medium_airport: 1 } as Record<string, number>)[a.type] ?? 2;
  return airports.map(a => ({ a, r: rank(a) })).filter(x => x.r >= 0)
    .sort((x, y) => x.r - y.r || size(x.a) - size(y.a) || (near ? haversineDistance(near, x.a.position) - haversineDistance(near, y.a.position) : 0) || (x.a.ident < y.a.ident ? -1 : 1))
    .slice(0, limit).map(x => match(x.a));
}
export { match as airportMatch };
