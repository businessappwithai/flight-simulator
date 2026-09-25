import {z} from "zod";
export const ScenarioConfigSchema=z.object({
 id:z.string().min(1),seed:z.coerce.bigint(),
 aircraftStart:z.object({x:z.number(),y:z.number().nonnegative(),z:z.number()}),
 checkpoint:z.object({x:z.number(),y:z.number().nonnegative(),z:z.number()}),
 obstacleStart:z.object({x:z.number(),y:z.number().nonnegative(),z:z.number()}),
 obstacleVelocity:z.object({x:z.number(),y:z.number(),z:z.number()})
});
export type ScenarioConfig=z.infer<typeof ScenarioConfigSchema>;
export const parseScenarioConfig=(x:unknown)=>ScenarioConfigSchema.parse(x);
