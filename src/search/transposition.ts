/**
 * Transposition table for MCTS.
 *
 * Uses Map<bigint, TranspositionEntry> as specified.
 * Zobrist hashes serve as keys for fast lookup.
 *
 * Thread-safe design: each worker has its own table,
 * results are merged after parallel search completes.
 */
import { TranspositionEntry, Order } from '../core/types';

export class TranspositionTable {
  private table: Map<bigint, TranspositionEntry>;
  private maxSize: number;

  constructor(maxSize: number = 1_000_000) {
    this.table = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Look up a position in the transposition table.
   */
  get(hash: bigint): TranspositionEntry | undefined {
    return this.table.get(hash);
  }

  /**
   * Store or update a position in the transposition table.
   */
  put(entry: TranspositionEntry): void {
    // Eviction: if table is full, we just let Map grow
    // (in production, implement LRU or replacement strategy)
    if (this.table.size >= this.maxSize) {
      // Simple eviction: clear oldest quarter
      const keys = Array.from(this.table.keys());
      const toRemove = Math.floor(keys.length / 4);
      for (let i = 0; i < toRemove; i++) {
        this.table.delete(keys[i]);
      }
    }

    const existing = this.table.get(entry.hash);
    if (existing) {
      // Merge: keep the one with more visits (higher confidence)
      if (entry.visits > existing.visits) {
        this.table.set(entry.hash, entry);
      } else {
        // Update visit counts
        this.table.set(entry.hash, {
          ...existing,
          visits: existing.visits + entry.visits,
          totalValue: existing.totalValue + entry.totalValue,
        });
      }
    } else {
      this.table.set(entry.hash, entry);
    }
  }

  /**
   * Merge another transposition table into this one.
   * Used to combine results from worker threads.
   */
  merge(other: TranspositionTable): void {
    for (const [hash, entry] of other.table) {
      this.put(entry);
    }
  }

  /**
   * Get the number of entries in the table.
   */
  get size(): number {
    return this.table.size;
  }

  /**
   * Clear the table.
   */
  clear(): void {
    this.table.clear();
  }

  /**
   * Serialize the table for transfer between threads.
   */
  serialize(): { hash: string; entry: TranspositionEntry }[] {
    const entries: { hash: string; entry: TranspositionEntry }[] = [];
    for (const [hash, entry] of this.table) {
      entries.push({ hash: hash.toString(), entry });
    }
    return entries;
  }

  /**
   * Deserialize entries from thread transfer.
   */
  static deserialize(
    data: { hash: string; entry: TranspositionEntry }[]
  ): TranspositionTable {
    const table = new TranspositionTable();
    for (const { hash, entry } of data) {
      table.table.set(BigInt(hash), entry);
    }
    return table;
  }
}
