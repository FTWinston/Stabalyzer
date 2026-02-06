/**
 * Backstabbr game state scraper using Cheerio.
 *
 * Scraping library choice: Cheerio
 * Rationale:
 * - Lightweight: no browser dependency, fast startup
 * - Backstabbr embeds game data as JavaScript variables (unitsByPlayer, territories)
 *   in script tags, which can be extracted via regex without DOM rendering
 * - No Playwright/browser overhead for CI environments
 * - Falls back gracefully with clear error messages
 *
 * Data extraction:
 * - Reads the `unitsByPlayer` JS variable from inline scripts
 * - Reads the `territories` JS variable from inline scripts
 * - Parses turn info from page content
 *
 * Limitations:
 * - Requires the game page to be publicly accessible
 * - Cannot handle games behind authentication (Backstabbr login)
 * - Depends on Backstabbr's page structure; may break if they change their HTML
 * - Does not execute JavaScript; relies on data being in inline script tags
 */
import * as cheerio from 'cheerio';
import {
  ScrapedGameState,
  ScrapedUnit,
  TurnInfo,
  UnitType,
  Season,
  Phase,
} from '../core/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('scraper');

/**
 * Scrape a Backstabbr game page and extract the game state.
 *
 * @param url - The Backstabbr game URL
 * @param timeoutMs - Request timeout in milliseconds
 * @returns Scraped game state
 * @throws Error if scraping fails
 */
export async function scrapeBackstabbr(
  url: string,
  timeoutMs = 30000
): Promise<ScrapedGameState> {
  logger.info(`Scraping game from: ${url}`);

  // Validate URL
  if (!url.includes('backstabbr.com/game/')) {
    throw new Error(
      'Invalid Backstabbr URL. Expected format: https://www.backstabbr.com/game/<game-id>'
    );
  }

  // Fetch the page
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let html: string;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Stabalyzer/1.0 (Diplomacy game analyzer)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    html = await response.text();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Scraping timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Failed to fetch game page: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  return parseBackstabbrHTML(html, url);
}

/**
 * Parse Backstabbr HTML and extract game state data.
 * Exported for testing with static HTML.
 */
export function parseBackstabbrHTML(html: string, url: string): ScrapedGameState {
  const $ = cheerio.load(html);

  // Extract game ID from URL
  const gameIdMatch = url.match(/game\/([^/?#]+)/);
  const gameId = gameIdMatch ? gameIdMatch[1] : 'unknown';

  // Extract game name
  const gameName = $('h1').first().text().trim() || `Game ${gameId}`;

  // Extract unitsByPlayer from inline scripts
  // Backstabbr format: { "England": { "Wal": "A", ... }, ... }
  const unitsByPlayer = extractJSVariable<Record<string, Record<string, any>>>(html, 'unitsByPlayer');
  if (!unitsByPlayer) {
    throw new Error(
      'Could not find unitsByPlayer data in page. The game page structure may have changed.'
    );
  }

  // Extract territories from inline scripts
  const territories = extractJSVariable<Record<string, string>>(html, 'territories');
  if (!territories) {
    throw new Error(
      'Could not find territories data in page. The game page structure may have changed.'
    );
  }

  // Parse turn info from page content
  const turn = extractTurnInfo($, html);

  // Convert unitsByPlayer to our format.
  // Backstabbr structure: { "England": { "Wal": "A", "Spa": { "type": "F", "coast": "sc" } } }
  // Each player maps to an object of province -> unitType (string) or { type, coast }.
  const parsedUnits: Record<string, ScrapedUnit[]> = {};
  for (const [player, playerUnits] of Object.entries(unitsByPlayer)) {
    const unitObj = playerUnits as Record<string, any>;
    parsedUnits[player] = Object.entries(unitObj).map(([province, value]) => {
      if (typeof value === 'string') {
        return {
          type: normalizeUnitType(value),
          province,
          coast: undefined,
        };
      }
      // value is an object like { type: "F", coast: "sc" }
      return {
        type: normalizeUnitType(value.type || 'Army'),
        province,
        coast: value.coast || undefined,
      };
    });
  }

  logger.info(`Scraped game "${gameName}" (${gameId}): ${Object.keys(parsedUnits).length} players`);

  return {
    gameId,
    gameName,
    turn,
    unitsByPlayer: parsedUnits,
    territories: territories as Record<string, string>,
  };
}

/**
 * Extract a JavaScript variable value from inline script tags.
 * Looks for patterns like: var unitsByPlayer = { ... };
 */
function extractJSVariable<T>(html: string, varName: string): T | null {
  // Try various patterns
  const patterns = [
    new RegExp(`(?:var|let|const)\\s+${varName}\\s*=\\s*(\\{[^;]*\\})\\s*;`, 's'),
    new RegExp(`(?:var|let|const)\\s+${varName}\\s*=\\s*(\\[[^;]*\\])\\s*;`, 's'),
    new RegExp(`${varName}\\s*=\\s*(\\{[^;]*\\})\\s*;`, 's'),
    new RegExp(`${varName}\\s*=\\s*(\\[[^;]*\\])\\s*;`, 's'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        // Clean up JS object to valid JSON
        let jsonStr = match[1]
          .replace(/'/g, '"')
          .replace(/(\w+)\s*:/g, '"$1":')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');

        return JSON.parse(jsonStr) as T;
      } catch {
        logger.warn(`Failed to parse ${varName} as JSON, trying eval-safe approach`);
        continue;
      }
    }
  }

  return null;
}

/**
 * Extract turn information from the page.
 */
function extractTurnInfo($: cheerio.CheerioAPI, html: string): TurnInfo {
  // Try to find turn info in page content
  // Common patterns: "Spring 1901", "Fall 1903 Retreats", etc.
  const turnPatterns = [
    /(Spring|Fall)\s+(\d{4})\s*(Diplomacy|Retreat|Build|Adjustment)?/i,
    /(S|F)(\d{4})(M|R|B)?/i,
  ];

  const textContent = $('body').text();

  for (const pattern of turnPatterns) {
    const match = textContent.match(pattern) || html.match(pattern);
    if (match) {
      const season = match[1].toLowerCase().startsWith('s') ? 'Spring' : 'Fall';
      const year = parseInt(match[2]);
      let phase: Phase = 'Diplomacy';

      if (match[3]) {
        const p = match[3].toLowerCase();
        if (p.startsWith('r')) phase = 'Retreat';
        else if (p.startsWith('b') || p.startsWith('a')) phase = 'Build';
      }

      return { year, season: season as Season, phase };
    }
  }

  // Default if we can't determine
  logger.warn('Could not determine turn info, defaulting to Spring 1901 Diplomacy');
  return { year: 1901, season: 'Spring', phase: 'Diplomacy' };
}

/**
 * Normalize unit type string.
 */
function normalizeUnitType(type: string): UnitType {
  const lower = type.toLowerCase();
  if (lower.includes('fleet') || lower === 'f') return 'Fleet';
  return 'Army';
}
