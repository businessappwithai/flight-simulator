import type {BestPracticeEvidence} from "./model-promotion.ts";
export type ModelState="CANDIDATE"|"VALIDATED"|"ACTIVE"|"REJECTED"|"RETIRED";
export interface BestPracticeModelRecord{id:string;schemaVersion:string;datasetHash:string;createdAt:string;state:ModelState;evidence?:BestPracticeEvidence}
export class BestPracticeModelRegistry{
 #models=new Map<string,BestPracticeModelRecord>();#active?:string;
 register(x:BestPracticeModelRecord){if(this.#models.has(x.id))throw new Error(`model exists: ${x.id}`);this.#models.set(x.id,Object.freeze({...x}))}
 promote(id:string,evidence:BestPracticeEvidence){const x=this.#models.get(id);if(!x)throw new Error("unknown model");if(this.#active){const old=this.#models.get(this.#active)!;this.#models.set(this.#active,Object.freeze({...old,state:"RETIRED"}))}
 this.#models.set(id,Object.freeze({...x,state:"ACTIVE",evidence}));this.#active=id}
 reject(id:string,evidence:BestPracticeEvidence){const x=this.#models.get(id);if(!x)throw new Error("unknown model");this.#models.set(id,Object.freeze({...x,state:"REJECTED",evidence}))}
 get active(){return this.#active?this.#models.get(this.#active):undefined}
 get(id:string){return this.#models.get(id)}
}
