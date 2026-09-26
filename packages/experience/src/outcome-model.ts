import {Booster,DMatrix,loadXGB} from "@wlearn/xgboost";
import {ACTIONS,buildOutcomeDataset,candidateRows,outcomeRow,rankOutcomes,type BestPracticeExample,type BestPracticePrediction} from "./best-practice.ts";
import {explainPrediction,importance,treeDepths,type PredictionTrace,type XgbModelJson} from "./xgb-trees.ts";
import type {PilotIntent} from "@flight/protocol";
/** User-tunable XGBoost hyper-parameters for the outcome model. */
export interface OutcomeModelParams{maxDepth:number;rounds:number;eta:number;minChildWeight:number;subsample:number;colsample:number;lambda:number;seed:number}
export const DEFAULT_OUTCOME_PARAMS:OutcomeModelParams={maxDepth:4,rounds:60,eta:.2,minChildWeight:1,subsample:.9,colsample:.9,lambda:1,seed:0};
export function validateParams(p:Partial<OutcomeModelParams>):OutcomeModelParams{
 const q={...DEFAULT_OUTCOME_PARAMS,...p},int=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,Math.round(x))),num=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:a));
 return {maxDepth:int(q.maxDepth,1,12),rounds:int(q.rounds,1,500),eta:num(q.eta,.01,1),minChildWeight:num(q.minChildWeight,0,50),subsample:num(q.subsample,.3,1),colsample:num(q.colsample,.3,1),lambda:num(q.lambda,0,50),seed:int(q.seed,0,2**31-1)};
}
export interface OutcomeEvaluation{n:number;positives:number;logloss:number;auc:number;accuracy:number;brier:number}
/** Rank-based AUC (ties averaged); NaN when only one class is present. */
export function auc(scores:readonly number[],labels:readonly number[]){
 const idx=scores.map((s,i)=>[s,labels[i]!] as const).sort((a,b)=>a[0]-b[0]);let pos=0,neg=0,rankSum=0,i=0;
 while(i<idx.length){let j=i;while(j<idx.length&&idx[j]![0]===idx[i]![0])j++;const r=(i+j+1)/2;for(let k=i;k<j;k++)if(idx[k]![1]===1){rankSum+=r;pos++}else neg++;i=j}
 return pos&&neg?(rankSum-pos*(pos+1)/2)/(pos*neg):NaN;
}
export function evaluateScores(p:readonly number[],y:readonly number[]):OutcomeEvaluation{
 const n=p.length,eps=1e-7;let ll=0,acc=0,brier=0,pos=0;
 for(let i=0;i<n;i++){const q=Math.min(1-eps,Math.max(eps,p[i]!)),t=y[i]!;ll-=t*Math.log(q)+(1-t)*Math.log(1-q);acc+=(q>=.5?1:0)===t?1:0;brier+=(q-t)**2;pos+=t}
 return {n,positives:pos,logloss:n?ll/n:NaN,auc:auc(p,y),accuracy:n?acc/n:NaN,brier:n?brier/n:NaN};
}
/**
 * XGBoost outcome model P(good outcome | situation, action) with explanations. Runs anywhere @wlearn/xgboost runs
 * (Bun/Node, or a browser worker when bundled against its browser build).
 */
export class OutcomeModel{
 #booster?:Booster;#json?:XgbModelJson;featureCount=0;params:OutcomeModelParams=DEFAULT_OUTCOME_PARAMS;trainedRows=0;
 static async create(){await loadXGB();return new OutcomeModel()}
 get ready(){return !!this.#booster}
 train(examples:readonly BestPracticeExample[],params:Partial<OutcomeModelParams>={}){
  const p=validateParams(params),d=buildOutcomeDataset(examples),dm=new DMatrix(d.data,{nrow:d.rows,ncol:d.cols});
  try{dm.setLabel(d.labels);dm.setWeight(d.weights);
   const b=new Booster({objective:"binary:logistic",eval_metric:"logloss",max_depth:p.maxDepth,eta:p.eta,min_child_weight:p.minChildWeight,subsample:p.subsample,colsample_bytree:p.colsample,lambda:p.lambda,seed:p.seed,nthread:1,verbosity:0},[dm]);
   try{for(let i=0;i<p.rounds;i++)b.update(dm,i)}catch(e){b.dispose();throw e}
   this.#booster?.dispose();this.#booster=b;this.#json=JSON.parse(new TextDecoder().decode(b.saveModel("json")));this.featureCount=d.featureCount;this.params=p;this.trainedRows=d.rows;
   return {rows:d.rows,skipped:d.skipped,positives:[...d.labels].filter(x=>x===1).length};
  }finally{dm.dispose()}
 }
 #need(){if(!this.#booster||!this.#json)throw new Error("outcome model not trained");return this.#booster}
 /** P(good outcome) for each action in the given situation, ranked. */
 predictActions(features:readonly number[]):BestPracticePrediction[]{
  const b=this.#need();if(features.length!==this.featureCount)throw new Error(`expected ${this.featureCount} features, got ${features.length}`);
  const c=candidateRows(features),dm=new DMatrix(c.data,{nrow:c.rows,ncol:c.cols});try{return rankOutcomes(b.predict(dm))}finally{dm.dispose()}
 }
 /** Held-out evaluation on examples the model has not been trained on. */
 evaluate(examples:readonly BestPracticeExample[]):OutcomeEvaluation{
  const b=this.#need(),d=buildOutcomeDataset(examples.filter(x=>x.features.length===this.featureCount)),dm=new DMatrix(d.data,{nrow:d.rows,ncol:d.cols});
  try{return evaluateScores([...b.predict(dm)],[...d.labels])}finally{dm.dispose()}
 }
 /** Full trace of one (situation, action) prediction: every tree's path and additive feature contributions. */
 explain(features:readonly number[],action:PilotIntent):PredictionTrace{this.#need();return explainPrediction(this.#json!,outcomeRow(features,action))}
 importance(){this.#need();return importance(this.#json!,this.featureCount+ACTIONS.length)}
 depths(){this.#need();return treeDepths(this.#json!)}
 /** Parsed XGBoost JSON (for storing a generation's model and explaining with pure code later). */
 toJSON():XgbModelJson{this.#need();return this.#json!}
 get treeCount(){return this.#json?.learner.gradient_booster.model.trees.length??0}
 save(){return this.#need().saveModel("ubj")}
 dispose(){this.#booster?.dispose();this.#booster=undefined;this.#json=undefined}
}
