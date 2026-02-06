/**
 * Standard Diplomacy map data: all 75 provinces, adjacencies, supply centers,
 * and helper functions for move validation.
 *
 * Province IDs use standard 3-letter abbreviations.
 * Adjacency lists are complete and accurate for the standard (Classic) map.
 */

import { Power, UnitType, Coast } from './types';

// ─── Province Data Interface ─────────────────────────────────────────
export interface ProvinceData {
  id: string;
  name: string;
  type: 'land' | 'sea' | 'coastal' | 'bicoastal';
  isSupplyCenter: boolean;
  homeCenter?: Power;
  armyAdj: string[];        // provinces reachable by army
  fleetAdj: string[];       // provinces reachable by fleet (no coast specified)
  coastalAdj?: {            // for bicoastal provinces: coast → reachable provinces
    nc?: string[];
    sc?: string[];
    ec?: string[];
  };
}

// ─── Province Definitions ────────────────────────────────────────────

const provinceArray: ProvinceData[] = [

  // ═══════════════════════════════════════════════════════════════════
  // INLAND (land-only) provinces — 13 total
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'boh', name: 'Bohemia', type: 'land',
    isSupplyCenter: false,
    armyAdj: ['mun', 'sil', 'gal', 'vie', 'tyr'],
    fleetAdj: [],
  },
  {
    id: 'bud', name: 'Budapest', type: 'land',
    isSupplyCenter: true, homeCenter: 'Austria',
    armyAdj: ['vie', 'tri', 'ser', 'rum', 'gal'],
    fleetAdj: [],
  },
  {
    id: 'gal', name: 'Galicia', type: 'land',
    isSupplyCenter: false,
    armyAdj: ['boh', 'sil', 'war', 'ukr', 'rum', 'bud', 'vie'],
    fleetAdj: [],
  },
  {
    id: 'mos', name: 'Moscow', type: 'land',
    isSupplyCenter: true, homeCenter: 'Russia',
    armyAdj: ['stp', 'fin', 'lvn', 'war', 'ukr', 'sev'],
    fleetAdj: [],
  },
  {
    id: 'mun', name: 'Munich', type: 'land',
    isSupplyCenter: true, homeCenter: 'Germany',
    armyAdj: ['bur', 'ruh', 'kie', 'ber', 'sil', 'boh', 'tyr'],
    fleetAdj: [],
  },
  {
    id: 'par', name: 'Paris', type: 'land',
    isSupplyCenter: true, homeCenter: 'France',
    armyAdj: ['bre', 'pic', 'bur', 'gas'],
    fleetAdj: [],
  },
  {
    id: 'ruh', name: 'Ruhr', type: 'land',
    isSupplyCenter: false,
    armyAdj: ['bel', 'hol', 'kie', 'mun', 'bur'],
    fleetAdj: [],
  },
  {
    id: 'ser', name: 'Serbia', type: 'land',
    isSupplyCenter: true,
    armyAdj: ['bud', 'rum', 'bul', 'gre', 'alb', 'tri'],
    fleetAdj: [],
  },
  {
    id: 'sil', name: 'Silesia', type: 'land',
    isSupplyCenter: false,
    armyAdj: ['ber', 'pru', 'war', 'gal', 'boh', 'mun'],
    fleetAdj: [],
  },
  {
    id: 'tyr', name: 'Tyrolia', type: 'land',
    isSupplyCenter: false,
    armyAdj: ['mun', 'boh', 'vie', 'tri', 'ven', 'pie'],
    fleetAdj: [],
  },
  {
    id: 'ukr', name: 'Ukraine', type: 'land',
    isSupplyCenter: false,
    armyAdj: ['mos', 'sev', 'rum', 'gal', 'war'],
    fleetAdj: [],
  },
  {
    id: 'vie', name: 'Vienna', type: 'land',
    isSupplyCenter: true, homeCenter: 'Austria',
    armyAdj: ['tyr', 'boh', 'gal', 'bud', 'tri'],
    fleetAdj: [],
  },
  {
    id: 'war', name: 'Warsaw', type: 'land',
    isSupplyCenter: true, homeCenter: 'Russia',
    armyAdj: ['pru', 'lvn', 'mos', 'ukr', 'gal', 'sil'],
    fleetAdj: [],
  },
  // Burgundy is inland
  {
    id: 'bur', name: 'Burgundy', type: 'land',
    isSupplyCenter: false,
    armyAdj: ['par', 'pic', 'bel', 'ruh', 'mun', 'mar', 'gas'],
    fleetAdj: [],
  },
  // Albania is coastal but listed separately below

  // ═══════════════════════════════════════════════════════════════════
  // COASTAL provinces — 39 total (+ 3 bicoastal = 42 with coast access)
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'alb', name: 'Albania', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['tri', 'ser', 'gre'],
    fleetAdj: ['tri', 'adr', 'ion', 'gre'],
  },
  {
    id: 'ank', name: 'Ankara', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Turkey',
    armyAdj: ['con', 'smy', 'arm'],
    fleetAdj: ['con', 'bla', 'arm'],
  },
  {
    id: 'apu', name: 'Apulia', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['ven', 'rom', 'nap'],
    fleetAdj: ['ven', 'adr', 'ion', 'nap'],
  },
  {
    id: 'arm', name: 'Armenia', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['ank', 'smy', 'syr', 'sev'],
    fleetAdj: ['ank', 'bla', 'sev'],
  },
  {
    id: 'bel', name: 'Belgium', type: 'coastal',
    isSupplyCenter: true,
    armyAdj: ['pic', 'bur', 'ruh', 'hol'],
    fleetAdj: ['pic', 'eng', 'nth', 'hol'],
  },
  {
    id: 'ber', name: 'Berlin', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Germany',
    armyAdj: ['kie', 'mun', 'sil', 'pru'],
    fleetAdj: ['kie', 'bal', 'pru'],
  },
  {
    id: 'bre', name: 'Brest', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'France',
    armyAdj: ['pic', 'par', 'gas'],
    fleetAdj: ['pic', 'eng', 'mao', 'gas'],
  },
  {
    id: 'cly', name: 'Clyde', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['edi', 'lvp'],
    fleetAdj: ['edi', 'nwg', 'nat', 'lvp'],
  },
  {
    id: 'con', name: 'Constantinople', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Turkey',
    // Army can cross between Europe and Asia Minor
    armyAdj: ['bul', 'ank', 'smy'],
    fleetAdj: ['bul/ec', 'bul/sc', 'bla', 'ank', 'smy', 'aeg'],
  },
  {
    id: 'den', name: 'Denmark', type: 'coastal',
    isSupplyCenter: true,
    // Army can move to Sweden (crossing) and Kiel
    armyAdj: ['kie', 'swe'],
    fleetAdj: ['kie', 'hel', 'nth', 'ska', 'bal', 'swe'],
  },
  {
    id: 'edi', name: 'Edinburgh', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'England',
    armyAdj: ['cly', 'lvp', 'yor'],
    fleetAdj: ['cly', 'nwg', 'nth', 'yor'],
  },
  {
    id: 'fin', name: 'Finland', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['swe', 'nor', 'stp'],
    fleetAdj: ['swe', 'bot', 'stp/sc'],
  },
  {
    id: 'gas', name: 'Gascony', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['bre', 'par', 'bur', 'mar', 'spa'],
    fleetAdj: ['bre', 'mao', 'spa/nc'],
  },
  {
    id: 'gre', name: 'Greece', type: 'coastal',
    isSupplyCenter: true,
    armyAdj: ['alb', 'ser', 'bul'],
    fleetAdj: ['alb', 'ion', 'aeg', 'bul/sc'],
  },
  {
    id: 'hol', name: 'Holland', type: 'coastal',
    isSupplyCenter: true,
    armyAdj: ['bel', 'ruh', 'kie'],
    fleetAdj: ['bel', 'nth', 'hel', 'kie'],
  },
  {
    id: 'kie', name: 'Kiel', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Germany',
    // Kiel canal: connects Baltic to Heligoland Bight
    armyAdj: ['hol', 'ruh', 'mun', 'ber', 'den'],
    fleetAdj: ['hol', 'hel', 'den', 'bal', 'ber'],
  },
  {
    id: 'lon', name: 'London', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'England',
    armyAdj: ['wal', 'yor'],
    fleetAdj: ['wal', 'eng', 'nth', 'yor'],
  },
  {
    id: 'lvn', name: 'Livonia', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['pru', 'war', 'mos', 'stp'],
    fleetAdj: ['pru', 'bal', 'bot', 'stp/sc'],
  },
  {
    id: 'lvp', name: 'Liverpool', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'England',
    armyAdj: ['cly', 'edi', 'yor', 'wal'],
    fleetAdj: ['cly', 'nat', 'iri', 'wal'],
  },
  {
    id: 'mar', name: 'Marseilles', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'France',
    armyAdj: ['spa', 'gas', 'bur', 'pie'],
    fleetAdj: ['spa/sc', 'gol', 'pie'],
  },
  {
    id: 'naf', name: 'North Africa', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['tun'],
    fleetAdj: ['tun', 'wes', 'mao'],
  },
  {
    id: 'nap', name: 'Naples', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Italy',
    armyAdj: ['rom', 'apu'],
    fleetAdj: ['rom', 'tyn', 'ion', 'apu'],
  },
  {
    id: 'nor', name: 'Norway', type: 'coastal',
    isSupplyCenter: true,
    armyAdj: ['stp', 'fin', 'swe'],
    fleetAdj: ['stp/nc', 'bar', 'nwg', 'nth', 'ska', 'swe'],
  },
  {
    id: 'pic', name: 'Picardy', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['bre', 'par', 'bur', 'bel'],
    fleetAdj: ['bre', 'eng', 'bel'],
  },
  {
    id: 'pie', name: 'Piedmont', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['mar', 'tyr', 'ven', 'tus'],
    fleetAdj: ['mar', 'gol', 'tus'],
  },
  {
    id: 'por', name: 'Portugal', type: 'coastal',
    isSupplyCenter: true,
    armyAdj: ['spa'],
    fleetAdj: ['spa/nc', 'spa/sc', 'mao'],
  },
  {
    id: 'pru', name: 'Prussia', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['ber', 'sil', 'war', 'lvn'],
    fleetAdj: ['ber', 'bal', 'lvn'],
  },
  {
    id: 'rom', name: 'Rome', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Italy',
    armyAdj: ['tus', 'ven', 'apu', 'nap'],
    fleetAdj: ['tus', 'tyn', 'nap'],
  },
  {
    id: 'rum', name: 'Rumania', type: 'coastal',
    isSupplyCenter: true,
    armyAdj: ['bud', 'gal', 'ukr', 'sev', 'bul', 'ser'],
    fleetAdj: ['sev', 'bla', 'bul/ec'],
  },
  {
    id: 'sev', name: 'Sevastopol', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Russia',
    armyAdj: ['ukr', 'mos', 'arm', 'rum'],
    fleetAdj: ['rum', 'bla', 'arm'],
  },
  {
    id: 'smy', name: 'Smyrna', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Turkey',
    armyAdj: ['con', 'ank', 'arm', 'syr'],
    fleetAdj: ['con', 'aeg', 'eas', 'syr'],
  },
  {
    id: 'swe', name: 'Sweden', type: 'coastal',
    isSupplyCenter: true,
    // Army can reach Denmark (crossing) and Norway, Finland
    armyAdj: ['den', 'nor', 'fin'],
    fleetAdj: ['den', 'ska', 'nor', 'fin', 'bot', 'bal'],
  },
  {
    id: 'syr', name: 'Syria', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['smy', 'arm'],
    fleetAdj: ['smy', 'eas'],
  },
  {
    id: 'tri', name: 'Trieste', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Austria',
    armyAdj: ['ven', 'tyr', 'vie', 'bud', 'ser', 'alb'],
    fleetAdj: ['ven', 'adr', 'alb'],
  },
  {
    id: 'tun', name: 'Tunis', type: 'coastal',
    isSupplyCenter: true,
    armyAdj: ['naf'],
    fleetAdj: ['naf', 'wes', 'tyn', 'ion'],
  },
  {
    id: 'tus', name: 'Tuscany', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['pie', 'ven', 'rom'],
    fleetAdj: ['pie', 'gol', 'tyn', 'rom'],
  },
  {
    id: 'ven', name: 'Venice', type: 'coastal',
    isSupplyCenter: true, homeCenter: 'Italy',
    armyAdj: ['pie', 'tyr', 'tri', 'apu', 'rom', 'tus'],
    fleetAdj: ['tri', 'adr', 'apu'],
  },
  {
    id: 'wal', name: 'Wales', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['lon', 'yor', 'lvp'],
    fleetAdj: ['lon', 'eng', 'iri', 'lvp'],
  },
  {
    id: 'yor', name: 'Yorkshire', type: 'coastal',
    isSupplyCenter: false,
    armyAdj: ['lon', 'wal', 'lvp', 'edi'],
    fleetAdj: ['lon', 'nth', 'edi'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // BICOASTAL provinces — 3 total
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'bul', name: 'Bulgaria', type: 'bicoastal',
    isSupplyCenter: true,
    armyAdj: ['ser', 'rum', 'con', 'gre'],
    fleetAdj: [], // must use coastalAdj
    coastalAdj: {
      ec: ['rum', 'bla', 'con'],    // east coast
      sc: ['con', 'aeg', 'gre'],    // south coast
    },
  },
  {
    id: 'spa', name: 'Spain', type: 'bicoastal',
    isSupplyCenter: true,
    armyAdj: ['por', 'gas', 'mar'],
    fleetAdj: [], // must use coastalAdj
    coastalAdj: {
      nc: ['por', 'mao', 'gas'],          // north coast
      sc: ['por', 'mao', 'wes', 'gol', 'mar'], // south coast
    },
  },
  {
    id: 'stp', name: 'St. Petersburg', type: 'bicoastal',
    isSupplyCenter: true, homeCenter: 'Russia',
    armyAdj: ['fin', 'nor', 'mos', 'lvn'],
    fleetAdj: [], // must use coastalAdj
    coastalAdj: {
      nc: ['bar', 'nor'],           // north coast
      sc: ['fin', 'bot', 'lvn'],    // south coast
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // SEA provinces — 19 total
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'adr', name: 'Adriatic Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['ven', 'tri', 'alb', 'ion', 'apu'],
  },
  {
    id: 'aeg', name: 'Aegean Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['gre', 'bul/sc', 'con', 'smy', 'eas', 'ion'],
  },
  {
    id: 'bal', name: 'Baltic Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['ber', 'pru', 'lvn', 'bot', 'swe', 'den', 'kie'],
  },
  {
    id: 'bar', name: 'Barents Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['stp/nc', 'nor', 'nwg'],
  },
  {
    id: 'bla', name: 'Black Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['rum', 'sev', 'arm', 'ank', 'con', 'bul/ec'],
  },
  {
    id: 'bot', name: 'Gulf of Bothnia', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['swe', 'fin', 'stp/sc', 'lvn', 'bal'],
  },
  {
    id: 'eas', name: 'Eastern Mediterranean', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['ion', 'aeg', 'smy', 'syr'],
  },
  {
    id: 'eng', name: 'English Channel', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['lon', 'wal', 'iri', 'mao', 'bre', 'pic', 'bel', 'nth'],
  },
  {
    id: 'gol', name: 'Gulf of Lyon', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['spa/sc', 'mar', 'pie', 'tus', 'tyn', 'wes'],
  },
  {
    id: 'hel', name: 'Heligoland Bight', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['hol', 'den', 'kie', 'nth'],
  },
  {
    id: 'ion', name: 'Ionian Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['tun', 'tyn', 'nap', 'apu', 'adr', 'alb', 'gre', 'aeg', 'eas'],
  },
  {
    id: 'iri', name: 'Irish Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['nat', 'lvp', 'wal', 'eng', 'mao'],
  },
  {
    id: 'mao', name: 'Mid-Atlantic Ocean', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['nat', 'iri', 'eng', 'bre', 'gas', 'spa/nc', 'por', 'spa/sc', 'wes', 'naf'],
  },
  {
    id: 'nat', name: 'North Atlantic Ocean', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['nwg', 'cly', 'lvp', 'iri', 'mao'],
  },
  {
    id: 'nth', name: 'North Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['edi', 'yor', 'lon', 'eng', 'bel', 'hol', 'hel', 'den', 'ska', 'nor', 'nwg'],
  },
  {
    id: 'nwg', name: 'Norwegian Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['nat', 'cly', 'edi', 'nth', 'nor', 'bar'],
  },
  {
    id: 'ska', name: 'Skagerrak', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['nor', 'swe', 'den', 'nth'],
  },
  {
    id: 'tyn', name: 'Tyrrhenian Sea', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['tus', 'rom', 'nap', 'ion', 'tun', 'wes', 'gol'],
  },
  {
    id: 'wes', name: 'Western Mediterranean', type: 'sea',
    isSupplyCenter: false,
    armyAdj: [],
    fleetAdj: ['spa/sc', 'gol', 'tyn', 'tun', 'naf', 'mao'],
  },
];

// ─── Build the PROVINCES map ─────────────────────────────────────────

export const PROVINCES: Map<string, ProvinceData> = new Map(
  provinceArray.map((p) => [p.id, p]),
);

// ─── Supply Centers ──────────────────────────────────────────────────

export const SUPPLY_CENTERS: string[] = provinceArray
  .filter((p) => p.isSupplyCenter)
  .map((p) => p.id);

// ─── Home Centers ────────────────────────────────────────────────────

export const HOME_CENTERS: Map<string, Power> = new Map(
  provinceArray
    .filter((p): p is ProvinceData & { homeCenter: Power } => p.homeCenter !== undefined)
    .map((p) => [p.id, p.homeCenter]),
);

// ─── Helper: parse a fleet adjacency entry ───────────────────────────
// Fleet adjacency strings may include coast specifiers like "bul/ec".
// This helper strips the coast part for province-ID comparison.

function stripCoast(entry: string): string {
  const slash = entry.indexOf('/');
  return slash === -1 ? entry : entry.substring(0, slash);
}

function entryCoast(entry: string): Coast {
  const slash = entry.indexOf('/');
  if (slash === -1) return null;
  return entry.substring(slash + 1) as Coast;
}

// ─── isAdjacent ──────────────────────────────────────────────────────

/**
 * Determine whether a unit can move from `from` to `to`.
 *
 * @param from       Source province ID (e.g. 'lon')
 * @param to         Destination province ID (e.g. 'nth')
 * @param unitType   'Army' or 'Fleet'
 * @param fromCoast  Coast the unit is on (for fleets in bicoastal provinces)
 * @param toCoast    Coast the unit is moving to (for bicoastal destinations)
 */
export function isAdjacent(
  from: string,
  to: string,
  unitType: UnitType,
  fromCoast?: Coast,
  toCoast?: Coast,
): boolean {
  const province = PROVINCES.get(from);
  if (!province) return false;

  const dest = PROVINCES.get(to);
  if (!dest) return false;

  // ── Army logic ─────────────────────────────────────────────────
  if (unitType === 'Army') {
    // Armies cannot enter sea zones
    if (dest.type === 'sea') return false;
    return province.armyAdj.includes(to);
  }

  // ── Fleet logic ────────────────────────────────────────────────
  // Fleets cannot enter inland provinces
  if (dest.type === 'land') return false;

  // Source is bicoastal — use coastalAdj
  if (province.type === 'bicoastal' && province.coastalAdj) {
    const coast = fromCoast ?? null;
    if (!coast) return false; // fleet must specify coast on bicoastal
    const key = coast as keyof typeof province.coastalAdj;
    const adj = province.coastalAdj[key];
    if (!adj) return false;

    // If the destination is also bicoastal, check coast match
    if (dest.type === 'bicoastal' && toCoast) {
      return adj.includes(`${to}/${toCoast}`);
    }
    // Check if `to` (possibly with coast qualifier stripped) is in the list
    return adj.some((entry: string) => stripCoast(entry) === to);
  }

  // Destination is bicoastal — the toCoast matters
  if (dest.type === 'bicoastal') {
    // Check the plain fleetAdj list for coast-qualified entries
    if (toCoast) {
      const qualified = `${to}/${toCoast}`;
      return province.fleetAdj.includes(qualified);
    }
    // If no coast specified, check if any coast of dest appears
    return province.fleetAdj.some((entry) => stripCoast(entry) === to);
  }

  // Normal fleet adjacency
  return province.fleetAdj.some((entry) => stripCoast(entry) === to);
}

// ─── getAdjacentProvinces ────────────────────────────────────────────

/**
 * Return all province IDs reachable from the given province for the given unit type.
 *
 * @param provinceId  Province to query from
 * @param unitType    'Army' or 'Fleet'
 * @param coast       Coast the fleet is on (required for bicoastal provinces)
 */
export function getAdjacentProvinces(
  provinceId: string,
  unitType: UnitType,
  coast?: Coast,
): string[] {
  const province = PROVINCES.get(provinceId);
  if (!province) return [];

  if (unitType === 'Army') {
    return [...province.armyAdj];
  }

  // Fleet in a bicoastal province
  if (province.type === 'bicoastal' && province.coastalAdj) {
    const c = coast ?? null;
    if (!c) return [];
    const key = c as keyof typeof province.coastalAdj;
    const adj = province.coastalAdj[key];
    if (!adj) return [];
    // Strip coast qualifiers to return province IDs
    return adj.map(stripCoast);
  }

  // Normal fleet — strip coast qualifiers
  return province.fleetAdj.map(stripCoast);
}

// ─── getValidCoasts ──────────────────────────────────────────────────

/**
 * Return the valid coasts for a province. For non-bicoastal provinces
 * this returns an empty array. For bicoastal provinces it returns the
 * coast identifiers defined in coastalAdj.
 */
export function getValidCoasts(provinceId: string): Coast[] {
  const province = PROVINCES.get(provinceId);
  if (!province || province.type !== 'bicoastal' || !province.coastalAdj) {
    return [];
  }
  return Object.keys(province.coastalAdj) as Coast[];
}

// ─── Display formatting ─────────────────────────────────────────────

/**
 * Format a province ID for display.
 * Sea zones → UPPERCASE (e.g. "NTH", "ENG", "MAO")
 * Land/coastal/bicoastal → Title Case (e.g. "Ber", "Mun", "Spa")
 */
export function displayProvince(provinceId: string, coast?: Coast | null): string {
  const province = PROVINCES.get(provinceId);
  if (!province) {
    return provinceId.toUpperCase(); // Fallback
  }

  let name: string;
  if (province.type === 'sea') {
    name = provinceId.toUpperCase();
  } else {
    // Title case: first letter uppercase, rest lowercase
    name = provinceId.charAt(0).toUpperCase() + provinceId.slice(1).toLowerCase();
  }

  if (coast) {
    name += `/${coast}`;
  }
  return name;
}
