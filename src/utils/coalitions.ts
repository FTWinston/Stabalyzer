/**
 * Coalition parsing utility.
 * Parses coalition specifications like "England+France,Italy+Turkey"
 */
import { Coalition, Power, ALL_POWERS } from '../core/types';

/**
 * Parse a coalition specification string.
 * Format: "Power1+Power2,Power3+Power4"
 * Each comma-separated group is a coalition.
 *
 * @param spec - Coalition specification string
 * @returns Array of parsed coalitions
 * @throws Error if a power name is invalid
 */
export function parseCoalitions(spec: string): Coalition[] {
  const groups = spec.split(',').map(g => g.trim()).filter(g => g.length > 0);
  const coalitions: Coalition[] = [];

  for (const group of groups) {
    const powerNames = group.split('+').map(p => p.trim());
    const powers: Power[] = [];

    for (const name of powerNames) {
      const power = normalizePowerName(name);
      if (!power) {
        throw new Error(
          `Unknown power: "${name}". Valid powers: ${ALL_POWERS.join(', ')}`
        );
      }
      powers.push(power);
    }

    coalitions.push({
      powers,
      name: powers.join('+'),
    });
  }

  return coalitions;
}

/**
 * Normalize a power name to the canonical form.
 */
function normalizePowerName(name: string): Power | null {
  const lower = name.toLowerCase().trim();
  const mapping: Record<string, Power> = {
    england: 'England',
    france: 'France',
    germany: 'Germany',
    italy: 'Italy',
    austria: 'Austria',
    'austria-hungary': 'Austria',
    russia: 'Russia',
    turkey: 'Turkey',
  };
  return mapping[lower] ?? null;
}
