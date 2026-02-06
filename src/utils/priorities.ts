/**
 * Priority parsing utility.
 * Parses priority specifications like "deny England nth" or "allow Italy mao".
 *
 * Format: "<action> <power> <province>"
 *   action:   "deny" or "allow"
 *   power:    A valid power name (e.g. England, France)
 *   province: A province ID (e.g. nth, mao, lon)
 */
import { Priority, PriorityAction, Power, ALL_POWERS } from '../core/types';
import { PROVINCES } from '../core/mapData';

/**
 * Parse a single priority specification string.
 *
 * @param spec - Priority specification, e.g. "deny England nth"
 * @returns Parsed Priority
 * @throws Error if the format is invalid
 */
export function parsePriority(spec: string): Priority {
  const parts = spec.trim().split(/\s+/);
  if (parts.length !== 3) {
    throw new Error(
      `Invalid priority format: "${spec}". Expected: "<deny|allow> <power> <province>"`
    );
  }

  const [actionStr, powerStr, provinceStr] = parts;

  // Validate action
  const action = actionStr.toLowerCase();
  if (action !== 'deny' && action !== 'allow') {
    throw new Error(
      `Invalid priority action: "${actionStr}". Must be "deny" or "allow".`
    );
  }

  // Validate power
  const power = normalizePowerName(powerStr);
  if (!power) {
    throw new Error(
      `Unknown power: "${powerStr}". Valid powers: ${ALL_POWERS.join(', ')}`
    );
  }

  // Validate province
  const provinceId = provinceStr.toLowerCase();
  if (!PROVINCES.has(provinceId)) {
    throw new Error(
      `Unknown province: "${provinceStr}". Use standard 3-letter abbreviations (e.g. nth, mao, lon).`
    );
  }

  return {
    action: action as PriorityAction,
    power,
    provinceId,
  };
}

/**
 * Parse multiple priority specifications.
 *
 * @param specs - Array of priority specification strings
 * @returns Array of parsed Priorities
 */
export function parsePriorities(specs: string[]): Priority[] {
  return specs.map(parsePriority);
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
