export interface RuntimeBudgets{physicsMs:number;sensorsMs:number;controllerMs:number;decisionMs:number;renderMs:number}
export const DEFAULT_BUDGETS:RuntimeBudgets={physicsMs:4,sensorsMs:8,controllerMs:8,decisionMs:250,renderMs:16.7};
export interface TimingSample{subsystem:keyof RuntimeBudgets;milliseconds:number}
export function budgetViolations(samples:readonly TimingSample[],b:RuntimeBudgets=DEFAULT_BUDGETS){
 return samples.filter(x=>x.milliseconds>b[x.subsystem]);
}
