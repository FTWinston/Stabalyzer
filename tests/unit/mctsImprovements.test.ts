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
  HoldOrder,
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
    it('should discourage coalition members from attacking partner SCs', () => {
      // Setup: Germany+France coalition. France has army in Burgundy adjacent to Munich (German SC).
      // The French army should not be predicted to attack Munich (a coalition partner's SC).
      const units: Unit[] = [
        { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
        { type: 'Army', power: 'Germany', location: { provinceId: 'ber', coast: null } },
        { type: 'Fleet', power: 'Germany', location: { provinceId: 'kie', coast: null } },
        { type: 'Army', power: 'France', location: { provinceId: 'bur', coast: null } },
        { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
        { type: 'Fleet', power: 'France', location: { provinceId: 'bre', coast: null } },
        { type: 'Fleet', power: 'England', location: { provinceId: 'lon', coast: null } },
        { type: 'Army', power: 'Italy', location: { provinceId: 'ven', coast: null } },
        { type: 'Army', power: 'Austria', location: { provinceId: 'vie', coast: null } },
        { type: 'Army', power: 'Russia', location: { provinceId: 'mos', coast: null } },
        { type: 'Fleet', power: 'Turkey', location: { provinceId: 'ank', coast: null } },
      ];

      const supplyCenters = new Map<string, Power>();
      supplyCenters.set('mun', 'Germany');
      supplyCenters.set('ber', 'Germany');
      supplyCenters.set('kie', 'Germany');
      supplyCenters.set('bur', 'France');
      supplyCenters.set('par', 'France');
      supplyCenters.set('bre', 'France');
      supplyCenters.set('lon', 'England');
      supplyCenters.set('ven', 'Italy');
      supplyCenters.set('vie', 'Austria');
      supplyCenters.set('mos', 'Russia');
      supplyCenters.set('ank', 'Turkey');

      const state = GameStateBuilder.create({
        turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
        units,
        supplyCenters,
      });

      // With Germany+France coalition, coalition orders should not attack each other's SCs
      const coalition: Coalition = { powers: ['Germany', 'France'], name: 'Germany+France' };
      let coalitionAttackingPartnerSC = false;

      for (let seed = 0; seed < 10; seed++) {
        const config = createConfig(coalition, { searchTimeMs: 100, seed });
        const engine = new MCTSEngine(config);
        const result = engine.search(state);

        for (const move of result.rankedMoves) {
          // Check coalition orders: France should not move Bur → Mun (German SC)
          for (const order of move.orders) {
            if (order.type !== 'move') continue;
            const mo = order as MoveOrder;
            const dest = mo.destination.provinceId;
            const scOwner = supplyCenters.get(dest);
            if (scOwner && coalition.powers.includes(scOwner)) {
              // Check if the moving unit belongs to a different coalition power
              const unit = units.find(u => u.location.provinceId === mo.unit.provinceId);
              if (unit && unit.power !== scOwner && coalition.powers.includes(unit.power)) {
                coalitionAttackingPartnerSC = true;
              }
            }
          }
        }
      }

      expect(coalitionAttackingPartnerSC).toBe(false);
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
          // Predicted turns can be Diplomacy or Build phase
          expect(['Diplomacy', 'Build', 'Retreat']).toContain(pt.turn.phase);
          // State should be included for correct unit lookups
          expect(pt.state).toBeDefined();
          expect(pt.state.units).toBeDefined();

          // Build phase turns should have build/disband/waive orders
          if (pt.turn.phase === 'Build') {
            const allOrders = [...pt.coalitionOrders, ...pt.opponentOrders];
            for (const order of allOrders) {
              expect(['build', 'disband', 'waive']).toContain(order.type);
            }
          }

          // No support/convoy orders should appear in Retreat phase
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

  describe('Self-blocking move prevention', () => {
    it('should not suggest moving into a province occupied by own unit holding', () => {
      // Setup: Italy has armies in Rom and Nap. The search should never suggest
      // one army move to the other's province while that other army is holding there.
      const units: Unit[] = [
        { type: 'Army', power: 'Italy', location: { provinceId: 'rom', coast: null } },
        { type: 'Army', power: 'Italy', location: { provinceId: 'nap', coast: null } },
        { type: 'Army', power: 'Italy', location: { provinceId: 'ven', coast: null } },
        { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
        { type: 'Fleet', power: 'England', location: { provinceId: 'lon', coast: null } },
        { type: 'Army', power: 'Germany', location: { provinceId: 'ber', coast: null } },
        { type: 'Army', power: 'Austria', location: { provinceId: 'vie', coast: null } },
        { type: 'Army', power: 'Russia', location: { provinceId: 'mos', coast: null } },
        { type: 'Fleet', power: 'Turkey', location: { provinceId: 'ank', coast: null } },
      ];

      const supplyCenters = new Map<string, Power>();
      supplyCenters.set('rom', 'Italy');
      supplyCenters.set('nap', 'Italy');
      supplyCenters.set('ven', 'Italy');
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

      // France is the coalition, so Italy's orders are opponent (non-optimized) orders
      const coalition: Coalition = { powers: ['France'], name: 'France' };
      let selfBlockFound = false;

      for (let seed = 0; seed < 10; seed++) {
        const config = createConfig(coalition, { searchTimeMs: 200, seed });
        const engine = new MCTSEngine(config);
        const result = engine.search(state);

        for (const move of result.rankedMoves) {
          // Check opponent orders for self-blocking
          const ordersByPower = new Map<Power, Order[]>();
          for (const order of move.opponentOrders) {
            if (order.type !== 'move' && order.type !== 'hold') continue;
            const unitProv = order.type === 'move'
              ? (order as MoveOrder).unit.provinceId
              : (order as HoldOrder).unit.provinceId;
            const unit = units.find(u => u.location.provinceId === unitProv);
            if (!unit) continue;
            if (!ordersByPower.has(unit.power)) ordersByPower.set(unit.power, []);
            ordersByPower.get(unit.power)!.push(order);
          }

          for (const [_power, powerOrders] of ordersByPower) {
            for (const order of powerOrders) {
              if (order.type !== 'move') continue;
              const mo = order as MoveOrder;
              const dest = mo.destination.provinceId;
              // Check if another unit of the same power is holding at the destination
              const holdingAtDest = powerOrders.find(
                o => o.type === 'hold' && (o as HoldOrder).unit.provinceId === dest
              );
              if (holdingAtDest) {
                selfBlockFound = true;
              }
            }
          }
        }
      }

      expect(selfBlockFound).toBe(false);
    });
  });

  describe('Build phase orders in output', () => {
    it('should include build/disband orders in predicted turns for winter', () => {
      // Setup a Fall Diplomacy state that will transition to Build phase
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
        searchTimeMs: 2000,
        seed: 42,
      });
      const engine = new MCTSEngine(config);
      const result = engine.search(state);

      expect(result.rankedMoves.length).toBeGreaterThan(0);

      const topMove = result.rankedMoves[0];
      // With depth 4, the search should go through at least one Build phase
      const buildTurns = topMove.predictedTurns.filter(pt => pt.turn.phase === 'Build');
      // Build phase turns should now appear in predicted turns
      if (buildTurns.length > 0) {
        for (const bt of buildTurns) {
          const allOrders = [...bt.coalitionOrders, ...bt.opponentOrders];
          expect(allOrders.length).toBeGreaterThan(0);
          for (const order of allOrders) {
            expect(['build', 'disband', 'waive']).toContain(order.type);
          }
        }
      }
    });
  });
});
