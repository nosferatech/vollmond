import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { createStorageReader, type FileSource, type StoredFile } from "./file-source.js";
import { checkStoragePath } from "./path.js";
import type { StorageReader } from "./storage.js";

/** A file of an in-memory store: its content, as bytes or as text encoded in UTF-8, and how the backend treats it. */
export interface MemoryFile {
  readonly content: Uint8Array | string;
  /** When the file last changed, as an ISO 8601 date and time in UTC; null when omitted. */
  readonly modified?: string | null;
  /** Makes every read of the file fail with `storage-failed`, as a file refused by a permission error does. */
  readonly unreadable?: boolean;
}

/** The store an in-memory backend holds. */
export interface MemoryStorageInit {
  /** The files by store path. A string stands for a file with that text, encoded in UTF-8. */
  readonly files: Readonly<Record<string, Uint8Array | string | MemoryFile>>;
  /** What `head()` gives; null, a plain filesystem, when omitted. */
  readonly head?: string | null;
}

/**
 * Creates a read-only backend over files held in memory, for tests and for programs that hold a store's files themselves. It
 * copies the files when created, so later changes to `init` do not reach it, and every read returns a copy. It has no history.
 *
 * Throws a `RangeError` when a key of `init.files` is not a store path.
 */
export function createMemoryStorage(init: MemoryStorageInit): StorageReader {
  return createStorageReader(new MemoryFileSource(init));
}

interface HeldFile {
  readonly bytes: Uint8Array;
  readonly modified: string | null;
  readonly unreadable: boolean;
}

class MemoryFileSource implements FileSource {
  readonly history = null;
  readonly #files = new Map<string, HeldFile>();
  readonly #head: string | null;

  constructor(init: MemoryStorageInit) {
    for (const [path, file] of Object.entries(init.files)) {
      const issue = checkStoragePath(path);
      if (issue !== null) throw new RangeError(issue.message);
      const entry: MemoryFile = typeof file === "string" || file instanceof Uint8Array ? { content: file } : file;
      const bytes = typeof entry.content === "string" ? new TextEncoder().encode(entry.content) : entry.content.slice();
      this.#files.set(path, { bytes, modified: entry.modified ?? null, unreadable: entry.unreadable === true });
    }
    this.#head = init.head ?? null;
  }

  async listFiles(directory: string): Promise<Outcome<readonly string[]>> {
    const within = directory === "" ? "" : `${directory}/`;
    return succeed([...this.#files.keys()].filter((path) => path.startsWith(within)));
  }

  async readFile(path: string): Promise<Outcome<StoredFile>> {
    const file = this.#files.get(path);
    if (file === undefined) {
      return fail([makeIssue({ code: "address-not-found", path, at: null, message: `${path} does not exist` })]);
    }
    if (file.unreadable) {
      return fail([makeIssue({ code: "storage-failed", path, at: null, message: `cannot read ${path}: permission denied` })]);
    }
    return succeed({ bytes: file.bytes, modified: file.modified });
  }

  async head(): Promise<Outcome<string | null>> {
    return succeed(this.#head);
  }
}
