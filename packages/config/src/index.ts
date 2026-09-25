import {z} from "zod";
export const FlightConfigSchema=z.object({
 decision:z.object({
  mode:z.enum(["SINGLE","SHADOW"]).default("SINGLE"),
  primary:z.object({provider:z.enum(["jev","open-jev","scripted"]),model:z.string()}),
  shadow:z.object({provider:z.enum(["jev","open-jev"]),model:z.string()}).optional(),
  timeoutMs:z.number().int().positive().default(250)
 }),
 worldModel:z.object({authority:z.enum(["SHADOW","ADVISORY","ACTIVE"]).default("SHADOW"),endpoint:z.string().url().optional()}).default({authority:"SHADOW"}),
 runtime:z.object({decisionIntervalTicks:z.number().int().positive().default(30),maxEpisodeTicks:z.number().int().positive().default(7200)}).default({})
});
export type FlightConfig=z.infer<typeof FlightConfigSchema>;
export const parseFlightConfig=(x:unknown)=>FlightConfigSchema.parse(x);
