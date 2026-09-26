/**
 * Pure interpretation of an XGBoost JSON model (xgboost ≥ 1.0 "save_model json" format): per-decision tree paths,
 * Saabas-style additive feature contributions and split-gain importance. No WASM needed — works on parsed JSON.
 */
export interface XgbTree{left_children:number[];right_children:number[];split_indices:number[];split_conditions:number[];default_left:number[];sum_hessian:number[];loss_changes:number[]}
export interface XgbModelJson{learner:{learner_model_param:{base_score:string};gradient_booster:{model:{trees:XgbTree[]}}}}
export interface PathStep{feature:number;threshold:number;value:number;wentLeft:boolean;missing:boolean;delta:number}
export interface TreeTrace{tree:number;steps:PathStep[];leaf:number;leafValue:number;contribution:number}
export interface PredictionTrace{baseMargin:number;margin:number;probability:number;contributions:number[];trees:TreeTrace[]}
export const sigmoid=(x:number)=>1/(1+Math.exp(-x));
export const logit=(p:number)=>Math.log(p/(1-p));
/** base_score is stored as a string like "[5E-1]" or "5E-1"; for binary:logistic it is a probability. */
export function baseMargin(m:XgbModelJson){const s=m.learner.learner_model_param.base_score.replace(/[\[\]\s]/g,"");const p=Number(s.split(",")[0]);return Number.isFinite(p)&&p>0&&p<1?logit(p):0}
const isLeaf=(t:XgbTree,i:number)=>t.left_children[i]===-1;
/** Cover-weighted expected value of every node (leaves: their value; internal: hessian-weighted mean of children). */
export function nodeValues(t:XgbTree):number[]{
 const v=new Array<number>(t.left_children.length).fill(0),h=t.sum_hessian;
 const walk=(i:number):number=>{if(isLeaf(t,i))return v[i]=t.split_conditions[i]!;const l=t.left_children[i]!,r=t.right_children[i]!,a=walk(l),b=walk(r),hl=h[l]!,hr=h[r]!;return v[i]=hl+hr>0?(hl*a+hr*b)/(hl+hr):(a+b)/2};
 walk(0);return v;
}
export function traceTree(t:XgbTree,x:readonly number[],values=nodeValues(t),tree=0):TreeTrace{
 const steps:PathStep[]=[];let i=0;
 while(!isLeaf(t,i)){const f=t.split_indices[i]!,thr=t.split_conditions[i]!,val=x[f],missing=val===undefined||Number.isNaN(val);
  const left=missing?t.default_left[i]===1:val<thr,next=left?t.left_children[i]!:t.right_children[i]!;
  steps.push({feature:f,threshold:thr,value:val??NaN,wentLeft:left,missing,delta:values[next]!-values[i]!});i=next}
 return {tree,steps,leaf:i,leafValue:t.split_conditions[i]!,contribution:t.split_conditions[i]!-values[0]!};
}
export function explainPrediction(m:XgbModelJson,x:readonly number[],featureCount=x.length):PredictionTrace{
 const trees=m.learner.gradient_booster.model.trees,contributions=new Array<number>(featureCount).fill(0);let margin=baseMargin(m);const base=margin;const out:TreeTrace[]=[];
 trees.forEach((t,k)=>{const vals=nodeValues(t),tr=traceTree(t,x,vals,k);margin+=tr.leafValue;
  // Bias of each tree (its root expected value) is folded into the base; path deltas are attributed to split features.
  for(const s of tr.steps)contributions[s.feature]=(contributions[s.feature]??0)+s.delta;out.push(tr)});
 const bias=trees.reduce((a,t)=>a+nodeValues(t)[0]!,0);
 return {baseMargin:base+bias,margin,probability:sigmoid(margin),contributions,trees:out};
}
export interface FeatureImportance{feature:number;gain:number;splits:number}
export function importance(m:XgbModelJson,featureCount:number):FeatureImportance[]{
 const acc=Array.from({length:featureCount},(_,feature)=>({feature,gain:0,splits:0}));
 for(const t of m.learner.gradient_booster.model.trees)for(let i=0;i<t.left_children.length;i++)if(!isLeaf(t,i)){const a=acc[t.split_indices[i]!];if(a){a.gain+=t.loss_changes[i]!;a.splits++}}
 return acc;
}
export function treeDepths(m:XgbModelJson):number[]{return m.learner.gradient_booster.model.trees.map(t=>{const d=(i:number):number=>isLeaf(t,i)?0:1+Math.max(d(t.left_children[i]!),d(t.right_children[i]!));return d(0)})}
