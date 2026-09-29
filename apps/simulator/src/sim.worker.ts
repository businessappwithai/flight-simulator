import type {AircraftControls,CopilotAdvice,PilotIntent,SimCommand,SimEvent,SimPilot,WorldSnapshot} from "@flight/protocol";
import {DeterministicSimulation,defaultScenario,scenarioForSeed,type Scenario} from "@flight/simulation";
import {IntentController,autopilotControls,autopilotIntent,autopilotTarget,steerTo,targetIntent} from "@flight/controller";
import {PerfectSensorSuite} from "@flight/sensors";
import {FlightTraceRecorder,LearningRecorder,emptyBook,parseBook,situationOf} from "@flight/learning";
import {Copilot} from "@flight/copilot";
import {observationFeatures} from "@flight/cognition";
import {XGBoostBestPracticeClient} from "@flight/experience/xgboost-client";
import {AirportIndex,DEFAULT_FEATURES_URL,GeoWorld,SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV,decodeCatalog,parseOurAirports,searchAirports,terrariumSource,vectorSources,type AirportCatalogJson} from "@flight/geospatial";
// Authoritative flight simulation off the render thread. The page only sends pilot commands and STEP requests.
const MAX_TICKS_PER_STEP=240,LEARN_EVERY_TICKS=30n;
const sim=new DeterministicSimulation(),controller=new IntentController(),sensors=new PerfectSensorSuite(),learner=new LearningRecorder(),tracer=new FlightTraceRecorder();
let scenario:Scenario=defaultScenario(1n),world:WorldSnapshot=sim.reset(scenario),intent:PilotIntent="HOLD",pilot:SimPilot="AUTOPILOT",paused=false;
let controls:AircraftControls={aileron:0,elevator:0,rudder:0,throttle:0},flight=0,ended=false,advice:CopilotAdvice|undefined;
// The XGBoost worker is served next to this one (xgb.worker.js); under Bun (tests) the client finds its source.
const copilot=new Copilot({xgboost:()=>new XGBoostBestPracticeClient(typeof Bun==="undefined"?new URL("xgb.worker.js",self.location.href):undefined)});
const emit=(e:SimEvent,transfer:Transferable[]=[])=>postMessage(e,{transfer});
// Real-world anchoring (SET_WORLD): real terrain for physics and rendering around a real runway.
// The bundled sample answers at once; the full OurAirports catalogue (~27k airports, served next to this worker as
// airports-catalog.json.gz) replaces it when loaded. SET_WORLD waits for it, so a flight's airports never change mid-flight.
const SAMPLE=parseOurAirports(SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV);
let airports=new AirportIndex(SAMPLE);
async function catalogBytes():Promise<Uint8Array<ArrayBuffer>>{
 if(typeof Bun!=="undefined")return new Uint8Array(await Bun.file(new URL("../../../packages/geospatial/data/airports-catalog.json.gz",import.meta.url)).arrayBuffer());
 const r=await fetch(new URL("airports-catalog.json.gz",self.location.href));if(!r.ok)throw new Error(`airport catalogue: HTTP ${r.status}`);
 return new Uint8Array(await r.arrayBuffer());
}
async function gunzip(b:Uint8Array<ArrayBuffer>):Promise<Uint8Array<ArrayBuffer>>{
 // Some servers send the file with Content-Encoding: gzip and the browser has already inflated it.
 if(b[0]!==0x1f||b[1]!==0x8b)return b;
 if(typeof Bun!=="undefined")return new Uint8Array(Bun.gunzipSync(b));
 return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
// The picker's short list: the bundled sample airports (well-known, varied terrain), as found in the loaded index.
const featured=()=>SAMPLE.map(a=>airports.find(a.ident)??a).filter(a=>a.runways.some(r=>!r.closed)).map(a=>({ident:a.ident,name:a.name,municipality:a.municipality,country:a.country,runways:a.runways.filter(r=>!r.closed).flatMap(r=>[r.le.ident,r.he.ident])}));
const catalog=(async()=>{
 try{
  const list=decodeCatalog(JSON.parse(new TextDecoder().decode(await gunzip(await catalogBytes()))) as AirportCatalogJson),have=new Set(list.map(a=>a.ident));
  airports=new AirportIndex([...list,...SAMPLE.filter(a=>!have.has(a.ident))]);
 }catch(e){console.warn(`airport catalogue unavailable, using the bundled sample: ${e instanceof Error?e.message:String(e)}`)}
 emit({type:"GEO_CATALOG",airports:featured(),total:airports.size});
})();
let geo:GeoWorld|undefined,geoEpoch=0;
const pose=()=>({position:world.aircraft.position,velocity:world.aircraft.velocity,heading:world.aircraft.heading});
function setWorld(airport:string|null,runway?:string,terrainUrl?:string,featuresUrl:string|null=DEFAULT_FEATURES_URL,destination?:string,destinationRunway?:string){
 geo?.dispose();geo=undefined;sim.setGround(undefined);const epoch=++geoEpoch;
 emit({type:"TERRAIN",epoch,add:[],remove:[],clear:true});emit({type:"FEATURES",epoch,add:[],remove:[],clear:true});
 if(airport!==null){
  const g=new GeoWorld({airports,airport,runway,destination,destinationRunway,terrain:terrariumSource(terrainUrl?{template:terrainUrl}:{}),
   ...(featuresUrl?{features:vectorSources({url:featuresUrl})}:{}),
   onPatches:(add,remove)=>{if(geo===g)emit({type:"TERRAIN",epoch:geoEpoch,add,remove},add.flatMap(p=>[p.positions.buffer,p.colors.buffer,p.indices.buffer]))},
   onFeatures:(add,remove)=>{if(geo===g)emit({type:"FEATURES",epoch:geoEpoch,add,remove},add.flatMap(p=>[p.positions.buffer,p.colors.buffer,...(p.lights?[p.lights.buffer]:[])]))},
   // Re-anchoring moved the local frame: meshes of the old frame are dropped and re-sent in the new one.
   onRebase:frame=>{if(geo===g){const e=++geoEpoch;emit({type:"TERRAIN",epoch:e,add:[],remove:[],clear:true});emit({type:"FEATURES",epoch:e,add:[],remove:[],clear:true});void frame}},
   onChange:()=>{if(geo===g){if(g.state==="ERROR")sim.setGround(undefined);else g.update(pose());publish()}}});
  geo=g;sim.setGround(g.ground,g.landable);void g.prepare();
 }
 world=sim.reset(scenario);controls={aileron:0,elevator:0,rudder:0,throttle:0};
}
const INTENTS=new Set<PilotIntent>(["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"]);
// With a destination the autopilot flies the route (take-off, great circle, approach, landing there); else the circuit.
const routeTarget=()=>geo?.route?geo.routeTarget(world):undefined;
const autopilotMode=()=>(routeTarget()??autopilotTarget(world)).mode;
function publish(seq?:number){emit({type:"WORLD",world,seq,controls,pilot,intent,autopilotMode:world.objective.phase==="COMPLETE"?"LANDED":world.objective.phase==="FAILED"?"CRASHED":autopilotMode(),scenarioId:scenario.id,paused,
 learning:learner.enabled,insight:learner.enabled?learner.insight(sensors.observe(world)):undefined,
 ...(copilot.enabled||copilot.status.jev!=="OFF"?{copilot:advice,copilotStatus:copilot.status}:{}),...(geo?{geo:geo.status(pose(),world)}:{})})}
// Learning and traces observe the flight; they never feed back into the controls, so runs stay bit-for-bit
// deterministic. Manual and autopilot flying are recorded alike, as the pilot intent being flown.
const flownIntent=()=>{if(pilot!=="AUTOPILOT")return intent;const r=routeTarget();return r?targetIntent(world,r):autopilotIntent(world)};
function observeFlight(){
 const o=sensors.observe(world),situation=situationOf(o),flown=flownIntent();
 learner.observe(situation,flown,pilot,observationFeatures(o));
 tracer.record(world.tick,flown,pilot,situation,pilot==="AUTOPILOT"?`autopilot:${autopilotMode()}`:"pilot");
}
const beginFlight=()=>{learner.beginEpisode();tracer.begin(`${scenario.id}#${Date.now().toString(36)}-${++flight}`,scenario.id);ended=false;advice=undefined;copilot.reset()};
// The copilot's recommendation goes into this flight's trace and the next WORLD event; it never touches the controls.
const takeAdvice=(a:CopilotAdvice,frame:Parameters<FlightTraceRecorder["advise"]>[0])=>{advice=a;if(learner.enabled)tracer.advise(frame)};
// Commands run strictly in order (SET_WORLD may wait for the airport catalogue; later commands wait behind it).
let queue:Promise<void>=Promise.resolve();
onmessage=({data}:MessageEvent<SimCommand>)=>{queue=queue.then(()=>handle(data))};
async function handle(data:SimCommand){
 try{
  switch(data?.type){
   case "RESET":{
    if(!/^\d{1,19}$/.test(String(data.seed)))throw new Error(`invalid seed ${String(data.seed)}`);
    const seed=BigInt(data.seed);
    // A flight restarted before it landed or crashed is still traced (ABANDONED); it has no outcome to learn from.
    // checksum() snapshots synchronously, so this captures the abandoned flight even though it resolves after the reset.
    const abandoned=!ended&&tracer.frames>0?{tick:world.tick,phase:world.objective.phase,checksum:sim.checksum()}:undefined;
    scenario=data.scenario==="seeded"?scenarioForSeed(seed):defaultScenario(seed);
    geo?.resetFrame();world=sim.reset(scenario);controls={aileron:0,elevator:0,rudder:0,throttle:0};intent="HOLD";
    const trace=abandoned&&tracer.finish("ABANDONED",abandoned.tick,"",abandoned.phase);beginFlight();publish();
    if(trace&&abandoned){const checksum=await abandoned.checksum;emit({type:"TRACE",trace:{...trace,events:trace.events.map(e=>e.type==="EPISODE_END"?{...e,checksum}:e)}})}
    return;
   }
   case "SET_LEARNING":if(typeof data.enabled!=="boolean")throw new Error(`invalid learning flag ${String(data.enabled)}`);learner.enabled=data.enabled;publish();return;
   case "LOAD_LEARNING":{const book=parseBook(data.book);
    if(!book){learner.clear();emit({type:"LEARNING",book:emptyBook(),reason:"REJECTED"});return}
    // Publish too: a parked aircraft does not step, so this is how the page gets the learned insight.
    learner.load(book);copilot.learnFrom(learner.book);emit({type:"LEARNING",book:learner.book,reason:"LOADED"});publish();return}
   case "SET_JEV":if(data.apiKey!==null&&typeof data.apiKey!=="string")throw new Error("invalid Jev key");copilot.setKey(data.apiKey);advice=undefined;copilot.learnFrom(learner.book);publish();return;
   case "CLEAR_LEARNING":learner.clear();tracer.discard();copilot.learnFrom(learner.book);emit({type:"LEARNING",book:learner.book,reason:"CLEARED"});publish();return;
   case "SET_INTENT":if(!INTENTS.has(data.intent))throw new Error(`unknown intent ${String(data.intent)}`);intent=data.intent;return;
   case "SET_PILOT":if(data.pilot!=="AUTOPILOT"&&data.pilot!=="MANUAL")throw new Error(`unknown pilot ${String(data.pilot)}`);pilot=data.pilot;return;
   case "PAUSE":paused=true;publish();return;
   case "RESUME":paused=false;publish();return;
   case "STEP":{
    const ticks=Math.max(0,Math.min(MAX_TICKS_PER_STEP,Math.floor(Number(data.ticks)||0)));
    const done=()=>world.objective.phase==="COMPLETE"||world.objective.phase==="FAILED";
    // With real terrain the clock holds until every tile under the aircraft is loaded, so no tick is ever computed
    // with partial terrain: the flight is the same however slowly the network delivers.
    if(geo&&!paused&&ticks>0){const wait=geo.state==="LOADING"||geo.ensureAround(world.aircraft.position.x,world.aircraft.position.z);geo.holding=!!wait;if(wait){publish(data.seq);return}}
    if(!paused)for(let i=0;i<ticks&&!done();i++){
     // Crossing into a new tile mid-batch: hold here until its neighbourhood is loaded too.
     if(geo&&i>0&&geo.ensureAround(world.aircraft.position.x,world.aircraft.position.z))break;
     if(learner.enabled&&world.tick%LEARN_EVERY_TICKS===0n)observeFlight();
     const route=pilot==="AUTOPILOT"?routeTarget():undefined;
     controls=route?steerTo(world,route):pilot==="AUTOPILOT"?autopilotControls(world):controller.controls(intent,sensors.observe(world));world=sim.step(controls);
     if(geo){
      // Long flights: keep the local frame under the aircraft (exact transform through WGS84, decided from the state alone).
      const moved=geo.maybeRebase(world);if(moved){sim.restore(moved);world=moved}
      // Landed and stopped at the destination: the flight is complete.
      if(geo.route&&world.objective.phase!=="COMPLETE"&&geo.arrived(world)){world={...world,objective:{phase:"COMPLETE",checkpointReached:true}};sim.restore(world)}
     }
    }
    geo?.update(pose());
    const finishing=done()&&!ended;if(finishing)ended=true;
    const landed=world.objective.phase==="COMPLETE";
    if(!done()&&!paused&&ticks>0)copilot.advise(world.tick,sensors.observe(world),flownIntent(),takeAdvice);
    if(finishing&&learner.finish(landed)){emit({type:"LEARNING",book:learner.book,reason:"RECORDED"});copilot.learnFrom(learner.book)}
    publish(data.seq);
    if(done()||(data.seq??0)%60===0){const checksum=await sim.checksum();emit({type:"CHECKSUM",tick:String(world.tick),checksum});
     const trace=finishing?tracer.finish(landed?"LANDED":"CRASHED",world.tick,checksum,world.objective.phase):undefined;if(trace)emit({type:"TRACE",trace})}
    return;
   }
   case "FIND_AIRPORTS":{
    if(typeof data.query!=="string"||data.query.length>64)throw new Error("invalid airport search");
    await catalog;const near=geo?geo.status(pose()).position:undefined;
    emit({type:"AIRPORTS_FOUND",query:data.query,airports:searchAirports(airports.airports,data.query,Math.max(1,Math.min(50,Math.floor(Number(data.limit)||20))),near)});return;
   }
   case "SET_WORLD":{
    await catalog;
    if(data.airport!==null&&(typeof data.airport!=="string"||!airports.find(data.airport)))throw new Error(`unknown airport ${String(data.airport)}`);
    if(data.destination!==undefined&&data.destination!==null&&(typeof data.destination!=="string"||!airports.find(data.destination)))throw new Error(`unknown destination ${String(data.destination)}`);
    if(data.destinationRunway!==undefined&&typeof data.destinationRunway!=="string")throw new Error("invalid destination runway");
    if(data.runway!==undefined&&typeof data.runway!=="string")throw new Error("invalid runway");
    if(data.terrainUrl!==undefined&&(typeof data.terrainUrl!=="string"||!/^(https?:\/\/|\/|\.)/.test(data.terrainUrl)||!/\{z\}.*\{x\}.*\{y\}/.test(data.terrainUrl)))throw new Error("invalid terrain URL template");
    if(data.featuresUrl!==undefined&&data.featuresUrl!==null&&(typeof data.featuresUrl!=="string"||!/^(https?:\/\/|\/|\.)/.test(data.featuresUrl)))throw new Error("invalid features URL");
    setWorld(data.airport,data.runway,data.terrainUrl,data.featuresUrl===undefined?DEFAULT_FEATURES_URL:data.featuresUrl,data.destination??undefined,data.destinationRunway);publish();return;
   }
   case "RESTORE":throw new Error("RESTORE is not supported by the simulator worker");
   default:throw new Error(`unknown command ${JSON.stringify((data as any)?.type)}`);
  }
 }catch(e){emit({type:"ERROR",message:e instanceof Error?e.message:String(e)})}
};
beginFlight();
emit({type:"GEO_CATALOG",airports:featured(),total:airports.size});
emit({type:"READY"});
