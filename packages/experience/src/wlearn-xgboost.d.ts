// Minimal surface of @wlearn/xgboost used by xgboost.worker.ts (the package ships no typings).
declare module "@wlearn/xgboost" {
 export function loadXGB(): Promise<unknown>;
 export class DMatrix {
  constructor(data: Float32Array | number[][], opts?: { nrow?: number; ncol?: number; missing?: number });
  setLabel(labels: Float32Array | number[]): void;
  setWeight(weights: Float32Array | number[]): void;
  dispose(): void;
 }
 export class Booster {
  constructor(params: Record<string, unknown>, cache?: DMatrix[]);
  update(dtrain: DMatrix, iteration: number): void;
  predict(dtest: DMatrix): Float32Array;
  saveModel(format?: "ubj" | "json"): Uint8Array;
  static loadModel(bytes: Uint8Array): Booster;
  dispose(): void;
 }
 export class XGBModel {
  static create(params: Record<string, unknown>): Promise<XGBModel>;
  static load(bytes: Uint8Array): Promise<XGBModel>;
  fit(X: number[][], y: number[]): void;
  predictProba(X: number[][]): ArrayLike<number>;
  save(): Uint8Array;
  dispose(): void;
 }
}
