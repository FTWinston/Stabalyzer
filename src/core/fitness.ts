/**
 * Fitness evaluation for Diplomacy game states.
 *
 * Formula: fitness = supply_centers * 1000 + units
 *
 * Terminal wins:
 *   - 18 SC → maximal fitness (999999) for winner
 *   - Alternative win: all non-coalition players eliminated, no one has 18 SC
 */
import {
  GameState,
  Coalition,
  FitnessResult,
  Power,
  Priority,
  FITNESS_SC_WEIGHT,
  FITNESS_UNIT_WEIGHT,
  FITNESS_WIN_SCORE,
  WIN_SC_THRESHOLD,
  ALL_POWERS,
} from './types';

/**
 * Calculate fitness for a coalition given a game state.
 *
 * fitness = supply_centers * 1000 + units + priority_adjustments
 *
 * Priority adjustments:
 *   - 'deny' priority: if the specified power has a unit in the province,
 *     subtract FITNESS_SC_WEIGHT (equivalent to losing a supply center).
 *   - 'allow' priority: if the specified power has a unit in the province,
 *     add FITNESS_SC_WEIGHT (equivalent to gaining a supply center).
 *
 * @param state - Current game state
 * @param coalition - The coalition to evaluate for
 * @param priorities - Optional priority constraints
 * @returns FitnessResult with score breakdown
 */
export function calculateFitness(
  state: GameState,
  coalition: Coalition,
  priorities?: readonly Priority[],
): FitnessResult {
  // Check for domination win (any single player with 18+ SC)
  const scCounts = new Map<Power, number>();
  for (const power of state.supplyCenters.values()) {
    scCounts.set(power, (scCounts.get(power) ?? 0) + 1);
  }

  // Check domination: any single player hits 18 SC
  for (const [power, count] of scCounts) {
    if (count >= WIN_SC_THRESHOLD) {
      const isCoalitionMember = coalition.powers.includes(power);
      return {
        supplyCenters: count,
        units: state.units.filter(u => u.power === power).length,
        score: isCoalitionMember ? FITNESS_WIN_SCORE : 0,
        isWin: true,
        winType: 'domination',
      };
    }
  }

  // Check alternative win: all non-coalition players eliminated
  const opposingPowers = ALL_POWERS.filter(p => !coalition.powers.includes(p));
  const opposingAlive = opposingPowers.some(p => {
    const hasUnits = state.units.some(u => u.power === p);
    const hasSC = scCounts.has(p) && (scCounts.get(p)! > 0);
    return hasUnits || hasSC;
  });

  if (!opposingAlive && opposingPowers.length > 0) {
    const coalitionSC = coalition.powers.reduce(
      (sum, p) => sum + (scCounts.get(p) ?? 0), 0
    );
    const coalitionUnits = state.units.filter(
      u => coalition.powers.includes(u.power)
    ).length;
    return {
      supplyCenters: coalitionSC,
      units: coalitionUnits,
      score: FITNESS_WIN_SCORE,
      isWin: true,
      winType: 'elimination',
    };
  }

  // Normal evaluation
  const coalitionSC = coalition.powers.reduce(
    (sum, p) => sum + (scCounts.get(p) ?? 0), 0
  );
  const coalitionUnits = state.units.filter(
    u => coalition.powers.includes(u.power)
  ).length;

  let score = coalitionSC * FITNESS_SC_WEIGHT + coalitionUnits * FITNESS_UNIT_WEIGHT;

  // Apply priority adjustments
  if (priorities) {
    for (const priority of priorities) {
      const unitInProvince = state.units.some(
        u => u.power === priority.power && u.location.provinceId === priority.provinceId
      );
      if (unitInProvince) {
        if (priority.action === 'deny') {
          score -= FITNESS_SC_WEIGHT;
        } else if (priority.action === 'allow') {
          score += FITNESS_SC_WEIGHT;
        }
      }
    }
  }

  return {
    supplyCenters: coalitionSC,
    units: coalitionUnits,
    score,
    isWin: false,
  };
}

/**
 * Check if a terminal win condition is reached.
 * @returns The winning Power or null
 */
export function checkWinCondition(state: GameState): { winner: Power | null; type: 'domination' | 'elimination' | null } {
  const scCounts = new Map<Power, number>();
  for (const power of state.supplyCenters.values()) {
    scCounts.set(power, (scCounts.get(power) ?? 0) + 1);
  }

  // Domination check
  for (const [power, count] of scCounts) {
    if (count >= WIN_SC_THRESHOLD) {
      return { winner: power, type: 'domination' };
    }
  }

  // Elimination check: only one power alive
  const alivePowers = ALL_POWERS.filter(p => {
    const hasUnits = state.units.some(u => u.power === p);
    const hasSC = scCounts.has(p) && (scCounts.get(p)! > 0);
    return hasUnits || hasSC;
  });

  if (alivePowers.length === 1) {
    return { winner: alivePowers[0], type: 'elimination' };
  }

  return { winner: null, type: null };
}
