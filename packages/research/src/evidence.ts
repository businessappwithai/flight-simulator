import type {ReleaseEvidence,GateDecision} from "./lifecycle.ts";
export interface EvidenceRecord{pilotId:string;baselinePilotId:string;experimentId:string;evidence:ReleaseEvidence;decision:GateDecision;recordedAt:string}
export class EvidenceArchive{
 #records:EvidenceRecord[]=[];
 append(x:EvidenceRecord){this.#records.push(Object.freeze({...x,evidence:Object.freeze({...x.evidence})}))}
 forPilot(id:string){return this.#records.filter(x=>x.pilotId===id)}
 all(){return [...this.#records]}
}
