import type {PilotIntent} from "@flight/protocol";
export interface ShadowCase{recommended:PilotIntent;executed:PilotIntent;recommendedProbability:number;actualSuccess:boolean;catastrophic:boolean}
export interface ShadowSummary{cases:number;agreementRate:number;catastrophicRecommendations:number}
export function summarizeShadow(xs:readonly ShadowCase[]):ShadowSummary{
 const n=xs.length;if(!n)return {cases:0,agreementRate:0,catastrophicRecommendations:0};
 return {cases:n,agreementRate:xs.filter(x=>x.recommended===x.executed).length/n,catastrophicRecommendations:xs.filter(x=>x.catastrophic&&x.recommended===x.executed).length};
}
