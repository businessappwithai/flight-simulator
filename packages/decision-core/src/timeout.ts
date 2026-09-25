export class DecisionTimeoutError extends Error{}
export async function withTimeout<T>(work:Promise<T>,milliseconds:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new DecisionTimeoutError(`decision exceeded ${milliseconds}ms`)),milliseconds)});
 try{return await Promise.race([work,timeout])}finally{if(timer)clearTimeout(timer)}
}
