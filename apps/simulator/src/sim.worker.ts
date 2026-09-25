import type {SimCommand,SimEvent,PilotIntent} from "@flight/protocol";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {IntentController} from "@flight/controller";
import {PerfectSensorSuite} from "@flight/sensors";
const sim=new DeterministicSimulation();sim.reset(defaultScenario(1n));let intent:PilotIntent="HOLD",paused=false;
const controller=new IntentController(),sensors=new PerfectSensorSuite();
const emit=(e:SimEvent)=>postMessage(e);
onmessage=async({data}:MessageEvent<SimCommand>)=>{
 try{
  if(data.type==="RESET"){emit({type:"WORLD",world:sim.reset(defaultScenario(BigInt(data.seed)))});return}
  if(data.type==="SET_INTENT"){intent=data.intent;return}
  if(data.type==="PAUSE"){paused=true;return} if(data.type==="RESUME"){paused=false;return}
  if(data.type==="STEP"&&!paused){let world=sim.snapshot();for(let i=0;i<data.ticks;i++)world=sim.step(controller.controls(intent,sensors.observe(world)));emit({type:"WORLD",world});emit({type:"CHECKSUM",tick:String(world.tick),checksum:await sim.checksum()})}
 }catch(e){emit({type:"ERROR",message:e instanceof Error?e.message:String(e)})}
};
emit({type:"READY"});
