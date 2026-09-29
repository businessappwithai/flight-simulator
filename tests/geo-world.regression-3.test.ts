// Regression: ISSUE-010 — white dotted lines along terrain tile edges (sky showing through cracks between tiles).
// Found by /qa on 2026-09-29. Report: .gstack/qa-reports/qa-report-appwithai-org-2026-09-29.md
import {expect,test} from "bun:test";
import {AirportIndex,GeoWorld,SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV,TerrainTile,parseOurAirports,tileBounds,type TileSource} from "@flight/geospatial";

const index=new AirportIndex(parseOurAirports(SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV));
const hilly:TileSource<TerrainTile>={layer:"terrain",maxZoom:15,sizeOf:t=>t.byteLength,load:async tile=>{
 const n=16,b=tileBounds(tile),h=new Float32Array(n*n);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++)h[j*n+i]=50+40*Math.sin((b.west+(b.east-b.west)*i/n)*300)+30*Math.cos((b.north+(b.south-b.north)*j/n)*250);
 return new TerrainTile(tile,n,n,h)}};

test("terrain tiles hang a skirt below every edge, facing outwards, so neighbours leave no gap to the sky",async()=>{
 const g=new GeoWorld({airports:index,airport:"VOMM",runway:"07",terrain:hilly,meshSegments:8});await g.prepare();
 const t=await hilly.load({z:12,x:2958,y:1807},new AbortController().signal);
 const p=g.mesh(t),seg=8,n=seg+1,top=n*n,P=(i:number)=>[p.positions[i*3]!,p.positions[i*3+1]!,p.positions[i*3+2]!] as const;
 expect(p.positions.length).toBe((top+4*seg*4)*3);expect(p.colors.length).toBe(p.positions.length);
 expect(p.indices.length).toBe(seg*seg*6+4*seg*6);
 const normal=(a:number,b:number,c:number)=>{const A=P(a),B=P(b),C=P(c),u=[B[0]-A[0],B[1]-A[1],B[2]-A[2]] as const,v=[C[0]-A[0],C[1]-A[1],C[2]-A[2]] as const;return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]};
 // The surface still faces up.
 for(let k=0;k<seg*seg*6;k+=3)expect(normal(p.indices[k]!,p.indices[k+1]!,p.indices[k+2]!)[1]!).toBeGreaterThan(0);
 // Every skirt triangle is vertical, reaches at least 30 m below the edge, and faces away from the tile's middle.
 let lowest=0;
 for(let k=seg*seg*6;k<p.indices.length;k+=3){const [a,b,c]=[p.indices[k]!,p.indices[k+1]!,p.indices[k+2]!],nm=normal(a,b,c);
  const mx=(P(a)[0]+P(b)[0]+P(c)[0])/3,mz=(P(a)[2]+P(b)[2]+P(c)[2])/3;
  expect(Math.abs(nm[1]!)).toBeLessThan(1e-3*Math.hypot(nm[0]!,nm[2]!));expect(nm[0]!*mx+nm[2]!*mz).toBeGreaterThan(0);
  for(const v of [a,b,c])expect(v).toBeGreaterThanOrEqual(top);
  lowest=Math.min(lowest,...[a,b,c].map(v=>P(v)[1]!))}
 const minEdge=Math.min(...Array.from({length:n},(_,i)=>P(i)[1]!));expect(lowest).toBeLessThanOrEqual(minEdge-30);
 g.dispose();
});
