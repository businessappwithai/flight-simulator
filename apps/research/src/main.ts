import { prioritizeResearch, standardAblations } from "@flight/research";
const signals=prioritizeResearch([
 {id:"provider-disagreement",severity:.8,novelty:.6,uncertainty:.7,providerDisagreement:.9,worldModelError:.2,estimatedCost:.3},
 {id:"world-model-error",severity:.7,novelty:.8,uncertainty:.8,providerDisagreement:.2,worldModelError:.9,estimatedCost:.5}
]);
const ablations=standardAblations({temporalMemory:true,experience:true,worldModel:true,skills:true,provider:"open-jev"});
console.log(JSON.stringify({nextResearch:signals,ablations},null,2));
