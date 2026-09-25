import type {PilotIntent} from "@flight/protocol";
export const ACTIONS=["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"] as const satisfies readonly PilotIntent[];
export interface BestPracticeExample{features:readonly number[];action:PilotIntent;reward:number;regret:number;success:boolean;safetyOverride:boolean;catastrophic:boolean}
/** probability = model estimate of P(good outcome | situation, action); ranked highest first. Values do not sum to 1. */
export interface BestPracticePrediction{action:PilotIntent;probability:number}
export const actionIndex=(a:PilotIntent)=>ACTIONS.indexOf(a as typeof ACTIONS[number]);
export function trainingWeight(x:BestPracticeExample){
 if(x.catastrophic)return 12;
 if(x.safetyOverride)return 7;
 if(!x.success)return 5+Math.min(5,Math.max(0,x.regret));
 return 1+Math.min(5,Math.max(0,x.reward))+Math.max(0,2-x.regret);
}
/**
 * The best-practice model is an outcome model: it learns P(good outcome | situation, action).
 * A row is "good" only if it succeeded without a safety override or catastrophe. Failures keep their
 * executed action with label 0 and the heavy trainingWeight, so they teach the model which actions to
 * avoid rather than (as an imitation label would) which actions to repeat.
 */
export const OUTCOME_MODEL_FORMAT="xgb-ubj-outcome-v1";
export const outcomeLabel=(x:BestPracticeExample)=>x.success&&!x.safetyOverride&&!x.catastrophic?1:0;
export function outcomeRow(features:readonly number[],action:PilotIntent):number[]{
 const i=actionIndex(action);if(i<0)throw new Error(`unknown action ${action}`);
 return [...features,...ACTIONS.map((_,j)=>j===i?1:0)];
}
export interface OutcomeDataset{rows:number;cols:number;data:Float32Array;labels:Float32Array;weights:Float32Array;featureCount:number;skipped:number}
export function buildOutcomeDataset(examples:readonly BestPracticeExample[]):OutcomeDataset{
 const usable=examples.filter(x=>actionIndex(x.action)>=0&&x.features.length>0&&x.features.every(Number.isFinite));
 if(!usable.length)throw new Error("no usable training examples");
 const featureCount=usable[0]!.features.length,rows=usable.filter(x=>x.features.length===featureCount);
 const cols=featureCount+ACTIONS.length,data=new Float32Array(rows.length*cols),labels=new Float32Array(rows.length),weights=new Float32Array(rows.length);
 rows.forEach((x,r)=>{data.set(outcomeRow(x.features,x.action),r*cols);labels[r]=outcomeLabel(x);weights[r]=trainingWeight(x)});
 return {rows:rows.length,cols,data,labels,weights,featureCount,skipped:examples.length-rows.length};
}
/** One candidate row per action for the same situation; pairs with rankOutcomes. */
export function candidateRows(features:readonly number[]):{rows:number;cols:number;data:Float32Array}{
 if(!features.every(Number.isFinite))throw new Error("non-finite feature");
 const cols=features.length+ACTIONS.length,data=new Float32Array(ACTIONS.length*cols);
 ACTIONS.forEach((a,r)=>data.set(outcomeRow(features,a),r*cols));return {rows:ACTIONS.length,cols,data};
}
export function rankOutcomes(p:ArrayLike<number>):BestPracticePrediction[]{
 if(p.length!==ACTIONS.length)throw new Error(`expected ${ACTIONS.length} predictions, got ${p.length}`);
 return ACTIONS.map((action,i)=>({action,probability:Number(p[i])})).sort((a,b)=>b.probability-a.probability||actionIndex(a.action)-actionIndex(b.action));
}
