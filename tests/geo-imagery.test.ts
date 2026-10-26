// Satellite imagery drapes onto real terrain: each patch is one Web Mercator tile, so the worker gives it texture
// coordinates over that tile (the imagery tile of the same z/x/y fits exactly), and the skirts repeat their edge's.
import {expect,test} from "bun:test";
import {GeoWorld,TerrainTile,lonLatToTile} from "@flight/geospatial";
import {catalogIndex,demSource,inland} from "./geo-route.helpers.ts";

test("terrain patches carry texture coordinates over their own tile, skirts included",async()=>{
 const g=new GeoWorld({airports:catalogIndex(),airport:"VOMM",runway:"07",terrain:demSource(inland)});await g.prepare();
 try{
  const tile=lonLatToTile(80.17,12.99,13),p=g.mesh(new TerrainTile(tile,2,2,new Float32Array([10,20,30,40])));
  expect(p.key).toBe(`${tile.z}/${tile.x}/${tile.y}`);
  const uv=p.uvs!,verts=p.positions.length/3;expect(uv).toBeInstanceOf(Float32Array);expect(uv.length).toBe(verts*2);
  const seg=32,n=seg+1;
  // The grid: (0,0) at the north-west corner, (1,1) at the south-east, uniform in between.
  expect([uv[0],uv[1]]).toEqual([0,0]);expect([uv[(n*n-1)*2],uv[(n*n-1)*2+1]]).toEqual([1,1]);
  expect(uv[(3*n+5)*2]).toBeCloseTo(5/seg,6);expect(uv[(3*n+5)*2+1]).toBeCloseTo(3/seg,6);
  // Every skirt vertex sits under a grid vertex and has its texture coordinate.
  for(let v=n*n;v<verts;v++){
   let match=-1;for(let k=0;k<n*n&&match<0;k++)if(p.positions[k*3]===p.positions[v*3]&&p.positions[k*3+2]===p.positions[v*3+2])match=k;
   expect(match).toBeGreaterThanOrEqual(0);expect([uv[v*2],uv[v*2+1]]).toEqual([uv[match*2],uv[match*2+1]]);
  }
 }finally{g.dispose()}
});
