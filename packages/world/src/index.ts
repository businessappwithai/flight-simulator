import { SplitMix64 } from "@flight/simulation";
import type { EntityState } from "@flight/protocol";
export interface WorldGenes{seed:bigint;obstacles:number;width:number;depth:number;altitudeMin:number;altitudeMax:number}
export function generateObstacles(g:WorldGenes):readonly EntityState[]{
 const r=new SplitMix64(g.seed),out:EntityState[]=[];
 for(let i=0;i<g.obstacles;i++)out.push({
  id:`obstacle:${i.toString().padStart(4,"0")}`,kind:"OBSTACLE",
  position:{x:(r.nextFloat()-.5)*g.width,y:g.altitudeMin+r.nextFloat()*(g.altitudeMax-g.altitudeMin),z:r.nextFloat()*g.depth},
  velocity:{x:(r.nextFloat()-.5)*10,y:0,z:(r.nextFloat()-.5)*5},radius:6+r.nextFloat()*12
 });return out;
}

export { generateEnvironment } from "./environment.ts";
export type { TerrainCell, WeatherCell, TrafficSpawn, GameHazard, EnvironmentGenes } from "./environment.ts";
