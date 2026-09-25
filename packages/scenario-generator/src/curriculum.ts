export type CurriculumLevel="C0_STRAIGHT"|"C1_ALTITUDE"|"C2_NAVIGATION"|"C3_STATIC_OBSTACLE"|"C4_MOVING_OBSTACLE"|"C5_TERRAIN"|"C6_TRAFFIC"|"C7_WEATHER"|"C8_GAME_HAZARDS"|"C9_COMPOSITE"|"C10_SENSOR_UNCERTAINTY"|"C11_COMBINED";
export interface CurriculumResult{level:CurriculumLevel;episodes:number;completionRate:number;hardFailures:number}
export function nextCurriculumLevel(history:readonly CurriculumResult[]):CurriculumLevel{
 const levels:CurriculumLevel[]=["C0_STRAIGHT","C1_ALTITUDE","C2_NAVIGATION","C3_STATIC_OBSTACLE","C4_MOVING_OBSTACLE","C5_TERRAIN","C6_TRAFFIC","C7_WEATHER","C8_GAME_HAZARDS","C9_COMPOSITE","C10_SENSOR_UNCERTAINTY","C11_COMBINED"];
 const last=history.at(-1);if(!last)return levels[0]!;
 const i=levels.indexOf(last.level);
 return last.episodes>=100&&last.completionRate>=.95&&last.hardFailures===0?levels[Math.min(i+1,levels.length-1)]!:last.level;
}
