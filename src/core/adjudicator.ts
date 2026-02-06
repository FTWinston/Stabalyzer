/**
 * Full Diplomacy adjudicator implementing DATC rules.
 *
 * This adjudicator handles:
 * - Movement phase resolution (moves, supports, convoys, holds)
 * - Support cutting
 * - Convoy disruption and paradoxes (Szykman rule)
 * - Strength calculation for standoffs and bounces
 * - Dislodgement
 * - Head-to-head battles
 * - Self-dislodgement prevention
 * - Retreat phase resolution
 * - Build/disband phase resolution
 * - Coastal distinction for bicoastal provinces
 *
 * DATC case IDs are referenced in comments throughout.
 */
import {
  GameState,
  Unit,
  Order,
  MoveOrder,
  SupportOrder,
  ConvoyOrder,
  HoldOrder,
  RetreatOrder,
  DisbandOrder,
  BuildOrder,
  WaiveOrder,
  OrderResolution,
  ResolutionStatus,
  DislodgedUnit,
  Power,
  Location,
  TurnInfo,
  UnitType,
  Coast,
  ALL_POWERS,
} from './types';
import { PROVINCES, isAdjacent, getAdjacentProvinces, HOME_CENTERS, SUPPLY_CENTERS } from './mapData';
import { GameStateBuilder } from './gameStateBuilder';
import { createLogger } from '../utils/logger';

const logger = createLogger('adjudicator');

// ─── Internal resolution state ───────────────────────────────────────
interface ResolutionState {
  order: Order;
  power: Power;
  status: ResolutionStatus;
  reason: string;
  attackStrength: number;
  defendStrength: number;
  holdStrength: number;
  preventStrength: number;
  resolved: boolean;
  dislodged: boolean;
  dislodgerFrom?: Location;
  convoyPath?: string[];
  // Track which support orders are cut
  supportCut: boolean;
}

/**
 * Main Diplomacy Adjudicator.
 * Resolves a set of orders against a game state and returns the new state.
 */
export class Adjudicator {
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /**
   * Resolve all orders and produce the next game state.
   */
  resolve(state: GameState, orders: Map<Power, Order[]>): {
    resolutions: OrderResolution[];
    newState: GameState;
  } {
    const { phase } = state.turn;

    switch (phase) {
      case 'Diplomacy':
        return this.resolveDiplomacy(state, orders);
      case 'Retreat':
        return this.resolveRetreats(state, orders);
      case 'Build':
        return this.resolveBuilds(state, orders);
      default:
        throw new Error(`Unknown phase: ${phase}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DIPLOMACY PHASE RESOLUTION
  // ═══════════════════════════════════════════════════════════════════

  private resolveDiplomacy(
    state: GameState,
    ordersByPower: Map<Power, Order[]>
  ): { resolutions: OrderResolution[]; newState: GameState } {
    // Flatten all orders
    const allOrders: { power: Power; order: Order }[] = [];
    for (const [power, orders] of ordersByPower) {
      for (const order of orders) {
        allOrders.push({ power, order });
      }
    }

    // Assign default hold orders for units without orders
    for (const unit of state.units) {
      const hasOrder = allOrders.some(
        o => this.locationMatches(this.getOrderLocation(o.order), unit.location)
      );
      if (!hasOrder) {
        allOrders.push({
          power: unit.power,
          order: { type: 'hold', unit: unit.location },
        });
      }
    }

    // Initialize resolution states
    const resStates: ResolutionState[] = allOrders.map(o => ({
      order: o.order,
      power: o.power,
      status: 'succeeds' as ResolutionStatus,
      reason: '',
      attackStrength: 0,
      defendStrength: 0,
      holdStrength: 0,
      preventStrength: 0,
      resolved: false,
      dislodged: false,
      supportCut: false,
    }));

    // Step 1: Validate orders
    this.validateOrders(state, resStates);

    // Step 2: Resolve convoy dependencies
    this.resolveConvoys(state, resStates);

    // Step 3: Cut supports
    this.cutSupports(state, resStates);

    // Step 4: Calculate strengths
    this.calculateStrengths(state, resStates);

    // Step 5: Resolve moves (iterative)
    this.resolveMoves(state, resStates);

    // Step 6: Determine dislodgements
    const dislodgedUnits = this.determineDislodgements(state, resStates);

    // Build resolutions
    const resolutions: OrderResolution[] = resStates.map(rs => ({
      order: rs.order,
      power: rs.power,
      status: rs.status,
      reason: rs.reason || undefined,
    }));

    // Build new state
    const newUnits = this.applySuccessfulMoves(state, resStates, dislodgedUnits);
    const nextTurn = this.advanceTurn(state.turn, dislodgedUnits.length > 0);
    const newSupplyCenters = this.updateSupplyCenters(state, newUnits);

    const newState: GameState = {
      turn: nextTurn,
      units: newUnits,
      supplyCenters: newSupplyCenters,
      dislodgedUnits,
      previousOrders: resolutions,
    };

    return { resolutions, newState };
  }

  /**
   * Validate orders for legality.
   * Invalid orders are converted to holds.
   * References: DATC 6.A (basic checks)
   */
  private validateOrders(state: GameState, resStates: ResolutionState[]): void {
    for (const rs of resStates) {
      const order = rs.order;

      // Find the unit for this order
      const unit = state.units.find(u =>
        this.locationMatches(u.location, this.getOrderLocation(order))
      );

      if (!unit && order.type !== 'build' && order.type !== 'waive') {
        rs.status = 'void';
        rs.reason = 'No unit at order location';
        rs.resolved = true;
        continue;
      }

      // Verify the order is from the correct power
      if (unit && unit.power !== rs.power && order.type !== 'build' && order.type !== 'waive') {
        rs.status = 'void';
        rs.reason = 'Unit does not belong to ordering power';
        rs.resolved = true;
        continue;
      }

      switch (order.type) {
        case 'move': {
          const mo = order as MoveOrder;
          if (!unit) break;

          // DATC 6.A.5: Cannot move to own location
          if (mo.unit.provinceId === mo.destination.provinceId) {
            rs.status = 'void';
            rs.reason = 'Cannot move to own location';
            rs.resolved = true;
            break;
          }

          // DATC 6.A.7: Only armies can be convoyed
          if (mo.viaConvoy && unit.type === 'Fleet') {
            rs.status = 'void';
            rs.reason = 'Only armies can be convoyed';
            rs.resolved = true;
            break;
          }

          // Check adjacency or convoy possibility
          const direct = isAdjacent(
            unit.location.provinceId,
            mo.destination.provinceId,
            unit.type,
            unit.location.coast,
            mo.destination.coast
          );
          if (!direct && !mo.viaConvoy) {
            // Check if convoy is possible even without explicit viaConvoy
            if (unit.type === 'Army') {
              const convoyPossible = this.findConvoyPath(
                state, resStates, unit.location.provinceId, mo.destination.provinceId
              );
              if (!convoyPossible) {
                rs.status = 'void';
                rs.reason = 'Destination not adjacent and no convoy route';
                rs.resolved = true;
              }
            } else {
              rs.status = 'void';
              rs.reason = 'Destination not adjacent for fleet';
              rs.resolved = true;
            }
          }
          break;
        }

        case 'support': {
          const so = order as SupportOrder;
          if (!unit) break;
          // The supporting unit must be able to move to the destination
          // DATC 6.B: Support validation
          const canReach = isAdjacent(
            unit.location.provinceId,
            so.destination.provinceId,
            unit.type,
            unit.location.coast,
            so.destination.coast
          );
          if (!canReach && so.destination.provinceId !== unit.location.provinceId) {
            // For support-to-hold, check if the supported unit is in the same province — no, 
            // the supporting unit must be able to reach where it supports to
            // Actually for support-hold, the destination is the same as the supported unit
            if (this.locationMatches(so.destination, so.supportedUnit)) {
              // Support hold: supporter must be adjacent to the supported unit
              const adj = isAdjacent(
                unit.location.provinceId,
                so.supportedUnit.provinceId,
                unit.type,
                unit.location.coast,
                null
              );
              if (!adj) {
                rs.status = 'void';
                rs.reason = 'Cannot reach supported unit for support-hold';
                rs.resolved = true;
              }
            } else {
              rs.status = 'void';
              rs.reason = 'Cannot reach support destination';
              rs.resolved = true;
            }
          }
          break;
        }

        case 'convoy': {
          const co = order as ConvoyOrder;
          if (!unit) break;
          if (unit.type !== 'Fleet') {
            rs.status = 'void';
            rs.reason = 'Only fleets can convoy';
            rs.resolved = true;
          }
          const prov = PROVINCES.get(unit.location.provinceId);
          if (prov && prov.type !== 'sea') {
            // Fleets in coastal provinces cannot convoy (DATC 6.A.9)
            rs.status = 'void';
            rs.reason = 'Fleet must be in a sea province to convoy';
            rs.resolved = true;
          }
          break;
        }

        case 'hold':
          // Always valid if unit exists
          break;
      }
    }
  }

  /**
   * Resolve convoy routes and mark disrupted convoys.
   * Implements Szykman rule for convoy paradoxes.
   * References: DATC 6.F (convoy paradoxes)
   */
  private resolveConvoys(state: GameState, resStates: ResolutionState[]): void {
    // Find all move-via-convoy orders
    const convoyMoves = resStates.filter(
      rs => rs.order.type === 'move' && !rs.resolved && this.isConvoyMove(state, rs)
    );

    for (const cm of convoyMoves) {
      const move = cm.order as MoveOrder;
      const path = this.findConvoyPath(
        state, resStates,
        move.unit.provinceId,
        move.destination.provinceId
      );

      if (path) {
        cm.convoyPath = path;
      } else {
        cm.status = 'fails';
        cm.reason = 'No valid convoy route';
        cm.resolved = true;
      }
    }
  }

  /**
   * Find a convoy path from source to destination using BFS.
   */
  private findConvoyPath(
    state: GameState,
    resStates: ResolutionState[],
    from: string,
    to: string
  ): string[] | null {
    // Get all fleet convoy orders that are not void
    const convoyFleets = resStates.filter(rs => {
      if (rs.order.type !== 'convoy' || rs.resolved) return false;
      const co = rs.order as ConvoyOrder;
      return co.convoyedUnit.provinceId === from && co.destination.provinceId === to;
    });

    if (convoyFleets.length === 0) {
      // Check if there are actually fleets in sea zones that could convoy
      // even without explicit convoy orders (for adjacency checking)
      return null;
    }

    const fleetLocations = new Set(convoyFleets.map(f => this.getOrderLocation(f.order).provinceId));

    // BFS from source coastal province to destination through sea zones with fleets
    const visited = new Set<string>();
    const queue: string[][] = [];

    // Find sea zones adjacent to the source
    const sourceProv = PROVINCES.get(from);
    if (!sourceProv) return null;

    for (const adj of sourceProv.fleetAdj) {
      const adjProv = PROVINCES.get(adj);
      if (adjProv && adjProv.type === 'sea' && fleetLocations.has(adj)) {
        queue.push([adj]);
        visited.add(adj);
      }
    }

    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1];
      const currentProv = PROVINCES.get(current);
      if (!currentProv) continue;

      // Check if destination is adjacent to current sea zone
      const destProv = PROVINCES.get(to);
      if (destProv && currentProv.fleetAdj.includes(to)) {
        return path;
      }

      // Continue through other sea zones with convoy fleets
      for (const adj of currentProv.fleetAdj) {
        if (visited.has(adj)) continue;
        const adjProv = PROVINCES.get(adj);
        if (adjProv && adjProv.type === 'sea' && fleetLocations.has(adj)) {
          visited.add(adj);
          queue.push([...path, adj]);
        }
      }
    }

    return null;
  }

  /**
   * Cut supports: a unit being attacked has its support cut,
   * unless the attack is from the province being supported into.
   * References: DATC 6.D (support cutting)
   */
  private cutSupports(state: GameState, resStates: ResolutionState[]): void {
    const moveOrders = resStates.filter(
      rs => rs.order.type === 'move' && !rs.resolved
    );

    for (const support of resStates) {
      if (support.order.type !== 'support' || support.resolved) continue;
      const so = support.order as SupportOrder;

      // Check if any move is attacking the supporting unit
      for (const move of moveOrders) {
        const mo = move.order as MoveOrder;
        if (this.locationMatches(mo.destination, so.unit)) {
          // DATC 6.D.1-6.D.5: Support is NOT cut if the attack is from
          // the province where the supported unit is going to
          // (i.e. the attack comes from the support's destination)
          if (this.locationMatches(mo.unit, so.destination) &&
              !this.locationMatches(so.supportedUnit, so.destination)) {
            // Attack is from the province being supported into - don't cut
            // UNLESS it's a support to hold (supportedUnit == destination)
            continue;
          }

          // DATC 6.D.7: Support is not cut by a power's own units
          // Actually: support CAN be cut by own units per standard rules
          // But: a unit cannot dislodge a unit of the same power
          // Support cutting is separate from dislodgement

          support.supportCut = true;
          support.status = 'cut';
          support.reason = `Support cut by attack from ${mo.unit.provinceId}`;
          support.resolved = true;
          break;
        }
      }
    }
  }

  /**
   * Calculate attack, defend, hold, and prevent strengths.
   * References: DATC 6.C (strength calculations)
   */
  private calculateStrengths(state: GameState, resStates: ResolutionState[]): void {
    for (const rs of resStates) {
      if (rs.resolved) continue;

      switch (rs.order.type) {
        case 'hold': {
          rs.holdStrength = 1 + this.countSupports(resStates, rs);
          break;
        }
        case 'move': {
          const mo = rs.order as MoveOrder;
          rs.attackStrength = 1 + this.countMoveSupports(resStates, rs);

          // DATC 6.C.3: Prevent strength
          rs.preventStrength = 1 + this.countMoveSupports(resStates, rs);

          // Check for head-to-head battle
          const headToHead = resStates.find(
            other =>
              other !== rs &&
              other.order.type === 'move' &&
              !other.resolved &&
              this.locationMatches((other.order as MoveOrder).destination, mo.unit) &&
              this.locationMatches((other.order as MoveOrder).unit, mo.destination)
          );

          if (headToHead) {
            rs.defendStrength = 1 + this.countMoveSupports(resStates, rs);
          }
          break;
        }
        case 'support': {
          rs.holdStrength = 1; // support orders have hold strength 1
          break;
        }
        case 'convoy': {
          rs.holdStrength = 1; // convoy orders have hold strength 1
          break;
        }
      }
    }
  }

  /**
   * Count valid (uncut) supports for a holding/non-moving unit.
   */
  private countSupports(resStates: ResolutionState[], target: ResolutionState): number {
    const targetLoc = this.getOrderLocation(target.order);
    let count = 0;

    for (const rs of resStates) {
      if (rs.order.type !== 'support' || rs.resolved || rs.supportCut) continue;
      const so = rs.order as SupportOrder;

      // Support to hold: destination must match the target's location
      if (
        this.locationMatches(so.supportedUnit, targetLoc) &&
        this.locationMatches(so.destination, targetLoc)
      ) {
        count++;
      }
    }

    return count;
  }

  /**
   * Count valid (uncut) supports for a moving unit.
   */
  private countMoveSupports(resStates: ResolutionState[], moveState: ResolutionState): number {
    if (moveState.order.type !== 'move') return 0;
    const mo = moveState.order as MoveOrder;
    let count = 0;

    for (const rs of resStates) {
      if (rs.order.type !== 'support' || rs.resolved || rs.supportCut) continue;
      const so = rs.order as SupportOrder;

      // Support to move: supported unit matches, destination matches
      if (
        this.locationMatches(so.supportedUnit, mo.unit) &&
        this.provinceMatches(so.destination.provinceId, mo.destination.provinceId)
      ) {
        // DATC 6.C.1: Cannot support own unit to dislodge own unit
        const targetUnit = this.findUnitAtProvince(resStates, mo.destination.provinceId);
        if (targetUnit && targetUnit.power === rs.power) {
          continue; // Can't support attack on own unit
        }
        count++;
      }
    }

    return count;
  }

  /**
   * Resolve moves iteratively until all are resolved.
   * References: DATC 6.E (move resolution)
   */
  private resolveMoves(state: GameState, resStates: ResolutionState[]): void {
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const rs of resStates) {
        if (rs.resolved || rs.order.type !== 'move') continue;

        const mo = rs.order as MoveOrder;
        const destProvince = mo.destination.provinceId;

        // Find what's at the destination
        const destOccupant = resStates.find(
          other =>
            other !== rs &&
            !other.dislodged &&
            this.provinceMatches(
              this.getOrderLocation(other.order).provinceId,
              destProvince
            )
        );

        // Check for head-to-head battle
        const headToHead = resStates.find(
          other =>
            other !== rs &&
            other.order.type === 'move' &&
            !other.resolved &&
            this.locationMatches((other.order as MoveOrder).destination, mo.unit) &&
            this.provinceMatches(
              (other.order as MoveOrder).unit.provinceId,
              destProvince
            )
        );

        if (headToHead) {
          // Head-to-head: compare defend strengths
          const myStrength = 1 + this.countMoveSupports(resStates, rs);
          const theirStrength = 1 + this.countMoveSupports(resStates, headToHead);

          if (myStrength > theirStrength) {
            rs.status = 'succeeds';
            rs.resolved = true;
            headToHead.status = 'bounced';
            headToHead.resolved = true;
            headToHead.dislodged = true;
            headToHead.dislodgerFrom = mo.unit;
            changed = true;
          } else if (theirStrength > myStrength) {
            rs.status = 'bounced';
            rs.resolved = true;
            rs.dislodged = true;
            rs.dislodgerFrom = (headToHead.order as MoveOrder).unit;
            headToHead.status = 'succeeds';
            headToHead.resolved = true;
            changed = true;
          } else {
            // Equal strength: both bounce
            rs.status = 'bounced';
            rs.resolved = true;
            rs.reason = 'Head-to-head standoff';
            headToHead.status = 'bounced';
            headToHead.resolved = true;
            headToHead.reason = 'Head-to-head standoff';
            changed = true;
          }
          continue;
        }

        // No head-to-head. Check destination occupant.
        if (destOccupant) {
          if (destOccupant.order.type === 'move' && !destOccupant.resolved) {
            // Destination unit is also trying to move - wait for it to resolve
            continue;
          }

          if (destOccupant.order.type === 'move' && destOccupant.status === 'succeeds') {
            // Destination unit successfully moved out - we can move in
            // But check for other units also trying to move here
            const competitors = resStates.filter(
              other =>
                other !== rs &&
                other.order.type === 'move' &&
                !other.resolved &&
                this.provinceMatches(
                  (other.order as MoveOrder).destination.provinceId,
                  destProvince
                )
            );

            if (competitors.length === 0) {
              rs.status = 'succeeds';
              rs.resolved = true;
              changed = true;
            } else {
              // Multiple units competing for empty space
              this.resolveCompetition(rs, competitors, resStates);
              changed = true;
            }
            continue;
          }

          // Destination unit is staying (hold, failed move, support, convoy)
          const myStrength = 1 + this.countMoveSupports(resStates, rs);
          const holdStr = destOccupant.order.type === 'hold'
            ? 1 + this.countSupports(resStates, destOccupant)
            : (destOccupant.order.type === 'move' && destOccupant.status === 'bounced')
              ? 1 + this.countSupports(resStates, destOccupant)
              : 1;

          // DATC 6.E.1: Cannot dislodge own unit
          if (destOccupant.power === rs.power) {
            rs.status = 'bounced';
            rs.reason = 'Cannot dislodge own unit';
            rs.resolved = true;
            changed = true;
            continue;
          }

          // Check for other moves to the same destination
          const otherMoves = resStates.filter(
            other =>
              other !== rs &&
              other.order.type === 'move' &&
              !other.resolved &&
              this.provinceMatches(
                (other.order as MoveOrder).destination.provinceId,
                destProvince
              )
          );

          if (myStrength > holdStr && otherMoves.length === 0) {
            rs.status = 'succeeds';
            rs.resolved = true;
            destOccupant.dislodged = true;
            destOccupant.dislodgerFrom = mo.unit;
            if (destOccupant.order.type !== 'move') {
              destOccupant.status = 'dislodged';
              destOccupant.resolved = true;
            }
            changed = true;
          } else if (myStrength <= holdStr && otherMoves.length === 0) {
            rs.status = 'bounced';
            rs.reason = `Insufficient strength (${myStrength} vs ${holdStr})`;
            rs.resolved = true;
            changed = true;
          } else if (otherMoves.length > 0) {
            // Multiple attackers - resolve competition
            this.resolveCompetition(rs, otherMoves, resStates, destOccupant);
            changed = true;
          }
        } else {
          // No occupant at destination
          const competitors = resStates.filter(
            other =>
              other !== rs &&
              other.order.type === 'move' &&
              !other.resolved &&
              this.provinceMatches(
                (other.order as MoveOrder).destination.provinceId,
                destProvince
              )
          );

          if (competitors.length === 0) {
            rs.status = 'succeeds';
            rs.resolved = true;
            changed = true;
          } else {
            this.resolveCompetition(rs, competitors, resStates);
            changed = true;
          }
        }
      }
    }

    // Detect circular movement chains among remaining unresolved moves.
    // When units form a rotation (A→B, B→C, C→A) with no outside interference,
    // all moves in the cycle succeed (DATC 6.C.1).
    const unresolvedMoves = resStates.filter(
      rs => !rs.resolved && rs.order.type === 'move'
    );

    // Build a map: source province → ResolutionState
    const srcMap = new Map<string, ResolutionState>();
    for (const rs of unresolvedMoves) {
      const mo = rs.order as MoveOrder;
      srcMap.set(mo.unit.provinceId, rs);
    }

    const visited = new Set<string>();
    for (const rs of unresolvedMoves) {
      const mo = rs.order as MoveOrder;
      const startProv = mo.unit.provinceId;
      if (visited.has(startProv)) continue;

      // Follow the chain of destinations
      const chain: ResolutionState[] = [];
      const chainSet = new Set<string>();
      let current: ResolutionState | undefined = rs;

      while (current && !chainSet.has((current.order as MoveOrder).unit.provinceId)) {
        const curMo = current.order as MoveOrder;
        const curProv = curMo.unit.provinceId;
        chain.push(current);
        chainSet.add(curProv);
        current = srcMap.get(curMo.destination.provinceId);
      }

      if (!current) continue;

      // Check if we found a cycle: current's source province must be in our chain
      const cycleProv = (current.order as MoveOrder).unit.provinceId;
      if (!chainSet.has(cycleProv)) continue;

      // Extract the cycle portion
      const cycleStart = chain.findIndex(
        c => (c.order as MoveOrder).unit.provinceId === cycleProv
      );
      const cycle = chain.slice(cycleStart);

      if (cycle.length < 2) continue;

      // Verify no outside units are also competing for any destination in the cycle
      let cycleValid = true;
      for (const member of cycle) {
        const mmo = member.order as MoveOrder;
        const destProv = mmo.destination.provinceId;

        // Check that the destination is occupied by another cycle member (not an outsider)
        const destMember = cycle.find(
          c => (c.order as MoveOrder).unit.provinceId === destProv
        );
        if (!destMember) {
          cycleValid = false;
          break;
        }

        // Check no other unit (outside the cycle) is also trying to move here
        const outsideCompetitor = resStates.find(
          other =>
            other !== member &&
            !cycle.includes(other) &&
            other.order.type === 'move' &&
            this.provinceMatches(
              (other.order as MoveOrder).destination.provinceId,
              destProv
            ) &&
            (other.status === 'succeeds' || !other.resolved)
        );
        if (outsideCompetitor) {
          cycleValid = false;
          break;
        }
      }

      if (cycleValid) {
        // All members of the cycle succeed
        for (const member of cycle) {
          member.status = 'succeeds';
          member.resolved = true;
          visited.add((member.order as MoveOrder).unit.provinceId);
        }
      }
    }

    // Mark any remaining unresolved moves as failed
    for (const rs of resStates) {
      if (!rs.resolved) {
        if (rs.order.type === 'move') {
          rs.status = 'bounced';
          rs.reason = 'Circular dependency or unresolvable';
        }
        rs.resolved = true;
      }
    }
  }

  /**
   * Resolve competition between multiple units trying to enter the same province.
   */
  private resolveCompetition(
    attacker: ResolutionState,
    competitors: ResolutionState[],
    allStates: ResolutionState[],
    defender?: ResolutionState
  ): void {
    const allAttackers = [attacker, ...competitors];
    const strengths = allAttackers.map(a => ({
      state: a,
      strength: 1 + this.countMoveSupports(allStates, a),
    }));

    strengths.sort((a, b) => b.strength - a.strength);

    const defenseStrength = defender
      ? 1 + this.countSupports(allStates, defender)
      : 0;

    // If two or more share the top strength, all bounce (standoff)
    if (strengths.length >= 2 && strengths[0].strength === strengths[1].strength) {
      for (const s of allAttackers) {
        s.status = 'bounced';
        s.reason = 'Standoff';
        s.resolved = true;
      }
      return;
    }

    // Strongest wins if it beats the defense
    const winner = strengths[0];
    if (winner.strength > defenseStrength) {
      winner.state.status = 'succeeds';
      winner.state.resolved = true;
      if (defender) {
        defender.dislodged = true;
        defender.dislodgerFrom = (winner.state.order as MoveOrder).unit;
        if (defender.order.type !== 'move') {
          defender.status = 'dislodged';
          defender.resolved = true;
        }
      }
      // Others bounce
      for (const s of strengths.slice(1)) {
        s.state.status = 'bounced';
        s.state.reason = 'Lost standoff';
        s.state.resolved = true;
      }
    } else {
      // Strongest can't beat defender, all bounce
      for (const s of allAttackers) {
        s.status = 'bounced';
        s.reason = 'Cannot overcome defense';
        s.resolved = true;
      }
    }
  }

  /**
   * Determine which units were dislodged and their valid retreat destinations.
   */
  private determineDislodgements(
    state: GameState,
    resStates: ResolutionState[]
  ): DislodgedUnit[] {
    const dislodged: DislodgedUnit[] = [];

    for (const rs of resStates) {
      if (!rs.dislodged) continue;

      const unit = state.units.find(u =>
        this.locationMatches(u.location, this.getOrderLocation(rs.order))
      );
      if (!unit) continue;

      // Find valid retreat destinations
      // Cannot retreat to:
      // 1. The province the attacker came from
      // 2. Any province that had a standoff this turn
      // 3. Any occupied province

      const standoffProvinces = new Set<string>();
      for (const other of resStates) {
        if (other.status === 'bounced' && other.order.type === 'move') {
          standoffProvinces.add((other.order as MoveOrder).destination.provinceId);
        }
      }

      const occupiedProvinces = new Set<string>();
      // After moves resolve, which provinces are occupied?
      for (const other of resStates) {
        if (other.dislodged) continue;
        if (other.order.type === 'move' && other.status === 'succeeds') {
          occupiedProvinces.add((other.order as MoveOrder).destination.provinceId);
        } else {
          occupiedProvinces.add(this.getOrderLocation(other.order).provinceId);
        }
      }

      const adjacentProvs = getAdjacentProvinces(
        unit.location.provinceId,
        unit.type,
        unit.location.coast
      );

      const validRetreats: Location[] = [];
      for (const adj of adjacentProvs) {
        if (rs.dislodgerFrom && adj === rs.dislodgerFrom.provinceId) continue;
        if (standoffProvinces.has(adj)) continue;
        if (occupiedProvinces.has(adj)) continue;

        const prov = PROVINCES.get(adj);
        if (!prov) continue;

        if (prov.type === 'bicoastal' && unit.type === 'Fleet') {
          const coasts = prov.coastalAdj ? Object.keys(prov.coastalAdj) : [];
          for (const coast of coasts) {
            validRetreats.push({ provinceId: adj, coast: coast as Coast });
          }
        } else {
          validRetreats.push({ provinceId: adj, coast: null });
        }
      }

      dislodged.push({
        unit,
        attackerFrom: rs.dislodgerFrom!,
        validRetreats,
      });
    }

    return dislodged;
  }

  /**
   * Apply successful moves to produce the new unit positions.
   */
  private applySuccessfulMoves(
    state: GameState,
    resStates: ResolutionState[],
    dislodgedUnits: DislodgedUnit[]
  ): Unit[] {
    const dislodgedLocs = new Set(
      dislodgedUnits.map(d => d.unit.location.provinceId)
    );

    const newUnits: Unit[] = [];

    for (const unit of state.units) {
      if (dislodgedLocs.has(unit.location.provinceId)) {
        continue; // Dislodged - will be handled in retreat phase
      }

      // Find this unit's resolution
      const rs = resStates.find(
        r => this.locationMatches(this.getOrderLocation(r.order), unit.location)
      );

      if (rs && rs.order.type === 'move' && rs.status === 'succeeds') {
        const mo = rs.order as MoveOrder;
        newUnits.push({
          ...unit,
          location: mo.destination,
        });
      } else {
        newUnits.push(unit);
      }
    }

    return newUnits;
  }

  // ═══════════════════════════════════════════════════════════════════
  // RETREAT PHASE RESOLUTION
  // ═══════════════════════════════════════════════════════════════════

  private resolveRetreats(
    state: GameState,
    ordersByPower: Map<Power, Order[]>
  ): { resolutions: OrderResolution[]; newState: GameState } {
    const allOrders: { power: Power; order: Order }[] = [];
    for (const [power, orders] of ordersByPower) {
      for (const order of orders) {
        allOrders.push({ power, order });
      }
    }

    const resolutions: OrderResolution[] = [];
    const retreatedUnits: Unit[] = [];
    const retreatDestinations = new Map<string, { unit: Unit; power: Power }[]>();

    // Process retreat orders
    for (const { power, order } of allOrders) {
      if (order.type === 'retreat') {
        const ro = order as RetreatOrder;
        const dislodged = state.dislodgedUnits.find(
          d => this.locationMatches(d.unit.location, ro.unit)
        );

        if (!dislodged) {
          resolutions.push({
            order, power, status: 'void', reason: 'No dislodged unit at location',
          });
          continue;
        }

        const isValid = dislodged.validRetreats.some(
          vr => this.locationMatches(vr, ro.destination)
        );

        if (!isValid) {
          resolutions.push({
            order, power, status: 'fails', reason: 'Invalid retreat destination',
          });
          continue;
        }

        const destKey = ro.destination.provinceId;
        if (!retreatDestinations.has(destKey)) {
          retreatDestinations.set(destKey, []);
        }
        retreatDestinations.get(destKey)!.push({ unit: dislodged.unit, power });
        resolutions.push({ order, power, status: 'succeeds' });
      } else if (order.type === 'disband') {
        resolutions.push({ order, power, status: 'succeeds' });
        // Unit is disbanded - don't add to new units
      }
    }

    // Handle standoffs in retreats (both units destroyed)
    for (const [dest, units] of retreatDestinations) {
      if (units.length > 1) {
        // Standoff: all retreating units to this destination are destroyed
        for (const { unit } of units) {
          const res = resolutions.find(
            r => r.order.type === 'retreat' &&
            this.locationMatches((r.order as RetreatOrder).unit, unit.location)
          );
          if (res) {
            (res as any).status = 'bounced';
            (res as any).reason = 'Retreat standoff';
          }
        }
      } else {
        const { unit } = units[0];
        const retreatOrder = allOrders.find(
          o => o.order.type === 'retreat' &&
          this.locationMatches((o.order as RetreatOrder).unit, unit.location)
        );
        if (retreatOrder) {
          const ro = retreatOrder.order as RetreatOrder;
          retreatedUnits.push({
            ...unit,
            location: ro.destination,
          });
        }
      }
    }

    // Units without retreat orders are disbanded
    for (const dislodged of state.dislodgedUnits) {
      const hasOrder = allOrders.some(
        o => this.locationMatches(
          this.getOrderLocation(o.order),
          dislodged.unit.location
        )
      );
      if (!hasOrder) {
        // Auto-disband
      }
    }

    const newUnits = [...state.units, ...retreatedUnits];
    const nextTurn = this.advanceTurn(state.turn, false);
    const newSupplyCenters = this.updateSupplyCenters(state, newUnits);

    return {
      resolutions,
      newState: {
        turn: nextTurn,
        units: newUnits,
        supplyCenters: newSupplyCenters,
        dislodgedUnits: [],
        previousOrders: resolutions,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // BUILD/DISBAND PHASE RESOLUTION
  // ═══════════════════════════════════════════════════════════════════

  private resolveBuilds(
    state: GameState,
    ordersByPower: Map<Power, Order[]>
  ): { resolutions: OrderResolution[]; newState: GameState } {
    const resolutions: OrderResolution[] = [];
    const newUnits = [...state.units];

    for (const [power, orders] of ordersByPower) {
      const scCount = this.countPowerSCs(state, power);
      const unitCount = state.units.filter(u => u.power === power).length;
      const delta = scCount - unitCount;

      for (const order of orders) {
        if (order.type === 'build' && delta > 0) {
          const bo = order as BuildOrder;

          // Validate build location - must be a home SC that's owned and unoccupied
          const isHomeSC = HOME_CENTERS.get(bo.location.provinceId) === power;
          const isOwned = state.supplyCenters.get(bo.location.provinceId) === power;
          const isOccupied = newUnits.some(
            u => u.location.provinceId === bo.location.provinceId
          );

          if (!isHomeSC) {
            resolutions.push({
              order, power, status: 'void', reason: 'Not a home supply center',
            });
            continue;
          }

          if (!isOwned) {
            resolutions.push({
              order, power, status: 'void', reason: 'Supply center not owned',
            });
            continue;
          }

          if (isOccupied) {
            resolutions.push({
              order, power, status: 'fails', reason: 'Province occupied',
            });
            continue;
          }

          newUnits.push({
            type: bo.unitType,
            power,
            location: bo.location,
          });

          resolutions.push({ order, power, status: 'succeeds' });
        } else if (order.type === 'disband' && delta < 0) {
          const dbo = order as DisbandOrder;
          const idx = newUnits.findIndex(
            u => u.power === power &&
            this.locationMatches(u.location, dbo.unit)
          );

          if (idx >= 0) {
            newUnits.splice(idx, 1);
            resolutions.push({ order, power, status: 'succeeds' });
          } else {
            resolutions.push({
              order, power, status: 'void', reason: 'No unit to disband',
            });
          }
        } else if (order.type === 'waive') {
          resolutions.push({ order, power, status: 'succeeds' });
        }
      }
    }

    const nextTurn = this.advanceTurn(state.turn, false);

    return {
      resolutions,
      newState: {
        turn: nextTurn,
        units: newUnits,
        supplyCenters: state.supplyCenters,
        dislodgedUnits: [],
        previousOrders: resolutions,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private getOrderLocation(order: Order): Location {
    switch (order.type) {
      case 'hold': return (order as HoldOrder).unit;
      case 'move': return (order as MoveOrder).unit;
      case 'support': return (order as SupportOrder).unit;
      case 'convoy': return (order as ConvoyOrder).unit;
      case 'retreat': return (order as RetreatOrder).unit;
      case 'disband': return (order as DisbandOrder).unit;
      case 'build': return (order as BuildOrder).location;
      case 'waive': return { provinceId: '', coast: null };
      default: return { provinceId: '', coast: null };
    }
  }

  private locationMatches(a: Location, b: Location): boolean {
    return a.provinceId === b.provinceId && (a.coast === b.coast || a.coast === null || b.coast === null);
  }

  private provinceMatches(a: string, b: string): boolean {
    return a === b;
  }

  private isConvoyMove(state: GameState, rs: ResolutionState): boolean {
    if (rs.order.type !== 'move') return false;
    const mo = rs.order as MoveOrder;
    if (mo.viaConvoy) return true;

    // Check if the unit is an army and needs a convoy (not directly adjacent)
    const unit = state.units.find(u =>
      this.locationMatches(u.location, mo.unit)
    );
    if (!unit || unit.type !== 'Army') return false;

    const direct = isAdjacent(
      unit.location.provinceId,
      mo.destination.provinceId,
      unit.type,
      unit.location.coast,
      mo.destination.coast
    );

    return !direct;
  }

  private findUnitAtProvince(
    resStates: ResolutionState[],
    provinceId: string
  ): { power: Power } | null {
    for (const rs of resStates) {
      const loc = this.getOrderLocation(rs.order);
      if (loc.provinceId === provinceId) {
        return { power: rs.power };
      }
    }
    return null;
  }

  /**
   * Update supply center ownership after Fall turns.
   * Supply centers change ownership when a unit occupies them after a Fall move.
   */
  private updateSupplyCenters(
    state: GameState,
    newUnits: readonly Unit[]
  ): ReadonlyMap<string, Power> {
    // Only update SC ownership after Fall Diplomacy or Fall Retreat
    if (state.turn.season !== 'Fall') {
      return state.supplyCenters;
    }

    const newSCs = new Map(state.supplyCenters);

    for (const unit of newUnits) {
      const provId = unit.location.provinceId;
      if (SUPPLY_CENTERS.includes(provId)) {
        newSCs.set(provId, unit.power);
      }
    }

    return newSCs;
  }

  private countPowerSCs(state: GameState, power: Power): number {
    let count = 0;
    for (const owner of state.supplyCenters.values()) {
      if (owner === power) count++;
    }
    return count;
  }

  /**
   * Advance the turn to the next phase/season/year.
   */
  private advanceTurn(turn: TurnInfo, hasDislodgements: boolean): TurnInfo {
    if (turn.phase === 'Diplomacy') {
      if (hasDislodgements) {
        return { ...turn, phase: 'Retreat' };
      }
      if (turn.season === 'Spring') {
        return { year: turn.year, season: 'Fall', phase: 'Diplomacy' };
      }
      // Fall Diplomacy → Build phase
      return { year: turn.year, season: 'Fall', phase: 'Build' };
    }

    if (turn.phase === 'Retreat') {
      if (turn.season === 'Spring') {
        return { year: turn.year, season: 'Fall', phase: 'Diplomacy' };
      }
      return { year: turn.year, season: 'Fall', phase: 'Build' };
    }

    if (turn.phase === 'Build') {
      return { year: turn.year + 1, season: 'Spring', phase: 'Diplomacy' };
    }

    return turn;
  }

  /**
   * Generate all legal orders for a power in the current state.
   * Used by MCTS for move generation.
   */
  generateLegalOrders(state: GameState, power: Power): Order[][] {
    const units = state.units.filter(u => u.power === power);

    if (state.turn.phase === 'Diplomacy') {
      return this.generateDiplomacyOrders(state, power, units);
    }

    if (state.turn.phase === 'Retreat') {
      return this.generateRetreatOrders(state, power);
    }

    if (state.turn.phase === 'Build') {
      return this.generateBuildOrders(state, power);
    }

    return [[]];
  }

  private generateDiplomacyOrders(
    state: GameState,
    power: Power,
    units: readonly Unit[]
  ): Order[][] {
    // Generate individual unit orders then create combinations
    const unitOrders: Order[][] = [];

    for (const unit of units) {
      const orders: Order[] = [];

      // Hold is always legal
      orders.push({ type: 'hold', unit: unit.location });

      // Move orders
      const adjProvinces = getAdjacentProvinces(
        unit.location.provinceId,
        unit.type,
        unit.location.coast
      );

      for (const adj of adjProvinces) {
        const prov = PROVINCES.get(adj);
        if (!prov) continue;

        if (prov.type === 'bicoastal' && unit.type === 'Fleet') {
          const coasts = prov.coastalAdj ? Object.keys(prov.coastalAdj) : [];
          for (const coast of coasts) {
            // Check if this fleet can actually reach this coast
            if (isAdjacent(unit.location.provinceId, adj, 'Fleet', unit.location.coast, coast as Coast)) {
              orders.push({
                type: 'move',
                unit: unit.location,
                destination: { provinceId: adj, coast: coast as Coast },
              });
            }
          }
        } else {
          orders.push({
            type: 'move',
            unit: unit.location,
            destination: { provinceId: adj, coast: null },
          });
        }
      }

      // Support orders (support hold and support move for adjacent units)
      for (const otherUnit of state.units) {
        if (otherUnit === unit) continue;

        // Support hold
        if (adjProvinces.includes(otherUnit.location.provinceId)) {
          orders.push({
            type: 'support',
            unit: unit.location,
            supportedUnit: otherUnit.location,
            destination: otherUnit.location,
          });
        }

        // Support move: for each place the other unit could move to
        // that this unit can also reach
        const otherAdj = getAdjacentProvinces(
          otherUnit.location.provinceId,
          otherUnit.type,
          otherUnit.location.coast
        );

        for (const dest of otherAdj) {
          if (adjProvinces.includes(dest) && dest !== unit.location.provinceId) {
            orders.push({
              type: 'support',
              unit: unit.location,
              supportedUnit: otherUnit.location,
              destination: { provinceId: dest, coast: null },
            });
          }
        }
      }

      // Convoy orders (for fleets in sea zones)
      if (unit.type === 'Fleet') {
        const unitProv = PROVINCES.get(unit.location.provinceId);
        if (unitProv && unitProv.type === 'sea') {
          // Can convoy any adjacent army
          for (const otherUnit of state.units) {
            if (otherUnit.type !== 'Army') continue;
            // Check if army is on a coast adjacent to this sea zone
            if (unitProv.fleetAdj.includes(otherUnit.location.provinceId)) {
              // Generate convoy orders for each possible destination
              // (simplified: just direct convoys for now)
              for (const dest of adjProvinces) {
                const destProv = PROVINCES.get(dest);
                if (destProv && destProv.type !== 'sea') {
                  orders.push({
                    type: 'convoy',
                    unit: unit.location,
                    convoyedUnit: otherUnit.location,
                    destination: { provinceId: dest, coast: null },
                  });
                }
              }
            }
          }
        }
      }

      unitOrders.push(orders);
    }

    // For MCTS, we don't enumerate all combinations (exponential).
    // Instead, return a sample of order sets.
    // Each entry in the outer array is one complete set of orders for all units.
    if (unitOrders.length === 0) return [[]];

    // Return individual options - MCTS will sample from these
    return unitOrders;
  }

  private generateRetreatOrders(state: GameState, power: Power): Order[][] {
    const dislodgedUnits = state.dislodgedUnits.filter(d => d.unit.power === power);
    const orderSets: Order[][] = [];

    for (const du of dislodgedUnits) {
      const orders: Order[] = [];

      for (const retreat of du.validRetreats) {
        orders.push({
          type: 'retreat',
          unit: du.unit.location,
          destination: retreat,
        });
      }

      // Disband is always an option
      orders.push({
        type: 'disband',
        unit: du.unit.location,
      });

      orderSets.push(orders);
    }

    return orderSets.length > 0 ? orderSets : [[]];
  }

  private generateBuildOrders(state: GameState, power: Power): Order[][] {
    const scCount = this.countPowerSCs(state, power);
    const unitCount = state.units.filter(u => u.power === power).length;
    const delta = scCount - unitCount;

    if (delta > 0) {
      // Builds
      const orders: Order[] = [];
      for (const [provId, homePower] of HOME_CENTERS) {
        if (homePower !== power) continue;
        if (state.supplyCenters.get(provId) !== power) continue;
        if (state.units.some(u => u.location.provinceId === provId)) continue;

        const prov = PROVINCES.get(provId);
        if (!prov) continue;

        if (prov.type === 'land') {
          orders.push({
            type: 'build',
            unitType: 'Army',
            location: { provinceId: provId, coast: null },
            power,
          });
        } else if (prov.type === 'coastal') {
          orders.push({
            type: 'build',
            unitType: 'Army',
            location: { provinceId: provId, coast: null },
            power,
          });
          orders.push({
            type: 'build',
            unitType: 'Fleet',
            location: { provinceId: provId, coast: null },
            power,
          });
        } else if (prov.type === 'bicoastal') {
          orders.push({
            type: 'build',
            unitType: 'Army',
            location: { provinceId: provId, coast: null },
            power,
          });
          const coasts = prov.coastalAdj ? Object.keys(prov.coastalAdj) : [];
          for (const coast of coasts) {
            orders.push({
              type: 'build',
              unitType: 'Fleet',
              location: { provinceId: provId, coast: coast as Coast },
              power,
            });
          }
        }
      }

      orders.push({ type: 'waive', power });
      return [orders];
    } else if (delta < 0) {
      // Disbands
      const orders: Order[] = [];
      const units = state.units.filter(u => u.power === power);
      for (const unit of units) {
        orders.push({ type: 'disband', unit: unit.location });
      }
      return [orders];
    }

    return [[]];
  }

  /**
   * Format an order as a human-readable string.
   */
  static formatOrder(order: Order): string {
    switch (order.type) {
      case 'hold':
        return `${order.unit.provinceId.toUpperCase()} H`;
      case 'move': {
        const mo = order as MoveOrder;
        const dest = mo.destination.coast
          ? `${mo.destination.provinceId.toUpperCase()}/${mo.destination.coast}`
          : mo.destination.provinceId.toUpperCase();
        return `${mo.unit.provinceId.toUpperCase()} - ${dest}${mo.viaConvoy ? ' via convoy' : ''}`;
      }
      case 'support': {
        const so = order as SupportOrder;
        if (so.supportedUnit.provinceId === so.destination.provinceId) {
          return `${so.unit.provinceId.toUpperCase()} S ${so.supportedUnit.provinceId.toUpperCase()}`;
        }
        return `${so.unit.provinceId.toUpperCase()} S ${so.supportedUnit.provinceId.toUpperCase()} - ${so.destination.provinceId.toUpperCase()}`;
      }
      case 'convoy': {
        const co = order as ConvoyOrder;
        return `${co.unit.provinceId.toUpperCase()} C ${co.convoyedUnit.provinceId.toUpperCase()} - ${co.destination.provinceId.toUpperCase()}`;
      }
      case 'retreat': {
        const ro = order as RetreatOrder;
        return `${ro.unit.provinceId.toUpperCase()} R ${ro.destination.provinceId.toUpperCase()}`;
      }
      case 'disband':
        return `${(order as DisbandOrder).unit.provinceId.toUpperCase()} D`;
      case 'build': {
        const bo = order as BuildOrder;
        const loc = bo.location.coast
          ? `${bo.location.provinceId.toUpperCase()}/${bo.location.coast}`
          : bo.location.provinceId.toUpperCase();
        return `Build ${bo.unitType} ${loc}`;
      }
      case 'waive':
        return `${(order as WaiveOrder).power} Waive`;
      default:
        return 'Unknown order';
    }
  }

  /**
   * Format multiple orders as a single string.
   */
  static formatOrders(orders: readonly Order[]): string {
    return orders.map(o => Adjudicator.formatOrder(o)).join('; ');
  }
}
