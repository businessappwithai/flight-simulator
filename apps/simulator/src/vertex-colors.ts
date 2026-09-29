/**
 * Vertex colours arrive from the worker as sRGB bytes; three.js lights and blends vertex colours in linear space, so
 * used as-is they wash out (sea, fields and rock all drift towards white). Convert once per patch.
 */
const SRGB_TO_LINEAR=Float32Array.from({length:256},(_,i)=>{const c=i/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});
export function linearColors(bytes:Uint8Array):Float32Array{const out=new Float32Array(bytes.length);for(let i=0;i<bytes.length;i++)out[i]=SRGB_TO_LINEAR[bytes[i]!]!;return out}
