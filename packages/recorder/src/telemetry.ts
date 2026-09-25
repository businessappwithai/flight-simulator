export class JsonlTelemetryRecorder<T>{
 #lines:string[]=[];
 record(event:T){this.#lines.push(JSON.stringify(event,(_,v)=>typeof v==="bigint"?v.toString():v))}
 text(){return this.#lines.join("\n")+(this.#lines.length?"\n":"")}
 async save(path:string){await Bun.write(path,this.text())}
}
