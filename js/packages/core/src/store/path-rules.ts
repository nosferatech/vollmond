import { lowerCaseOf } from "../anchor/unicode/unicode.js";
import type { Collection } from "../config/configuration.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { compareUtf8 } from "../storage/path.js";
import { portableRegexToJavaScript } from "../storage/portable-regex.js";

/** A path a store lists, other than an ignored one, with what it is. */
export interface ListedPath {
  readonly path: string;
  readonly kind: "record" | "asset";
}

/** What a path segment may be. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The names Windows reserves, before the first `.` of a segment, compared without regard to ASCII case. */
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** The largest segment, and the largest path, in UTF-8 bytes. */
const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1024;

const encoder = new TextEncoder();

/**
 * Checks the path rules of the paths a store lists: for each path that breaks a rule other than case, one `path-invalid` whose
 * message names every rule it breaks; and one `path-case-conflict` for each path after the first in UTF-8 byte order whose
 * path, or the path of a directory above it, equals an earlier one's under the default lower-case mapping of each code point
 * but is spelled otherwise, so `docs/b.md` conflicts with `Docs/a.md`. A record's issue is an error at its root (`at`
 * is `""`), and an asset's a warning with no node, since an asset is never in a collection.
 *
 * The rules: every segment matches `[A-Za-z0-9][A-Za-z0-9._-]*` and is at most 255 bytes, the path is at most 1,024 bytes and
 * in NFC, no segment is a name Windows reserves (`CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`, with any
 * extension and in any case), and no segment ends in `.`.
 *
 * The issues come in the byte order of their paths, a path's `path-invalid` before its `path-case-conflict`.
 */
export function pathRuleIssues(paths: readonly ListedPath[], options: PathRuleOptions = {}): Issue[] {
  const sorted = [...paths].sort((a, b) => compareUtf8(a.path, b.path));
  const firstByLowerCase = new Map<string, string>();
  const involving = options.involving;
  // The lower case of every prefix of the paths that issues must involve, which a case conflict's prefix may equal.
  const involvedPrefixes = new Set<string>();
  for (const path of involving ?? []) for (const prefix of prefixesOf(path)) involvedPrefixes.add(lowerCase(prefix));
  const issues: Issue[] = [];
  for (const listed of sorted) {
    const own = involving === undefined || involving.has(listed.path);
    const broken = brokenRules(listed.path);
    if (broken.length > 0 && own) {
      issues.push(pathIssue("path-invalid", listed, `${listed.path} breaks the path rules: ${broken.join("; ")}`));
    }
    const conflict = caseConflict(listed.path, firstByLowerCase);
    if (conflict !== null && (own || involvedPrefixes.has(lowerCase(conflict.prefix)))) {
      issues.push(pathIssue("path-case-conflict", listed, conflict.message));
    }
  }
  return issues;
}

/** What {@link pathRuleIssues} gives. */
export interface PathRuleOptions {
  /**
   * Only the issues that involve one of these paths, which need not be listed: a path's own issues, and a case conflict whose
   * clashing prefix one of them has, under the lower-case mapping, so that a path added beside an unchanged one, or removed
   * from beside it, brings the unchanged one's conflict along. Every issue when absent.
   */
  readonly involving?: ReadonlySet<string>;
}

/** The prefixes of a path that end at a segment, the path itself included. */
function prefixesOf(path: string): string[] {
  const segments = path.split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

/**
 * Compares each prefix of a path that ends at a segment, the path itself included, with the prefixes of the paths before it,
 * which `firstByLowerCase` holds by their lower case, and adds the path's own. Gives the shortest prefix that an earlier path
 * spells otherwise in letter case, with the message that says so, so that two directories that differ only by case, which a
 * filesystem that ignores case would merge, conflict whatever the files below them are called; or null when none does.
 */
function caseConflict(
  path: string,
  firstByLowerCase: Map<string, string>,
): { readonly prefix: string; readonly message: string } | null {
  const segments = path.split("/");
  let conflict: { readonly prefix: string; readonly message: string } | null = null;
  for (let length = 1; length <= segments.length; length++) {
    const prefix = segments.slice(0, length).join("/");
    const lower = lowerCase(prefix);
    const first = firstByLowerCase.get(lower);
    if (first === undefined) {
      firstByLowerCase.set(lower, prefix);
    } else if (first !== prefix && conflict === null) {
      const message =
        prefix === path ? `${path} differs from ${first} only by case` : `${path}: ${prefix} differs from ${first} only by case`;
      conflict = { prefix, message };
    }
  }
  return conflict;
}

/**
 * Checks a record's file name against its collection's `filename` pattern, which is searched in the last segment of the path
 * as the portable subset reads it, so a pattern that must match the whole name says so with `^` and `$`. Gives a
 * `filename-mismatch` at the record's root, or null when the name matches or the collection has no pattern.
 *
 * Precondition: the collection's pattern is in the portable subset, which reading the configuration checks.
 */
export function filenameMismatch(path: string, collection: Collection): Issue | null {
  if (collection.filename === undefined) return null;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (new RegExp(portableRegexToJavaScript(collection.filename, false), "su").test(name)) return null;
  return makeIssue({
    code: "filename-mismatch",
    path,
    at: "",
    message: `the file name ${name} does not match the pattern ${collection.filename} of the collection ${collection.name}`,
  });
}

/** Says which rules a path breaks, other than case, each once; empty when it breaks none. */
function brokenRules(path: string): string[] {
  const broken: string[] = [];
  const segments = path.split("/");
  const outside = segments.filter((segment) => !SEGMENT.test(segment));
  if (outside.length > 0) {
    broken.push(`${quoted(outside)} ${outside.length === 1 ? "does" : "do"} not match [A-Za-z0-9][A-Za-z0-9._-]*`);
  }
  const long = segments.filter((segment) => encoder.encode(segment).length > MAX_SEGMENT_BYTES);
  if (long.length > 0) broken.push(`a segment is longer than ${MAX_SEGMENT_BYTES} bytes`);
  if (encoder.encode(path).length > MAX_PATH_BYTES) broken.push(`the path is longer than ${MAX_PATH_BYTES} bytes`);
  if (path.normalize("NFC") !== path) broken.push("the path is not in NFC");
  const reserved = segments.filter((segment) => WINDOWS_RESERVED.test(segment.split(".")[0] as string));
  if (reserved.length > 0)
    broken.push(`${quoted(reserved)} ${reserved.length === 1 ? "is a name" : "are names"} Windows reserves`);
  const dotted = segments.filter((segment) => segment.endsWith("."));
  if (dotted.length > 0) broken.push(`${quoted(dotted)} ${dotted.length === 1 ? "ends" : "end"} in .`);
  return broken;
}

/** Writes segments for a message, each in quotes. */
function quoted(segments: readonly string[]): string {
  return segments.map((segment) => JSON.stringify(segment)).join(", ");
}

/** Maps each code point of a text to its default lower case, with no context. */
function lowerCase(text: string): string {
  let lower = "";
  for (const character of text) lower += lowerCaseOf(character.codePointAt(0) as number);
  return lower;
}

/** A path rule's issue: an error at a record's root, or a warning with no node for an asset. */
function pathIssue(code: "path-invalid" | "path-case-conflict", listed: ListedPath, message: string): Issue {
  const record = listed.kind === "record";
  return makeIssue({
    code,
    path: listed.path,
    at: record ? "" : null,
    severity: record ? "error" : "warning",
    message,
  });
}
