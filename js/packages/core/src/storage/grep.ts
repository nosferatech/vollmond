import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { checkPortableRegex, portableRegexToJavaScript } from "./portable-regex.js";
import type { GrepMatch, GrepQuery } from "./storage.js";

/** A test of one line, without its line break. */
export type LineTest = (line: string) => boolean;

/**
 * Compiles the pattern of a grep query into a test of one line. A `literal` pattern matches where the line contains it. A
 * `regex` pattern is checked against the portable subset, and fails with its issues when it is outside it. It then means what
 * RE2 reads it as: it is translated where JavaScript reads it otherwise ({@link portableRegexToJavaScript}), and runs on
 * JavaScript's engine with the flags `u`, so that `.` and classes read code points, and `s`, so that `.` matches U+2028 and
 * U+2029, as it does in RE2. A line is matched alone, so `^` and `$` are its start and end; the flag `m` is never set, since
 * JavaScript's would also match them around U+2028 and U+2029 within the line.
 *
 * JavaScript's engine backtracks, so matching is not linear in time: `(a+)+$` takes time exponential in the length of a run
 * of `a` that ends in another character. No time limit is set, since a local backend runs its user's own patterns; a backend
 * that runs other people's patterns needs an automaton engine such as RE2.
 */
export function compileLineTest(query: Pick<GrepQuery, "pattern" | "mode" | "ignoreCase">): Outcome<LineTest> {
  if (query.mode === "literal") {
    const pattern = query.pattern;
    return succeed((line) => line.includes(pattern));
  }
  const issues = checkPortableRegex(query.pattern);
  if (issues.length > 0) return fail(issues);
  const ignoreCase = query.ignoreCase === true;
  const expression = new RegExp(portableRegexToJavaScript(query.pattern, ignoreCase), ignoreCase ? "usi" : "us");
  return succeed((line) => expression.test(line));
}

/**
 * Splits a file's text into lines, without their line breaks: a line ends at LF, CRLF or a lone CR, and a break at the end of
 * the text ends the last line rather than starting an empty one. The empty text has no lines.
 */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Decodes a file for grep: as UTF-8, with a byte order mark at its start dropped and each ill-formed sequence read as U+FFFD. */
export function decodeForGrep(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Finds the matching lines of one file's text, from line `afterLine + 1` on (0 for the whole file), and returns at most
 * `limit` of them with `context` lines around each.
 */
export function grepText(
  path: string,
  text: string,
  test: LineTest,
  options: { readonly context: number; readonly limit: number; readonly afterLine: number },
): GrepMatch[] {
  const lines = splitLines(text);
  const matches: GrepMatch[] = [];
  for (let index = options.afterLine; index < lines.length && matches.length < options.limit; index++) {
    const line = lines[index] as string;
    if (!test(line)) continue;
    matches.push({
      path,
      line: index + 1,
      text: line,
      before: lines.slice(Math.max(0, index - options.context), index),
      after: lines.slice(index + 1, index + 1 + options.context),
    });
  }
  return matches;
}

/** Encodes the cursor of a grep page, which ends at a line of a file. */
export function grepCursor(path: string, line: number): string {
  return `${line}:${path}`;
}

/** Decodes a grep cursor, or returns null when `cursor` is not one. */
export function readGrepCursor(cursor: string): { readonly path: string; readonly line: number } | null {
  const match = /^([1-9]\d*):(.+)$/s.exec(cursor);
  if (match === null) return null;
  return { path: match[2] as string, line: Number(match[1]) };
}
