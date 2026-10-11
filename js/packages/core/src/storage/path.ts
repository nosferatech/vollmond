import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";

/**
 * Compares two strings in the order of their UTF-8 bytes, which is the order of their code points. JavaScript's `<` compares
 * UTF-16 code units, which puts a character above U+FFFF (a surrogate pair, from U+D800) before U+E000 to U+FFFF, while its
 * UTF-8 bytes (from F0) come after theirs (EE and EF). Strings with lone surrogates compare by code unit there.
 */
export function compareUtf8(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // Below U+D800 and from U+E000 up, a code unit is its code point; a surrogate stands for a code point above U+FFFF.
    const xRank = x >= 0xd800 && x <= 0xdfff ? x + 0x2000 : x >= 0xe000 ? x - 0x800 : x;
    const yRank = y >= 0xd800 && y <= 0xdfff ? y + 0x2000 : y >= 0xe000 ? y - 0x800 : y;
    return xRank - yRank;
  }
  return a.length - b.length;
}

/**
 * Checks that `path` is a store path a backend can look up: not empty, relative, `/`-separated, without an empty, `.` or `..`
 * segment, without a backslash or a NUL, and well-formed Unicode. Returns an `address-malformed` issue, or null for a path
 * that passes. This keeps every lookup inside the store root; the naming rules for records are the store layer's.
 */
export function checkStoragePath(path: string): Issue | null {
  const problem = storagePathProblem(path);
  if (problem === null) return null;
  return makeIssue({
    code: "address-malformed",
    path: null,
    at: null,
    message: `${JSON.stringify(path)} is not a store path: ${problem}`,
  });
}

/** Says what is wrong with a store path, or null when nothing is. */
function storagePathProblem(path: string): string | null {
  if (path === "") return "it is empty";
  if (!path.isWellFormed()) return "it holds a lone surrogate";
  if (path.includes("\0")) return "it holds a NUL";
  if (path.includes("\\")) return "it holds a backslash";
  if (path.startsWith("/")) return "it starts with /";
  for (const segment of path.split("/")) {
    if (segment === "") return "it has an empty segment";
    if (segment === "." || segment === "..") return `it has a ${segment} segment`;
  }
  return null;
}

/**
 * Checks the prefix of a listing, and returns the directory to look in: the prefix up to its last `/`, or `""` for the store
 * root. Returns an `address-malformed` issue when that directory is not a store path, or when the prefix holds a backslash,
 * a NUL or a lone surrogate.
 */
export function prefixDirectory(prefix: string): { readonly directory: string } | { readonly issue: Issue } {
  const slash = prefix.lastIndexOf("/");
  const directory = slash < 0 ? "" : prefix.slice(0, slash);
  const malformed =
    !prefix.isWellFormed() ||
    prefix.includes("\0") ||
    prefix.includes("\\") ||
    (slash >= 0 && storagePathProblem(directory) !== null);
  if (!malformed) return { directory };
  return {
    issue: makeIssue({
      code: "address-malformed",
      path: null,
      at: null,
      message: `${JSON.stringify(prefix)} is not a prefix of store paths`,
    }),
  };
}

/** A test of whether a glob matches a store path. */
export type GlobTest = (path: string) => boolean;

/** One step of a compiled glob. */
type GlobToken =
  | { readonly kind: "character"; readonly character: string }
  /** `*`: any run of characters but `/`, none included. */
  | { readonly kind: "star" }
  /** `**` followed by `/`: zero or more whole segments, each with its `/`. */
  | { readonly kind: "segments" }
  /** A final `**`: the rest of the path, at least one character. */
  | { readonly kind: "rest" };

/**
 * Compiles a glob over whole store paths, in the one glob syntax that listings, grep, a collection's `match` and `exclude`, the
 * configuration's `ignore` and VQL's `@path` share. `**` is special as a whole segment only: `**` followed by `/` matches zero
 * or more whole segments with their `/`, and a final `/**` matches one or more segments, so `docs/**` matches every path
 * below `docs/` but not `docs`; consecutive `**` segments are one. `*` matches any run of characters within a segment, none
 * included, a leading `.` too, so dotfiles are not special. Every other character matches itself.
 *
 * Fails with `query-invalid` for a glob that is empty, starts or ends with `/`, or has an empty segment, which no store path
 * could match. The test it returns takes time proportional to the length of the path times the length of the glob: it runs
 * the glob as a set of states and never backtracks.
 */
export function compileGlob(glob: string): Outcome<GlobTest> {
  const problem =
    glob === ""
      ? "it is empty"
      : glob.startsWith("/")
        ? "it starts with /"
        : glob.endsWith("/")
          ? "it ends with /"
          : glob.includes("//")
            ? "it has an empty segment"
            : null;
  if (problem !== null) {
    return fail([
      makeIssue({
        code: "query-invalid",
        path: null,
        at: null,
        message: `glob ${JSON.stringify(glob)} is malformed: ${problem}`,
      }),
    ]);
  }
  const segments = glob.split("/").filter((segment, index, all) => segment !== "**" || all[index + 1] !== "**");
  const tokens: GlobToken[] = [];
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      tokens.push({ kind: last ? "rest" : "segments" });
      return;
    }
    for (const character of segment) tokens.push(character === "*" ? { kind: "star" } : { kind: "character", character });
    if (!last) tokens.push({ kind: "character", character: "/" });
  });
  return succeed((path) => runGlob(tokens, path));
}

/**
 * Runs glob tokens over a path as a nondeterministic automaton. A state is a token index and a flag: within a segment, for
 * `segments`, and past the first character, for `rest`.
 */
function runGlob(tokens: readonly GlobToken[], path: string): boolean {
  let states = closeGlobStates(tokens, [0]);
  for (const character of path) {
    const next = new Set<number>();
    for (const state of states) {
      const index = state >> 1;
      const token = tokens[index];
      if (token === undefined) continue;
      if (token.kind === "character") {
        if (token.character === character) next.add((index + 1) << 1);
      } else if (token.kind === "star") {
        if (character !== "/") next.add(index << 1);
      } else if (token.kind === "segments") {
        next.add((index << 1) | (character === "/" ? 0 : 1));
      } else {
        next.add((index << 1) | 1);
      }
    }
    if (next.size === 0) return false;
    states = closeGlobStates(tokens, [...next]);
  }
  return states.has(tokens.length << 1);
}

/** Adds to `states` those reached without reading a character: past a `*`, past `segments` at a boundary, past a started `rest`. */
function closeGlobStates(tokens: readonly GlobToken[], states: readonly number[]): Set<number> {
  const closed = new Set<number>();
  const pending = [...states];
  while (pending.length > 0) {
    const state = pending.pop() as number;
    if (closed.has(state)) continue;
    closed.add(state);
    const index = state >> 1;
    const token = tokens[index];
    const skips =
      token !== undefined &&
      (token.kind === "star" || (token.kind === "segments" && (state & 1) === 0) || (token.kind === "rest" && (state & 1) === 1));
    if (skips) pending.push((index + 1) << 1);
  }
  return closed;
}
