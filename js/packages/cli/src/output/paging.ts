// Limits and cursors: how many items a listing prints by default, how `-n` and `--cursor` are read, and the line that says
// more remain.

import type { OptionSpec } from "../arguments.js";
import { hasUnsafeCharacter } from "./lines.js";
import { formatCount } from "./sizes.js";

/** The number of items each listing prints when `-n` is not given. */
export const DEFAULT_LIMITS = Object.freeze({ ls: 100, grep: 50, query: 20 });

/** The largest `-n` accepted: more items than any page holds, and far below where a count loses precision. */
export const MAX_LIMIT = 1_000_000;

/** The options of a paged listing: `-n N` (also `--limit N`) and `--cursor C`. */
export const PAGE_OPTIONS: Readonly<Record<"limit" | "cursor", OptionSpec>> = Object.freeze({
  limit: Object.freeze({ type: "string", short: "n" }),
  cursor: Object.freeze({ type: "string" }),
});

/** The limit read from `-n`, or why it is not one. */
export type LimitReading = { readonly ok: true; readonly limit: number } | { readonly ok: false; readonly message: string };

/**
 * Reads the value of `-n`: a decimal integer from 1 to {@link MAX_LIMIT}, written with digits only and no leading zero, or the
 * default when the option is absent. Anything else (`0`, `-1`, `1.5`, `1e2`, `0x10`, ` 5`, the empty string) is not a limit,
 * though `Number` would read some of them.
 */
export function readLimit(value: string | undefined, defaultLimit: number): LimitReading {
  if (value === undefined) return { ok: true, limit: defaultLimit };
  if (/^[1-9][0-9]*$/.test(value)) {
    const limit = Number(value);
    if (limit <= MAX_LIMIT) return { ok: true, limit };
  }
  return { ok: false, message: `-n takes a whole number from 1 to ${formatCount(MAX_LIMIT)}, not ${JSON.stringify(value)}` };
}

/** Characters that a POSIX shell takes literally outside quotes. */
const SHELL_LITERAL = /^[A-Za-z0-9_./:=@%+,-]+$/;

/**
 * Writes `text` as one word for a POSIX shell: as it is when that is safe, in single quotes otherwise, and in ANSI-C quotes
 * (`$'…'`, which bash and zsh read) when it holds a character that {@link oneLine} escapes, so that no control, separator or
 * bidirectional character reaches the terminal raw and the word still pastes back as the same text. Inside ANSI-C quotes, a
 * C0 control or DEL is written `\xHH`, any other such character `\uHHHH`, and a backslash and a single quote are escaped.
 */
export function shellWord(text: string): string {
  if (hasUnsafeCharacter(text)) return `$'${ansiCQuoted(text)}'`;
  return SHELL_LITERAL.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/** Writes `text` as the inside of ANSI-C quotes, with every character that {@link oneLine} escapes as a hexadecimal escape. */
function ansiCQuoted(text: string): string {
  let quoted = "";
  for (const c of text) {
    const codePoint = c.codePointAt(0) as number;
    if (c === "\\" || c === "'") quoted += `\\${c}`;
    else if (!hasUnsafeCharacter(c)) quoted += c;
    // `\xHH` is a byte in bash, so only ASCII is written that way; `\uHHHH` is the character in bash and zsh.
    else if (codePoint < 0x80) quoted += `\\x${codePoint.toString(16).padStart(2, "0")}`;
    else quoted += `\\u${codePoint.toString(16).padStart(4, "0")}`;
  }
  return quoted;
}

/** What remains after a page: how many items, when the listing knows, and the cursor that continues it. */
export interface PageRemainder {
  /** The number of items after the page, or null when the listing does not count them. */
  readonly remaining: number | null;
  /** Whether `remaining` is an estimate, as `grep`'s is, rather than an exact count, as `ls`'s is. */
  readonly estimated?: boolean;
  /** The cursor of the next page, as the library gave it. */
  readonly cursor: string;
}

/**
 * Writes the last line of a page after which more remain, with a line break: `… 37 more (--cursor tickets/0171.md)`,
 * `… ~37 more (--cursor …)` for an estimate, or `… more (--cursor …)` when the count is unknown. The cursor is quoted by
 * {@link shellWord}, so the line can be pasted into the next command and nothing in the cursor acts on the terminal. A
 * listing with nothing left prints no such line.
 */
export function formatPageRemainder(remainder: PageRemainder): string {
  const mark = remainder.estimated === true ? "~" : "";
  const count = remainder.remaining === null ? "" : ` ${mark}${formatCount(remainder.remaining)}`;
  return `…${count} more (--cursor ${shellWord(remainder.cursor)})\n`;
}

/**
 * Writes the line that says how many records a listing could not read, with a line break, or the empty string for none. `scope`
 * says what was counted: the records on the printed page only, as long as a count over the whole store needs every record
 * parsed, or the whole store.
 */
export function formatUnreadableRecords(count: number, scope: "page" | "store"): string {
  if (count === 0) return "";
  const records = count === 1 ? "1 record" : `${formatCount(count)} records`;
  const where = scope === "page" ? " on this page" : "";
  return `${records}${where} could not be read\n`;
}
