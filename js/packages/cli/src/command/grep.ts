// `vmd grep PATTERN [GLOB] [-F] [-i] [-C N] [-n N] [--cursor C]`: the lines of the store's files that match a pattern.

import type { CountedPage, GrepMatch } from "@vollmond/core";
import { oneLine, oneLineWithTabs } from "../output/lines.js";
import { DEFAULT_LIMITS, formatPageRemainder, MAX_LIMIT, PAGE_OPTIONS, readLimit } from "../output/paging.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem, readWholeNumber } from "./options.js";

// Deviation from the specification, recorded in issue #18: `-i` is not among grep's options in the specification's list of
// commands, but the portable regex has the flag `i`, and the hint for an inline `(?i)` tells the user to give it.
/**
 * Searches the store's records and assets, those whose paths the glob matches, for lines that match a pattern in the portable
 * regex subset, or a literal string with `-F`; `-i` matches regardless of case. `.vmd/` and dotfiles are not searched. Each
 * match is a line `path:line:text`, preceded and followed by up to `-C` lines of context, written `path-line-text`, in GNU
 * grep's format, which agents and people already read; `--json` gives the exact form, since a path that holds `:12:` makes
 * the text ambiguous.
 * With `-C`, even `-C 0`, groups that do not touch are separated by `--`, as GNU grep does; a line is printed once even when
 * it is context for two matches. At most `-n` matches (50 by default) are printed, then, when more remain, an estimate of their
 * number and the cursor.
 */
export const GREP_COMMAND: Command = {
  name: "grep",
  usage: "PATTERN [GLOB] [-F] [-i] [-C N] [-n N] [--cursor C]",
  summary: "search the text of the store's files",
  options: {
    ...PAGE_OPTIONS,
    "fixed-strings": { type: "boolean", short: "F" },
    "ignore-case": { type: "boolean", short: "i" },
    context: { type: "string", short: "C" },
  },
  help:
    "  PATTERN  a portable regex: the subset RE2, Python re and ECMAScript all accept, as RE2 reads it (literals and\n" +
    "           escapes, classes, ., anchors, groups, alternation, quantifiers; no backreferences or lookaround), matched\n" +
    "           against each line on its own; \\d, \\w, \\s and \\b are ASCII\n" +
    "  GLOB     the store paths to search, such as docs/**/*.md\n" +
    "  -F       take PATTERN as a literal string\n" +
    "  -i       match regardless of case\n" +
    "  -C N     print N lines of context around each match, and -- between groups that do not touch\n" +
    "  -n N     print at most N matches, 50 by default; --cursor C continues after them\n" +
    "Lines are path:line:text, and context lines path-line-text, as GNU grep prints them; --json gives the exact form.\n",
  readsStore: true,
  prepare: ({ positionals, options }) => {
    const problem = argumentCountProblem(positionals, 1, 2, "the pattern");
    if (problem !== null) return usagePlan(problem);
    const limit = readLimit(options.limit as string | undefined, DEFAULT_LIMITS.grep);
    if (!limit.ok) return usagePlan(limit.message);
    const context = readWholeNumber(options.context, "-C", { minimum: 0, maximum: MAX_LIMIT }, 0);
    if (!context.ok) return usagePlan(context.message);
    const [pattern, glob] = positionals as [string, string | undefined];
    const cursor = options.cursor as string | undefined;
    return {
      kind: "run",
      run: async (opened) => {
        const { store } = opened as OpenedStore;
        const page = await store.grep({
          pattern,
          mode: options["fixed-strings"] === true ? "literal" : "regex",
          ignoreCase: options["ignore-case"] === true,
          context: context.value,
          limit: limit.limit,
          ...(glob === undefined ? {} : { glob }),
          ...(cursor === undefined ? {} : { cursor }),
        });
        // GNU grep separates groups whenever context is given, -C 0 included (src/grep.c, prtext: `0 <= out_before ||
        // 0 <= out_after`, read on 2026-10-11 at cgit.git.savannah.gnu.org/cgit/grep.git/plain/src/grep.c).
        return outcomeOutput(page, (value) => formatMatches(value, options.context !== undefined));
      },
    };
  },
};

/** Writes a page of matches with their context, `--` between groups that do not touch when `grouped`, then what remains. */
function formatMatches(page: CountedPage<GrepMatch>, grouped: boolean): string {
  // Each line once, in order, since matches come by path and then by line: a line that is context for one match and the
  // match of another is printed as a match.
  const printed = new Map<string, { path: string; line: number; text: string; match: boolean }>();
  const add = (path: string, line: number, text: string, match: boolean) => {
    const key = `${line}:${path}`;
    const known = printed.get(key);
    if (known === undefined) printed.set(key, { path, line, text, match });
    else known.match ||= match;
  };
  for (const match of page.items) {
    const first = match.line - match.before.length;
    match.before.forEach((text, index) => {
      add(match.path, first + index, text, false);
    });
    add(match.path, match.line, match.text, true);
    match.after.forEach((text, index) => {
      add(match.path, match.line + 1 + index, text, false);
    });
  }
  const lines: string[] = [];
  let previous: { readonly path: string; readonly line: number } | null = null;
  for (const entry of printed.values()) {
    if (grouped && previous !== null && (previous.path !== entry.path || previous.line + 1 !== entry.line)) lines.push("--\n");
    const separator = entry.match ? ":" : "-";
    // A tab is kept, so that a line copied from the output matches the file.
    lines.push(`${oneLine(entry.path)}${separator}${entry.line}${separator}${oneLineWithTabs(entry.text)}\n`);
    previous = entry;
  }
  let text = lines.join("");
  if (page.cursor !== null) {
    text += formatPageRemainder({ remaining: page.remaining.count, estimated: !page.remaining.exact, cursor: page.cursor });
  }
  return text;
}
