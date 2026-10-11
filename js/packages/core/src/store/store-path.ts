import { recordFormatOf } from "../record/record.js";

/** What a file of a store is to vmd: a record, which it parses; an asset, which it lists and reads; or a path it ignores. */
export type StorePathKind = "record" | "asset" | "ignored";

/**
 * Gives what a store path is to vmd before any configuration is read. A path with a segment that starts with `.` is ignored:
 * `.vmd/` and every dotfile or dot directory, at any depth. Any other path is a record when it ends in a record's extension,
 * compared exactly, and an asset otherwise. A configuration's `ignore` globs ignore more paths, which `PathClassifier` adds.
 *
 * Precondition: `path` is a store path, which a backend's check accepts.
 */
export function storePathKind(path: string): StorePathKind {
  if (path.split("/").some((segment) => segment.startsWith("."))) return "ignored";
  return recordFormatOf(path) === null ? "asset" : "record";
}

/**
 * The globs that match exactly the paths {@link storePathKind} ignores, for a backend's `exclude`: a path whose last segment
 * starts with `.`, and a path below a segment that does.
 */
export const IGNORED_PATH_GLOBS: readonly string[] = Object.freeze(["**/.*", "**/.*/**"]);
