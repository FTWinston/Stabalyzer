/**
 * DATC test case parser.
 *
 * Converts embedded DATC test case data into internal game states
 * and order objects for adjudication testing.
 */
import {
  GameState,
  Unit,
  Order,
  Power,
  Location,
  Coast,
  MoveOrder,
  SupportOrder,
  ConvoyOrder,
  HoldOrder,
  TurnInfo,
} from '../../src/core/types';
import { GameStateBuilder } from '../../src/core/gameStateBuilder';
import { DATCTestCase, DATCOrder, DATCUnit } from './datcCases';

/**
 * Convert DATC test case units into a GameState.
 */
export function buildStateFromDATCCase(testCase: DATCTestCase): GameState {
  const units: Unit[] = testCase.units.map(u => ({
    type: u.type,
    power: u.power,
    location: {
      provinceId: u.province,
      coast: u.coast ?? null,
    },
  }));

  const turn: TurnInfo = {
    year: 1901,
    season: 'Spring',
    phase: 'Diplomacy',
  };

  return GameStateBuilder.create({ turn, units });
}

/**
 * Convert DATC test case orders into the internal Order format.
 */
export function buildOrdersFromDATCCase(
  testCase: DATCTestCase
): Map<Power, Order[]> {
  const ordersByPower = new Map<Power, Order[]>();

  for (const datcOrder of testCase.orders) {
    const order = convertDATCOrder(datcOrder);
    if (!order) continue;

    const existing = ordersByPower.get(datcOrder.power) ?? [];
    existing.push(order);
    ordersByPower.set(datcOrder.power, existing);
  }

  return ordersByPower;
}

/**
 * Convert a single DATC order to our Order type.
 */
function convertDATCOrder(datcOrder: DATCOrder): Order | null {
  const unitLoc: Location = {
    provinceId: datcOrder.unit,
    coast: datcOrder.unitCoast ?? null,
  };

  switch (datcOrder.type) {
    case 'hold':
      return {
        type: 'hold',
        unit: unitLoc,
      } as HoldOrder;

    case 'move':
      return {
        type: 'move',
        unit: unitLoc,
        destination: {
          provinceId: datcOrder.destination!,
          coast: datcOrder.destinationCoast ?? null,
        },
        viaConvoy: datcOrder.viaConvoy ?? false,
      } as MoveOrder;

    case 'support':
      return {
        type: 'support',
        unit: unitLoc,
        supportedUnit: {
          provinceId: datcOrder.target!,
          coast: datcOrder.targetCoast ?? null,
        },
        destination: {
          provinceId: datcOrder.destination!,
          coast: datcOrder.destinationCoast ?? null,
        },
      } as SupportOrder;

    case 'convoy':
      return {
        type: 'convoy',
        unit: unitLoc,
        convoyedUnit: {
          provinceId: datcOrder.target!,
          coast: datcOrder.targetCoast ?? null,
        },
        destination: {
          provinceId: datcOrder.destination!,
          coast: datcOrder.destinationCoast ?? null,
        },
      } as ConvoyOrder;

    default:
      return null;
  }
}
