import type {TrustCell} from "./trust-map.ts";
export type WorldModelAuthority="SHADOW"|"ADVISORY"|"ACTIVE";
export interface AuthorityEvidence{cells:readonly TrustCell[];hardRegressions:number;shadowEpisodes:number}
export function allowedAuthority(e:AuthorityEvidence):WorldModelAuthority{
 if(e.hardRegressions>0||e.shadowEpisodes<100)return "SHADOW";
 const trusted=e.cells.length>0&&e.cells.every(c=>c.samples>=50&&c.trust>=.8);
 if(!trusted)return "SHADOW";
 if(e.shadowEpisodes<1000)return "ADVISORY";
 return "ACTIVE";
}
