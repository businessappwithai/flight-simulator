export interface ReleaseArtifact{
 path:string;sha256:string;kind:"PILOT"|"BENCHMARK"|"DATASET"|"SKILL"|"REGRESSION"|"CONFIG";
}
export interface ReleaseManifest{
 releaseId:string;pilotId:string;createdAt:string;artifacts:readonly ReleaseArtifact[];
}
export function validateReleaseManifest(m:ReleaseManifest):readonly string[]{
 const e:string[]=[];if(!m.releaseId)e.push("releaseId");if(!m.pilotId)e.push("pilotId");
 const paths=new Set<string>();for(const a of m.artifacts){if(paths.has(a.path))e.push(`duplicate:${a.path}`);paths.add(a.path);if(!/^[a-f0-9]{64}$/.test(a.sha256))e.push(`sha256:${a.path}`)}
 return e;
}
