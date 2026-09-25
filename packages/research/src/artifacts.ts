export interface ArtifactRef {sha256:string;bytes:number;}
export async function sha256(data:Uint8Array):Promise<string>{
 const d=await crypto.subtle.digest("SHA-256",data as Uint8Array<ArrayBuffer>);
 return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function writeArtifact(root:string,data:Uint8Array):Promise<ArtifactRef>{
 const hash=await sha256(data); const dir=`${root}/${hash.slice(0,2)}`;
 await Bun.write(`${dir}/${hash}`,data);
 return {sha256:hash,bytes:data.byteLength};
}
