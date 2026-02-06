/**
 * Output formatter for Stabalyzer.
 * Produces plain text only. No JSON, HTML, or structured formats.
 *
 * Formatting rules:
 * - Sea zones displayed in UPPERCASE (e.g. NTH, ENG, MAO)
 * - Land/coastal provinces displayed in Title Case (e.g. Ber, Mun, Spa)
 * - Each order prefixed with A (Army) or F (Fleet)
 * - Orders grouped by country within each recommendation
 */
import {
  SearchResult,
  RankedMove,
  Coalition,
  GameState,
  Order,
  Power,
  MoveOrder,
  SupportOrder,
  ConvoyOrder,
  RetreatOrder,
  DisbandOrder,
  BuildOrder,
  WaiveOrder,
  UnitType,
} from '../core/types';
import { displayProvince } from '../core/mapData';

const MAX_LINE_WIDTH = 100;

/**
 * Format the full analysis output.
 */
export function formatOutput(
  result: SearchResult,
  coalition: Coalition,
  gameState: GameState,
  depth: number,
  threads: number,
  searchTimeSec: number,
  seed?: number
): string {
  const lines: string[] = [];

  // Header
  lines.push(`Stabalyzer analysis for coalition: ${coalition.name}`);
  lines.push(
    `Depth: ${depth} turns | Threads: ${threads} | Search time: ${searchTimeSec}s` +
    (seed !== undefined ? ` | Seed: ${seed}` : '')
  );
  lines.push('');

  if (result.rankedMoves.length === 0) {
    lines.push('No moves found. The search may need more iterations or the game may be over.');
    return lines.join('\n');
  }

  lines.push(`Recommended orders (ranked):`);

  for (const move of result.rankedMoves) {
    lines.push(formatRankedMove(move, gameState));
  }

  // Notes
  lines.push('');
  lines.push('Notes:');
  lines.push(`- Total simulations: ${result.totalSimulations.toLocaleString()}`);
  lines.push(`- Search time: ${(result.elapsedMs / 1000).toFixed(1)}s`);

  return lines.join('\n');
}

/**
 * Look up unit type for a given province in the game state.
 */
function getUnitType(state: GameState, provinceId: string): UnitType | null {
  const unit = state.units.find(u => u.location.provinceId === provinceId);
  return unit?.type ?? null;
}

/**
 * Look up the power owning a unit at a given province.
 */
function getUnitPower(state: GameState, provinceId: string): Power | null {
  const unit = state.units.find(u => u.location.provinceId === provinceId);
  return unit?.power ?? null;
}

/**
 * Format a single order with unit type prefix and proper province casing.
 */
function formatOrder(order: Order, state: GameState): string {
  const unitPrefix = (provinceId: string): string => {
    const ut = getUnitType(state, provinceId);
    return ut === 'Fleet' ? 'F' : 'A';
  };

  switch (order.type) {
    case 'hold':
      return `${unitPrefix(order.unit.provinceId)} ${displayProvince(order.unit.provinceId)} H`;
    case 'move': {
      const mo = order as MoveOrder;
      const dest = displayProvince(mo.destination.provinceId, mo.destination.coast);
      return `${unitPrefix(mo.unit.provinceId)} ${displayProvince(mo.unit.provinceId)} - ${dest}${mo.viaConvoy ? ' via convoy' : ''}`;
    }
    case 'support': {
      const so = order as SupportOrder;
      if (so.supportedUnit.provinceId === so.destination.provinceId) {
        return `${unitPrefix(so.unit.provinceId)} ${displayProvince(so.unit.provinceId)} S ${displayProvince(so.supportedUnit.provinceId)}`;
      }
      return `${unitPrefix(so.unit.provinceId)} ${displayProvince(so.unit.provinceId)} S ${displayProvince(so.supportedUnit.provinceId)} - ${displayProvince(so.destination.provinceId)}`;
    }
    case 'convoy': {
      const co = order as ConvoyOrder;
      return `${unitPrefix(co.unit.provinceId)} ${displayProvince(co.unit.provinceId)} C ${displayProvince(co.convoyedUnit.provinceId)} - ${displayProvince(co.destination.provinceId)}`;
    }
    case 'retreat': {
      const ro = order as RetreatOrder;
      return `${unitPrefix(ro.unit.provinceId)} ${displayProvince(ro.unit.provinceId)} R ${displayProvince(ro.destination.provinceId)}`;
    }
    case 'disband':
      return `${unitPrefix((order as DisbandOrder).unit.provinceId)} ${displayProvince((order as DisbandOrder).unit.provinceId)} D`;
    case 'build': {
      const bo = order as BuildOrder;
      const loc = displayProvince(bo.location.provinceId, bo.location.coast);
      return `Build ${bo.unitType === 'Fleet' ? 'F' : 'A'} ${loc}`;
    }
    case 'waive':
      return `${(order as WaiveOrder).power} Waive`;
    default:
      return 'Unknown order';
  }
}

/**
 * Get the province ID that identifies which unit an order applies to.
 */
function orderUnitProvince(order: Order): string | null {
  switch (order.type) {
    case 'hold':
    case 'move':
    case 'support':
    case 'convoy':
    case 'retreat':
    case 'disband':
      return (order as any).unit.provinceId;
    case 'build':
      return (order as BuildOrder).location.provinceId;
    case 'waive':
      return null;
    default:
      return null;
  }
}

/**
 * Group orders by power and format as indented lines.
 */
function formatOrdersByCountry(orders: readonly Order[], state: GameState, indent: string = '   '): string {
  const byPower = new Map<string, string[]>();

  for (const order of orders) {
    const provId = orderUnitProvince(order);
    let power: string;
    if (order.type === 'waive') {
      power = (order as WaiveOrder).power;
    } else if (order.type === 'build') {
      power = (order as BuildOrder).power;
    } else if (provId) {
      power = getUnitPower(state, provId) ?? 'Unknown';
    } else {
      power = 'Unknown';
    }

    if (!byPower.has(power)) {
      byPower.set(power, []);
    }
    byPower.get(power)!.push(formatOrder(order, state));
  }

  const lines: string[] = [];
  for (const [power, powerOrders] of byPower) {
    lines.push(`${indent}${power}:`);
    for (const o of powerOrders) {
      lines.push(`${indent}  ${o}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a single ranked move entry.
 */
function formatRankedMove(move: RankedMove, state: GameState): string {
  const lines: string[] = [];

  // Rank header
  lines.push(`${move.rank})`);

  // Orders grouped by country
  if (move.orders.length > 0) {
    lines.push(formatOrdersByCountry(move.orders, state));
  } else {
    lines.push('   (no orders)');
  }

  // Expected value (long-term MCTS evaluation)
  const evPct = (move.expectedValue * 100).toFixed(1);
  lines.push(
    `   Expected outcome: ${evPct}% | ` +
    `Immediate: ${move.fitness.supplyCenters} SC, ${move.fitness.units} units`
  );

  // Win indicator
  if (move.fitness.isWin) {
    lines.push(`   *** WIN (${move.fitness.winType}) ***`);
  }

  // Confidence
  lines.push(
    `   Confidence: ${move.confidence.level} ` +
    `(visits: ${move.confidence.visits}, stdev: ${move.confidence.stdev.toFixed(2)})`
  );

  lines.push('');

  return lines.join('\n');
}

/**
 * Wrap a long line to fit terminal width.
 */
function wrapLine(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;

  const words = text.split('; ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 2 > maxWidth && current.length > 0) {
      lines.push(current);
      current = '     ' + word;
    } else {
      current += (current ? '; ' : '') + word;
    }
  }

  if (current) lines.push(current);

  return lines.join('\n');
}
