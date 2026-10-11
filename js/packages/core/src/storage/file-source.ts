import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import type { ByteRange } from "../text/source-text.js";
import { gitBlobId } from "../value/digest.js";
import { compileLineTest, decodeForGrep, grepCursor, grepText, readGrepCursor } from "./grep.js";
import { checkStoragePath, compareUtf8, compileGlob, prefixDirectory } from "./path.js";
import type {
  ContentRange,
  CountedPage,
  FileContent,
  FileInfo,
  GrepMatch,
  GrepQuery,
  ListQuery,
  StorageHistory,
  StorageReader,
} from "./storage.js";

/** A file's bytes as a backend holds them, and when it last changed. */
export interface StoredFile {
  readonly bytes: Uint8Array;
  /** An ISO 8601 date and time in UTC, or null when the backend does not know. */
  readonly modified: string | null;
}

/**
 * The few operations a backend that holds files provides, from which {@link createStorageReader} builds the read side of the
 * storage contract. Paths it receives have passed the store path check.
 */
export interface FileSource {
  /**
   * Lists every file under a directory, `""` for the store root, as store paths in any order. A directory that does not exist
   * lists nothing. A directory below it that cannot be read is left out with a `storage-failed` issue; when the directory
   * itself cannot be read, the listing fails with one.
   */
  listFiles(directory: string): Promise<Outcome<readonly string[]>>;
  /** Reads a file, and fails with `address-not-found` when there is none, or `storage-failed` when it cannot be read. */
  readFile(path: string): Promise<Outcome<StoredFile>>;
  /** The store's current version, or null for a plain filesystem. */
  head(): Promise<Outcome<string | null>>;
  readonly history: StorageHistory | null;
}

/**
 * Builds the read side of the storage contract over a file source. Listings and grep sort paths in UTF-8 byte order, file
 * versions are the git blob ids of the bytes the source returns, and grep runs with {@link compileLineTest}.
 *
 * `list` counts the paths that remain exactly. `grep` counts the matches that remain in the files it has read, and estimates
 * those in the files it has not, at the rate of matches per file read; the count is exact once every file has been read.
 *
 * Cost: `list` lists the whole directory of its prefix and reads each file on the page, to hash it; `stat` reads the file;
 * `grep` reads every file its glob matches, up to the first file with a match after a full page, so that its cursor is null
 * exactly when nothing remains.
 */
export function createStorageReader(source: FileSource): StorageReader {
  return new FileSourceReader(source);
}

class FileSourceReader implements StorageReader {
  readonly #source: FileSource;
  readonly history: StorageHistory | null;

  constructor(source: FileSource) {
    this.#source = source;
    this.history = source.history;
  }

  async list(query: ListQuery): Promise<Outcome<CountedPage<FileInfo>>> {
    requireCount("limit", query.limit, 1);
    const prefix = prefixDirectory(query.prefix);
    if ("issue" in prefix) return fail([prefix.issue]);
    // A list cursor is the last path of the previous page.
    if (query.cursor !== undefined && checkStoragePath(query.cursor) !== null) {
      return fail([
        makeIssue({
          code: "query-invalid",
          path: null,
          at: null,
          message: `${JSON.stringify(query.cursor)} is not a list cursor`,
        }),
      ]);
    }
    const glob = query.glob === undefined ? null : compileGlob(query.glob);
    if (glob !== null && !glob.ok) return glob;
    const matches = glob === null ? null : glob.value;
    const listed = await this.#source.listFiles(prefix.directory);
    if (!listed.ok) return listed;
    const issues: Issue[] = [...listed.issues];
    const cursor = query.cursor;
    const candidates = listed.value
      .filter((path) => path.startsWith(query.prefix))
      .filter((path) => matches === null || matches(path))
      .filter((path) => cursor === undefined || compareUtf8(path, cursor) > 0)
      .sort(compareUtf8);
    const items: FileInfo[] = [];
    for (const [index, path] of candidates.entries()) {
      if (items.length === query.limit) {
        const remaining = { count: candidates.length - index, exact: true };
        return succeed({ items, cursor: candidates[index - 1] as string, remaining }, issues);
      }
      const file = await this.#source.readFile(path);
      if (file.ok) {
        items.push(await fileInfo(path, file.value));
      } else {
        // A file listed a moment ago may be gone or unreadable now; a page still lists the others.
        issues.push(...file.issues);
      }
    }
    return succeed({ items, cursor: null, remaining: { count: 0, exact: true } }, issues);
  }

  async stat(path: string): Promise<Outcome<FileInfo>> {
    const file = await this.#readChecked(path);
    if (!file.ok) return file;
    return succeed(await fileInfo(path, file.value), file.issues);
  }

  async read(path: string, options: { readonly range?: ContentRange; readonly at?: string } = {}): Promise<Outcome<FileContent>> {
    if (options.range !== undefined) requireRange(options.range);
    const pathIssue = checkStoragePath(path);
    if (pathIssue !== null) return fail([pathIssue]);
    if (options.at !== undefined) {
      return fail([
        makeIssue({
          code: "storage-failed",
          path,
          at: null,
          message: `cannot read ${path} at ${options.at}: this backend keeps no history`,
        }),
      ]);
    }
    const file = await this.#source.readFile(path);
    if (!file.ok) return file;
    const bytes = file.value.bytes;
    const range = options.range === undefined ? { start: 0, end: bytes.length } : byteRangeOf(bytes, options.range);
    // A copy, so that a caller who changes the content cannot change what the backend holds.
    const content = bytes.slice(range.start, range.end);
    return succeed({ ...(await fileInfo(path, file.value)), content, range }, file.issues);
  }

  async grep(query: GrepQuery): Promise<Outcome<CountedPage<GrepMatch>>> {
    requireCount("context", query.context, 0);
    requireCount("limit", query.limit, 1);
    const test = compileLineTest(query);
    if (!test.ok) return test;
    let after: { readonly path: string; readonly line: number } | null = null;
    if (query.cursor !== undefined) {
      after = readGrepCursor(query.cursor);
      if (after === null) {
        return fail([
          makeIssue({
            code: "query-invalid",
            path: null,
            at: null,
            message: `${JSON.stringify(query.cursor)} is not a grep cursor`,
          }),
        ]);
      }
    }
    const glob = query.glob === undefined ? null : compileGlob(query.glob);
    if (glob !== null && !glob.ok) return glob;
    const matches = glob === null ? null : glob.value;
    const listed = await this.#source.listFiles("");
    if (!listed.ok) return listed;
    const issues: Issue[] = [...listed.issues];
    const paths = listed.value
      .filter((path) => matches === null || matches(path))
      .filter((path) => after === null || compareUtf8(path, after.path) >= 0)
      .sort(compareUtf8);
    const items: GrepMatch[] = [];
    let filesRead = 0;
    let matchesFound = 0;
    for (const [index, path] of paths.entries()) {
      const file = await this.#source.readFile(path);
      if (!file.ok) {
        issues.push(...file.issues);
        continue;
      }
      const afterLine = after !== null && after.path === path ? after.line : 0;
      // The matches that fit on the page, and the number of all of them, so that those beyond the page are counted exactly.
      const room = query.limit - items.length;
      const found = grepText(path, decodeForGrep(file.value.bytes), test.value, {
        context: query.context,
        limit: room,
        afterLine,
      });
      filesRead += 1;
      matchesFound += found.count;
      items.push(...found.matches);
      const beyond = found.count - room;
      if (beyond > 0) {
        // The files not read yet are estimated at the rate of matches per file read so far.
        const unread = paths.length - index - 1;
        const remaining = { count: beyond + Math.round((matchesFound / filesRead) * unread), exact: unread === 0 };
        const last = items[items.length - 1] as GrepMatch;
        return succeed({ items, cursor: grepCursor(last.path, last.line), remaining }, issues);
      }
    }
    return succeed({ items, cursor: null, remaining: { count: 0, exact: true } }, issues);
  }

  head(): Promise<Outcome<string | null>> {
    return this.#source.head();
  }

  async #readChecked(path: string): Promise<Outcome<StoredFile>> {
    const pathIssue = checkStoragePath(path);
    if (pathIssue !== null) return fail([pathIssue]);
    return this.#source.readFile(path);
  }
}

async function fileInfo(path: string, file: StoredFile): Promise<FileInfo> {
  return { path, size: file.bytes.length, version: await gitBlobId(file.bytes), modified: file.modified };
}

/** Throws a `RangeError` unless `value` is an integer of at least `minimum`. */
function requireCount(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer of at least ${minimum}`);
}

/** Throws a `RangeError` unless `range` has integer bounds, a start of at least 0 for bytes or 1 for lines, and an end not below it. */
function requireRange(range: ContentRange): void {
  const minimum = range.unit === "lines" ? 1 : 0;
  requireCount("range start", range.start, minimum);
  requireCount("range end", range.end, range.start);
}

/** Gives the bytes a range covers, cut at the end of the file. */
function byteRangeOf(bytes: Uint8Array, range: ContentRange): ByteRange {
  if (range.unit === "bytes") return { start: Math.min(range.start, bytes.length), end: Math.min(range.end, bytes.length) };
  const starts = lineStarts(bytes);
  const startOf = (line: number) => (line <= starts.length ? (starts[line - 1] as number) : bytes.length);
  return { start: startOf(range.start), end: startOf(range.end) };
}

/** Gives the byte offset at which each line starts, with lines ending at LF, CRLF or a lone CR. A final line break starts no line. */
function lineStarts(bytes: Uint8Array): number[] {
  const starts = [0];
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0x0d && bytes[i + 1] === 0x0a) i += 1;
    if (byte === 0x0a || byte === 0x0d) starts.push(i + 1);
  }
  if (starts.length > 1 && starts[starts.length - 1] === bytes.length) starts.pop();
  return starts;
}
