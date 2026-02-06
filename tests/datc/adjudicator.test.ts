/**
 * DATC Adjudicator Test Suite.
 *
 * Tests the Diplomacy adjudicator against embedded DATC test cases.
 * Each test case has a unique DATC case ID referenced in comments.
 *
 * Source: https://boardgamegeek.com/filepage/274846/datc-diplomacy-adjudicator-test-cases
 */
import { describe, it, expect } from 'vitest';
import { Adjudicator } from '../../src/core/adjudicator';
import { DATC_CASES } from './datcCases';
import { buildStateFromDATCCase, buildOrdersFromDATCCase } from './datcParser';
import { ResolutionStatus } from '../../src/core/types';

const adjudicator = new Adjudicator();

describe('DATC Adjudicator Tests', () => {
  // Group tests by section
  const sections = new Map<string, typeof DATC_CASES>();
  for (const tc of DATC_CASES) {
    const existing = sections.get(tc.section) ?? [];
    existing.push(tc);
    sections.set(tc.section, existing);
  }

  for (const [section, cases] of sections) {
    describe(`Section ${section}`, () => {
      for (const testCase of cases) {
        it(`${testCase.id}: ${testCase.description}`, () => {
          // Build game state from test case
          const state = buildStateFromDATCCase(testCase);

          // Build orders from test case
          const orders = buildOrdersFromDATCCase(testCase);

          // Resolve orders
          const { resolutions } = adjudicator.resolve(state, orders);

          // Check expected results
          for (const expected of testCase.expectedResults) {
            const resolution = resolutions.find(r => {
              // Match by unit province
              const orderLoc = getOrderProvince(r.order);
              return orderLoc === expected.unit && r.order.type === expected.orderType;
            });

            expect(
              resolution,
              `Expected resolution for ${expected.unit} (${expected.orderType}) not found.\n` +
              `Available resolutions: ${resolutions.map(r =>
                `${getOrderProvince(r.order)} ${r.order.type} -> ${r.status}`
              ).join(', ')}`
            ).toBeDefined();

            if (resolution) {
              expect(
                resolution.status,
                `DATC ${testCase.id}: ${expected.unit} ${expected.orderType} ` +
                `expected "${expected.status}" but got "${resolution.status}"` +
                (resolution.reason ? ` (reason: ${resolution.reason})` : '')
              ).toBe(expected.status);
            }
          }
        });
      }
    });
  }
});

/**
 * Get the province from an order's primary unit location.
 */
function getOrderProvince(order: any): string {
  if (order.unit?.provinceId) return order.unit.provinceId;
  if (order.location?.provinceId) return order.location.provinceId;
  return '';
}
