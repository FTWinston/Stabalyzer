#!/usr/bin/env node
/**
 * Stabalyzer CLI entry point.
 *
 * Single primary command: analyze
 *
 * Usage:
 *   stabalyzer analyze --url <backstabbr-url> --coalitions <spec> --optimize-for <player> --max-depth <int>
 *
 * Options:
 *   --url              Backstabbr game URL (required)
 *   --coalitions       Coalition specification, e.g. England+France,Italy+Turkey (required)
 *   --optimize-for     Player or coalition to optimize for (required)
 *   --max-depth        Maximum search depth in turns (required)
 *   --threads          Number of worker threads (default: CPU cores)
 *   --seed             Random seed for deterministic MCTS
 *   --verbose          Enable detailed logging
 */
import { Command } from 'commander';
import * as os from 'os';
import { scrapeBackstabbr } from '../scraper';
import { GameStateBuilder } from '../core/gameStateBuilder';
import { parallelSearch } from '../search/coordinator';
import { parseCoalitions } from '../utils/coalitions';
import { enableVerbose, createLogger } from '../utils/logger';
import { formatOutput } from './output';
import { Coalition } from '../core/types';

const logger = createLogger('cli');
const program = new Command();

program
  .name('stabalyzer')
  .description('Diplomacy game analyzer using Monte Carlo Tree Search')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze a Backstabbr game and recommend orders')
  .requiredOption('--url <url>', 'Backstabbr game URL')
  .requiredOption('--coalitions <spec>', 'Coalition specification (e.g. England+France,Italy+Turkey)')
  .requiredOption('--optimize-for <player>', 'Player or coalition to optimize for')
  .requiredOption('--max-depth <depth>', 'Maximum search depth in turns', parseInt)
  .option('--search-time <seconds>', 'Search time in seconds (default: 60)', parseInt)
  .option('--threads <count>', 'Number of worker threads', parseInt)
  .option('--seed <seed>', 'Random seed for deterministic MCTS', parseInt)
  .option('--verbose', 'Enable detailed logging')
  .action(async (options) => {
    try {
      if (options.verbose) {
        enableVerbose();
      }

      const {
        url,
        coalitions: coalitionSpec,
        optimizeFor,
        maxDepth,
        searchTime,
        threads,
        seed,
      } = options;

      // Parse coalitions
      const coalitions = parseCoalitions(coalitionSpec);
      if (coalitions.length === 0) {
        console.error('Error: No valid coalitions specified');
        process.exit(1);
      }

      // Find the coalition to optimize for
      let optimizeCoalition: Coalition | undefined;
      for (const c of coalitions) {
        if (
          c.name.toLowerCase() === optimizeFor.toLowerCase() ||
          c.powers.some(p => p.toLowerCase() === optimizeFor.toLowerCase())
        ) {
          optimizeCoalition = c;
          break;
        }
      }

      if (!optimizeCoalition) {
        // If optimize-for is a single power, create a coalition for it
        try {
          const parsed = parseCoalitions(optimizeFor);
          if (parsed.length > 0) {
            optimizeCoalition = parsed[0];
          }
        } catch {
          console.error(`Error: Cannot find coalition or power "${optimizeFor}"`);
          process.exit(1);
        }
      }

      if (!optimizeCoalition) {
        console.error(`Error: Cannot find coalition or power "${optimizeFor}"`);
        process.exit(1);
      }

      const numThreads = threads ?? os.cpus().length;

      logger.info(`Analyzing game: ${url}`);
      logger.info(`Coalitions: ${coalitions.map(c => c.name).join(', ')}`);
      logger.info(`Optimizing for: ${optimizeCoalition.name}`);
      const searchTimeMs = (searchTime ?? 60) * 1000;
      logger.info(`Max depth: ${maxDepth}, Threads: ${numThreads}, Search time: ${searchTime ?? 60}s`);
      if (seed !== undefined) logger.info(`Seed: ${seed}`);

      // Progress indicator
      let progressInterval: NodeJS.Timeout | undefined;
      let currentIterations = 0;

      // Step 1: Scrape game state
      process.stdout.write('Scraping game state...\r');
      const scrapedState = await scrapeBackstabbr(url);
      process.stdout.write('Scraping game state... done\n');

      // Step 2: Convert to internal model
      const gameState = GameStateBuilder.fromScraped(scrapedState);

      logger.info(`Game state: ${gameState.units.length} units, ${gameState.supplyCenters.size} SCs`);
      logger.info(`Turn: ${gameState.turn.season} ${gameState.turn.year} ${gameState.turn.phase}`);

      // Step 3: Run MCTS
      const abortController = new AbortController();

      // Handle SIGINT for graceful cancellation
      process.on('SIGINT', () => {
        process.stdout.write('\nCancelling search...\n');
        abortController.abort();
      });

      progressInterval = setInterval(() => {
        process.stdout.write(
          `\rSearching... ${currentIterations.toLocaleString()} simulations`
        );
      }, 500);

      const result = await parallelSearch({
        state: gameState,
        coalition: optimizeCoalition,
        maxDepth,
        threads: numThreads,
        seed,
        searchTimeMs,
        signal: abortController.signal,
        onProgress: (iterations) => {
          currentIterations = iterations;
        },
      });

      clearInterval(progressInterval);
      process.stdout.write('\r' + ' '.repeat(60) + '\r'); // Clear progress line

      // Step 4: Output results
      const output = formatOutput(
        result,
        optimizeCoalition,
        gameState,
        maxDepth,
        numThreads,
        searchTime ?? 60,
        seed
      );

      console.log(output);
      process.exit(0);
    } catch (error: any) {
      if (options.verbose) {
        console.error('Error:', error);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
