import type {LabCommand,LabEvent} from "@flight/protocol";
import {LearningLab} from "@flight/lab";
// Learning Lab worker: flies, trains and explains off the UI thread. The page only sees @flight/protocol messages.
let lab:LearningLab|undefined,run:Promise<unknown>|undefined;
const emit=(e:LabEvent)=>postMessage(e);
onmessage=async({data}:MessageEvent<LabCommand>)=>{
 try{
  switch(data?.type){
   case "START":{if(lab&&run){lab.stop();await run.catch(()=>{})}lab=new LearningLab(emit);run=lab.run(data.config);await run;run=undefined;return}
   case "STOP":lab?.stop();return;
   case "EPISODE":if(!lab)throw new Error("no lab run yet");emit({type:"EPISODE_DETAIL",detail:lab.episode(data.generation,data.episode)});return;
   case "EXPLAIN":if(!lab)throw new Error("no lab run yet");emit({type:"EXPLANATION",explanation:lab.explain(data.generation,data.episode,data.decisionId,data.action,data.model)});return;
   default:throw new Error(`unknown lab command ${JSON.stringify((data as {type?:unknown})?.type)}`);
  }
 }catch(e){run=undefined;emit({type:"ERROR",message:e instanceof Error?e.message:String(e)})}
};
