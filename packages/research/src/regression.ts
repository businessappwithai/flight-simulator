export interface RegressionCase{id:string;scenarioId:string;seed:string;reason:string;sourceFailureId?:string;sourceSkillId?:string}
export class RegressionSuite{
 #cases=new Map<string,RegressionCase>();
 add(c:RegressionCase){this.#cases.set(c.id,c)}
 all(){return [...this.#cases.values()].sort((a,b)=>a.id.localeCompare(b.id))}
 addFailure(id:string,scenarioId:string,seed:bigint){this.add({id:`failure:${id}`,scenarioId,seed:seed.toString(),reason:"FAILURE",sourceFailureId:id})}
 addSkillBoundary(skillId:string,scenarioId:string,seed:bigint){this.add({id:`skill:${skillId}:${seed}`,scenarioId,seed:seed.toString(),reason:"SKILL_BOUNDARY",sourceSkillId:skillId})}
}
