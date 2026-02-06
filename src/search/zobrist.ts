/**
 * Zobrist hashing for Diplomacy game states.
 *
 * Uses precomputed random 64-bit values (stored as bigint) for:
 * - Each (unit type, power, province, coast) combination
 * - Season/phase encoding
 * - Supply center ownership
 *
 * The hash of a position is the XOR of all applicable Zobrist keys.
 * This enables incremental updates when making/unmaking moves.
 */
import { GameState, Power, UnitType, Coast, ALL_POWERS } from '../core/types';
import { PROVINCES } from '../core/mapData';

const UNIT_TYPES: UnitType[] = ['Army', 'Fleet'];
const COASTS: (Coast)[] = [null, 'nc', 'sc', 'ec', 'wc'];
const PROVINCES_LIST = Array.from(PROVINCES.keys());

// Pre-generate random bigints deterministically from a seed
function generateZobristKeys(seed: number): Map<string, bigint> {
  const keys = new Map<string, bigint>();

  // Simple deterministic bigint generator using linear congruential
  let state = BigInt(seed) | 1n;
  const next = (): bigint => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return state;
  };

  // Unit keys: unitType_power_province_coast
  for (const unitType of UNIT_TYPES) {
    for (const power of ALL_POWERS) {
      for (const province of PROVINCES_LIST) {
        for (const coast of COASTS) {
          const key = `unit_${unitType}_${power}_${province}_${coast}`;
          keys.set(key, next());
        }
      }
    }
  }

  // Supply center ownership keys: sc_province_power
  for (const province of PROVINCES_LIST) {
    for (const power of ALL_POWERS) {
      keys.set(`sc_${province}_${power}`, next());
    }
  }

  // Turn info keys
  for (const season of ['Spring', 'Fall']) {
    for (const phase of ['Diplomacy', 'Retreat', 'Build']) {
      for (let year = 1901; year <= 2000; year++) {
        keys.set(`turn_${year}_${season}_${phase}`, next());
      }
    }
  }

  return keys;
}

// Singleton Zobrist keys instance
const ZOBRIST_KEYS = generateZobristKeys(0xDEAD_BEEF);

/**
 * Compute the Zobrist hash for a complete game state.
 */
export function zobristHash(state: GameState): bigint {
  let hash = 0n;

  // Hash units
  for (const unit of state.units) {
    const key = `unit_${unit.type}_${unit.power}_${unit.location.provinceId}_${unit.location.coast}`;
    const val = ZOBRIST_KEYS.get(key);
    if (val !== undefined) {
      hash ^= val;
    }
  }

  // Hash supply centers
  for (const [province, power] of state.supplyCenters) {
    const key = `sc_${province}_${power}`;
    const val = ZOBRIST_KEYS.get(key);
    if (val !== undefined) {
      hash ^= val;
    }
  }

  // Hash turn info
  const turnKey = `turn_${state.turn.year}_${state.turn.season}_${state.turn.phase}`;
  const turnVal = ZOBRIST_KEYS.get(turnKey);
  if (turnVal !== undefined) {
    hash ^= turnVal;
  }

  return hash;
}

/**
 * Get the Zobrist key for a specific unit placement.
 * Used for incremental hash updates.
 */
export function getUnitKey(
  unitType: UnitType,
  power: Power,
  provinceId: string,
  coast: Coast
): bigint {
  const key = `unit_${unitType}_${power}_${provinceId}_${coast}`;
  return ZOBRIST_KEYS.get(key) ?? 0n;
}

/**
 * Get the Zobrist key for a supply center ownership.
 */
export function getSCKey(provinceId: string, power: Power): bigint {
  return ZOBRIST_KEYS.get(`sc_${provinceId}_${power}`) ?? 0n;
}
