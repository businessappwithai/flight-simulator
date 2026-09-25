import { SplitMix64 } from "@flight/simulation";
export interface TerrainSample{x:number;z:number;height:number}
export interface WeatherCell{x:number;z:number;radius:number;windX:number;windY:number;windZ:number;turbulence:number}
export interface TrafficSpawn{id:string;x:number;y:number;z:number;heading:number;speed:number}
export interface GameHazard{id:string;x:number;y:number;z:number;vx:number;vy:number;vz:number;radius:number}
export interface EnvironmentGenes{seed:bigint;terrainAmplitude:number;weatherCells:number;traffic:number;hazards:number}
export function terrainHeight(seed:bigint,x:number,z:number,amplitude=60):number{
 const a=Number(seed%997n)/997; return Math.max(0,(Math.sin(x*.006+a*6)+Math.cos(z*.004-a*3)+2)*.25*amplitude);
}
export function generateEnvironment(g:EnvironmentGenes){
 const r=new SplitMix64(g.seed);
 const weather:WeatherCell[]=Array.from({length:g.weatherCells},(_,i)=>({x:(r.nextFloat()-.5)*3000,z:r.nextFloat()*5000,radius:150+r.nextFloat()*500,windX:(r.nextFloat()-.5)*20,windY:(r.nextFloat()-.5)*5,windZ:(r.nextFloat()-.5)*20,turbulence:r.nextFloat()}));
 const traffic:TrafficSpawn[]=Array.from({length:g.traffic},(_,i)=>({id:`traffic:${i}`,x:(r.nextFloat()-.5)*1500,y:80+r.nextFloat()*500,z:r.nextFloat()*5000,heading:r.nextFloat()*Math.PI*2,speed:20+r.nextFloat()*60}));
 const hazards:GameHazard[]=Array.from({length:g.hazards},(_,i)=>({id:`hazard:${i}`,x:(r.nextFloat()-.5)*1500,y:40+r.nextFloat()*500,z:r.nextFloat()*5000,vx:(r.nextFloat()-.5)*30,vy:(r.nextFloat()-.5)*8,vz:(r.nextFloat()-.5)*30,radius:5+r.nextFloat()*15}));
 return {weather,traffic,hazards};
}
