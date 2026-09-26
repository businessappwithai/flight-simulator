import type {AircraftControls,PilotIntent,SimCommand,SimEvent,SimPilot,WorldSnapshot} from "@flight/protocol";
import {DeterministicSimulation,defaultScenario,scenarioForSeed,type Scenario} from "@flight/simulation";
import {IntentController,autopilotControls,autopilotIntent,autopilotTarget} from "@flight/controller";
import {PerfectSensorSuite} from "@flight/sensors";
import {FlightTraceRecorder,LearningRecorder,emptyBook,parseBook,situationOf} from "@flight/learning";
// Authoritative flight simulation off the render thread. The page only sends pilot commands and STEP requests.
const MAX_TICKS_PER_STEP=240,LEARN_EVERY_TICKS=30n;
const sim=new DeterministicSimulation(),controller=new IntentController(),sensors=new PerfectSensorSuite(),learner=new LearningRecorder(),tracer=new FlightTraceRecorder();
let scenario:Scenario=defaultScenario(1n),world:WorldSnapshot=sim.reset(scenario),intent:PilotIntent="HOLD",pilot:SimPilot="AUTOPILOT",paused=false;
let controls:AircraftControls={aileron:0,elevator:0,rudder:0,throttle:0},flight=0,ended=false;
const emit=(e:SimEvent)=>postMessage(e);
const INTENTS=new Set<PilotIntent>(["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"]);
function publish(seq?:number){emit({type:"WORLD",world,seq,controls,pilot,intent,autopilotMode:world.objective.phase==="COMPLETE"?"LANDED":world.objective.phase==="FAILED"?"CRASHED":autopilotTarget(world).mode,scenarioId:scenario.id,paused,
 learning:learner.enabled,insight:learner.enabled?learner.insight(sensors.observe(world)):undefined})}
// Learning and traces observe the flight; they never feed back into the controls, so runs stay bit-for-bit
// deterministic. Manual and autopilot flying are recorded alike, as the pilot intent being flown.
function observeFlight(){
 const o=sensors.observe(world),situation=situationOf(o),flown=pilot==="AUTOPILOT"?autopilotIntent(world):intent;
 learner.observe(situation,flown,pilot);
 tracer.record(world.tick,flown,pilot,situation,pilot==="AUTOPILOT"?`autopilot:${autopilotTarget(world).mode}`:"pilot");
}
const beginFlight=()=>{learner.beginEpisode();tracer.begin(`${scenario.id}#${Date.now().toString(36)}-${++flight}`,scenario.id);ended=false};
onmessage=async({data}:MessageEvent<SimCommand>)=>{
 try{
  switch(data?.type){
   case "RESET":{
    if(!/^\d{1,19}$/.test(String(data.seed)))throw new Error(`invalid seed ${String(data.seed)}`);
    const seed=BigInt(data.seed);
    // A flight restarted before it landed or crashed is still traced (ABANDONED); it has no outcome to learn from.
    // checksum() snapshots synchronously, so this captures the abandoned flight even though it resolves after the reset.
    const abandoned=!ended&&tracer.frames>0?{tick:world.tick,phase:world.objective.phase,checksum:sim.checksum()}:undefined;
    scenario=data.scenario==="seeded"?scenarioForSeed(seed):defaultScenario(seed);
    world=sim.reset(scenario);controls={aileron:0,elevator:0,rudder:0,throttle:0};intent="HOLD";
    const trace=abandoned&&tracer.finish("ABANDONED",abandoned.tick,"",abandoned.phase);beginFlight();publish();
    if(trace&&abandoned){const checksum=await abandoned.checksum;emit({type:"TRACE",trace:{...trace,events:trace.events.map(e=>e.type==="EPISODE_END"?{...e,checksum}:e)}})}
    return;
   }
   case "SET_LEARNING":if(typeof data.enabled!=="boolean")throw new Error(`invalid learning flag ${String(data.enabled)}`);learner.enabled=data.enabled;publish();return;
   case "LOAD_LEARNING":{const book=parseBook(data.book);
    if(!book){learner.clear();emit({type:"LEARNING",book:emptyBook(),reason:"REJECTED"});return}
    // Publish too: a parked aircraft does not step, so this is how the page gets the learned insight.
    learner.load(book);emit({type:"LEARNING",book:learner.book,reason:"LOADED"});publish();return}
   case "CLEAR_LEARNING":learner.clear();tracer.discard();emit({type:"LEARNING",book:learner.book,reason:"CLEARED"});publish();return;
   case "SET_INTENT":if(!INTENTS.has(data.intent))throw new Error(`unknown intent ${String(data.intent)}`);intent=data.intent;return;
   case "SET_PILOT":if(data.pilot!=="AUTOPILOT"&&data.pilot!=="MANUAL")throw new Error(`unknown pilot ${String(data.pilot)}`);pilot=data.pilot;return;
   case "PAUSE":paused=true;publish();return;
   case "RESUME":paused=false;publish();return;
   case "STEP":{
    const ticks=Math.max(0,Math.min(MAX_TICKS_PER_STEP,Math.floor(Number(data.ticks)||0)));
    const done=()=>world.objective.phase==="COMPLETE"||world.objective.phase==="FAILED";
    if(!paused)for(let i=0;i<ticks&&!done();i++){
     if(learner.enabled&&world.tick%LEARN_EVERY_TICKS===0n)observeFlight();
     controls=pilot==="AUTOPILOT"?autopilotControls(world):controller.controls(intent,sensors.observe(world));world=sim.step(controls)}
    const finishing=done()&&!ended;if(finishing)ended=true;
    const landed=world.objective.phase==="COMPLETE";
    if(finishing&&learner.finish(landed))emit({type:"LEARNING",book:learner.book,reason:"RECORDED"});
    publish(data.seq);
    if(done()||(data.seq??0)%60===0){const checksum=await sim.checksum();emit({type:"CHECKSUM",tick:String(world.tick),checksum});
     const trace=finishing?tracer.finish(landed?"LANDED":"CRASHED",world.tick,checksum,world.objective.phase):undefined;if(trace)emit({type:"TRACE",trace})}
    return;
   }
   case "RESTORE":throw new Error("RESTORE is not supported by the simulator worker");
   default:throw new Error(`unknown command ${JSON.stringify((data as any)?.type)}`);
  }
 }catch(e){emit({type:"ERROR",message:e instanceof Error?e.message:String(e)})}
};
beginFlight();
emit({type:"READY"});
