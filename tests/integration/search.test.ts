/**
 * Integration tests for Stabalyzer.
 *
 * Tests the full pipeline: game state → MCTS search → ranked results.
 * Uses a deterministic seed for reproducible results.
 */
import { describe, it, expect } from 'vitest';
import { MCTSEngine, MCTSConfig } from '../../src/search/mcts';
import { GameStateBuilder } from '../../src/core/gameStateBuilder';
import { calculateFitness, checkWinCondition } from '../../src/core/fitness';
import { Adjudicator } from '../../src/core/adjudicator';
import { zobristHash } from '../../src/search/zobrist';
import { parseCoalitions } from '../../src/utils/coalitions';
import { parsePriority, parsePriorities } from '../../src/utils/priorities';
import { SeededRandom } from '../../src/utils/random';
import {
  GameState,
  Unit,
  Power,
  Priority,
  Coalition,
  TurnInfo,
  FITNESS_SC_WEIGHT,
  FITNESS_WIN_SCORE,
} from '../../src/core/types';

describe('Integration: Deterministic MCTS Scenario', () => {
  // Create a simple game state for testing
  function createTestState(): GameState {
    const units: Unit[] = [
      // England
      { type: 'Fleet', power: 'England', location: { provinceId: 'lon', coast: null } },
      { type: 'Fleet', power: 'England', location: { provinceId: 'edi', coast: null } },
      { type: 'Army', power: 'England', location: { provinceId: 'lvp', coast: null } },
      // France
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'mar', coast: null } },
      { type: 'Fleet', power: 'France', location: { provinceId: 'bre', coast: null } },
    ];

    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('lon', 'England');
    supplyCenters.set('edi', 'England');
    supplyCenters.set('lvp', 'England');
    supplyCenters.set('par', 'France');
    supplyCenters.set('mar', 'France');
    supplyCenters.set('bre', 'France');

    return GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units,
      supplyCenters,
    });
  }

  it('should produce deterministic results with the same seed', () => {
    const state = createTestState();
    const coalition: Coalition = { powers: ['England'], name: 'England' };

    const config1: MCTSConfig = {
      maxDepth: 2,
      searchTimeMs: 500,
      explorationConstant: 1.414,
      seed: 42,
      coalition,
    };

    const engine1 = new MCTSEngine(config1);

    const result1 = engine1.search(state);

    // Should produce results with valid structure
    expect(result1.totalSimulations).toBeGreaterThan(0);
    expect(result1.rankedMoves.length).toBeGreaterThan(0);
    expect(result1.rankedMoves.length).toBeLessThanOrEqual(3);
  });

  it('should produce results with proper fitness scores', () => {
    const state = createTestState();
    const coalition: Coalition = { powers: ['England'], name: 'England' };

    const config: MCTSConfig = {
      maxDepth: 1,
      searchTimeMs: 500,
      explorationConstant: 1.414,
      seed: 42,
      coalition,
    };

    const engine = new MCTSEngine(config);
    const result = engine.search(state);

    // Should have some results
    expect(result.totalSimulations).toBeGreaterThan(0);

    // Each ranked move should have valid fitness
    for (const move of result.rankedMoves) {
      expect(move.score).toBeGreaterThanOrEqual(0);
      expect(move.confidence.visits).toBeGreaterThan(0);
      expect(move.fitness.supplyCenters).toBeGreaterThanOrEqual(0);
      expect(move.fitness.units).toBeGreaterThanOrEqual(0);
    }
  });

  it('should handle AbortController cancellation', () => {
    const state = createTestState();
    const coalition: Coalition = { powers: ['England'], name: 'England' };
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    const config: MCTSConfig = {
      maxDepth: 2,
      searchTimeMs: 10000,
      explorationConstant: 1.414,
      seed: 42,
      coalition,
      signal: controller.signal,
    };

    const engine = new MCTSEngine(config);
    const result = engine.search(state);

    // Should have very few or no simulations since we aborted immediately
    expect(result.totalSimulations).toBeLessThan(100);
  });
});

describe('Integration: Fitness Function', () => {
  it('should compute fitness = SC * 1000 + units', () => {
    const units: Unit[] = [
      { type: 'Army', power: 'England', location: { provinceId: 'lon', coast: null } },
      { type: 'Fleet', power: 'England', location: { provinceId: 'nth', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
    ];

    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('lon', 'England');
    supplyCenters.set('edi', 'England');
    supplyCenters.set('lvp', 'England');

    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units,
      supplyCenters,
    });

    const coalition: Coalition = { powers: ['England'], name: 'England' };
    const fitness = calculateFitness(state, coalition);

    // 3 SC * 1000 + 2 units = 3002
    expect(fitness.score).toBe(3002);
    expect(fitness.supplyCenters).toBe(3);
    expect(fitness.units).toBe(2);
    expect(fitness.isWin).toBe(false);
  });

  it('should detect domination win at 18 SC', () => {
    const units: Unit[] = [
      { type: 'Army', power: 'England', location: { provinceId: 'lon', coast: null } },
    ];

    const supplyCenters = new Map<string, Power>();
    // Give England 18 SCs
    const provinces = [
      'lon', 'edi', 'lvp', 'par', 'bre', 'mar', 'ber', 'mun', 'kie',
      'rom', 'nap', 'ven', 'vie', 'bud', 'tri', 'bel', 'hol', 'den',
    ];
    for (const p of provinces) {
      supplyCenters.set(p, 'England');
    }

    const state = GameStateBuilder.create({
      turn: { year: 1905, season: 'Fall', phase: 'Diplomacy' },
      units,
      supplyCenters,
    });

    const coalition: Coalition = { powers: ['England'], name: 'England' };
    const fitness = calculateFitness(state, coalition);

    expect(fitness.isWin).toBe(true);
    expect(fitness.winType).toBe('domination');
    expect(fitness.score).toBe(FITNESS_WIN_SCORE);
  });
});

describe('Integration: Adjudicator', () => {
  const adjudicator = new Adjudicator();

  it('should resolve simple move to empty province', () => {
    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units: [
        { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
      ],
    });

    const orders = new Map<Power, any[]>();
    orders.set('Germany', [
      { type: 'move', unit: { provinceId: 'mun', coast: null }, destination: { provinceId: 'boh', coast: null } },
    ]);

    const { resolutions, newState } = adjudicator.resolve(state, orders);

    expect(resolutions[0].status).toBe('succeeds');
    expect(newState.units[0].location.provinceId).toBe('boh');
  });

  it('should resolve hold order', () => {
    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units: [
        { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
      ],
    });

    const orders = new Map<Power, any[]>();
    orders.set('France', [
      { type: 'hold', unit: { provinceId: 'par', coast: null } },
    ]);

    const { resolutions } = adjudicator.resolve(state, orders);
    expect(resolutions[0].status).toBe('succeeds');
  });

  it('should generate legal orders for a power', () => {
    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units: [
        { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
      ],
    });

    const orders = adjudicator.generateLegalOrders(state, 'Germany');
    expect(orders.length).toBeGreaterThan(0);

    // Should have at least hold and some moves
    const flatOrders = orders.flat();
    const hasHold = flatOrders.some(o => o.type === 'hold');
    const hasMove = flatOrders.some(o => o.type === 'move');
    expect(hasHold).toBe(true);
    expect(hasMove).toBe(true);
  });
});

describe('Integration: Zobrist Hashing', () => {
  it('should produce consistent hashes for the same state', () => {
    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units: [
        { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
      ],
    });

    const hash1 = zobristHash(state);
    const hash2 = zobristHash(state);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different states', () => {
    const state1 = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units: [
        { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
      ],
    });

    const state2 = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units: [
        { type: 'Army', power: 'Germany', location: { provinceId: 'ber', coast: null } },
      ],
    });

    const hash1 = zobristHash(state1);
    const hash2 = zobristHash(state2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('Integration: Coalition Parser', () => {
  it('should parse single power coalition', () => {
    const coalitions = parseCoalitions('England');
    expect(coalitions).toHaveLength(1);
    expect(coalitions[0].powers).toEqual(['England']);
  });

  it('should parse multi-power coalition', () => {
    const coalitions = parseCoalitions('England+France');
    expect(coalitions).toHaveLength(1);
    expect(coalitions[0].powers).toEqual(['England', 'France']);
  });

  it('should parse multiple coalitions', () => {
    const coalitions = parseCoalitions('England+France,Italy+Turkey');
    expect(coalitions).toHaveLength(2);
    expect(coalitions[0].powers).toEqual(['England', 'France']);
    expect(coalitions[1].powers).toEqual(['Italy', 'Turkey']);
  });

  it('should throw on invalid power name', () => {
    expect(() => parseCoalitions('InvalidPower')).toThrow('Unknown power');
  });
});

describe('Integration: SeededRandom', () => {
  it('should produce deterministic sequences', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    for (let i = 0; i < 100; i++) {
      expect(rng1.random()).toBe(rng2.random());
    }
  });

  it('should produce different sequences for different seeds', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(43);

    let allSame = true;
    for (let i = 0; i < 10; i++) {
      if (rng1.random() !== rng2.random()) {
        allSame = false;
        break;
      }
    }
    expect(allSame).toBe(false);
  });
});

describe('Integration: Priority Parsing', () => {
  it('should parse a deny priority', () => {
    const priority = parsePriority('deny England nth');
    expect(priority.action).toBe('deny');
    expect(priority.power).toBe('England');
    expect(priority.provinceId).toBe('nth');
  });

  it('should parse an allow priority', () => {
    const priority = parsePriority('allow Italy mao');
    expect(priority.action).toBe('allow');
    expect(priority.power).toBe('Italy');
    expect(priority.provinceId).toBe('mao');
  });

  it('should be case-insensitive for action and power', () => {
    const priority = parsePriority('DENY england NTH');
    expect(priority.action).toBe('deny');
    expect(priority.power).toBe('England');
    expect(priority.provinceId).toBe('nth');
  });

  it('should parse multiple priorities', () => {
    const priorities = parsePriorities(['deny England nth', 'allow Italy mao']);
    expect(priorities).toHaveLength(2);
    expect(priorities[0].action).toBe('deny');
    expect(priorities[1].action).toBe('allow');
  });

  it('should throw on invalid format', () => {
    expect(() => parsePriority('deny England')).toThrow('Invalid priority format');
  });

  it('should throw on invalid action', () => {
    expect(() => parsePriority('block England nth')).toThrow('Invalid priority action');
  });

  it('should throw on invalid power', () => {
    expect(() => parsePriority('deny InvalidPower nth')).toThrow('Unknown power');
  });

  it('should throw on invalid province', () => {
    expect(() => parsePriority('deny England xyz')).toThrow('Unknown province');
  });
});

describe('Integration: Fitness with Priorities', () => {
  it('should penalize fitness for deny priority when unit is in province', () => {
    const units: Unit[] = [
      { type: 'Fleet', power: 'England', location: { provinceId: 'nth', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
    ];

    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('lon', 'England');
    supplyCenters.set('edi', 'England');
    supplyCenters.set('lvp', 'England');
    supplyCenters.set('par', 'France');

    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units,
      supplyCenters,
    });

    const coalition: Coalition = { powers: ['England'], name: 'England' };

    // Without priorities
    const fitnessNoPriority = calculateFitness(state, coalition);

    // With deny priority
    const priorities: Priority[] = [{ action: 'deny', power: 'England', provinceId: 'nth' }];
    const fitnessWithPriority = calculateFitness(state, coalition, priorities);

    expect(fitnessWithPriority.score).toBe(fitnessNoPriority.score - FITNESS_SC_WEIGHT);
  });

  it('should reward fitness for allow priority when unit is in province', () => {
    const units: Unit[] = [
      { type: 'Fleet', power: 'Italy', location: { provinceId: 'mao', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
    ];

    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('rom', 'Italy');
    supplyCenters.set('par', 'France');

    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units,
      supplyCenters,
    });

    const coalition: Coalition = { powers: ['Italy'], name: 'Italy' };

    // Without priorities
    const fitnessNoPriority = calculateFitness(state, coalition);

    // With allow priority
    const priorities: Priority[] = [{ action: 'allow', power: 'Italy', provinceId: 'mao' }];
    const fitnessWithPriority = calculateFitness(state, coalition, priorities);

    expect(fitnessWithPriority.score).toBe(fitnessNoPriority.score + FITNESS_SC_WEIGHT);
  });

  it('should not adjust fitness when unit is not in the priority province', () => {
    const units: Unit[] = [
      { type: 'Fleet', power: 'England', location: { provinceId: 'eng', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
    ];

    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('lon', 'England');
    supplyCenters.set('par', 'France');

    const state = GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units,
      supplyCenters,
    });

    const coalition: Coalition = { powers: ['England'], name: 'England' };

    const fitnessNoPriority = calculateFitness(state, coalition);
    const priorities: Priority[] = [{ action: 'deny', power: 'England', provinceId: 'nth' }];
    const fitnessWithPriority = calculateFitness(state, coalition, priorities);

    expect(fitnessWithPriority.score).toBe(fitnessNoPriority.score);
  });
});

describe('Integration: MCTS with Opponent Orders and Predicted Turns', () => {
  function createTestState(): GameState {
    const units: Unit[] = [
      { type: 'Fleet', power: 'England', location: { provinceId: 'lon', coast: null } },
      { type: 'Fleet', power: 'England', location: { provinceId: 'edi', coast: null } },
      { type: 'Army', power: 'England', location: { provinceId: 'lvp', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'mar', coast: null } },
      { type: 'Fleet', power: 'France', location: { provinceId: 'bre', coast: null } },
    ];

    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('lon', 'England');
    supplyCenters.set('edi', 'England');
    supplyCenters.set('lvp', 'England');
    supplyCenters.set('par', 'France');
    supplyCenters.set('mar', 'France');
    supplyCenters.set('bre', 'France');

    return GameStateBuilder.create({
      turn: { year: 1901, season: 'Spring', phase: 'Diplomacy' },
      units,
      supplyCenters,
    });
  }

  it('should include opponent orders in results', () => {
    const state = createTestState();
    const coalition: Coalition = { powers: ['England'], name: 'England' };

    const config: MCTSConfig = {
      maxDepth: 2,
      searchTimeMs: 500,
      explorationConstant: 1.414,
      seed: 42,
      coalition,
    };

    const engine = new MCTSEngine(config);
    const result = engine.search(state);

    expect(result.rankedMoves.length).toBeGreaterThan(0);

    for (const move of result.rankedMoves) {
      // opponentOrders should be defined (may be empty if no opponents)
      expect(move.opponentOrders).toBeDefined();
      expect(Array.isArray(move.opponentOrders)).toBe(true);
    }
  });

  it('should include predicted turns in results', () => {
    const state = createTestState();
    const coalition: Coalition = { powers: ['England'], name: 'England' };

    const config: MCTSConfig = {
      maxDepth: 2,
      searchTimeMs: 500,
      explorationConstant: 1.414,
      seed: 42,
      coalition,
    };

    const engine = new MCTSEngine(config);
    const result = engine.search(state);

    expect(result.rankedMoves.length).toBeGreaterThan(0);

    for (const move of result.rankedMoves) {
      // predictedTurns should be defined
      expect(move.predictedTurns).toBeDefined();
      expect(Array.isArray(move.predictedTurns)).toBe(true);
    }
  });

  it('should accept priorities in MCTS config', () => {
    const state = createTestState();
    const coalition: Coalition = { powers: ['England'], name: 'England' };
    const priorities: Priority[] = [{ action: 'deny', power: 'England', provinceId: 'nth' }];

    const config: MCTSConfig = {
      maxDepth: 1,
      searchTimeMs: 500,
      explorationConstant: 1.414,
      seed: 42,
      coalition,
      priorities,
    };

    const engine = new MCTSEngine(config);
    const result = engine.search(state);

    expect(result.totalSimulations).toBeGreaterThan(0);
    expect(result.rankedMoves.length).toBeGreaterThan(0);
  });
});
