# Stabalyzer

A production-ready Node.js + TypeScript command-line application that analyzes Diplomacy games from [Backstabbr](https://www.backstabbr.com) using **Monte Carlo Tree Search (MCTS)**.

Stabalyzer scrapes a Backstabbr game URL, evaluates possible moves N turns into the future, and prints a plain-text ranked list of recommended orders with fitness scores optimized for one or more cooperating players (coalitions).

## Features

- **MCTS-only search** with UCT selection policy
- **Multi-threaded** via Node.js Worker Threads
- **Deterministic mode** with `--seed` for reproducible results
- **Coalition support** for cooperating players
- **Full Diplomacy adjudicator** matching DATC rules
- **Embedded DATC test cases** for adjudicator verification
- **Plain-text output** with ranked orders, fitness scores, and confidence indicators

## Architecture Overview

```
src/
  cli/          CLI entry point and output formatting
  core/         Game model, adjudicator, fitness evaluation
  search/       MCTS engine, Zobrist hashing, transposition table, worker threads
  scraper/      Backstabbr page scraping via Cheerio
  utils/        Logger, seeded PRNG, coalition parser
tests/
  datc/         Embedded DATC test cases and adjudicator tests
  integration/  Full pipeline integration tests
```

### Fitness Function

```
fitness = supply_centers × 1000 + units
```

- **Primary**: supply centers held by the coalition
- **Secondary**: surviving coalition units
- **Terminal win (domination)**: any single player reaches 18 SC → score = 999,999
- **Terminal win (elimination)**: all non-coalition players eliminated → score = 999,999

### MCTS Details

- **Selection**: UCT with exploration constant C = √2 ≈ 1.414
- **Expansion**: random untried order set per iteration
- **Rollout**: heuristic-guided random playout preferring SC gains and unit preservation
- **Backpropagation**: visit counts, total value, variance tracking
- **Transposition**: Zobrist hashing with `Map<bigint, TranspositionEntry>`
- **Parallelism**: each Worker Thread runs independent MCTS with a unique seed derived from the main seed
- **Cancellation**: cooperative via `AbortController`

### Scraping

**Library**: Cheerio (lightweight HTML parser)

**Rationale**: Backstabbr embeds game state data as JavaScript variables (`unitsByPlayer`, `territories`) in inline `<script>` tags. Cheerio can extract these via regex without needing a full browser. This makes scraping fast, lightweight, and CI-friendly (no Playwright/browser dependency).

**Limitations**:
- Requires the game page to be publicly accessible
- Cannot handle games behind Backstabbr authentication
- Depends on Backstabbr's page structure; may break if they change their HTML
- Does not execute JavaScript; relies on data being in inline script tags

## Installation

```bash
npm install
npm run build
```

## CLI Usage

### Analyze a game

```bash
node dist/cli/index.js analyze \
  --url "https://www.backstabbr.com/game/XXXX" \
  --coalitions England+France \
  --optimize-for England \
  --max-depth 4 \
  --threads 8 \
  --seed 42 \
  --verbose
```

### CLI Options

| Flag | Required | Description |
|------|----------|-------------|
| `--url <url>` | Yes | Backstabbr game URL |
| `--coalitions <spec>` | Yes | Coalition spec (e.g. `England+France,Italy+Turkey`) |
| `--optimize-for <player>` | Yes | Player or coalition to optimize for |
| `--max-depth <int>` | Yes | Maximum search depth in turns |
| `--threads <int>` | No | Worker threads (default: CPU cores) |
| `--seed <int>` | No | Random seed for deterministic MCTS |
| `--verbose` | No | Enable detailed logging |

### Example Output

```
Stabalyzer analysis for coalition: England+France
Depth: 4 turns | Threads: 8 | Seed: 42

Recommended orders (ranked):
1) LON - NTH; EDI - NWG; LVP - YOR
   Fitness: 12 SC, 8 units -> Score: 12008
   Likely opponent response: MUN - BUR; BER - KIE (probability 0.34)
   Best follow-up: NTH - NOR; NWG - BAR
   Confidence: High (visits: 1200, stdev: 0.12)

2) LON - ENG; EDI - NTH; LVP - WAL
   Fitness: 11 SC, 9 units -> Score: 11009
   Likely opponent response: BRE - MAO; PAR - BUR (probability 0.28)
   Best follow-up: ENG - BRE; NTH - BEL
   Confidence: Medium (visits: 800, stdev: 0.25)

Notes:
- Any single player reaching 18 SC is an immediate win.
- Alternative win: elimination of all non-opposing players without any player reaching 18 SC.
```

## Testing

### Run all tests

```bash
npm test
```

### Run DATC adjudicator tests only

```bash
npx vitest run --project datc
```

### Run integration tests only

```bash
npx vitest run --project integration
```

### DATC Test Cases

The DATC (Diplomacy Adjudicator Test Cases) are embedded in `tests/datc/datcCases.ts`. These test cases verify the adjudicator handles all standard Diplomacy rules correctly:

- **6.A**: Basic checks (invalid moves, army to sea, fleet to land, etc.)
- **6.B**: Coastal issues (bicoastal provinces)
- **6.C**: Circular movement
- **6.D**: Support cutting
- **6.E**: Head-to-head battles
- **6.F**: Convoys
- **6.G**: Retreats
- **6.H**: Building

Source: [DATC on BoardGameGeek](https://boardgamegeek.com/filepage/274846/datc-diplomacy-adjudicator-test-cases)

## Win Conditions

1. **Domination**: Any single player reaches 18 supply centers → immediate win
2. **Alternative win**: All non-opposing players are eliminated and no player has 18 SC

## License

MIT - see [LICENSE](LICENSE)
