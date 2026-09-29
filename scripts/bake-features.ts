// Bake buildings and airport surfaces into a PMTiles archive in the OpenMapTiles schema (the layers the simulator
// reads from OpenFreeMap): `building` (render_height, render_min_height) and `aeroway` (class, ref), z14 only.
//
//   python3 scripts/overture-extract.py buildings 80.12 12.95 80.22 13.03 > b.geojson
//   python3 scripts/overture-extract.py infrastructure 80.12 12.95 80.22 13.03 > i.geojson
//   bun scripts/bake-features.ts b.geojson i.geojson --out vomm.pmtiles
//
// Then open the simulator with &features=<URL of vomm.pmtiles> (served with HTTP range support, e.g. terrain-relay.ts).
// Input: GeoJSON FeatureCollections from overture-extract.py (Overture schema) or OSM-style properties.
// Data licences travel with the output: Overture buildings (ODbL, includes OpenStreetMap), OSM aeroways (ODbL).
import {gzipSync} from "node:zlib";
import {Compression,encodeMvt,lonLatToTile,lonLatToTilePoint,ringArea,writePMTiles,type MvtFeature,type TileId} from "@flight/geospatial";

type Pos=[number,number];type Geometry={type:string;coordinates:any};type Feature={properties:Record<string,unknown>|null;geometry:Geometry|null};
const Z=14,EXTENT=4096,args=process.argv.slice(2),out=args.includes("--out")?args[args.indexOf("--out")+1]!:"features.pmtiles";
const inputs=args.filter((a,i)=>!a.startsWith("--")&&args[i-1]!=="--out");
const tiles=new Map<string,{tile:TileId;building:MvtFeature[];aeroway:MvtFeature[]}>();
const bucket=(t:TileId)=>{const k=`${t.x}/${t.y}`;let b=tiles.get(k);if(!b){b={tile:t,building:[],aeroway:[]};tiles.set(k,b)}return b};
const AEROWAY=new Set(["runway","taxiway","taxilane","apron","helipad"]);
let id=0,buildings=0,aeroways=0,skipped=0;const bounds=[180,90,-180,-90];
const num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:undefined;
function polygonsOf(g:Geometry):Pos[][][]{return g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:[]}
function linesOf(g:Geometry):Pos[][]{return g.type==="LineString"?[g.coordinates]:g.type==="MultiLineString"?g.coordinates:[]}
const grow=(p:Pos)=>{bounds[0]=Math.min(bounds[0]!,p[0]);bounds[1]=Math.min(bounds[1]!,p[1]);bounds[2]=Math.max(bounds[2]!,p[0]);bounds[3]=Math.max(bounds[3]!,p[1])};
/** Every z14 tile a bounding box touches (aeroways are long: they go into each tile they cross, unclipped). */
function tilesFor(pts:Pos[]){const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),a=lonLatToTile(Math.min(...xs),Math.max(...ys),Z),b=lonLatToTile(Math.max(...xs),Math.min(...ys),Z),out:TileId[]=[];
 for(let x=a.x;x<=b.x;x++)for(let y=a.y;y<=b.y;y++)out.push({z:Z,x,y});return out}
// MVT 2.x: exterior rings have positive surveyor's-formula area in tile space (y down), holes negative. Whatever the input winding, fix it here.
const ringToTile=(t:TileId,r:Pos[],exterior:boolean)=>{const pts=r.map(p=>lonLatToTilePoint(t,EXTENT,p[0],p[1])),a=ringArea(pts);return (exterior?a<0:a>0)?pts.reverse():pts};
for(const file of inputs){
 const fc=await Bun.file(file).json() as {features:Feature[]};
 for(const f of fc.features){
  const p=f.properties??{},g=f.geometry;if(!g){skipped++;continue}
  const cls=String(p.class??p.aeroway??""),isAeroway=AEROWAY.has(cls)&&(p.subtype===undefined||p.subtype==="airport"),isBuilding=!isAeroway&&("height" in p||"num_floors" in p||p.building!==undefined||/buildings/.test(file));
  if(isAeroway){
   const props:Record<string,string|number>={class:cls==="taxilane"?"taxiway":cls,...(typeof p.ref==="string"&&p.ref?{ref:p.ref}:{})};
   for(const line of linesOf(g)){line.forEach(grow);for(const t of tilesFor(line))bucket(t).aeroway.push({id:++id,type:2,properties:props,geometry:[line.map(q=>lonLatToTilePoint(t,EXTENT,q[0],q[1]))]});aeroways++}
   for(const poly of polygonsOf(g)){poly[0]!.forEach(grow);for(const t of tilesFor(poly[0]!))bucket(t).aeroway.push({id:++id,type:3,properties:props,geometry:poly.map((r,i)=>ringToTile(t,r,i===0))});aeroways++}
  }else if(isBuilding){
   const h=num(p.height)??(num(p.num_floors)!==undefined?num(p.num_floors)!*3.2:undefined),minH=num(p.min_height);
   const props:Record<string,number>={...(h!==undefined?{render_height:Math.round(h*10)/10}:{}),...(minH!==undefined?{render_min_height:minH}:{})};
   for(const poly of polygonsOf(g)){const ext=poly[0]!;if(ext.length<4)continue;ext.forEach(grow);
    const c:Pos=[ext.reduce((s,q)=>s+q[0],0)/ext.length,ext.reduce((s,q)=>s+q[1],0)/ext.length],t=lonLatToTile(c[0],c[1],Z);
    bucket(t).building.push({id:++id,type:3,properties:props,geometry:poly.map((r,i)=>ringToTile(t,r,i===0))});buildings++}
  }else skipped++;
 }
}
const encoded=[...tiles.values()].map(b=>({tile:b.tile,data:gzipSync(encodeMvt([...(b.building.length?[{name:"building",extent:EXTENT,features:b.building}]:[]),...(b.aeroway.length?[{name:"aeroway",extent:EXTENT,features:b.aeroway}]:[])]))}));
const archive=writePMTiles(encoded,{compress:b=>gzipSync(b),tileCompression:Compression.Gzip,bounds:bounds as [number,number,number,number],
 metadata:{name:"flight-world-features",format:"pbf",vector_layers:[{id:"building",fields:{render_height:"Number",render_min_height:"Number"}},{id:"aeroway",fields:{class:"String",ref:"String"}}],
  attribution:"© Overture Maps Foundation · © OpenStreetMap contributors (ODbL)"}});
await Bun.write(out,archive);
console.log(`${out}: ${encoded.length} z${Z} tiles, ${buildings} buildings, ${aeroways} aeroway features (${skipped} other features skipped), ${(archive.length/1e6).toFixed(1)} MB`);
