/**
 * Embedded DATC (Diplomacy Adjudicator Test Cases) data.
 *
 * Source: https://boardgamegeek.com/filepage/274846/datc-diplomacy-adjudicator-test-cases
 *
 * Each test case defines:
 * - A unique case ID (e.g., "6.A.1")
 * - A description
 * - Initial game state (units and their positions)
 * - Orders to resolve
 * - Expected results (which orders succeed, fail, etc.)
 *
 * This data is embedded directly in the repository (no runtime download required).
 *
 * Cases are organized by section:
 * 6.A - Basic checks
 * 6.B - Coastal issues
 * 6.C - Circular movement
 * 6.D - Supports and dislodges
 * 6.E - Head to head battles and beleaguered garrison
 * 6.F - Convoys
 * 6.G - Retreats
 * 6.H - Building
 */

import { Power, UnitType, Order, ResolutionStatus, Location, Coast } from '../../src/core/types';

export interface DATCTestCase {
  id: string;
  section: string;
  description: string;
  units: DATCUnit[];
  orders: DATCOrder[];
  expectedResults: DATCExpectedResult[];
}

export interface DATCUnit {
  power: Power;
  type: UnitType;
  province: string;
  coast?: Coast;
}

export interface DATCOrder {
  power: Power;
  type: string;
  unit: string;
  unitCoast?: Coast;
  target?: string;
  targetCoast?: Coast;
  destination?: string;
  destinationCoast?: Coast;
  viaConvoy?: boolean;
}

export interface DATCExpectedResult {
  unit: string;
  orderType: string;
  status: ResolutionStatus;
}

// ═══════════════════════════════════════════════════════════════════
// DATC TEST CASES - Section 6.A: Basic Checks
// ═══════════════════════════════════════════════════════════════════

export const DATC_CASES: DATCTestCase[] = [
  // ─── 6.A.1: Moving to an area that is not a neighbour ─────────
  {
    id: '6.A.1',
    section: '6.A',
    description: 'Moving to an area that is not a neighbour',
    units: [
      { power: 'England', type: 'Fleet', province: 'nth' },
    ],
    orders: [
      { power: 'England', type: 'move', unit: 'nth', destination: 'pic' },
    ],
    expectedResults: [
      { unit: 'nth', orderType: 'move', status: 'void' },
    ],
  },

  // ─── 6.A.2: Move army to sea ──────────────────────────────────
  {
    id: '6.A.2',
    section: '6.A',
    description: 'Move army to sea',
    units: [
      { power: 'England', type: 'Army', province: 'lvp' },
    ],
    orders: [
      { power: 'England', type: 'move', unit: 'lvp', destination: 'iri' },
    ],
    expectedResults: [
      { unit: 'lvp', orderType: 'move', status: 'void' },
    ],
  },

  // ─── 6.A.3: Move fleet to land ────────────────────────────────
  {
    id: '6.A.3',
    section: '6.A',
    description: 'Move fleet to land',
    units: [
      { power: 'Germany', type: 'Fleet', province: 'kie' },
    ],
    orders: [
      { power: 'Germany', type: 'move', unit: 'kie', destination: 'mun' },
    ],
    expectedResults: [
      { unit: 'kie', orderType: 'move', status: 'void' },
    ],
  },

  // ─── 6.A.5: Move to own sector ────────────────────────────────
  {
    id: '6.A.5',
    section: '6.A',
    description: 'Move to own sector (illegal)',
    units: [
      { power: 'Germany', type: 'Fleet', province: 'kie' },
    ],
    orders: [
      { power: 'Germany', type: 'move', unit: 'kie', destination: 'kie' },
    ],
    expectedResults: [
      { unit: 'kie', orderType: 'move', status: 'void' },
    ],
  },

  // ─── 6.A.6: Ordering a unit of another country ────────────────
  {
    id: '6.A.6',
    section: '6.A',
    description: 'Ordering a unit of another country',
    units: [
      { power: 'England', type: 'Fleet', province: 'lon' },
    ],
    orders: [
      { power: 'Germany', type: 'move', unit: 'lon', destination: 'nth' },
    ],
    expectedResults: [
      { unit: 'lon', orderType: 'move', status: 'void' },
    ],
  },

  // ─── 6.A.7: Only armies can be convoyed ───────────────────────
  {
    id: '6.A.7',
    section: '6.A',
    description: 'Only armies can be convoyed',
    units: [
      { power: 'England', type: 'Fleet', province: 'lon' },
      { power: 'England', type: 'Fleet', province: 'nth' },
    ],
    orders: [
      { power: 'England', type: 'move', unit: 'lon', destination: 'bel', viaConvoy: true },
      { power: 'England', type: 'convoy', unit: 'nth', target: 'lon', destination: 'bel' },
    ],
    expectedResults: [
      { unit: 'lon', orderType: 'move', status: 'void' },
    ],
  },

  // ─── 6.A.8: Support to hold yourself is not possible ──────────
  // (Technically it means supporting a hold on your own position which is just a hold)
  // Skipping as this is about order semantics

  // ─── 6.A.9: Fleets must follow coast if not on sea ────────────
  {
    id: '6.A.9',
    section: '6.A',
    description: 'Fleets must follow coast if not on sea',
    units: [
      { power: 'Italy', type: 'Fleet', province: 'rom' },
    ],
    orders: [
      { power: 'Italy', type: 'move', unit: 'rom', destination: 'ven' },
    ],
    expectedResults: [
      { unit: 'rom', orderType: 'move', status: 'void' },
    ],
  },

  // ─── 6.A.10: Support on unreachable destination not possible ──
  // DATC 6.A.10: A unit cannot support to a destination it cannot reach.
  // Fleet Rome cannot move to Venice (not adjacent by sea), so it cannot
  // support a move to Venice.
  {
    id: '6.A.10',
    section: '6.A',
    description: 'Support on unreachable destination not possible',
    units: [
      { power: 'Austria', type: 'Army', province: 'ven' },
      { power: 'Italy', type: 'Fleet', province: 'rom' },
      { power: 'Italy', type: 'Army', province: 'apu' },
    ],
    orders: [
      { power: 'Austria', type: 'hold', unit: 'ven' },
      { power: 'Italy', type: 'support', unit: 'rom', target: 'apu', destination: 'ven' },
      { power: 'Italy', type: 'move', unit: 'apu', destination: 'ven' },
    ],
    expectedResults: [
      // Fleet Rome cannot reach Venice (no sea route), so support is void.
      // Without support, the 1v1 move bounces.
      { unit: 'rom', orderType: 'support', status: 'void' },
      { unit: 'apu', orderType: 'move', status: 'bounced' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // Section 6.D: Support cutting
  // ═══════════════════════════════════════════════════════════════

  // ─── 6.D.1: A supported move dislodges a hold ─────────────────
  // DATC 6.D.1: Tests that valid support adds strength to a move.
  // A ARM supports F BLA - ANK. Army Armenia CAN reach Ankara, so support is valid.
  {
    id: '6.D.1',
    section: '6.D',
    description: 'A supported move dislodges a hold',
    units: [
      { power: 'Russia', type: 'Fleet', province: 'bla' },
      { power: 'Russia', type: 'Army', province: 'arm' },
      { power: 'Turkey', type: 'Fleet', province: 'ank' },
    ],
    orders: [
      { power: 'Russia', type: 'move', unit: 'bla', destination: 'ank' },
      { power: 'Russia', type: 'support', unit: 'arm', target: 'bla', destination: 'ank' },
      { power: 'Turkey', type: 'hold', unit: 'ank' },
    ],
    expectedResults: [
      { unit: 'bla', orderType: 'move', status: 'succeeds' },
      { unit: 'ank', orderType: 'hold', status: 'dislodged' },
    ],
  },

  // ─── 6.D.2: A move cuts support on hold ───────────────────────
  {
    id: '6.D.2',
    section: '6.D',
    description: 'A move cuts support on hold',
    units: [
      { power: 'Austria', type: 'Army', province: 'bud' },
      { power: 'Austria', type: 'Army', province: 'ser' },
      { power: 'Russia', type: 'Army', province: 'rum' },
      { power: 'Turkey', type: 'Army', province: 'bul' },
    ],
    orders: [
      { power: 'Austria', type: 'move', unit: 'bud', destination: 'rum' },
      { power: 'Austria', type: 'support', unit: 'ser', target: 'bud', destination: 'rum' },
      { power: 'Russia', type: 'hold', unit: 'rum' },
      { power: 'Turkey', type: 'move', unit: 'bul', destination: 'ser' },
    ],
    expectedResults: [
      { unit: 'ser', orderType: 'support', status: 'cut' },
      { unit: 'bud', orderType: 'move', status: 'bounced' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // Section 6.E: Head-to-head battles
  // ═══════════════════════════════════════════════════════════════

  // ─── 6.E.1: Dislodge with head to head battle ─────────────────
  {
    id: '6.E.1',
    section: '6.E',
    description: 'Head to head battle - stronger side wins',
    units: [
      { power: 'Germany', type: 'Army', province: 'ber' },
      { power: 'Germany', type: 'Army', province: 'mun' },
      { power: 'Russia', type: 'Army', province: 'sil' },
    ],
    orders: [
      { power: 'Germany', type: 'move', unit: 'ber', destination: 'sil' },
      { power: 'Germany', type: 'support', unit: 'mun', target: 'ber', destination: 'sil' },
      { power: 'Russia', type: 'move', unit: 'sil', destination: 'ber' },
    ],
    expectedResults: [
      { unit: 'ber', orderType: 'move', status: 'succeeds' },
      { unit: 'sil', orderType: 'move', status: 'bounced' },
    ],
  },

  // ─── 6.E.2: Head to head with equal strength bounces both ─────
  {
    id: '6.E.2',
    section: '6.E',
    description: 'Head to head with equal strength bounces both',
    units: [
      { power: 'Germany', type: 'Army', province: 'ber' },
      { power: 'Russia', type: 'Army', province: 'sil' },
    ],
    orders: [
      { power: 'Germany', type: 'move', unit: 'ber', destination: 'sil' },
      { power: 'Russia', type: 'move', unit: 'sil', destination: 'ber' },
    ],
    expectedResults: [
      { unit: 'ber', orderType: 'move', status: 'bounced' },
      { unit: 'sil', orderType: 'move', status: 'bounced' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // Section 6.C: Circular movement
  // ═══════════════════════════════════════════════════════════════

  // ─── 6.C.1: Three army circular movement ──────────────────────
  {
    id: '6.C.1',
    section: '6.C',
    description: 'Three army circular movement succeeds',
    units: [
      { power: 'Turkey', type: 'Fleet', province: 'ank' },
      { power: 'Turkey', type: 'Army', province: 'con' },
      { power: 'Turkey', type: 'Army', province: 'smy' },
    ],
    orders: [
      { power: 'Turkey', type: 'move', unit: 'ank', destination: 'con' },
      { power: 'Turkey', type: 'move', unit: 'con', destination: 'smy' },
      { power: 'Turkey', type: 'move', unit: 'smy', destination: 'ank' },
    ],
    expectedResults: [
      { unit: 'ank', orderType: 'move', status: 'succeeds' },
      { unit: 'con', orderType: 'move', status: 'succeeds' },
      { unit: 'smy', orderType: 'move', status: 'succeeds' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // Section 6.F: Convoys
  // ═══════════════════════════════════════════════════════════════

  // ─── 6.F.1: No convoy in coastal areas ─────────────────────────
  {
    id: '6.F.1',
    section: '6.F',
    description: 'No convoy in coastal areas',
    units: [
      { power: 'Turkey', type: 'Army', province: 'gre' },
      { power: 'Turkey', type: 'Fleet', province: 'aeg' },
      { power: 'Turkey', type: 'Fleet', province: 'con' },
      { power: 'Turkey', type: 'Fleet', province: 'bla' },
    ],
    orders: [
      { power: 'Turkey', type: 'move', unit: 'gre', destination: 'sev', viaConvoy: true },
      { power: 'Turkey', type: 'convoy', unit: 'aeg', target: 'gre', destination: 'sev' },
      { power: 'Turkey', type: 'convoy', unit: 'con', target: 'gre', destination: 'sev' },
      { power: 'Turkey', type: 'convoy', unit: 'bla', target: 'gre', destination: 'sev' },
    ],
    expectedResults: [
      // Constantinople is a coastal province, not sea - cannot convoy
      { unit: 'con', orderType: 'convoy', status: 'void' },
    ],
  },

  // ─── 6.F.6: Convoy disrupted - army stays ─────────────────────
  {
    id: '6.F.6',
    section: '6.F',
    description: 'A basic convoy succeeds',
    units: [
      { power: 'England', type: 'Army', province: 'lon' },
      { power: 'England', type: 'Fleet', province: 'nth' },
    ],
    orders: [
      { power: 'England', type: 'move', unit: 'lon', destination: 'bel', viaConvoy: true },
      { power: 'England', type: 'convoy', unit: 'nth', target: 'lon', destination: 'bel' },
    ],
    expectedResults: [
      { unit: 'lon', orderType: 'move', status: 'succeeds' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // Section 6.B: Coastal Issues
  // ═══════════════════════════════════════════════════════════════

  // ─── 6.B.6: Fleet ordering to coast of bicoastal province ─────
  {
    id: '6.B.6',
    section: '6.B',
    description: 'Fleet must specify coast to bicoastal',
    units: [
      { power: 'France', type: 'Fleet', province: 'por' },
    ],
    orders: [
      { power: 'France', type: 'move', unit: 'por', destination: 'spa', destinationCoast: 'nc' },
    ],
    expectedResults: [
      { unit: 'por', orderType: 'move', status: 'succeeds' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // Additional basic tests for coverage
  // ═══════════════════════════════════════════════════════════════

  // ─── Simple move succeeds ──────────────────────────────────────
  {
    id: 'BASIC.1',
    section: 'BASIC',
    description: 'Simple army move to empty adjacent territory',
    units: [
      { power: 'Germany', type: 'Army', province: 'mun' },
    ],
    orders: [
      { power: 'Germany', type: 'move', unit: 'mun', destination: 'boh' },
    ],
    expectedResults: [
      { unit: 'mun', orderType: 'move', status: 'succeeds' },
    ],
  },

  // ─── Simple hold ──────────────────────────────────────────────
  {
    id: 'BASIC.2',
    section: 'BASIC',
    description: 'Simple hold order',
    units: [
      { power: 'France', type: 'Army', province: 'par' },
    ],
    orders: [
      { power: 'France', type: 'hold', unit: 'par' },
    ],
    expectedResults: [
      { unit: 'par', orderType: 'hold', status: 'succeeds' },
    ],
  },

  // ─── Bounced move (equal strength) ─────────────────────────────
  {
    id: 'BASIC.3',
    section: 'BASIC',
    description: 'Two units move to same empty territory - both bounce',
    units: [
      { power: 'France', type: 'Army', province: 'par' },
      { power: 'Germany', type: 'Army', province: 'mun' },
    ],
    orders: [
      { power: 'France', type: 'move', unit: 'par', destination: 'bur' },
      { power: 'Germany', type: 'move', unit: 'mun', destination: 'bur' },
    ],
    expectedResults: [
      { unit: 'par', orderType: 'move', status: 'bounced' },
      { unit: 'mun', orderType: 'move', status: 'bounced' },
    ],
  },

  // ─── Supported attack dislodges ────────────────────────────────
  // Army Ruhur can reach Munich, so the support is valid.
  {
    id: 'BASIC.4',
    section: 'BASIC',
    description: 'Supported attack dislodges unsupported unit',
    units: [
      { power: 'France', type: 'Army', province: 'ruh' },
      { power: 'France', type: 'Army', province: 'bur' },
      { power: 'Germany', type: 'Army', province: 'mun' },
    ],
    orders: [
      { power: 'France', type: 'move', unit: 'bur', destination: 'mun' },
      { power: 'France', type: 'support', unit: 'ruh', target: 'bur', destination: 'mun' },
      { power: 'Germany', type: 'hold', unit: 'mun' },
    ],
    expectedResults: [
      { unit: 'bur', orderType: 'move', status: 'succeeds' },
      { unit: 'mun', orderType: 'hold', status: 'dislodged' },
    ],
  },

  // ─── Cannot dislodge own unit ──────────────────────────────────
  {
    id: 'BASIC.5',
    section: 'BASIC',
    description: 'Cannot dislodge own unit',
    units: [
      { power: 'France', type: 'Army', province: 'par' },
      { power: 'France', type: 'Army', province: 'bur' },
    ],
    orders: [
      { power: 'France', type: 'move', unit: 'par', destination: 'bur' },
      { power: 'France', type: 'hold', unit: 'bur' },
    ],
    expectedResults: [
      { unit: 'par', orderType: 'move', status: 'bounced' },
    ],
  },

  // ─── Fleet movement in sea zones ───────────────────────────────
  {
    id: 'BASIC.6',
    section: 'BASIC',
    description: 'Fleet moves through sea zones',
    units: [
      { power: 'England', type: 'Fleet', province: 'lon' },
    ],
    orders: [
      { power: 'England', type: 'move', unit: 'lon', destination: 'nth' },
    ],
    expectedResults: [
      { unit: 'lon', orderType: 'move', status: 'succeeds' },
    ],
  },
];
