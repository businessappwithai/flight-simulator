// Minimal surface of @wlearn/xgboost used by xgboost.worker.ts (the package ships no typings).
declare module "@wlearn/xgboost" {
 export class XGBModel {
  static create(params: Record<string, unknown>): Promise<XGBModel>;
  static load(bytes: Uint8Array): Promise<XGBModel>;
  fit(X: number[][], y: number[], opts?: { sampleWeight?: number[] }): void;
  predictProba(X: number[][]): ArrayLike<number>;
  save(): Uint8Array;
  dispose(): void;
 }
}
