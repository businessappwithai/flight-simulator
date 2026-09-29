import {expect,test} from "bun:test";
import type {GeoStatus,WorldSnapshot} from "@flight/protocol";
import {crashCause,recoverWorld} from "../apps/simulator/src/sim-store.ts";

const world=(a:Partial<WorldSnapshot["aircraft"]>):WorldSnapshot=>({tick:600n,random:{state:1n},entities:[],objective:{phase:"FAILED",checkpointReached:false},
 aircraft:{position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},heading:0,pitch:0,roll:0,throttle:0,grounded:true,crashed:true,...a}});
const geo=(surface:GeoStatus["surface"])=>({surface}) as GeoStatus;

test("crash banners name the cause",()=>{
 expect(crashCause(world({}),geo("BUILDING"))).toBe("Crashed into a building");
 expect(crashCause(world({velocity:{x:0,y:-12,z:40}}),geo("TERRAIN"))).toBe("Flew into terrain");
 expect(crashCause(world({velocity:{x:0,y:-11,z:30}}),geo("RUNWAY"))).toBe("Crashed: touchdown too hard");
 expect(crashCause(world({roll:.5,velocity:{x:0,y:-2,z:30}}),geo("AIRFIELD"))).toBe("Crashed: wing struck the ground (too much bank)");
 expect(crashCause(world({velocity:{x:0,y:-9,z:30}}))).toBe("Crashed: touchdown too hard");
 expect(crashCause(world({}))).toBe("Crashed on landing or impact");
});

test("a rejected SET_WORLD drops only what the worker objected to",()=>{
 const r={airport:"VOMM",runway:"99",destination:"VOBL",destinationRunway:"42",terrainUrl:"https://x/tiles.png",featuresUrl:"ftp://nope"};
 expect(recoverWorld(r,"unknown airport VOMM")).toBeNull();
 expect(recoverWorld({},"unknown airport ZZZZ")).toBeNull();
 expect(recoverWorld(r,"unknown destination VOBL")).toMatchObject({airport:"VOMM",runway:"99",destination:undefined,destinationRunway:undefined});
 expect(recoverWorld(r,"destination is the departure airport")).toMatchObject({destination:undefined});
 expect(recoverWorld(r,"VOBL has no runway 42")).toMatchObject({destination:"VOBL",destinationRunway:undefined,runway:"99"});
 expect(recoverWorld(r,"VOMM has no runway 99")).toMatchObject({airport:"VOMM",runway:undefined,destination:"VOBL"});
 expect(recoverWorld(r,"invalid terrain URL template")).toMatchObject({terrainUrl:undefined,runway:"99"});
 expect(recoverWorld(r,"invalid features URL")).toMatchObject({featuresUrl:undefined,terrainUrl:"https://x/tiles.png"});
 // Retrying converges: each rejection removes one part until the worker accepts or nothing is left to drop.
 let q:ReturnType<typeof recoverWorld>=r;const msgs=["invalid terrain URL template","invalid features URL","VOBL has no runway 42","VOMM has no runway 99"];
 for(const m of msgs)q=recoverWorld(q!,m);expect(q).toEqual({airport:"VOMM",destination:"VOBL"} as any);
 expect(recoverWorld({airport:"VOMM"},"VOMM has no runway 99")).toBeNull();
});
