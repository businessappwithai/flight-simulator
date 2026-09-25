import type {DashboardMetrics,DecisionWhy} from "./live-dashboard.ts";
export type AlertSeverity="INFO"|"WARNING"|"CRITICAL";
export interface DashboardAlert{id:string;severity:AlertSeverity;message:string}
export function dashboardAlerts(m:DashboardMetrics,d?:DecisionWhy):DashboardAlert[]{
 const a:DashboardAlert[]=[];
 if(m.decisions>=10&&m.overrideRate>.25)a.push({id:"override-rate",severity:"CRITICAL",message:`Safety override rate ${(m.overrideRate*100).toFixed(1)}%`});
 if(m.decisions>=10&&m.meanConfidence<.45)a.push({id:"low-confidence",severity:"WARNING",message:`Mean decision confidence ${(m.meanConfidence*100).toFixed(1)}%`});
 if(d&&d.disagreement>.5)a.push({id:"provider-disagreement",severity:"WARNING",message:`High provider disagreement ${d.disagreement.toFixed(3)}`});
 return a;
}
