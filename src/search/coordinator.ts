/**
 * Multi-threaded MCTS coordinator.
 *
 * Distributes MCTS work across Node.js Worker Threads.
 * Each worker runs independent MCTS with a unique seed.
 * Results are merged using the transposition table.
 *
 * Uses AbortController for cooperative cancellation.
 */
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import {
  GameState,
  Coalition,
  SearchResult,
  RankedMove,
  Power,
} from '../core/types';
import { MCTSEngine, MCTSConfig } from './mcts';
import { TranspositionTable } from './transposition';
import { createLogger } from '../utils/logger';

const logger = createLogger('search-coordinator');

export interface SearchOptions {
  state: GameState;
  coalition: Coalition;
  maxDepth: number;
  threads: number;
  seed?: number;
  searchTimeMs?: number;
  signal?: AbortSignal;
  onProgress?: (totalIterations: number) => void;
}

/**
 * Coordinate parallel MCTS search across worker threads.
 */
export async function parallelSearch(options: SearchOptions): Promise<SearchResult> {
  const {
    state,
    coalition,
    maxDepth,
    threads,
    seed,
    searchTimeMs = 60000,
    signal,
    onProgress,
  } = options;

  const numThreads = threads > 0 ? threads : os.cpus().length;

  // For single-thread mode, run directly (simpler and avoids worker overhead)
  if (numThreads === 1) {
    return singleThreadSearch(options);
  }

  const startTime = Date.now();

  // Serialize state for transfer
  const supplyCenterEntries: [string, string][] = [];
  for (const [k, v] of state.supplyCenters) {
    supplyCenterEntries.push([k, v]);
  }

  const workers: Worker[] = [];
  const results: SearchResult[] = [];
  const transpositionTables: TranspositionTable[] = [];
  let totalProgress = 0;

  const workerPromises: Promise<void>[] = [];

  for (let i = 0; i < numThreads; i++) {
    const workerPath = path.resolve(__dirname, 'worker.js');

    const promise = new Promise<void>((resolve, reject) => {
      try {
        const worker = new Worker(workerPath);
        workers.push(worker);

        worker.on('message', (msg: any) => {
          if (msg.type === 'progress') {
            totalProgress += 100; // Each progress report is 100 iterations
            if (onProgress) {
              onProgress(totalProgress);
            }
          } else if (msg.type === 'result') {
            results.push(msg.result);
            if (msg.transpositionData) {
              transpositionTables.push(
                TranspositionTable.deserialize(msg.transpositionData)
              );
            }
            resolve();
          } else if (msg.type === 'error') {
            logger.error(`Worker ${msg.workerId} error: ${msg.error}`);
            resolve(); // Don't reject, partial results are OK
          }
        });

        worker.on('error', (err) => {
          logger.error(`Worker ${i} error: ${err.message}`);
          resolve(); // Don't reject
        });

        const config: MCTSConfig = {
          maxDepth,
          searchTimeMs,
          explorationConstant: 1.414,
          seed,
          coalition,
        };

        worker.postMessage({
          state: { ...state, supplyCenters: undefined },
          config,
          workerId: i,
          supplyCenterEntries,
        });
      } catch (err: any) {
        logger.error(`Failed to create worker ${i}: ${err.message}`);
        resolve();
      }
    });

    workerPromises.push(promise);
  }

  // Handle cancellation
  if (signal) {
    signal.addEventListener('abort', () => {
      for (const worker of workers) {
        worker.terminate();
      }
    });
  }

  // Wait for all workers
  await Promise.all(workerPromises);

  // Terminate workers
  for (const worker of workers) {
    worker.terminate();
  }

  // Merge results
  const mergedResult = mergeResults(results, Date.now() - startTime);

  return mergedResult;
}

/**
 * Single-threaded search (no workers).
 */
function singleThreadSearch(options: SearchOptions): SearchResult {
  const config: MCTSConfig = {
    maxDepth: options.maxDepth,
    searchTimeMs: options.searchTimeMs ?? 60000,
    explorationConstant: 1.414,
    seed: options.seed,
    coalition: options.coalition,
    signal: options.signal,
  };

  const engine = new MCTSEngine(config);
  return engine.search(options.state, options.onProgress);
}

/**
 * Merge results from multiple MCTS workers.
 * Combines visit counts and selects the best moves overall.
 */
function mergeResults(results: SearchResult[], elapsedMs: number): SearchResult {
  if (results.length === 0) {
    return { rankedMoves: [], totalSimulations: 0, elapsedMs };
  }

  if (results.length === 1) {
    return { ...results[0], elapsedMs };
  }

  // Merge ranked moves by order fingerprint
  const moveMap = new Map<string, RankedMove>();
  let totalSims = 0;

  for (const result of results) {
    totalSims += result.totalSimulations;

    for (const move of result.rankedMoves) {
      const key = orderFingerprint(move.orders);
      const existing = moveMap.get(key);

      if (existing) {
        // Merge statistics
        const mergedVisits = existing.confidence.visits + move.confidence.visits;
        // Weighted average of expected values
        const mergedExpectedValue = (
          (existing.expectedValue * existing.confidence.visits) +
          (move.expectedValue * move.confidence.visits)
        ) / mergedVisits;
        moveMap.set(key, {
          ...existing,
          score: Math.max(existing.score, move.score),
          expectedValue: mergedExpectedValue,
          confidence: {
            visits: mergedVisits,
            stdev: (existing.confidence.stdev + move.confidence.stdev) / 2,
            level: mergedVisits > 1000 ? 'High' : mergedVisits > 500 ? 'Medium' : 'Low',
          },
        });
      } else {
        moveMap.set(key, move);
      }
    }
  }

  // Re-rank merged moves by expected value (MCTS long-term score)
  const rankedMoves = Array.from(moveMap.values())
    .sort((a, b) => b.expectedValue - a.expectedValue)
    .map((move, i) => ({ ...move, rank: i + 1 }))
    .slice(0, 3);

  return { rankedMoves, totalSimulations: totalSims, elapsedMs };
}

/**
 * Create a fingerprint string for a set of orders for deduplication.
 */
function orderFingerprint(orders: readonly any[]): string {
  return orders
    .map(o => {
      if (o.type === 'move') {
        return `${o.unit?.provinceId}-${o.destination?.provinceId}`;
      }
      if (o.type === 'hold') {
        return `H-${o.unit?.provinceId}`;
      }
      if (o.type === 'support') {
        return `S-${o.unit?.provinceId}-${o.supportedUnit?.provinceId}-${o.destination?.provinceId}`;
      }
      return JSON.stringify(o);
    })
    .sort()
    .join('|');
}
