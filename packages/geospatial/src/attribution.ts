/** Data sources and the credit each requires. Show `attributionFor(layers)` wherever that data is displayed. */
import type { WorldLayer } from "./lod.ts";

export interface DataSource { id: string; name: string; license: string; attribution: string; url: string; layers: readonly WorldLayer[] }

export const DATA_SOURCES: readonly DataSource[] = [
  {
    id: "mapzen-terrain", name: "Mapzen Terrain Tiles (AWS Open Data)", license: "Composite; per-source terms",
    attribution: "Terrain: Mapzen Terrain Tiles — SRTM & GMTED2010 (USGS), ETOPO1 (NOAA), 3DEP (USGS), ArcticDEM (PGC/NSF), Copernicus/EU-DEM, LINZ, Geoscience Australia and others",
    url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", layers: ["terrain"],
  },
  {
    id: "overture", name: "Overture Maps", license: "ODbL (buildings, places with OSM lineage); CDLA-Permissive-2.0 / other per theme",
    attribution: "© Overture Maps Foundation; includes © OpenStreetMap contributors (ODbL)", url: "https://docs.overturemaps.org/attribution/",
    layers: ["buildings", "landcover", "water", "roads"],
  },
  { id: "osm", name: "OpenStreetMap", license: "ODbL 1.0", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", layers: ["roads", "water", "landcover", "airports"] },
  { id: "openfreemap", name: "OpenFreeMap", license: "Tiles free to use; data ODbL (OpenStreetMap)", attribution: "OpenFreeMap © OpenMapTiles · Data from OpenStreetMap", url: "https://openfreemap.org/", layers: [] },
  { id: "ourairports", name: "OurAirports", license: "Public domain", attribution: "Airports: OurAirports (public domain)", url: "https://ourairports.com/data/", layers: ["airports"] },
];

export function attributionFor(layers: readonly WorldLayer[], sources: readonly DataSource[] = DATA_SOURCES): string[] {
  const want = new Set(layers);
  return sources.filter(s => s.layers.some(l => want.has(l))).map(s => s.attribution);
}
