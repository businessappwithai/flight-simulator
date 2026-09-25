export function benchmarkSeeds(count:number,start=1n):readonly bigint[]{
 if(!Number.isInteger(count)||count<1)throw new Error("count must be positive integer");
 return Array.from({length:count},(_,i)=>start+BigInt(i));
}
export function partitionSeeds(xs:readonly bigint[],shards:number,index:number):readonly bigint[]{
 if(shards<1||index<0||index>=shards)throw new Error("invalid shard");
 return xs.filter((_,i)=>i%shards===index);
}
