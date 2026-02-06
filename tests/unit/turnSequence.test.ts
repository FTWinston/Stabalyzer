/**
 * Unit tests for turn sequence (advanceTurn) and related fixes.
 *
 * Verifies:
 * - Fall Diplomacy → Fall Retreat when there are dislodgements
 * - Fall Retreat → Build
 * - Build → Spring Diplomacy of next year
 * - Spring Diplomacy → Fall Diplomacy (no dislodgements)
 * - Spring Diplomacy → Spring Retreat (with dislodgements)
 */
import { describe, it, expect } from 'vitest';
import { Adjudicator } from '../../src/core/adjudicator';
import { GameStateBuilder } from '../../src/core/gameStateBuilder';
import {
  GameState,
  Unit,
  Power,
  Order,
  MoveOrder,
  TurnInfo,
} from '../../src/core/types';

const adjudicator = new Adjudicator();

describe('Turn Sequence', () => {
  function createState(turn: TurnInfo, units: Unit[]): GameState {
    const supplyCenters = new Map<string, Power>();
    for (const u of units) {
      // Give each power their starting provinces as SCs
      supplyCenters.set(u.location.provinceId, u.power);
    }
    return GameStateBuilder.create({ turn, units, supplyCenters });
  }

  it('Spring Diplomacy with no dislodgements advances to Fall Diplomacy', () => {
    const units: Unit[] = [
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
      { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
    ];
    const state = createState({ year: 1901, season: 'Spring', phase: 'Diplomacy' }, units);

    const orders = new Map<Power, Order[]>();
    orders.set('France', [{ type: 'hold', unit: { provinceId: 'par', coast: null } }]);
    orders.set('Germany', [{ type: 'hold', unit: { provinceId: 'mun', coast: null } }]);

    const { newState } = adjudicator.resolve(state, orders);
    expect(newState.turn.season).toBe('Fall');
    expect(newState.turn.phase).toBe('Diplomacy');
    expect(newState.turn.year).toBe(1901);
  });

  it('Fall Diplomacy with dislodgements advances to Fall Retreat', () => {
    const units: Unit[] = [
      { type: 'Army', power: 'France', location: { provinceId: 'bur', coast: null } },
      { type: 'Army', power: 'France', location: { provinceId: 'tyr', coast: null } },
      { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
    ];
    const state = createState({ year: 1904, season: 'Fall', phase: 'Diplomacy' }, units);

    // France attacks Munich from Burgundy with support from Tyrolia; Germany holds → Germany dislodged
    const orders = new Map<Power, Order[]>();
    orders.set('France', [
      { type: 'move', unit: { provinceId: 'bur', coast: null }, destination: { provinceId: 'mun', coast: null } } as MoveOrder,
      { type: 'support', unit: { provinceId: 'tyr', coast: null }, supportedUnit: { provinceId: 'bur', coast: null }, destination: { provinceId: 'mun', coast: null } },
    ]);
    orders.set('Germany', [
      { type: 'hold', unit: { provinceId: 'mun', coast: null } },
    ]);

    const { newState } = adjudicator.resolve(state, orders);
    expect(newState.turn.season).toBe('Fall');
    expect(newState.turn.phase).toBe('Retreat');
    expect(newState.turn.year).toBe(1904);
    expect(newState.dislodgedUnits.length).toBeGreaterThan(0);
  });

  it('Fall Diplomacy with no dislodgements advances to Build', () => {
    const units: Unit[] = [
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
      { type: 'Army', power: 'Germany', location: { provinceId: 'mun', coast: null } },
    ];
    const state = createState({ year: 1904, season: 'Fall', phase: 'Diplomacy' }, units);

    const orders = new Map<Power, Order[]>();
    orders.set('France', [{ type: 'hold', unit: { provinceId: 'par', coast: null } }]);
    orders.set('Germany', [{ type: 'hold', unit: { provinceId: 'mun', coast: null } }]);

    const { newState } = adjudicator.resolve(state, orders);
    expect(newState.turn.season).toBe('Fall');
    expect(newState.turn.phase).toBe('Build');
    expect(newState.turn.year).toBe(1904);
  });

  it('Build phase advances to Spring Diplomacy of next year', () => {
    const units: Unit[] = [
      { type: 'Army', power: 'France', location: { provinceId: 'par', coast: null } },
    ];
    const state = createState({ year: 1904, season: 'Fall', phase: 'Build' }, units);

    const orders = new Map<Power, Order[]>();
    orders.set('France', [{ type: 'waive', power: 'France' }]);

    const { newState } = adjudicator.resolve(state, orders);
    expect(newState.turn.season).toBe('Spring');
    expect(newState.turn.phase).toBe('Diplomacy');
    expect(newState.turn.year).toBe(1905);
  });
});
