export type PilotStatus="CANDIDATE"|"SHADOW"|"ACTIVE"|"REJECTED"|"RETIRED";
export interface PilotManifest{
 id:string;parentId?:string;status:PilotStatus;decisionProvider:string;decisionModel:string;
 temporalStrategy:string;experienceVersion:string;worldModelVersion?:string;skills:readonly string[];
 controllerVersion:string;safetyVersion:string;rewardVersion:string;createdAt:string;
}
export class PilotRegistry{
 #items=new Map<string,PilotManifest>();#active?:string;
 add(p:PilotManifest){if(this.#items.has(p.id))throw new Error(`pilot exists: ${p.id}`);this.#items.set(p.id,Object.freeze({...p,skills:Object.freeze([...p.skills])}))}
 activate(id:string){const p=this.#items.get(id);if(!p)throw new Error("unknown pilot");if(this.#active){const old=this.#items.get(this.#active)!;this.#items.set(old.id,{...old,status:"RETIRED"})}this.#items.set(id,{...p,status:"ACTIVE"});this.#active=id}
 get active(){return this.#active?this.#items.get(this.#active):undefined}
 get(id:string){return this.#items.get(id)}
}
