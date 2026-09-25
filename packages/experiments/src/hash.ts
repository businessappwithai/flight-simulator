const canonical=(x:unknown):string=>{
 if(x===null||typeof x!=="object")return JSON.stringify(x);
 if(Array.isArray(x))return `[${x.map(canonical).join(",")}]`;
 return `{${Object.entries(x as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};
export async function manifestHash(x:unknown):Promise<string>{
 const bytes=new TextEncoder().encode(canonical(x));const digest=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
