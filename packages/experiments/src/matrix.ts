import type { TemporalStrategyName } from "@flight/protocol";
export type ProviderName="jev"|"open-jev";
export const providerMemoryMatrix=()=> {
 const providers:ProviderName[]=["jev","open-jev"];
 const strategies:TemporalStrategyName[]=["NONE","PREVIOUS","SEQUENCE","OUTCOME_AWARE","SHUFFLED"];
 return providers.flatMap(provider=>strategies.map(temporalStrategy=>({id:`${provider}__${temporalStrategy.toLowerCase()}`,provider,temporalStrategy})));
};
