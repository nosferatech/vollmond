import type { Outcome } from "../issue/outcome.js";
import type { ByteRange } from "../text/source-text.js";

/** A file the backend holds: its store path, its size in bytes, its version and its modification time. */
export interface FileInfo {
  /** The store path: relative to the store root, `/`-separated, with its extension. */
  readonly path: string;
  /** The length of the file's content in bytes. */
  readonly size: number;
  /** The git blob id of the bytes the backend returns, whatever git stores for the file. */
  readonly version: string;
  /** When the file last changed, as an ISO 8601 date and time in UTC, or null when the backend does not know. */
  readonly modified: string | null;
}

/** A file's content, or part of it, with the version and size of the whole file. */
export interface FileContent extends FileInfo {
  /** The bytes read: the whole file, or the bytes of the requested range. */
  readonly content: Uint8Array;
  /** Where `content` is in the file, in bytes, `[start, end)`. A line range is reported as the bytes it covers. */
  readonly range: ByteRange;
}

/**
 * A part of a file to read, half-open as every range in vmd is. Byte offsets count from 0, lines from 1. A line ends at LF,
 * CRLF or a lone CR, and a line range includes the line breaks of its lines. A range past the end of the file is cut at the
 * end.
 */
export interface ContentRange {
  readonly unit: "bytes" | "lines";
  readonly start: number;
  readonly end: number;
}

/** One page of items in UTF-8 byte order of their paths, and the cursor for the next page. */
export interface Page<T> {
  readonly items: readonly T[];
  /**
   * The cursor that continues after this page, null when nothing remains. It is opaque: a caller passes it back to the same
   * operation, with the same query, and does not read or build one.
   */
  readonly cursor: string | null;
}

/** The query of {@link StorageReader.list}. */
export interface ListQuery {
  /** Lists the paths that start with this string; `""` lists every file. It is a string prefix, not a directory. */
  readonly prefix: string;
  /**
   * Lists only the paths this glob matches, as a whole: `*` matches within one segment, and a `**` segment any number of
   * segments. Every other character matches itself.
   */
  readonly glob?: string;
  /** The largest number of items on the page, at least 1. */
  readonly limit: number;
  /** The cursor of the previous page of the same query; a string that is not one fails with `query-invalid`. */
  readonly cursor?: string;
}

/** The query of {@link StorageReader.grep}. */
export interface GrepQuery {
  /** A literal string, or a pattern in the portable regex subset. */
  readonly pattern: string;
  readonly mode: "literal" | "regex";
  /** Searches only the paths this glob matches, as {@link ListQuery.glob} does. */
  readonly glob?: string;
  /** The portable flag `i`, for `regex` mode: case-insensitive matching. */
  readonly ignoreCase?: boolean;
  /** How many lines before and after each matching line to return, at least 0. */
  readonly context: number;
  /** The largest number of matching lines on the page, at least 1. */
  readonly limit: number;
  /** The cursor of the previous page of the same query; a string that is not one fails with `query-invalid`. */
  readonly cursor?: string;
}

/** A line that matched, with its context. */
export interface GrepMatch {
  readonly path: string;
  /** The line number, from 1, with lines ending at LF, CRLF or a lone CR. */
  readonly line: number;
  /** The line's text, without its line break, decoded as UTF-8 (an ill-formed sequence reads as U+FFFD). */
  readonly text: string;
  /** Up to `context` lines before the line, in order. */
  readonly before: readonly string[];
  /** Up to `context` lines after the line, in order. */
  readonly after: readonly string[];
}

/** A change to a path since a head, as `changes` reports it. */
export interface FileChange {
  readonly path: string;
  readonly change: "added" | "modified" | "moved" | "deleted";
  /** The path before a move. */
  readonly from?: string;
  /** The file's version now, null for a deleted file. */
  readonly version: string | null;
}

/** An entry of the store's history, as `log` reports it. */
export interface LogEntry {
  /** The store version: a commit, or a sequence number. */
  readonly version: string;
  readonly author: string;
  /** An ISO 8601 date and time in UTC. */
  readonly time: string;
  readonly message: string;
  readonly paths: readonly string[];
}

/** The history operations of the storage contract, which a backend supports or not. */
export interface StorageHistory {
  changes(query: {
    readonly since: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<Outcome<Page<FileChange>>>;
  log(query: { readonly path?: string; readonly limit: number; readonly cursor?: string }): Promise<Outcome<Page<LogEntry>>>;
}

/**
 * The read side of the storage contract. A backend knows files, not records: the store layer sorts them into records,
 * assets and ignored paths, so a backend needs no vmd configuration.
 *
 * Expected failures are values. A path that names no file fails with `address-not-found`; a read the backend cannot complete,
 * such as one refused by a permission error, fails with `storage-failed`, since the file may exist. A path that is not a store
 * path (empty, absolute, or with an empty, `.` or `..` segment) fails with `address-malformed`. A query whose numbers are out
 * of range is a caller's bug and throws a `RangeError`.
 */
export interface StorageReader {
  /**
   * Lists files with their size, version and modification time, in UTF-8 byte order of their paths. A file the backend cannot
   * read is left out of the page with a `storage-failed` issue, and the page still succeeds.
   */
  list(query: ListQuery): Promise<Outcome<Page<FileInfo>>>;
  /** Gives a file's size, version and modification time, without its content. */
  stat(path: string): Promise<Outcome<FileInfo>>;
  /**
   * Reads a file, or a range of it, with the version of the whole file. `at` reads it at a past version of the store, and
   * fails with `storage-failed` where the backend keeps no history.
   */
  read(path: string, options?: { readonly range?: ContentRange; readonly at?: string }): Promise<Outcome<FileContent>>;
  /**
   * Finds the lines that match a pattern, in UTF-8 byte order of the paths and then by line. A `regex` pattern outside the
   * portable subset fails, with an issue for each construct outside it. A file the backend cannot read is skipped with a
   * `storage-failed` issue.
   */
  grep(query: GrepQuery): Promise<Outcome<Page<GrepMatch>>>;
  /** The store's current version (a commit, or a sequence number), or null for a plain filesystem. */
  head(): Promise<Outcome<string | null>>;
  /** `changes` and `log`, or null for a backend without history. */
  readonly history: StorageHistory | null;
}
