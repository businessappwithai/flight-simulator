import type {PilotIntent} from "./index.ts";
/** Learning Lab: repeated generations of flights; the XGBoost outcome model retrains between generations. */
export interface LabModelParams{maxDepth:number;rounds:number;eta:number;minChildWeight:number;subsample:number;colsample:number;lambda:number}
export interface LabConfig{
 generations:number;episodesPerGeneration:number;maxSeconds:number;scenario:"seeded"|"default";seed:number;decisionIntervalTicks:number;
 /** Decision provider. "local-rules" is a transparent stand-in when no Jev/Open-Jev endpoint is available. */
 provider:{kind:"local-rules"|"open-jev";temperature:number;endpoint?:string;model?:string};
 /** How much the XGBoost outcome model steers decisions: 0 = shadow (advice recorded only), 1 = fully decides. */
 advisor:{weight:number;schedule:"fixed"|"ramp";selection:"argmax"|"sample";explorationTemperature:number};
 model:LabModelParams;
 /** Max training examples kept (most recent). */
 bufferSize:number;
 /** Horizon at which a decision's outcome is judged. */
 horizon:"1S"|"3S";
}
export interface LabEvaluation{n:number;positives:number;logloss:number;auc:number;accuracy:number;brier:number}
export interface LabMetrics{gateRate:number;landRate:number;crashRate:number;collisionRate:number;overrideRate:number;advisorChangeRate:number;goodDecisionRate:number;meanReward:number;meanSeconds:number;meanGateDistance:number;
 /** Mean (max − min) of the advisor's P(success) across actions: near 0 = it only rates the situation, not the choice. */
 advisorSpread:number}
export interface LabEpisodeSummary{generation:number;episode:number;seed:number;scenarioId:string;phase:string;gateReached:boolean;landed:boolean;crashed:boolean;collision:boolean;seconds:number;decisions:number;overrides:number;advisorChanges:number;explored:number;goodDecisionRate:number;meanReward:number;closestGate:number}
export interface LabImportance{name:string;gain:number;splits:number}
export interface LabTraining{rows:number;positives:number;trainEval:LabEvaluation;params:LabModelParams;trees:number;maxDepthReached:number;importance:LabImportance[];ms:number}
export interface LabGenerationSummary{generation:number;advisorWeight:number;
 /** Generation whose training produced the model used while flying this generation (null = no model yet). */
 modelFrom:number|null;episodes:LabEpisodeSummary[];metrics:LabMetrics;
 /** The model used in this generation, scored on this generation's (unseen) decisions before retraining. */
 holdout?:LabEvaluation;
 /** Model trained after this generation (used by the next one). */
 training?:LabTraining}
export interface LabTrackPoint{t:number;x:number;y:number;z:number;heading:number;roll:number;speed:number}
export interface LabDecision{id:string;t:number;x:number;y:number;z:number;requested:PilotIntent;executed:PilotIntent;
 provider:readonly {intent:PilotIntent;probability:number}[];advisor?:readonly {action:PilotIntent;probability:number}[];
 blended?:readonly {intent:PilotIntent;blended:number}[];providerTop:PilotIntent;changedByAdvisor:boolean;explored:boolean;
 safetyReason?:string;features:readonly number[];label?:0|1;reward?:number;progress?:number}
export interface LabEpisodeDetail{generation:number;episode:number;summary:LabEpisodeSummary;
 scenario:{checkpoint:{x:number;y:number;z:number};gateRadius:number;obstacleRadius:number;runway:{x:number;z:number}};
 track:readonly LabTrackPoint[];obstacleTrack:readonly {t:number;x:number;y:number;z:number}[];decisions:readonly LabDecision[]}
export interface LabTreeStep{feature:string;threshold:number;value:number;wentLeft:boolean;missing:boolean;delta:number}
export interface LabExplanation{generation:number;episode:number;decisionId:string;action:PilotIntent;modelFrom:number;
 baseMargin:number;margin:number;probability:number;contributions:readonly {name:string;value:number;input:number}[];
 trees:readonly {tree:number;steps:readonly LabTreeStep[];leafValue:number;contribution:number}[];maxDepth:number}
export type LabCommand=
 |{type:"START";config:LabConfig}
 |{type:"STOP"}
 |{type:"EPISODE";generation:number;episode:number}
 |{type:"EXPLAIN";generation:number;episode:number;decisionId:string;action:PilotIntent;model:"then"|"latest"};
export type LabEvent=
 |{type:"STARTED";config:LabConfig;featureNames:readonly string[]}
 |{type:"PROGRESS";generation:number;episode:number;generations:number;episodes:number;phase:"flying"|"training"}
 |{type:"GENERATION";summary:LabGenerationSummary}
 |{type:"EPISODE_DETAIL";detail:LabEpisodeDetail}
 |{type:"EXPLANATION";explanation:LabExplanation}
 |{type:"DONE";stopped:boolean}
 |{type:"ERROR";message:string};
