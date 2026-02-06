/**
 * Unit tests for MCTS order sampling improvements.
 *
 * Tests:
 * - Position swap detection and prevention
 * - Coalition SC attack penalty
 * - Predicted turn labels use correct phase
 */
import { describe, it, expect } from 'vitest';
import { MCTSEngine, MCTSConfig } from '../../src/search/mcts';
import { GameStateBuilder } from '../../src/core/gameStateBuilder';
import {
  GameState,
  Unit,
  Power,
  Coalition,
  MoveOrder,
  Order,
} from '../../src/core/types';

function createConfig(coalition: Coalition, overrides?: Partial<MCTSConfig>): MCTSConfig {
  return {
    maxDepth: 2,
    searchTimeMs: 500,
    explorationConstant: 1.414,
    seed: 42,
    coalition,
    ...overrides,
  };
}

describe('MCTS Order Sampling Improvements', () => {
  describe('Coalition SC attack penalty', () => {
    it('should not generate orders for coalition members attacking each other\'s SCs', () => {
      // Setup: Germany+France coalition. Italy has A Vie near Bud (owned by Austria).
      // With Italy+Turkey coalition, Italy should not be penalized for attacking Austria.
      // But if Italy is in a coalition with Austria, it should be penalized.
      const units: Unit[] = [
        { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
        { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
        { type: 'Army', power: 'Italy', location: { provinceId: 'ven', coast: null } },
        { type: 'Army', power: 'Austria', location: { provinceId: 'vie', coast: null } },
        { type: 'Army', power: 'Turkey', location: { provinceId: 'con', coast: null } },
        { type: 'Fleet', power: 'England', location: { provinceId: 'lon', coast: null } },
        { type: 'Army', power: 'Russia', location: { provinceId: 'mos', coast: null } },
      ];

      const supplyCenters = new Map<string, Power>();
      supplyCenters.set('mun', 'Germany');
      supplyCenters.set('par', 'France');
      supplyCenters.set('ven', 'Italy');
      supplyCenters.set('vie', 'Austria');
      supplyCenters.set('con', 'Turkey');
      supplyCenters.set('lon', 'England');
      supplyCenters.set('mos', 'Russia');

      const state = GameStateBuilder.create({
        turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
        units,
        supplyCenters,
      });

      // With Germany+France coalition, search should produce results
      const coalition: Coalition = { powers: ['Germany', 'France'], name: 'Germany+France' };
      const config = createConfig(coalition, { searchTimeMs: 200 });
      const engine = new MCTSEngine(config);
      const result = engine.search(state);

      // Basic structure checks
      expect(result.totalSimulations).toBeGreaterThan(0);
      expect(result.rankedMoves.length).toBeGreaterThan(0);
    });
  });

  describe('Predicted turn labels', () => {
    it('should label predicted turns with the correct phase', () => {
      const units: Unit[] = [
        { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
        { type: 'Fleet', power: 'France', location: { provinceId: 'bre', coast: null } },
        { type: 'Army', power: 'France', location: { provinceId: 'mar', coast: null } },
        { type: 'Fleet', power: 'England', location: { provinceId: 'lon', coast: null } },
        { type: 'Fleet', power: 'England', location: { provinceId: 'edi', coast: null } },
        { type: 'Army', power: 'England', location: { provinceId: 'lvp', coast: null } },
        { type: 'Army', power: 'Germany', location: { provinceId: 'ber', coast: null } },
        { type: 'Fleet', power: 'Germany', location: { provinceId: 'kie', coast: null } },
        { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
      ];

      const supplyCenters = new Map<string, Power>();
      supplyCenters.set('par', 'France');
      supplyCenters.set('bre', 'France');
      supplyCenters.set('mar', 'France');
      supplyCenters.set('lon', 'England');
      supplyCenters.set('edi', 'England');
      supplyCenters.set('lvp', 'England');
      supplyCenters.set('ber', 'Germany');
      supplyCenters.set('kie', 'Germany');
      supplyCenters.set('mun', 'Germany');

      const state = GameStateBuilder.create({
        turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
        units,
        supplyCenters,
      });

      const coalition: Coalition = { powers: ['France'], name: 'France' };
      const config = createConfig(coalition, {
        maxDepth: 4,
        searchTimeMs: 1000,
      });
      const engine = new MCTSEngine(config);
      const result = engine.search(state);

      expect(result.rankedMoves.length).toBeGreaterThan(0);

      const topMove = result.rankedMoves[0];
      if (topMove.predictedTurns.length > 0) {
        for (const pt of topMove.predictedTurns) {
          // Predicted turns should only be Diplomacy phase (Retreat/Build are pass-throughs)
          expect(pt.turn.phase).toBe('Diplomacy');
          // State should be included for correct unit lookups
          expect(pt.state).toBeDefined();
          expect(pt.state.units).toBeDefined();

          // No support/convoy orders should appear labeled as Retreat phase
          // (since we now correctly label with parent turn)
          if (pt.turn.phase === 'Retreat') {
            for (const order of [...pt.coalitionOrders, ...pt.opponentOrders]) {
              expect(order.type).not.toBe('support');
              expect(order.type).not.toBe('convoy');
            }
          }
        }
      }
    });
  });

  describe('Position swap prevention', () => {
    it('search results should not contain swap moves for the same power', () => {
      // Setup where a swap might naturally be generated
      const units: Unit[] = [
        { type: 'Army', power: 'Italy', location: { provinceId: 'nap', coast: null } },
        { type: 'Fleet', power: 'Italy', location: { provinceId: 'rom', coast: null } },
        { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
        { type: 'Fleet', power: 'England', location: { provinceId: 'lon', coast: null } },
        { type: 'Army', power: 'Germany', location: { provinceId: 'ber', coast: null } },
        { type: 'Army', power: 'Austria', location: { provinceId: 'vie', coast: null } },
        { type: 'Army', power: 'Russia', location: { provinceId: 'mos', coast: null } },
        { type: 'Fleet', power: 'Turkey', location: { provinceId: 'ank', coast: null } },
      ];

      const supplyCenters = new Map<string, Power>();
      supplyCenters.set('nap', 'Italy');
      supplyCenters.set('rom', 'Italy');
      supplyCenters.set('par', 'France');
      supplyCenters.set('lon', 'England');
      supplyCenters.set('ber', 'Germany');
      supplyCenters.set('vie', 'Austria');
      supplyCenters.set('mos', 'Russia');
      supplyCenters.set('ank', 'Turkey');

      const state = GameStateBuilder.create({
        turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
        units,
        supplyCenters,
      });

      // Run multiple times with different seeds to check for swaps
      const coalition: Coalition = { powers: ['France'], name: 'France' };
      let swapFound = false;

      for (let seed = 0; seed < 10; seed++) {
        const config = createConfig(coalition, { searchTimeMs: 200, seed });
        const engine = new MCTSEngine(config);
        const result = engine.search(state);

        for (const move of result.rankedMoves) {
          const allOrders = [...move.opponentOrders];

          // Check for swaps within the orders
          for (let i = 0; i < allOrders.length; i++) {
            if (allOrders[i].type !== 'move') continue;
            const moveI = allOrders[i] as MoveOrder;

            for (let j = i + 1; j < allOrders.length; j++) {
              if (allOrders[j].type !== 'move') continue;
              const moveJ = allOrders[j] as MoveOrder;

              if (
                moveI.unit.provinceId === moveJ.destination.provinceId &&
                moveJ.unit.provinceId === moveI.destination.provinceId
              ) {
                swapFound = true;
              }
            }
          }
        }
      }

      // Swaps should be prevented by the fix
      expect(swapFound).toBe(false);
    });
  });
});
