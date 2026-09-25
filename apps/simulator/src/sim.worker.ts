import type {AircraftControls,PilotIntent,SimCommand,SimEvent,SimPilot,WorldSnapshot} from "@flight/protocol";
import {DeterministicSimulation,defaultScenario,scenarioForSeed,type Scenario} from "@flight/simulation";
import {IntentController,autopilotControls,autopilotTarget} from "@flight/controller";
import {PerfectSensorSuite} from "@flight/sensors";
// Authoritative flight simulation off the render thread. The page only sends pilot commands and STEP requests.
const MAX_TICKS_PER_STEP=240;
const sim=new DeterministicSimulation(),controller=new IntentController(),sensors=new PerfectSensorSuite();
let scenario:Scenario=defaultScenario(1n),world:WorldSnapshot=sim.reset(scenario),intent:PilotIntent="HOLD",pilot:SimPilot="AUTOPILOT",paused=false;
let controls:AircraftControls={aileron:0,elevator:0,rudder:0,throttle:0};
const emit=(e:SimEvent)=>postMessage(e);
const INTENTS=new Set<PilotIntent>(["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"]);
function publish(seq?:number){emit({type:"WORLD",world,seq,controls,pilot,intent,autopilotMode:world.objective.phase==="COMPLETE"?"LANDED":world.objective.phase==="FAILED"?"CRASHED":autopilotTarget(world).mode,scenarioId:scenario.id,paused})}
onmessage=async({data}:MessageEvent<SimCommand>)=>{
 try{
  switch(data?.type){
   case "RESET":{
    if(!/^\d{1,19}$/.test(String(data.seed)))throw new Error(`invalid seed ${String(data.seed)}`);
    const seed=BigInt(data.seed);scenario=data.scenario==="seeded"?scenarioForSeed(seed):defaultScenario(seed);
    world=sim.reset(scenario);controls={aileron:0,elevator:0,rudder:0,throttle:0};intent="HOLD";publish();return;
   }
   case "SET_INTENT":if(!INTENTS.has(data.intent))throw new Error(`unknown intent ${String(data.intent)}`);intent=data.intent;return;
   case "SET_PILOT":if(data.pilot!=="AUTOPILOT"&&data.pilot!=="MANUAL")throw new Error(`unknown pilot ${String(data.pilot)}`);pilot=data.pilot;return;
   case "PAUSE":paused=true;publish();return;
   case "RESUME":paused=false;publish();return;
   case "STEP":{
    const ticks=Math.max(0,Math.min(MAX_TICKS_PER_STEP,Math.floor(Number(data.ticks)||0)));
    const done=()=>world.objective.phase==="COMPLETE"||world.objective.phase==="FAILED";
    if(!paused)for(let i=0;i<ticks&&!done();i++){controls=pilot==="AUTOPILOT"?autopilotControls(world):controller.controls(intent,sensors.observe(world));world=sim.step(controls)}
    publish(data.seq);
    if(done()||(data.seq??0)%60===0)emit({type:"CHECKSUM",tick:String(world.tick),checksum:await sim.checksum()});
    return;
   }
   case "RESTORE":throw new Error("RESTORE is not supported by the simulator worker");
   default:throw new Error(`unknown command ${JSON.stringify((data as any)?.type)}`);
  }
 }catch(e){emit({type:"ERROR",message:e instanceof Error?e.message:String(e)})}
};
emit({type:"READY"});
