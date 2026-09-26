import type {AircraftControls,PilotIntent,SimCommand,SimEvent,SimPilot,WorldSnapshot} from "@flight/protocol";
import {DeterministicSimulation,defaultScenario,scenarioForSeed,type Scenario} from "@flight/simulation";
import {IntentController,autopilotControls,autopilotTarget} from "@flight/controller";
import {PerfectSensorSuite} from "@flight/sensors";
import {LearningRecorder,emptyBook,parseBook} from "@flight/learning";
// Authoritative flight simulation off the render thread. The page only sends pilot commands and STEP requests.
const MAX_TICKS_PER_STEP=240,LEARN_EVERY_TICKS=30n;
const sim=new DeterministicSimulation(),controller=new IntentController(),sensors=new PerfectSensorSuite(),learner=new LearningRecorder();
let scenario:Scenario=defaultScenario(1n),world:WorldSnapshot=sim.reset(scenario),intent:PilotIntent="HOLD",pilot:SimPilot="AUTOPILOT",paused=false;
let controls:AircraftControls={aileron:0,elevator:0,rudder:0,throttle:0};
const emit=(e:SimEvent)=>postMessage(e);
const INTENTS=new Set<PilotIntent>(["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"]);
function publish(seq?:number){emit({type:"WORLD",world,seq,controls,pilot,intent,autopilotMode:world.objective.phase==="COMPLETE"?"LANDED":world.objective.phase==="FAILED"?"CRASHED":autopilotTarget(world).mode,scenarioId:scenario.id,paused,
 learning:learner.enabled,insight:learner.enabled?learner.insight(sensors.observe(world)):undefined})}
// Learning observes the flight; it never feeds back into the controls, so runs stay bit-for-bit deterministic.
const learnAction=()=>pilot==="AUTOPILOT"?`AP_${autopilotTarget(world).mode}`:intent;
onmessage=async({data}:MessageEvent<SimCommand>)=>{
 try{
  switch(data?.type){
   case "RESET":{
    if(!/^\d{1,19}$/.test(String(data.seed)))throw new Error(`invalid seed ${String(data.seed)}`);
    const seed=BigInt(data.seed);scenario=data.scenario==="seeded"?scenarioForSeed(seed):defaultScenario(seed);
    world=sim.reset(scenario);controls={aileron:0,elevator:0,rudder:0,throttle:0};intent="HOLD";learner.beginEpisode();publish();return;
   }
   case "SET_LEARNING":if(typeof data.enabled!=="boolean")throw new Error(`invalid learning flag ${String(data.enabled)}`);learner.enabled=data.enabled;publish();return;
   case "LOAD_LEARNING":{const book=parseBook(data.book);
    if(!book){learner.clear();emit({type:"LEARNING",book:emptyBook(),reason:"REJECTED"});return}
    learner.load(book);emit({type:"LEARNING",book:learner.book,reason:"LOADED"});return}
   case "CLEAR_LEARNING":learner.clear();emit({type:"LEARNING",book:learner.book,reason:"CLEARED"});publish();return;
   case "SET_INTENT":if(!INTENTS.has(data.intent))throw new Error(`unknown intent ${String(data.intent)}`);intent=data.intent;return;
   case "SET_PILOT":if(data.pilot!=="AUTOPILOT"&&data.pilot!=="MANUAL")throw new Error(`unknown pilot ${String(data.pilot)}`);pilot=data.pilot;return;
   case "PAUSE":paused=true;publish();return;
   case "RESUME":paused=false;publish();return;
   case "STEP":{
    const ticks=Math.max(0,Math.min(MAX_TICKS_PER_STEP,Math.floor(Number(data.ticks)||0)));
    const done=()=>world.objective.phase==="COMPLETE"||world.objective.phase==="FAILED";
    if(!paused)for(let i=0;i<ticks&&!done();i++){
     if(learner.enabled&&world.tick%LEARN_EVERY_TICKS===0n)learner.observe(sensors.observe(world),learnAction());
     controls=pilot==="AUTOPILOT"?autopilotControls(world):controller.controls(intent,sensors.observe(world));world=sim.step(controls)}
    if(done()&&learner.finish(world.objective.phase==="COMPLETE"))emit({type:"LEARNING",book:learner.book,reason:"RECORDED"});
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
