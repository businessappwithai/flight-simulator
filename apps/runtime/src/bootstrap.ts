import {parseFlightConfig,type FlightConfig} from "@flight/config";
export interface ProviderBindings{
 jev?:unknown;openJev?:unknown;scripted?:unknown;
}
export interface BootPlan{config:FlightConfig;requiredBindings:readonly string[]}
export function createBootPlan(raw:unknown):BootPlan{
 const config=parseFlightConfig(raw),required=[config.decision.primary.provider];
 if(config.decision.mode==="SHADOW"&&config.decision.shadow)required.push(config.decision.shadow.provider);
 return {config,requiredBindings:[...new Set(required)]};
}
