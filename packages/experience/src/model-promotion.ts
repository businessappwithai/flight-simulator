export interface BestPracticeEvidence{validationExamples:number;accuracy:number;baselineAccuracy:number;hardRegressions:number;catastrophicFalsePositiveRate:number}
export function promoteBestPracticeModel(e:BestPracticeEvidence){
 return e.validationExamples>=1000&&e.hardRegressions===0&&e.accuracy>=e.baselineAccuracy&&e.catastrophicFalsePositiveRate===0;
}
