/**
 * Core type definitions for the Diplomacy game model.
 * All game state, orders, and adjudication results are represented here.
 */

// ─── Power (Player) ─────────────────────────────────────────────────
export type Power =
  | 'England'
  | 'France'
  | 'Germany'
  | 'Italy'
  | 'Austria'
  | 'Russia'
  | 'Turkey';

export const ALL_POWERS: readonly Power[] = [
  'England', 'France', 'Germany', 'Italy', 'Austria', 'Russia', 'Turkey',
] as const;

// ─── Unit types ──────────────────────────────────────────────────────
export type UnitType = 'Army' | 'Fleet';

// ─── Coasts ──────────────────────────────────────────────────────────
export type Coast = 'nc' | 'sc' | 'ec' | 'wc' | null;

// ─── Province types ──────────────────────────────────────────────────
export type ProvinceType = 'land' | 'sea' | 'coastal' | 'bicoastal';

export interface Province {
  readonly id: string;            // e.g. 'lon', 'nth', 'spa'
  readonly name: string;          // e.g. 'London', 'North Sea', 'Spain'
  readonly type: ProvinceType;
  readonly isSupplyCenter: boolean;
  readonly homeCenter?: Power;    // Which power's home SC, if any
  readonly coasts?: readonly Coast[]; // For bicoastal provinces
  readonly adjacencies: ReadonlyMap<string, readonly Coast[]>; // province id → valid coasts (empty = no coast needed)
}

// ─── Location ────────────────────────────────────────────────────────
export interface Location {
  readonly provinceId: string;
  readonly coast: Coast;
}

// ─── Unit ────────────────────────────────────────────────────────────
export interface Unit {
  readonly type: UnitType;
  readonly power: Power;
  readonly location: Location;
}

// ─── Season / Phase ──────────────────────────────────────────────────
export type Season = 'Spring' | 'Fall';
export type Phase = 'Diplomacy' | 'Retreat' | 'Build';

export interface TurnInfo {
  readonly year: number;
  readonly season: Season;
  readonly phase: Phase;
}

// ─── Orders ──────────────────────────────────────────────────────────
export type OrderType = 'hold' | 'move' | 'support' | 'convoy' | 'retreat' | 'disband' | 'build' | 'waive';

export interface HoldOrder {
  readonly type: 'hold';
  readonly unit: Location;
}

export interface MoveOrder {
  readonly type: 'move';
  readonly unit: Location;
  readonly destination: Location;
  readonly viaConvoy?: boolean;
}

export interface SupportOrder {
  readonly type: 'support';
  readonly unit: Location;
  readonly supportedUnit: Location;
  readonly destination: Location; // Where the supported unit is going (same as supportedUnit for support-hold)
}

export interface ConvoyOrder {
  readonly type: 'convoy';
  readonly unit: Location;       // The fleet doing the convoy
  readonly convoyedUnit: Location; // The army being convoyed
  readonly destination: Location;  // Where the army ends up
}

export interface RetreatOrder {
  readonly type: 'retreat';
  readonly unit: Location;
  readonly destination: Location;
}

export interface DisbandOrder {
  readonly type: 'disband';
  readonly unit: Location;
}

export interface BuildOrder {
  readonly type: 'build';
  readonly unitType: UnitType;
  readonly location: Location;
  readonly power: Power;
}

export interface WaiveOrder {
  readonly type: 'waive';
  readonly power: Power;
}

export type Order =
  | HoldOrder
  | MoveOrder
  | SupportOrder
  | ConvoyOrder
  | RetreatOrder
  | DisbandOrder
  | BuildOrder
  | WaiveOrder;

// ─── Order Resolution ────────────────────────────────────────────────
export type ResolutionStatus = 'succeeds' | 'fails' | 'void' | 'cut' | 'dislodged' | 'bounced';

export interface OrderResolution {
  readonly order: Order;
  readonly power: Power;
  readonly status: ResolutionStatus;
  readonly reason?: string;
}

// ─── Dislodgement info ───────────────────────────────────────────────
export interface DislodgedUnit {
  readonly unit: Unit;
  readonly attackerFrom: Location;
  readonly validRetreats: readonly Location[];
}

// ─── Game State ──────────────────────────────────────────────────────
export interface GameState {
  readonly turn: TurnInfo;
  readonly units: readonly Unit[];
  readonly supplyCenters: ReadonlyMap<string, Power>; // provinceId → owning Power
  readonly dislodgedUnits: readonly DislodgedUnit[];
  readonly previousOrders?: readonly OrderResolution[]; // last turn's resolutions
}

// ─── Coalition ───────────────────────────────────────────────────────
export interface Coalition {
  readonly powers: readonly Power[];
  readonly name: string;
}

// ─── Fitness ─────────────────────────────────────────────────────────
/**
 * Fitness function:
 *   fitness = supply_centers * 1000 + units
 *
 * Terminal wins:
 *   - 18 SC → maximal fitness (999999) for winner
 *   - Alternative win → maximal fitness for coalition
 */
export const FITNESS_SC_WEIGHT = 1000;
export const FITNESS_UNIT_WEIGHT = 1;
export const FITNESS_WIN_SCORE = 999999;
export const WIN_SC_THRESHOLD = 18;

export interface FitnessResult {
  readonly supplyCenters: number;
  readonly units: number;
  readonly score: number;
  readonly isWin: boolean;
  readonly winType?: 'domination' | 'elimination';
}

// ─── MCTS Node Statistics ────────────────────────────────────────────
export interface MCTSNodeStats {
  visits: number;
  totalValue: number;
  meanValue: number;
  variance: number;
}

// ─── Transposition Table Entry ───────────────────────────────────────
export interface TranspositionEntry {
  readonly hash: bigint;
  readonly depth: number;
  readonly visits: number;
  readonly totalValue: number;
  readonly bestOrders?: readonly Order[];
}

// ─── Search Result ───────────────────────────────────────────────────
export interface SearchResult {
  readonly rankedMoves: readonly RankedMove[];
  readonly totalSimulations: number;
  readonly elapsedMs: number;
}

export interface RankedMove {
  readonly rank: number;
  readonly orders: readonly Order[];
  readonly fitness: FitnessResult;
  readonly score: number;
  readonly expectedValue: number; // MCTS expected long-term value (0-1)
  readonly confidence: ConfidenceInfo;
}

export interface ConfidenceInfo {
  readonly level: 'High' | 'Medium' | 'Low';
  readonly visits: number;
  readonly stdev: number;
}

// ─── Scraper DTOs ────────────────────────────────────────────────────
export interface ScrapedGameState {
  readonly gameId: string;
  readonly gameName: string;
  readonly turn: TurnInfo;
  readonly unitsByPlayer: Record<string, ScrapedUnit[]>;
  readonly territories: Record<string, string>; // territory → owning power
}

export interface ScrapedUnit {
  readonly type: UnitType;
  readonly province: string;
  readonly coast?: string;
}

// ─── Config ──────────────────────────────────────────────────────────
export interface AppConfig {
  readonly url: string;
  readonly coalitions: Coalition[];
  readonly optimizeFor: string;
  readonly maxDepth: number;
  readonly threads: number;
  readonly seed?: number;
  readonly verbose: boolean;
}
