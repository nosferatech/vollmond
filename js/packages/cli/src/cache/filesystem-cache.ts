// The local index over the per-user cache directory: content-addressed entries shared by every store and worktree, one
// snapshot per store, files written whole by rename, and eviction to a bound.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type IndexCache, MAX_ENTRY_BYTES, SNAPSHOT_KEY } from "@vollmond/core";

/** The layout's version: the first part of the directory of one implementation's entries. */
const LAYOUT = "v1";

/** The bound on the entries of one implementation, in bytes, by default: 512 MiB. */
export const DEFAULT_CACHE_BOUND = 512 * 1024 * 1024;

/** How long an entry may go unread before eviction removes it, in milliseconds: 30 days. */
const UNREAD_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

/** How often eviction runs at most, in milliseconds: once a day. */
const EVICTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The file that marks a directory as one implementation's entries, written before its first entry, with this content.
 * Eviction removes another implementation's directory only when it holds it, so a directory of anything else whose name
 * looks like one is left alone.
 */
const LAYOUT_MARKER = "vmd-cache";
const LAYOUT_MARKER_CONTENT = "the local index of vmd, which vmd may remove\n";

/** Where the cache is, and for which build and store. */
export interface FilesystemCacheOptions {
  /** vmd's directory in the per-user cache directory, such as `~/.cache/vmd`. */
  readonly directory: string;
  /**
   * The implementation's id: of the build that writes the entries and of the runtime's Unicode data, so that no build reads
   * another's entries. A hexadecimal string.
   */
  readonly implementation: string;
  /** The store root's real path, whose snapshot this cache reads and writes. */
  readonly storeRoot: string;
  /** The time now, in milliseconds since the epoch; the clock by default. */
  readonly now?: () => number;
  /** The bound on the entries' bytes; {@link DEFAULT_CACHE_BOUND} by default. */
  readonly bound?: number;
}

/** A cache over the per-user cache directory, which also says how many writes failed. */
export interface FilesystemIndexCache extends IndexCache {
  /** The directory of this implementation's entries and snapshots. */
  readonly root: string;
  /** How many writes failed, and were ignored. */
  readonly failedWrites: number;
  /** Runs eviction now, whenever it last ran (see {@link evictCache}); never fails. */
  evict(): Promise<void>;
  /** Gives the bytes of this implementation's entries and snapshots, as the files below {@link root} take; 0 for none. */
  size(): Promise<number>;
}

const VERSION = "[0-9a-f]{40}(?:[0-9a-f]{24})?";
const FORMAT = "(?:md|yaml|json)";
const PARSE_KEY = new RegExp(`^parse/(${VERSION})\\.(${FORMAT})$`);
const BIND_KEY = new RegExp(`^bind/(${VERSION})\\.(${FORMAT})\\.([A-Za-z][A-Za-z0-9_-]*)\\.([0-9a-f]{64})$`);

// Deviation from the I2 design, recorded in issue #25: a store's snapshot is one file, `snapshot.jsonl`, with the references
// after its header and its files, rather than `snapshot.json` beside `snapshot-refs.jsonl`, so that one rename replaces it whole.
/**
 * Creates the filesystem cache of one store:
 *
 * ```
 * <directory>/v1-<implementation>/
 *   entries/parse/<2 hex>/<blob id>.<format>.jsonl
 *   entries/bind/<2 hex>/<blob id>.<format>.<collection>.<schema digest>.jsonl
 *   stores/<store id>/snapshot.jsonl, root      the snapshot, and the store root's real path
 *   last-eviction                                 when eviction last ran
 *   vmd-cache                                     marks the directory as vmd's
 * ```
 *
 * The store id is the SHA-256 of the store root's real path. A key of another shape reads nothing and writes nothing.
 * Reading an entry sets its modification time to now, which is how eviction tells a read entry. A write goes to a temporary
 * file renamed into place, so a reader sees a whole file or none; one that fails is counted and ignored. The first write of
 * the cache's life runs eviction when the last one is more than a day old: see {@link evictCache}.
 */
export function createFilesystemIndexCache(options: FilesystemCacheOptions): FilesystemIndexCache {
  const now = options.now ?? Date.now;
  const root = join(options.directory, `${LAYOUT}-${options.implementation}`);
  const storeId = createHash("sha256").update(options.storeRoot).digest("hex");
  const storeDirectory = join(root, "stores", storeId);
  let failedWrites = 0;
  let evictionChecked = false;
  let marked = false;

  const fileOf = (key: string): string | null => {
    if (key === SNAPSHOT_KEY) return join(storeDirectory, "snapshot.jsonl");
    const parse = PARSE_KEY.exec(key);
    if (parse !== null) {
      const [, version, format] = parse as unknown as [string, string, string];
      return join(root, "entries", "parse", version.slice(0, 2), `${version}.${format}.jsonl`);
    }
    const bind = BIND_KEY.exec(key);
    if (bind !== null) {
      const [, version, format, collection, digest] = bind as unknown as [string, string, string, string, string];
      return join(root, "entries", "bind", version.slice(0, 2), `${version}.${format}.${collection}.${digest}.jsonl`);
    }
    return null;
  };

  const writeWhole = async (file: string, bytes: Uint8Array): Promise<void> => {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  };

  return {
    root,
    maxEntryBytes: MAX_ENTRY_BYTES,
    get failedWrites() {
      return failedWrites;
    },
    evict: async () => {
      await evictCache({
        directory: options.directory,
        root,
        now: now(),
        bound: options.bound ?? DEFAULT_CACHE_BOUND,
        force: true,
      });
    },
    size: async () => {
      let total = 0;
      for (const path of await filesBelow(root)) total += (await stat(path).catch(() => null))?.size ?? 0;
      return total;
    },
    read: async (key) => {
      const file = fileOf(key);
      if (file === null) return null;
      let bytes: Uint8Array;
      try {
        // An entry past the bound is a miss, refused by its size before it is read.
        if ((await stat(file)).size > MAX_ENTRY_BYTES) return null;
        bytes = await readFile(file);
      } catch {
        return null;
      }
      const time = new Date(now());
      await utimes(file, time, time).catch(() => undefined);
      return bytes;
    },
    write: async (key, rows) => {
      const file = fileOf(key);
      if (file === null) return;
      try {
        if (!marked) {
          await writeWhole(join(root, LAYOUT_MARKER), new TextEncoder().encode(LAYOUT_MARKER_CONTENT));
          marked = true;
        }
        await writeWhole(file, rows);
        if (key === SNAPSHOT_KEY) await writeWhole(join(storeDirectory, "root"), new TextEncoder().encode(options.storeRoot));
      } catch {
        failedWrites += 1;
        return;
      }
      if (!evictionChecked) {
        evictionChecked = true;
        await evictCache({ directory: options.directory, root, now: now(), bound: options.bound ?? DEFAULT_CACHE_BOUND });
      }
    },
  };
}

/** What eviction needs: vmd's cache directory, the current implementation's, the time and the bound. */
export interface EvictionOptions {
  readonly directory: string;
  /** The directory of the current implementation's entries, below `directory`. */
  readonly root: string;
  readonly now: number;
  readonly bound: number;
  /** Whether to run whenever the last eviction ran, rather than at most once a day; false by default. */
  readonly force?: boolean;
}

/**
 * Evicts what the cache no longer needs, when the last eviction is more than a day old or `force` says to run now: the directories of other
 * implementations, those that hold the marker vmd writes in one; entries not read for 30 days; then the least recently read entries until those left take at most
 * `bound` bytes; and the snapshot of each store whose root no longer exists. The time of this eviction is written first, so
 * that two processes rarely run it at once; one that does finds files gone, which it ignores. Every failure is ignored, since
 * the cache is optional. Gives whether it ran.
 */
export async function evictCache(options: EvictionOptions): Promise<boolean> {
  const marker = join(options.directory, "last-eviction");
  const last = await readFile(marker, "utf8").then(Number, () => Number.NaN);
  if (options.force !== true && Number.isFinite(last) && options.now - last < EVICTION_INTERVAL_MS) return false;
  try {
    await mkdir(options.directory, { recursive: true });
    await writeFile(marker, String(options.now));
  } catch {
    return false;
  }
  for (const entry of await readdir(options.directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(options.directory, entry.name);
    if (!entry.isDirectory() || !/^v[0-9]+-/.test(entry.name) || path === options.root) continue;
    const content = await readFile(join(path, LAYOUT_MARKER), "utf8").catch(() => null);
    if (content === LAYOUT_MARKER_CONTENT) await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
  const files: { readonly path: string; readonly size: number; readonly read: number }[] = [];
  for (const path of await filesBelow(join(options.root, "entries"))) {
    const info = await stat(path).catch(() => null);
    if (info === null) continue;
    if (options.now - info.mtimeMs > UNREAD_LIMIT_MS) await rm(path, { force: true }).catch(() => undefined);
    else files.push({ path, size: info.size, read: info.mtimeMs });
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.read - b.read)) {
    if (total <= options.bound) break;
    await rm(file.path, { force: true }).catch(() => undefined);
    total -= file.size;
  }
  const stores = join(options.root, "stores");
  for (const entry of await readdir(stores, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const store = join(stores, entry.name);
    const storeRoot = await readFile(join(store, "root"), "utf8").catch(() => null);
    const exists =
      storeRoot !== null &&
      (await stat(storeRoot).then(
        (info) => info.isDirectory(),
        () => false,
      ));
    if (!exists) await rm(store, { recursive: true, force: true }).catch(() => undefined);
  }
  return true;
}

/** Every file below a directory, at any depth; none for a directory that cannot be read. */
async function filesBelow(directory: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [directory];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const entry of await readdir(next, { withFileTypes: true }).catch(() => [])) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) found.push(path);
    }
  }
  return found;
}
