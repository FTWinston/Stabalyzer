/**
 * Monte Carlo Tree Search (MCTS) implementation for Diplomacy.
 *
 * Uses UCT (Upper Confidence Bound applied to Trees) for selection.
 *
 * UCT formula: UCT = Q/N + C * sqrt(ln(N_parent) / N)
 * where:
 *   Q = total value of node
 *   N = visit count of node
 *   N_parent = visit count of parent
 *   C = exploration constant (default: sqrt(2) ≈ 1.414)
 *
 * Rollout policy: heuristic-guided preferring SC gains and unit preservation.
 *
 * fitness = supply_centers * 1000 + units
 */
import {
  GameState,
  Coalition,
  Order,
  MoveOrder,
  SupportOrder,
  Power,
  ALL_POWERS,
  Priority,
  PredictedTurn,
  FitnessResult,
  SearchResult,
  RankedMove,
  ConfidenceInfo,
  MCTSNodeStats,
} from '../core/types';
import { Adjudicator } from '../core/adjudicator';
import { calculateFitness, checkWinCondition } from '../core/fitness';
import { SUPPLY_CENTERS, getAdjacentProvinces } from '../core/mapData';
import { zobristHash } from './zobrist';
import { TranspositionTable } from './transposition';
import { SeededRandom } from '../utils/random';
import { createLogger } from '../utils/logger';

const logger = createLogger('mcts');

/** Exploration constant for UCT. sqrt(2) is standard. */
const EXPLORATION_CONSTANT = 1.414;

/**
 * MCTS tree node.
 */
interface MCTSNode {
  state: GameState;
  parent: MCTSNode | null;
  children: MCTSNode[];
  orders: Order[];  // Orders that led to this state
  opponentOrders: Order[]; // Non-coalition orders that led to this state
  power: Power;     // Which power's orders these are

  // Statistics
  visits: number;
  totalValue: number;
  squaredValueSum: number; // For variance calculation

  // UCT
  untriedOrders: Order[][];
  isTerminal: boolean;
  hash: bigint;
}

export interface MCTSConfig {
  maxDepth: number;
  searchTimeMs: number;
  explorationConstant: number;
  seed?: number;
  coalition: Coalition;
  priorities?: readonly Priority[];
  signal?: AbortSignal;
}

/**
 * Main MCTS search engine.
 */
export class MCTSEngine {
  private adjudicator: Adjudicator;
  private transpositionTable: TranspositionTable;
  private rng: SeededRandom;
  private config: MCTSConfig;
  private rootNode: MCTSNode | null = null;

  constructor(config: MCTSConfig) {
    this.config = config;
    this.adjudicator = new Adjudicator();
    this.transpositionTable = new TranspositionTable();
    this.rng = new SeededRandom(config.seed ?? Date.now());
  }

  /**
   * Run MCTS search from the given game state.
   */
  search(state: GameState, onProgress?: (iterations: number) => void): SearchResult {
    const startTime = Date.now();

    // Create root node
    this.rootNode = this.createNode(state, null, [], [], this.config.coalition.powers[0]);

    let iterations = 0;
    const deadline = startTime + this.config.searchTimeMs;

    while (Date.now() < deadline) {
      // Check for cancellation
      if (this.config.signal?.aborted) break;

      // Selection
      let node = this.select(this.rootNode);

      // Expansion
      if (!node.isTerminal && node.visits > 0) {
        node = this.expand(node);
      }

      // Simulation (rollout)
      const value = this.simulate(node);

      // Backpropagation
      this.backpropagate(node, value);

      iterations++;

      if (onProgress && iterations % 100 === 0) {
        onProgress(iterations);
      }
    }

    // Extract results
    const rankedMoves = this.extractResults(this.rootNode);
    const elapsedMs = Date.now() - startTime;

    return {
      rankedMoves,
      totalSimulations: iterations,
      elapsedMs,
    };
  }

  /**
   * UCT Selection: traverse tree choosing children with best UCT value.
   */
  private select(node: MCTSNode): MCTSNode {
    let current = node;

    while (current.children.length > 0 && current.untriedOrders.length === 0) {
      current = this.bestUCTChild(current);
    }

    return current;
  }

  /**
   * Select the child with the best UCT value.
   */
  private bestUCTChild(node: MCTSNode): MCTSNode {
    let bestValue = -Infinity;
    let bestChild = node.children[0];

    const logParent = Math.log(node.visits);

    for (const child of node.children) {
      if (child.visits === 0) {
        return child; // Prioritize unvisited
      }

      const exploitation = child.totalValue / child.visits;
      const exploration = this.config.explorationConstant * Math.sqrt(logParent / child.visits);
      const uct = exploitation + exploration;

      if (uct > bestValue) {
        bestValue = uct;
        bestChild = child;
      }
    }

    return bestChild;
  }

  /**
   * Expand: add a new child node by trying an untried order set.
   * For Diplomacy phase nodes: picks from untried coalition order sets.
   * For Retreat/Build phase nodes: auto-resolves the phase to advance to next Diplomacy.
   */
  private expand(node: MCTSNode): MCTSNode {
    // Non-Diplomacy phases: auto-resolve to advance the game
    if (node.state.turn.phase !== 'Diplomacy' && !node.isTerminal) {
      if (node.children.length > 0) {
        // Already expanded this pass-through node
        return node.children[0];
      }
      try {
        const allOrders = this.generatePhaseOrders(node.state);
        const { newState } = this.adjudicator.resolve(node.state, allOrders);
        const child = this.createNode(newState, node, [], [], node.power);
        node.children.push(child);
        return child;
      } catch {
        return node;
      }
    }

    if (node.untriedOrders.length === 0) return node;

    // Pick a random untried order set
    const idx = this.rng.randomInt(node.untriedOrders.length);
    const orders = node.untriedOrders.splice(idx, 1)[0];

    // Generate combined order set (coalition + sampled opponents)
    const allOrders = this.buildCompleteOrders(node.state, orders, node.power);

    // Collect opponent orders
    const opponentOrders: Order[] = [];
    for (const [power, powerOrders] of allOrders) {
      if (!this.config.coalition.powers.includes(power)) {
        opponentOrders.push(...powerOrders);
      }
    }

    // Resolve orders
    const { newState } = this.adjudicator.resolve(node.state, allOrders);

    // Create child node
    const child = this.createNode(newState, node, orders, opponentOrders, node.power);
    node.children.push(child);

    return child;
  }

  /**
   * Simulate: run a random rollout from the given node.
   * Handles all game phases: Diplomacy (coherent orders),
   * Retreat (random valid retreats), Build (heuristic builds/disbands).
   */
  private simulate(node: MCTSNode): number {
    let state = node.state;
    let depth = 0;

    while (depth < this.config.maxDepth) {
      // Check terminal conditions
      const win = checkWinCondition(state);
      if (win.winner) {
        const fitness = calculateFitness(state, this.config.coalition, this.config.priorities);
        return this.normalizeScore(fitness.score);
      }

      try {
        const allOrders = this.generatePhaseOrders(state);
        const { newState } = this.adjudicator.resolve(state, allOrders);
        state = newState;
      } catch {
        break; // Stop rollout on error
      }

      depth++;
    }

    // Evaluate terminal state
    const fitness = calculateFitness(state, this.config.coalition, this.config.priorities);
    return this.normalizeScore(fitness.score);
  }

  /**
   * Generate orders for all powers appropriate to the current game phase.
   */
  private generatePhaseOrders(state: GameState): Map<Power, Order[]> {
    const allOrders = new Map<Power, Order[]>();

    if (state.turn.phase === 'Diplomacy') {
      for (const power of ALL_POWERS) {
        const legalOrders = this.adjudicator.generateLegalOrders(state, power);
        if (legalOrders.length === 0) continue;
        allOrders.set(power, this.sampleCoherentOrders(state, [power], legalOrders));
      }
    } else if (state.turn.phase === 'Retreat') {
      for (const power of ALL_POWERS) {
        const legalOrders = this.adjudicator.generateLegalOrders(state, power);
        if (legalOrders.length === 0) continue;
        // Each dislodged unit picks a random retreat or disband
        const orders: Order[] = [];
        for (const unitOptions of legalOrders) {
          if (unitOptions.length > 0) {
            orders.push(this.rng.choice(unitOptions));
          }
        }
        if (orders.length > 0) allOrders.set(power, orders);
      }
    } else if (state.turn.phase === 'Build') {
      for (const power of ALL_POWERS) {
        const legalOrders = this.adjudicator.generateLegalOrders(state, power);
        if (legalOrders.length === 0) continue;
        const orders = this.sampleBuildOrders(state, power, legalOrders);
        if (orders.length > 0) allOrders.set(power, orders);
      }
    }

    return allOrders;
  }

  /**
   * Sample build/disband orders for a power.
   * Builds: prefer armies on home SCs closest to the front.
   * Disbands: disband units furthest from enemy SCs.
   */
  private sampleBuildOrders(
    state: GameState,
    power: Power,
    legalOrders: Order[][]
  ): Order[] {
    if (legalOrders.length === 0 || legalOrders[0].length === 0) return [];

    const options = legalOrders[0]; // Build orders come as a single flat list
    const firstOrder = options[0];

    if (firstOrder.type === 'build' || firstOrder.type === 'waive') {
      // How many builds are available?
      const scCount = this.countPowerSCs(state, power);
      const unitCount = state.units.filter(u => u.power === power).length;
      const buildsAvailable = scCount - unitCount;
      if (buildsAvailable <= 0) return [];

      // Filter to actual build orders (not waive)
      const builds = options.filter(o => o.type === 'build');
      if (builds.length === 0) return [{ type: 'waive', power } as Order];

      // Pick up to buildsAvailable builds, preferring armies
      const selected: Order[] = [];
      const usedLocations = new Set<string>();
      const shuffled = [...builds].sort(() => this.rng.random() - 0.5);

      // Prefer armies (more flexible)
      const armies = shuffled.filter(o => (o as any).unitType === 'Army');
      const fleets = shuffled.filter(o => (o as any).unitType === 'Fleet');
      const prioritized = [...armies, ...fleets];

      for (const build of prioritized) {
        if (selected.length >= buildsAvailable) break;
        const loc = (build as any).location?.provinceId;
        if (loc && !usedLocations.has(loc)) {
          selected.push(build);
          usedLocations.add(loc);
        }
      }

      return selected;
    } else if (firstOrder.type === 'disband') {
      // Must disband: pick random units to disband
      const scCount = this.countPowerSCs(state, power);
      const unitCount = state.units.filter(u => u.power === power).length;
      const disbandsNeeded = unitCount - scCount;
      if (disbandsNeeded <= 0) return [];

      const shuffled = [...options].sort(() => this.rng.random() - 0.5);
      return shuffled.slice(0, disbandsNeeded);
    }

    return [];
  }

  /**
   * Count supply centers owned by a power.
   */
  private countPowerSCs(state: GameState, power: Power): number {
    let count = 0;
    for (const owner of state.supplyCenters.values()) {
      if (owner === power) count++;
    }
    return count;
  }

  // ─── Coherent Order Generation ──────────────────────────────────────
  //
  // Two-phase approach that guarantees orders make sense as a whole:
  //
  //   Phase 1 (Primary Actions): Each unit picks MOVE or HOLD.
  //           No two friendly units may move to the same destination.
  //
  //   Phase 2 (Coordination):    For each unit, consider upgrading
  //           its action to a SUPPORT or CONVOY that references an
  //           actual Phase 1 action. This is done via heuristic scoring.
  //
  // Result: every support/convoy in the output references a real move
  //         or hold, and no two units collide.

  /**
   * Generate a single coherent order set for the given powers.
   *
   * @param state        Current game state
   * @param powers       Powers to generate orders for (coalition or single)
   * @param legalOrderSets  Per-unit legal order lists (from generateLegalOrders).
   *                     If not provided, generates them internally.
   */
  private sampleCoherentOrders(
    state: GameState,
    powers: readonly Power[],
    legalOrderSets?: Order[][]
  ): Order[] {
    // Gather per-unit legal orders (skip empty)
    const unitLegals: Order[][] = [];
    if (legalOrderSets) {
      for (const uo of legalOrderSets) {
        if (uo.length > 0) unitLegals.push(uo);
      }
    } else {
      for (const power of powers) {
        const orders = this.adjudicator.generateLegalOrders(state, power);
        for (const uo of orders) {
          if (uo.length > 0) unitLegals.push(uo);
        }
      }
    }
    if (unitLegals.length === 0) return [];

    // ── Phase 1: Assign primary actions (move or hold) ────────────────
    // Track destinations claimed so no two units target the same province
    const claimedDests = new Set<string>();
    // Track which province each unit currently occupies
    const unitProvs: string[] = [];
    const primaryActions: Order[] = [];

    // Record each unit's current province
    for (const unitOrders of unitLegals) {
      const prov = (unitOrders[0] as any).unit?.provinceId as string;
      unitProvs.push(prov);
    }

    for (let i = 0; i < unitLegals.length; i++) {
      const unitOrders = unitLegals[i];
      const unitProv = unitProvs[i];

      // Only consider moves and holds in Phase 1
      const movesAndHolds = unitOrders.filter(o => o.type === 'move' || o.type === 'hold');

      if (movesAndHolds.length === 0) {
        // Fallback: should never happen since hold is always legal
        const holdOrder: Order = { type: 'hold', unit: (unitOrders[0] as any).unit };
        primaryActions.push(holdOrder);
        claimedDests.add(unitProv);
        continue;
      }

      // Score each primary action
      const scored = movesAndHolds.map(order => ({
        order,
        score: this.scorePrimaryAction(state, powers, order, claimedDests),
      }));

      // Weighted random selection (softmax)
      const selected = this.softmaxSelect(scored);

      // Claim the destination
      if (selected.type === 'move') {
        const dest = (selected as MoveOrder).destination.provinceId;
        claimedDests.add(dest);
      } else {
        // Holding means this province stays occupied
        claimedDests.add(unitProv);
      }

      primaryActions.push(selected);
    }

    // ── Phase 1b: Detect and resolve position swaps ──────────────────
    // Two units attempting to swap positions (A→B, B→A) will always
    // bounce in Diplomacy (unless convoyed). Replace the lower-scored
    // swap participant with a hold.
    for (let i = 0; i < primaryActions.length; i++) {
      if (primaryActions[i].type !== 'move') continue;
      const destI = (primaryActions[i] as MoveOrder).destination.provinceId;

      for (let j = i + 1; j < primaryActions.length; j++) {
        if (primaryActions[j].type !== 'move') continue;
        const destJ = (primaryActions[j] as MoveOrder).destination.provinceId;

        // Check for swap: unit i → unit j's province AND unit j → unit i's province
        if (destI === unitProvs[j] && destJ === unitProvs[i]) {
          // Swap detected — replace one of them with a hold
          // Keep the move that is more valuable (re-score without dest conflicts)
          const scoreI = this.scorePrimaryAction(state, powers, primaryActions[i], new Set());
          const scoreJ = this.scorePrimaryAction(state, powers, primaryActions[j], new Set());

          if (scoreI >= scoreJ) {
            primaryActions[j] = { type: 'hold', unit: (unitLegals[j][0] as any).unit };
          } else {
            primaryActions[i] = { type: 'hold', unit: (unitLegals[i][0] as any).unit };
          }
        }
      }
    }

    // ── Phase 2: Consider upgrading to support/convoy ─────────────────
    // Build a LIVE lookup of current decisions — updated as units upgrade.
    const actionByProv = new Map<string, Order>();
    for (let i = 0; i < unitLegals.length; i++) {
      actionByProv.set(unitProvs[i], primaryActions[i]);
    }

    // Track which units have already upgraded to support/convoy.
    // A unit that is itself supporting cannot be support-held by another
    // (it's tactically useless: mutual support-hold means neither does anything).
    const upgradedToSupport = new Set<string>();

    // Build a set of provinces threatened by enemy units (fast adjacency check)
    const threatenedProvs = new Set<string>();
    for (const unit of state.units) {
      if (powers.includes(unit.power) || this.isCoalitionPower(unit.power)) continue;
      const adj = getAdjacentProvinces(unit.location.provinceId, unit.type, unit.location.coast ?? undefined);
      for (const prov of adj) {
        threatenedProvs.add(prov);
      }
      // The unit's own province is also "threatened" (it occupies it)
      threatenedProvs.add(unit.location.provinceId);
    }

    const finalOrders: Order[] = [];
    for (let i = 0; i < unitLegals.length; i++) {
      const unitOrders = unitLegals[i];
      const primaryAction = primaryActions[i];
      const unitProv = unitProvs[i];

      // Find valid support/convoy orders that reference actual current actions
      const validCoordination = unitOrders.filter(o => {
        if (o.type === 'support') {
          const so = o as SupportOrder;
          const supProv = so.supportedUnit.provinceId;
          const destProv = so.destination.provinceId;
          const actualOrder = actionByProv.get(supProv);
          if (!actualOrder) return false;

          // Only support coalition/friendly units
          const supUnit = state.units.find(u => u.location.provinceId === supProv);
          if (supUnit && !powers.includes(supUnit.power) &&
              !this.config.coalition.powers.includes(supUnit.power)) {
            return false; // Don't support enemy units
          }

          if (supProv === destProv) {
            // Support-hold: valid only if the unit is stationary
            if (actualOrder.type === 'move') return false;
            // Don't support-hold a unit that already upgraded to support
            // (mutual support-hold is tactically useless)
            if (upgradedToSupport.has(supProv)) return false;
            return true;
          } else {
            // Support-move: valid if the unit is actually moving there
            return actualOrder.type === 'move' &&
              (actualOrder as MoveOrder).destination.provinceId === destProv;
          }
        }
        if (o.type === 'convoy') {
          const co = o as any;
          const convoyedProv: string = co.convoyedUnit?.provinceId;
          const destProv: string = co.destination?.provinceId;
          const actualOrder = actionByProv.get(convoyedProv);
          return actualOrder?.type === 'move' &&
            (actualOrder as MoveOrder).destination.provinceId === destProv;
        }
        return false;
      });

      if (validCoordination.length === 0) {
        // No valid support/convoy — keep the primary action
        finalOrders.push(primaryAction);
        continue;
      }

      // Score the primary action vs. each valid support/convoy
      const candidates = [primaryAction, ...validCoordination];
      const scored = candidates.map(order => ({
        order,
        score: this.scoreCoordinationAction(state, powers, order, primaryAction, threatenedProvs),
      }));

      const selected = this.softmaxSelect(scored);

      // Update live state: if this unit upgraded to support/convoy,
      // record it so subsequent units won't mutual-support it
      if (selected.type === 'support' || selected.type === 'convoy') {
        upgradedToSupport.add(unitProv);
        // Update the action map so subsequent units see us as supporting, not our primary action
        actionByProv.set(unitProv, selected);
      }

      finalOrders.push(selected);
    }

    return finalOrders;
  }

  /**
   * Score a primary action (move or hold) for Phase 1.
   */
  private scorePrimaryAction(
    state: GameState,
    powers: readonly Power[],
    order: Order,
    claimedDests: Set<string>
  ): number {
    if (order.type === 'move') {
      const dest = (order as MoveOrder).destination.provinceId;
      // Heavily penalize colliding with another friendly unit's move
      if (claimedDests.has(dest)) return -20;

      const isSC = state.supplyCenters.has(dest) || this.isSupplyCenter(dest);
      if (isSC) {
        const owner = state.supplyCenters.get(dest);
        if (owner && !this.isCoalitionPower(owner)) {
          return 5; // Capture enemy SC
        }
        // Penalize attacking a coalition partner's SC
        if (owner && this.isCoalitionPower(owner) && !powers.includes(owner)) {
          return -10;
        }
        if (!owner) return 3; // Unclaimed SC
      }
      return 1.5; // General mobility
    }
    // Hold
    const unitProv = (order as any).unit?.provinceId;
    const scOwner = unitProv ? state.supplyCenters.get(unitProv) : null;
    if (scOwner && this.isCoalitionPower(scOwner)) {
      return 1; // Holding on our SC
    }
    return 0.5;
  }

  /**
   * Score whether to upgrade a primary action to a support/convoy in Phase 2.
   * Considers whether the target province is actually threatened by enemies.
   */
  private scoreCoordinationAction(
    state: GameState,
    powers: readonly Power[],
    order: Order,
    primaryAction: Order,
    threatenedProvs: Set<string>
  ): number {
    if (order.type === 'support') {
      const so = order as SupportOrder;
      const supProv = so.supportedUnit.provinceId;
      const destProv = so.destination.provinceId;
      const isSupportHold = supProv === destProv;

      if (isSupportHold) {
        const isThreatened = threatenedProvs.has(supProv);
        const scOwner = state.supplyCenters.get(supProv);
        const isCoalitionSC = scOwner && this.isCoalitionPower(scOwner);

        if (isCoalitionSC && isThreatened) {
          return 5; // Defend a threatened coalition SC — top priority
        }
        if (isThreatened) {
          return 2; // Defend a threatened non-SC province
        }
        if (isCoalitionSC) {
          return 0.5; // Defend unthreatened SC — low value, unit could do more
        }
        return 0; // Support-hold on unthreatened non-SC — basically useless
      } else {
        // Support-move: very valuable if targeting an enemy SC or contested destination
        const isSC = state.supplyCenters.has(destProv) || this.isSupplyCenter(destProv);
        const scOwner = state.supplyCenters.get(destProv);
        const isThreatened = threatenedProvs.has(destProv);

        if (isSC && scOwner && !this.isCoalitionPower(scOwner)) {
          return 6; // Support attack on enemy SC — highest value
        }
        if (isThreatened || this.isOccupiedByEnemy(state, destProv, powers)) {
          return 4; // Support move into contested/enemy-occupied territory
        }
        return 2; // General support-move
      }
    }
    if (order.type === 'convoy') {
      return 2.5; // Convoys are moderately valuable
    }
    // This is the primary action being re-scored for comparison
    return this.scorePrimaryAction(state, powers, order, new Set());
  }

  /**
   * Check if a province is occupied by a non-coalition enemy unit.
   */
  private isOccupiedByEnemy(
    state: GameState,
    provinceId: string,
    friendlyPowers: readonly Power[]
  ): boolean {
    const unit = state.units.find(u => u.location.provinceId === provinceId);
    if (!unit) return false;
    return !friendlyPowers.includes(unit.power) && !this.isCoalitionPower(unit.power);
  }

  /**
   * Softmax weighted random selection.
   */
  private softmaxSelect(scored: { order: Order; score: number }[]): Order {
    if (scored.length === 0) throw new Error('No candidates for softmax');
    if (scored.length === 1) return scored[0].order;

    const totalScore = scored.reduce((sum, s) => sum + Math.exp(s.score), 0);
    if (totalScore === 0) return scored[0].order;

    const r = this.rng.random() * totalScore;
    let cumulative = 0;
    for (const s of scored) {
      cumulative += Math.exp(s.score);
      if (cumulative >= r) return s.order;
    }
    return scored[scored.length - 1].order;
  }

  /**
   * Check if a power belongs to the coalition.
   */
  private isCoalitionPower(power: Power): boolean {
    return this.config.coalition.powers.includes(power);
  }

  private isSupplyCenter(provinceId: string): boolean {
    return SUPPLY_CENTERS.includes(provinceId);
  }

  /**
   * Backpropagate: update visit counts and values up the tree.
   */
  private backpropagate(node: MCTSNode, value: number): void {
    let current: MCTSNode | null = node;

    while (current !== null) {
      current.visits++;
      current.totalValue += value;
      current.squaredValueSum += value * value;
      current = current.parent;
    }
  }

  /**
   * Normalize fitness score to [0, 1] range for MCTS.
   *
   * Typical scores: 13 SCs + 13 units = 13013
   * Max plausible non-win score: ~25 SCs + 25 units = 25025
   * We use 34034 (all 34 SCs + 34 units) as the theoretical max.
   * Win scores (999999) clamp to 1.0.
   */
  private normalizeScore(score: number): number {
    const MAX_NORMAL_SCORE = 34 * 1000 + 34; // 34034
    return Math.min(1, score / MAX_NORMAL_SCORE);
  }

  /**
   * Build complete orders including opponent moves.
   * Handles Diplomacy, Retreat, and Build phases.
   */
  private buildCompleteOrders(
    state: GameState,
    coalitionOrders: Order[],
    _coalitionPower: Power
  ): Map<Power, Order[]> {
    // For non-Diplomacy phases, use the general phase handler
    if (state.turn.phase !== 'Diplomacy') {
      const allOrders = this.generatePhaseOrders(state);
      // Override with coalition orders if provided
      if (coalitionOrders.length > 0) {
        for (const power of this.config.coalition.powers) {
          const powerOrders = coalitionOrders.filter(o => {
            if (o.type === 'build' || o.type === 'waive') {
              return (o as any).power === power;
            }
            const unitProv = 'unit' in o ? (o as any).unit?.provinceId : null;
            if (!unitProv) return false;
            const unit = state.units.find(u => u.location.provinceId === unitProv && u.power === power);
            return !!unit;
          });
          if (powerOrders.length > 0) {
            allOrders.set(power, powerOrders);
          }
        }
      }
      return allOrders;
    }

    const allOrders = new Map<Power, Order[]>();

    // Distribute coalition orders by their unit's power
    for (const power of this.config.coalition.powers) {
      const powerOrders = coalitionOrders.filter(o => {
        const unitProv = 'unit' in o ? (o as any).unit?.provinceId : null;
        if (!unitProv) return false;
        const unit = state.units.find(u => u.location.provinceId === unitProv && u.power === power);
        return !!unit;
      });
      if (powerOrders.length > 0) {
        allOrders.set(power, powerOrders);
      }
    }

    // Generate coherent orders for non-coalition powers
    for (const power of ALL_POWERS) {
      if (this.config.coalition.powers.includes(power)) continue;

      const legalOrders = this.adjudicator.generateLegalOrders(state, power);
      if (legalOrders.length === 0) continue;

      allOrders.set(power, this.sampleCoherentOrders(state, [power], legalOrders));
    }

    return allOrders;
  }

  /**
   * Create an MCTS node.
   */
  private createNode(
    state: GameState,
    parent: MCTSNode | null,
    orders: Order[],
    opponentOrders: Order[],
    power: Power
  ): MCTSNode {
    const hash = zobristHash(state);
    const win = checkWinCondition(state);
    const isTerminal = win.winner !== null;

    // Generate sampled order sets for the coalition.
    // Only generate Diplomacy orders for the tree; Build/Retreat
    // phases are handled automatically during simulation rollouts.
    const untriedOrders: Order[][] = [];
    if (!isTerminal && state.turn.phase === 'Diplomacy') {
      const NUM_SAMPLES = 30;
      for (let i = 0; i < NUM_SAMPLES; i++) {
        const orderSet = this.sampleCoherentOrders(
          state,
          this.config.coalition.powers
        );
        untriedOrders.push(orderSet);
      }
    }

    return {
      state,
      parent,
      children: [],
      orders,
      opponentOrders,
      power,
      visits: 0,
      totalValue: 0,
      squaredValueSum: 0,
      untriedOrders,
      isTerminal,
      hash,
    };
  }

  /**
   * Extract ranked results from the root node.
   */
  private extractResults(root: MCTSNode): RankedMove[] {
    const results: RankedMove[] = [];

    // Sort children by average MCTS value (best expected outcome first)
    const sorted = [...root.children]
      .filter(c => c.visits > 0)
      .sort((a, b) => {
        const avgA = a.totalValue / a.visits;
        const avgB = b.totalValue / b.visits;
        return avgB - avgA;
      });

    for (let i = 0; i < Math.min(sorted.length, 3); i++) {
      const child = sorted[i];
      const fitness = calculateFitness(child.state, this.config.coalition, this.config.priorities);

      const meanValue = child.totalValue / child.visits;
      const variance = child.visits > 1
        ? (child.squaredValueSum / child.visits) - (meanValue * meanValue)
        : 0;
      const stdev = Math.sqrt(Math.max(0, variance));

      const confidence = this.determineConfidence(child.visits, stdev);

      // Extract predicted subsequent turns by following best children
      const predictedTurns = this.extractPredictedTurns(child);

      results.push({
        rank: i + 1,
        orders: child.orders,
        opponentOrders: child.opponentOrders,
        predictedTurns,
        fitness,
        score: fitness.score,
        expectedValue: meanValue,
        confidence,
      });
    }

    return results;
  }

  /**
   * Extract predicted moves for subsequent turns by following the most-visited path.
   */
  private extractPredictedTurns(node: MCTSNode): PredictedTurn[] {
    const turns: PredictedTurn[] = [];
    let current = node;

    while (current.children.length > 0) {
      // Follow the most-visited child
      const best = current.children
        .filter(c => c.visits > 0)
        .sort((a, b) => b.visits - a.visits)[0];

      if (!best || best.visits === 0) break;

      // Only include nodes with actual orders (skip non-Diplomacy pass-throughs)
      if (best.orders.length > 0 || best.opponentOrders.length > 0) {
        turns.push({
          // Use parent's state turn — orders were issued in the parent's phase
          turn: current.state.turn,
          // Include the parent's state so unit lookups work for display
          state: current.state,
          coalitionOrders: best.orders,
          opponentOrders: best.opponentOrders,
        });
      }

      current = best;
    }

    return turns;
  }

  /**
   * Determine confidence level based on visit count and standard deviation.
   */
  private determineConfidence(visits: number, stdev: number): ConfidenceInfo {
    let level: 'High' | 'Medium' | 'Low';

    if (visits > 1000 && stdev < 0.15) {
      level = 'High';
    } else if (visits > 500 || stdev < 0.25) {
      level = 'Medium';
    } else {
      level = 'Low';
    }

    return {
      level,
      visits,
      stdev: Math.round(stdev * 100) / 100,
    };
  }

  /**
   * Find the most likely opponent responses.
   */
  /**
   * Get the transposition table for merging with other workers.
   */
  getTranspositionTable(): TranspositionTable {
    return this.transpositionTable;
  }
}
