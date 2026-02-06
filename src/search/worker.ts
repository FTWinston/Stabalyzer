/**
 * Worker thread entry point for parallel MCTS.
 *
 * Each worker runs its own MCTS instance with a unique seed
 * derived from the main seed + worker ID.
 * Results are sent back to the main thread for merging.
 */
import { parentPort, workerData } from 'worker_threads';
import { MCTSEngine, MCTSConfig } from './mcts';
import { GameState, Coalition, SearchResult } from '../core/types';

interface WorkerInput {
  state: GameState;
  config: MCTSConfig;
  workerId: number;
  // Serialized supply centers (Map doesn't transfer)
  supplyCenterEntries: [string, string][];
}

if (parentPort) {
  parentPort.on('message', (input: WorkerInput) => {
    try {
      // Reconstruct GameState with proper Map
      const state: GameState = {
        ...input.state,
        supplyCenters: new Map(input.supplyCenterEntries) as any,
      };

      // Derive unique seed for this worker
      const workerSeed = (input.config.seed ?? Date.now()) + input.workerId * 7919;

      const config: MCTSConfig = {
        ...input.config,
        seed: workerSeed,
      };

      const engine = new MCTSEngine(config);
      const result = engine.search(state, (iterations) => {
        parentPort?.postMessage({
          type: 'progress',
          workerId: input.workerId,
          iterations,
        });
      });

      parentPort?.postMessage({
        type: 'result',
        workerId: input.workerId,
        result,
        transpositionData: engine.getTranspositionTable().serialize(),
      });
    } catch (error: any) {
      parentPort?.postMessage({
        type: 'error',
        workerId: input.workerId,
        error: error.message,
      });
    }
  });
}
