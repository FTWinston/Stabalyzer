/**
 * Seeded pseudo-random number generator for deterministic MCTS.
 * Uses xoshiro128** algorithm for good distribution and speed.
 */
export class SeededRandom {
  private s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    // Initialize state from seed using SplitMix32
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      s = (s + 0x9e3779b9) >>> 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      this.s[i] = t >>> 0;
    }
    // Ensure non-zero state
    if (this.s[0] === 0 && this.s[1] === 0 && this.s[2] === 0 && this.s[3] === 0) {
      this.s[0] = 1;
    }
  }

  /**
   * Returns a random float in [0, 1).
   */
  random(): number {
    const result = this.rotl(Math.imul(this.s[1], 5), 7);
    const t = this.s[1] << 9;

    this.s[2] ^= this.s[0];
    this.s[3] ^= this.s[1];
    this.s[1] ^= this.s[2];
    this.s[0] ^= this.s[3];
    this.s[2] ^= t;
    this.s[3] = this.rotl(this.s[3], 11);

    return (result >>> 0) / 0x100000000;
  }

  /**
   * Returns a random integer in [0, max).
   */
  randomInt(max: number): number {
    return Math.floor(this.random() * max);
  }

  /**
   * Fisher-Yates shuffle using this PRNG.
   */
  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.randomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Choose a random element from an array.
   */
  choice<T>(arr: readonly T[]): T {
    return arr[this.randomInt(arr.length)];
  }

  private rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }
}
