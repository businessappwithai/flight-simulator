import type {DashboardMetrics,DecisionWhy} from "./live-dashboard.ts";
import type {DashboardAlert} from "./alerts.ts";
export interface DiagnosticSnapshot{schemaVersion:1;capturedAt:string;metrics:DashboardMetrics;latest?:DecisionWhy;alerts:readonly DashboardAlert[];telemetryHealthy:boolean}
export function diagnosticSnapshot(metrics:DashboardMetrics,alerts:readonly DashboardAlert[],telemetryHealthy:boolean,latest?:DecisionWhy):DiagnosticSnapshot{
 return {schemaVersion:1,capturedAt:new Date().toISOString(),metrics,latest,alerts,telemetryHealthy};
}
