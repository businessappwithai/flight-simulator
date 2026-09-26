import type { DecisionContext } from "@flight/protocol";

export interface DecisionEngineIdentity {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
}

export interface DecisionRequest<T extends string> {
  readonly id: string;
  readonly context: DecisionContext;
  readonly question: string;
  readonly candidates: readonly T[];
  readonly timeoutMs: number;
}

export interface DecisionResponse<T extends string> {
  readonly requestId: string;
  readonly engine: DecisionEngineIdentity;
  readonly candidates: readonly { value: T; probability: number }[];
  readonly latencyMs: number;
}

export interface DecisionEngineHealth {
  readonly healthy: boolean;
  readonly detail?: string;
}

export interface DecisionEngine {
  readonly identity: DecisionEngineIdentity;
  decide<T extends string>(request: DecisionRequest<T>): Promise<DecisionResponse<T>>;
  health(): Promise<DecisionEngineHealth>;
}

export class ScriptedDecisionEngine implements DecisionEngine {
  readonly identity = { provider: "scripted", model: "scripted", version: "1" };
  #index = 0;
  constructor(private readonly actions: readonly string[]) {}

  async decide<T extends string>(request: DecisionRequest<T>): Promise<DecisionResponse<T>> {
    const selected = (this.actions[this.#index++] ?? request.candidates[0]) as T;
    return {
      requestId: request.id,
      engine: this.identity,
      candidates: request.candidates.map(value => ({
        value,
        probability: value === selected ? 1 : 0
      })),
      latencyMs: 0
    };
  }

  async health(): Promise<DecisionEngineHealth> { return { healthy: true }; }
}

export class OpenJevDecisionEngine implements DecisionEngine {
  readonly identity: DecisionEngineIdentity;
  constructor(
    private readonly endpoint: string,
    model: string,
    version = "unknown"
  ) {
    this.identity = { provider: "open-jev", model, version };
  }

  async decide<T extends string>(request: DecisionRequest<T>): Promise<DecisionResponse<T>> {
    const started = performance.now();
    const criteria = Object.fromEntries(request.candidates.map(c => [c, null]));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(`${this.endpoint.replace(/\/$/,"")}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          state: request.context,
          model: this.identity.model,
          questions: {
            maneuver: {
              type: "choice",
              instructions: request.question,
              criteria
            }
          }
        })
      });
      if (!response.ok) throw new Error(`Open-Jev HTTP ${response.status}`);
      const raw = await response.json() as any;
      const probs = raw?.answers?.maneuver?.probabilities ?? {};
      const candidates = request.candidates
        .map(value => ({ value, probability: Number(probs[value] ?? 0) }))
        .sort((a,b) => b.probability - a.probability);
      return {
        requestId: request.id,
        engine: this.identity,
        candidates,
        latencyMs: performance.now() - started
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<DecisionEngineHealth> {
    try {
      const response = await fetch(`${this.endpoint.replace(/\/$/,"")}/health`);
      return { healthy: response.ok, detail: `${response.status}` };
    } catch (e) {
      return { healthy: false, detail: String(e) };
    }
  }
}


export interface ShadowDecision<T extends string> {
  readonly primary: DecisionResponse<T>;
  readonly shadows: readonly PromiseSettledResult<DecisionResponse<T>>[];
}

export class DecisionEngineManager {
  constructor(
    readonly primary: DecisionEngine,
    readonly shadows: readonly DecisionEngine[] = []
  ) {}

  async decide<T extends string>(request: DecisionRequest<T>): Promise<ShadowDecision<T>> {
    const primary = await this.primary.decide(request);
    const shadows = await Promise.allSettled(
      this.shadows.map(engine => engine.decide(request))
    );
    return { primary, shadows };
  }
}

export interface ProviderComparison<T extends string> {
  readonly sameTopChoice: boolean;
  readonly primaryTop?: T;
  readonly shadowTop?: T;
  readonly probabilityDistance: number;
}

/** Highest-probability candidate; providers are not required to return candidates sorted. */
export function topCandidate<T extends string>(response: DecisionResponse<T>) {
  let best: DecisionResponse<T>["candidates"][number] | undefined;
  for (const c of response.candidates) if (!best || c.probability > best.probability) best = c;
  return best;
}

export function compareResponses<T extends string>(
  primary: DecisionResponse<T>,
  shadow: DecisionResponse<T>
): ProviderComparison<T> {
  const primaryMap = new Map(primary.candidates.map(c => [c.value, c.probability]));
  const shadowMap = new Map(shadow.candidates.map(c => [c.value, c.probability]));
  const values = new Set<T>([...primaryMap.keys(), ...shadowMap.keys()]);
  let distance = 0;
  for (const v of values) distance += Math.abs((primaryMap.get(v) ?? 0) - (shadowMap.get(v) ?? 0));
  return {
    sameTopChoice: topCandidate(primary)?.value === topCandidate(shadow)?.value,
    primaryTop: topCandidate(primary)?.value,
    shadowTop: topCandidate(shadow)?.value,
    probabilityDistance: distance / 2
  };
}

export function successfulShadows<T extends string>(bundle:ShadowDecision<T>):readonly DecisionResponse<T>[]{
 return bundle.shadows.flatMap(x=>x.status==="fulfilled"?[x.value]:[]);
}
export function disagreementScore<T extends string>(bundle:ShadowDecision<T>):number{
 const shadows=successfulShadows(bundle);if(!shadows.length)return 0;
 return shadows.reduce((a,s)=>a+compareResponses(bundle.primary,s).probabilityDistance,0)/shadows.length;
}

export { ResilientDecisionEngine } from "./resilience.ts";

export { withTimeout, DecisionTimeoutError } from "./timeout.ts";
export { RuleBasedDecisionEngine } from "./rule-based.ts";
