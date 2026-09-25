export interface ReplayCheckpoint{tick:string;checksum:string}
export interface ReplayVerification{ok:boolean;firstMismatch?:{expected:ReplayCheckpoint;actual:ReplayCheckpoint}}
export function verifyReplay(expected:readonly ReplayCheckpoint[],actual:readonly ReplayCheckpoint[]):ReplayVerification{
 const n=Math.max(expected.length,actual.length);
 for(let i=0;i<n;i++){const e=expected[i],a=actual[i];if(!e||!a||e.tick!==a.tick||e.checksum!==a.checksum)return{ok:false,firstMismatch:{expected:e??{tick:"MISSING",checksum:""},actual:a??{tick:"MISSING",checksum:""}}}}
 return {ok:true};
}
