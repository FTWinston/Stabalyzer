/**
 * Converts scraped game data into the internal GameState representation.
 */
import {
  GameState,
  ScrapedGameState,
  Unit,
  UnitType,
  Power,
  Location,
  TurnInfo,
  DislodgedUnit,
  Coast,
} from './types';

const POWER_ALIASES: Record<string, Power> = {
  england: 'England',
  france: 'France',
  germany: 'Germany',
  italy: 'Italy',
  austria: 'Austria',
  'austria-hungary': 'Austria',
  russia: 'Russia',
  turkey: 'Turkey',
};

/**
 * Province ID aliases: Backstabbr uses some non-standard abbreviations.
 * Maps lowercased Backstabbr IDs → our canonical IDs from mapData.
 */
const PROVINCE_ALIASES: Record<string, string> = {
  nwy: 'nor',   // Norway
  lyo: 'gol',   // Gulf of Lyon
  tys: 'tyn',   // Tyrrhenian Sea
  nao: 'nat',   // North Atlantic Ocean
};

export class GameStateBuilder {
  /**
   * Convert a scraped game state into the internal model.
   */
  static fromScraped(scraped: ScrapedGameState): GameState {
    const units: Unit[] = [];

    for (const [playerName, unitList] of Object.entries(scraped.unitsByPlayer)) {
      const power = GameStateBuilder.normalizePower(playerName);
      if (!power) continue;

      for (const su of unitList) {
        units.push({
          type: su.type,
          power,
          location: {
            provinceId: GameStateBuilder.normalizeProvinceId(su.province),
            coast: (su.coast as Coast) ?? null,
          },
        });
      }
    }

    const supplyCenters = new Map<string, Power>();
    for (const [territory, owner] of Object.entries(scraped.territories)) {
      const power = GameStateBuilder.normalizePower(owner);
      if (power) {
        supplyCenters.set(GameStateBuilder.normalizeProvinceId(territory), power);
      }
    }

    return {
      turn: scraped.turn,
      units,
      supplyCenters,
      dislodgedUnits: [],
    };
  }

  /**
   * Create a game state from explicit parameters (used in tests).
   */
  static create(params: {
    turn: TurnInfo;
    units: Unit[];
    supplyCenters?: Map<string, Power>;
    dislodgedUnits?: DislodgedUnit[];
  }): GameState {
    return {
      turn: params.turn,
      units: params.units,
      supplyCenters: params.supplyCenters ?? new Map(),
      dislodgedUnits: params.dislodgedUnits ?? [],
    };
  }

  static normalizePower(name: string): Power | null {
    const lower = name.toLowerCase().trim();
    return POWER_ALIASES[lower] ?? null;
  }

  static normalizeProvinceId(name: string): string {
    const id = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z_]/g, '');
    return PROVINCE_ALIASES[id] ?? id;
  }
}
