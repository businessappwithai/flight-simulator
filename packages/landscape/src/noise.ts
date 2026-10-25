/**
 * Integer-hash noise for the landscape. Only +, −, ×, ÷, floor and Math.imul are used, so every engine (Bun's JSC in
 * tests, V8 in the browser worker) computes bit-identical heights: the physics ground is built from these numbers.
 */
export function hash32(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Uniform in [0, 1). */
export const hashFloat = (a: number, b: number, seed: number) => hash32(a, b, seed) / 4294967296;

/** Value noise in [0, 1] with quintic interpolation (continuous slope, no lattice creases). */
export function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hashFloat(xi, zi, seed), b = hashFloat(xi + 1, zi, seed), c = hashFloat(xi, zi + 1, seed), d = hashFloat(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Twelve gradient directions (unit vectors as exact constants: no trigonometry at run time).
const S = Math.SQRT1_2, C30 = 0.8660254037844386;
const GX = new Float64Array([1, -1, 0, 0, S, -S, S, -S, C30, -C30, 0.5, -0.5]);
const GZ = new Float64Array([0, 0, 1, -1, S, S, -S, -S, 0.5, 0.5, -C30, -C30]);
/** Gradient (Perlin) noise, roughly in [-0.7, 0.7]: no lattice-aligned creases, unlike value noise. */
export function gradientNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const g00 = hash32(xi, zi, seed) % 12, g10 = hash32(xi + 1, zi, seed) % 12, g01 = hash32(xi, zi + 1, seed) % 12, g11 = hash32(xi + 1, zi + 1, seed) % 12;
  const n00 = GX[g00]! * fx + GZ[g00]! * fz, n10 = GX[g10]! * (fx - 1) + GZ[g10]! * fz;
  const n01 = GX[g01]! * fx + GZ[g01]! * (fz - 1), n11 = GX[g11]! * (fx - 1) + GZ[g11]! * (fz - 1);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}

/**
 * Ridged noise in [0, 1]: sharp crests where gradient noise crosses zero. The domain is turned by an exact rational
 * rotation (3-4-5) so crests from different octaves never line up with each other or the grid.
 */
export function ridged(x: number, z: number, seed: number): number {
  const rx = 0.8 * x - 0.6 * z, rz = 0.6 * x + 0.8 * z;
  const n = 1 - Math.abs(gradientNoise(rx, rz, seed) * 1.5);
  const r = n < 0 ? 0 : n;
  return r * r;
}

/** Fractal sum of value noise, normalised to [0, 1]. */
export function fbm(x: number, z: number, seed: number, octaves = 5): number {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += amp * valueNoise(x * f, z * f, seed + i * 1013);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
