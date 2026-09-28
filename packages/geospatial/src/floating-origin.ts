import { type Enu, type GeoPosition, enuToGeodetic, geodeticToEnu } from "./geodesy.ts";

/** Local coordinates for the renderer: x = east, y = up, z = −north (Three.js right-handed, y-up). */
export interface LocalVector { x: number; y: number; z: number }
export interface RebaseResult { rebased: boolean; epoch: number; origin: GeoPosition }

/**
 * Moving local tangent plane. The authoritative position stays in WGS84 doubles; the renderer only ever sees
 * `position − origin`, which stays small because the origin follows the aircraft once it is `rebaseDistanceM` away.
 * That keeps float32 GPU coordinates precise anywhere on Earth (no jitter over the Himalayas 2,000 km from home).
 */
export class FloatingOrigin {
  #origin: GeoPosition;
  #epoch = 0;
  constructor(origin: GeoPosition, readonly rebaseDistanceM = 5000) { this.#origin = { lat: origin.lat, lon: origin.lon, altMsl: 0 }; }
  get origin(): GeoPosition { return this.#origin; }
  /** Increments on every rebase, so consumers can tell which frame a cached local vector belongs to. */
  get epoch() { return this.#epoch; }

  toEnu(p: GeoPosition): Enu { return geodeticToEnu(p, this.#origin); }
  fromEnu(v: Enu): GeoPosition { return enuToGeodetic(v, this.#origin); }
  toLocal(p: GeoPosition): LocalVector { const v = this.toEnu(p); return { x: v.east, y: v.up, z: -v.north }; }
  fromLocal(v: LocalVector): GeoPosition { return this.fromEnu({ east: v.x, north: -v.z, up: v.y }); }

  /** Re-centre on the aircraft if it has drifted beyond the rebase distance (horizontal ENU distance). */
  update(aircraft: GeoPosition): RebaseResult {
    const v = this.toEnu(aircraft);
    if (Math.hypot(v.east, v.north) > this.rebaseDistanceM) {
      this.#origin = { lat: aircraft.lat, lon: aircraft.lon, altMsl: 0 };
      this.#epoch++;
      return { rebased: true, epoch: this.#epoch, origin: this.#origin };
    }
    return { rebased: false, epoch: this.#epoch, origin: this.#origin };
  }
}
