export interface GoldenCase{scenarioId:string;seed:string;expectedChecksum?:string;tags:readonly string[]}
export class GoldenCorpus{
 #cases=new Map<string,GoldenCase>();
 add(c:GoldenCase){this.#cases.set(`${c.scenarioId}:${c.seed}`,Object.freeze({...c,tags:Object.freeze([...c.tags])}))}
 all(){return [...this.#cases.values()].sort((a,b)=>`${a.scenarioId}:${a.seed}`.localeCompare(`${b.scenarioId}:${b.seed}`))}
 byTag(tag:string){return this.all().filter(x=>x.tags.includes(tag))}
}
