// The issue format: where the issue is, its severity, code and message, then the node it is in, the candidates of an ambiguity
// and the hint, each on its own indented line.

import type { Issue, IssueCode } from "@vollmond/core";
import { oneLine } from "./lines.js";
import { formatCount } from "./sizes.js";

/** One candidate of an ambiguity, as an issue lists it. */
export interface IssueCandidate {
  /** The candidate's address: its exact path, such as `#/$sections/2`. */
  readonly address: string;
  /** The line its node starts on, when the record has a source file. */
  readonly line?: number;
  /** Its derived anchor, written as an address, such as `#notes`. */
  readonly derived?: string;
}

/**
 * What a command knows about an issue beyond the issue itself, which the format prints when given. Commands build it from the
 * record the issue is about; the issue alone does not have it.
 */
export interface IssueDetails {
  /** The file to name in place of the issue's `path`, such as a configuration file, which is not a record. */
  readonly file?: string;
  /** The semantic path of the node the issue is in, written as an address, such as `#what-was-done/$body`. */
  readonly semantic?: string;
  /** The candidates of an ambiguity, in the order to list them. */
  readonly candidates?: readonly IssueCandidate[];
}

/** Gives the details of an issue, or undefined for none. */
export type IssueDetailsSource = (issue: Issue) => IssueDetails | undefined;

/** The number of issues printed when the caller sets no limit. */
export const DEFAULT_ISSUE_LIMIT = 20;

/**
 * Formats one issue, each line ending with a line break:
 *
 * ```
 * tickets/0171-x.md:14:3 error ref-ambiguous: #notes matches 2 sections
 *   in   #what-was-done/$body  (exact #/$sections/1/$body)
 *   candidates  #/$sections/2 (line 20, derived #notes)
 *               #/$sections/4 (line 31, derived #notes-1)
 *   hint add <a id="..."></a> to the heading you mean, and link to that anchor
 * ```
 *
 * The first line starts with the file and, when the issue has a position, its line and column; an issue with neither a file
 * nor a path starts with its severity. The `in` line names the node by its semantic path and its exact path when `details`
 * gives the semantic one, by its exact path alone otherwise, and is left out for an issue about the whole record (`at` is `""`)
 * or about no node (`at` is null). Every line is made safe for a terminal with {@link oneLine}.
 */
export function formatIssue(issue: Issue, details?: IssueDetails): string {
  const file = details?.file ?? issue.path;
  const position = issue.position === undefined ? "" : `:${issue.position.line}:${issue.position.col}`;
  const where = file === null ? "" : `${file}${position} `;
  const lines = [`${where}${issue.severity} ${issue.code}: ${issue.message}`];
  if (issue.at !== null && issue.at !== "") {
    const exact = `#${issue.at}`;
    const semantic = details?.semantic;
    lines.push(semantic === undefined || semantic === exact ? `  in   ${exact}` : `  in   ${semantic}  (exact ${exact})`);
  }
  const candidates = details?.candidates ?? [];
  candidates.forEach((candidate, index) => {
    const notes = [
      candidate.line === undefined ? null : `line ${candidate.line}`,
      candidate.derived === undefined ? null : `derived ${candidate.derived}`,
    ].filter((note) => note !== null);
    const text = notes.length === 0 ? candidate.address : `${candidate.address} (${notes.join(", ")})`;
    lines.push(`${index === 0 ? "  candidates  " : "              "}${text}`);
  });
  if (issue.hint !== undefined) lines.push(`  hint ${issue.hint}`);
  return lines.map((line) => `${oneLine(line)}\n`).join("");
}

/** How {@link formatIssues} prints a list of issues. */
export interface IssueListOptions {
  /** The most issues to print, at least 0; {@link DEFAULT_ISSUE_LIMIT} by default. */
  readonly limit?: number;
  /** Whether to leave out warnings; they are still counted. */
  readonly errorsOnly?: boolean;
  /** Gives each issue's details. */
  readonly details?: IssueDetailsSource;
}

/**
 * Formats a list of issues in their order, at most `limit` of them. When some are left out by the limit, a last line counts
 * every issue by code, the ones printed included, from the most frequent: `45 issues, 25 not shown: 30 ref-dangling, 15
 * heading-html`. Warnings left out by `errorsOnly` are counted the same way but do not cause that line by themselves. Returns
 * the empty string for no issue to print.
 */
export function formatIssues(issues: readonly Issue[], options: IssueListOptions = {}): string {
  const limit = options.limit ?? DEFAULT_ISSUE_LIMIT;
  const shown = options.errorsOnly === true ? issues.filter((issue) => issue.severity === "error") : issues;
  const printed = shown.slice(0, limit);
  let text = printed.map((issue) => formatIssue(issue, options.details?.(issue))).join("");
  if (printed.length < shown.length) text += formatIssueCounts(issues, issues.length - printed.length);
  return text;
}

/** Writes the line that counts `issues` by code, saying how many of them were not printed. */
function formatIssueCounts(issues: readonly Issue[], notShown: number): string {
  const counts = new Map<IssueCode, number>();
  for (const issue of issues) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  const byCode = [...counts]
    .sort(([codeA, countA], [codeB, countB]) => countB - countA || (codeA < codeB ? -1 : codeA > codeB ? 1 : 0))
    .map(([code, count]) => `${formatCount(count)} ${code}`);
  const total = issues.length === 1 ? "1 issue" : `${formatCount(issues.length)} issues`;
  return `${total}, ${formatCount(notShown)} not shown: ${byCode.join(", ")}\n`;
}
