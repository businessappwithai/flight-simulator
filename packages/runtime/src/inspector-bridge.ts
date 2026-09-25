import type { RuntimeEvent, RuntimeEventBus } from "./telemetry.ts";
export interface InspectorTransport{send(event:RuntimeEvent):void}
export class InspectorBridge{
 #off:()=>void;
 constructor(bus:RuntimeEventBus,transport:InspectorTransport){this.#off=bus.subscribe(e=>transport.send(e))}
 close(){this.#off()}
}
