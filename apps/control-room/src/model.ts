import type { DecisionFrame, WorldSnapshot } from "@flight/protocol";
export interface InspectorFrame{
 world:WorldSnapshot;decision?:DecisionFrame;
 providerDistributions?:Record<string,Record<string,number>>;
 worldModel?:{predictedReward:number;uncertainty:number;trust:number};
}
export class InspectorTimeline{
 #frames:InspectorFrame[]=[];
 push(x:InspectorFrame){this.#frames.push(x)}
 at(i:number){return this.#frames[i]}
 get length(){return this.#frames.length}
}
