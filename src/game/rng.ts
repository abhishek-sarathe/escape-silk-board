// Deterministic randomness: the same seed + turn always produces the same city.
// That keeps the game fair (no re-rolling by retrying) and replayable ("same evening again").

export type Rng = () => number;

function hashString(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(seed: number, ...salt: (string | number)[]): Rng {
  return mulberry32(hashString(`${seed}:${salt.join(":")}`));
}

export function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
