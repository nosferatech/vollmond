import { type Issue, makeIssue } from "../issue/issue.js";

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

/**
 * Compiles a glob over whole store paths: a `**` segment matches any number of segments, none included, `*` matches any run of
 * characters within a segment, and every other character matches itself. Returns a test of a path.
 */
export function compileGlob(glob: string): (path: string) => boolean {
  const segments = glob.split("/");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      source += last ? ".*" : "(?:[^/]*/)*";
      return;
    }
    source += segment
      .split("*")
      .map((part) => part.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&"))
      .join("[^/]*");
    if (!last) source += "/";
  });
  const expression = new RegExp(`^${source}$`, "su");
  return (path) => expression.test(path);
}
