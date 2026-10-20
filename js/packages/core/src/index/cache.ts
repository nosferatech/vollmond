// Where the local index keeps its entries: an interface that the command line implements over the per-user cache directory,
// and a memory implementation.

/**
 * A store of the local index's entries by key, which a store reads and writes through. Keys are those of `parseEntryKey`,
 * `bindingEntryKey` and {@link SNAPSHOT_KEY}: ASCII, with `/` and `.` as separators and no `..`. An entry's bytes are a function
 * of its key, but the snapshot's, so two writers of one entry write the same bytes. The cache is optional: a read may miss
 * at any time, and the store parses instead.
 */
export interface IndexCache {
  /**
   * Gives an entry's bytes, or null when there is none. Never fails: an entry that cannot be read is a miss, and so may be
   * one larger than {@link MAX_ENTRY_BYTES}, which the store does not decode.
   */
  read(key: string): Promise<Uint8Array | null>;
  /** Writes an entry, replacing one with that key whole. A write that fails is ignored, since the cache is optional. */
  write(key: string, rows: Uint8Array): Promise<void>;
  /**
   * The largest entry, in bytes, the cache keeps: {@link MAX_ENTRY_BYTES} when absent, and never more. The store writes no
   * larger entry, builds none past it, and reads a larger one as a miss.
   */
  readonly maxEntryBytes?: number;
}

/**
 * The largest entry or snapshot, in bytes, that the index reads or writes: 128 MiB, eight times the largest record. A larger
 * one is a miss, and is never built whole: writing stops at the bound. A record's own entry is bounded more tightly, by its
 * record's size ({@link entryBound}), and a cache may set a smaller bound of its own ({@link IndexCache.maxEntryBytes}).
 *
 * Entries are about half their record's size for prose (a 727 KB design document's is 287 KB), but a row per value makes a
 * record of tiny values many times larger: about 8 times for an object of small members, and about 49 times for an array of
 * single digits. Rows decode at about 90 MB/s, so an entry past the bound would take over a second to read.
 */
export const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

/** The entry every record may have, whatever its size: 64 KiB. */
const ENTRY_FLOOR_BYTES = 64 * 1024;

/** How many times its record's size a record's entry may be. */
const ENTRY_RATIO = 2;

// Deviation from the I2 design, recorded in issue #25: entries are bounded, absolutely and by their record's size.
/**
 * Gives the largest entry the index keeps for a record of `recordBytes` bytes, under a cache's bound: twice the record, or
 * 64 KiB for a small one. Restoring an entry holds its bytes where parsing holds the record's, so an entry many times its
 * record costs more memory to read than the parse it saves. Measured on arrays of tiny values, whose entries are largest:
 * an entry 2.5 times its record restored in 197 MiB where the parse took 200 MiB, and one 5.1 times its record in 353 MiB
 * where the parse took 328 MiB. Prose is far within it: a 727 KB design document's entry is 287 KB.
 */
export function entryBound(recordBytes: number, cacheBound = MAX_ENTRY_BYTES): number {
  return Math.min(cacheBound, MAX_ENTRY_BYTES, Math.max(ENTRY_FLOOR_BYTES, ENTRY_RATIO * recordBytes));
}

/** The key of a store's snapshot: the previous index of its last full check. A cache is scoped to one store for it. */
export const SNAPSHOT_KEY = "snapshot";

/** An {@link IndexCache} in memory, which also says what it holds and counts its reads and writes, for tests. */
export interface MemoryIndexCache extends IndexCache {
  /** The entries, by key. */
  readonly entries: Map<string, Uint8Array>;
  /** The keys read and written, in order, each read as `read <key>` and each write as `write <key>`. */
  readonly log: string[];
}

/**
 * Creates an empty {@link MemoryIndexCache}, with the bound on its entries given, {@link MAX_ENTRY_BYTES} by default. Each
 * entry is copied in and out, so a caller cannot change what it holds. It holds what it is given, whatever its size: the
 * store keeps to the bound.
 */
export function createMemoryIndexCache(options: { readonly maxEntryBytes?: number } = {}): MemoryIndexCache {
  const entries = new Map<string, Uint8Array>();
  const log: string[] = [];
  return {
    entries,
    log,
    ...(options.maxEntryBytes === undefined ? {} : { maxEntryBytes: options.maxEntryBytes }),
    read: async (key) => {
      log.push(`read ${key}`);
      const found = entries.get(key);
      return found === undefined ? null : found.slice();
    },
    write: async (key, rows) => {
      log.push(`write ${key}`);
      entries.set(key, rows.slice());
    },
  };
}
