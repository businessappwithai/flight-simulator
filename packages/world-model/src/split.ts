function hashSeed(seed:string){let h=2166136261;for(const c of seed){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
export type DatasetSplit="TRAIN"|"VALIDATION"|"TEST";
export function splitScenarioSeed(seed:string):DatasetSplit{
 const x=hashSeed(seed)%100;return x<80?"TRAIN":x<90?"VALIDATION":"TEST";
}
