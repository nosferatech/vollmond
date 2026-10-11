// The issue format: where the issue is, its severity, code and message, then the node it is in, the candidates of an ambiguity
// and the hint, each on its own indented line.

import type { Issue, IssueCode } from "@vollmond/core";
import { oneLine } from "./lines.js";
import { formatCount } from "./sizes.js";

/** A candidate of an ambiguity, as an issue carries it: the record and, below its root, the node. */
export interface IssueCandidate {
  /** The store path of the candidate's record. */
  readonly path: string;
  /** The exact path of the candidate's node; absent for the record's root. */
  readonly at?: string;
}

// TODO(#15): read `candidates` from core's `Issue` once the address module adds it there, as the design's `Target`s, and drop
// this type: core's `Issue` has no candidates yet, since their type is the address module's.
/** An issue that may carry the candidates of an ambiguity. */
export type IssueWithCandidates = Issue & { readonly candidates?: readonly IssueCandidate[] };

/** What a command knows about one candidate beyond the issue: where its node starts and its derived anchor. */
export interface CandidateNote {
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
  /** The file to name, for an issue whose `path` is null because the file is not a record, such as a configuration. */
  readonly file?: string;
  /** The semantic path of the node the issue is in, written as an address, such as `#what-was-done/$body`. */
  readonly semantic?: string;
  /** A note for each of the issue's candidates, in their order; a missing or undefined note prints the candidate alone. */
  readonly candidateNotes?: readonly (CandidateNote | undefined)[];
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
 * The first line starts with the issue's path, or the file `details` names when the path is null, and, when the issue has a
 * position, its line and column; an issue with neither starts with its severity. The `in` line names the node by its semantic
 * path and its exact path when `details` gives the semantic one, by its exact path alone otherwise, and is left out for an
 * issue about the whole record (`at` is `""`) or about no node (`at` is null). Each candidate is written by its exact path,
 * after its record's path when that is another record, with the line and derived anchor `details` notes for it. Every line is
 * made safe for a terminal with {@link oneLine}.
 */
export function formatIssue(issue: IssueWithCandidates, details?: IssueDetails): string {
  const file = issue.path ?? details?.file ?? null;
  const position = issue.position === undefined ? "" : `:${issue.position.line}:${issue.position.col}`;
  const where = file === null ? "" : `${file}${position} `;
  const lines = [`${where}${issue.severity} ${issue.code}: ${issue.message}`];
  if (issue.at !== null && issue.at !== "") {
    const exact = `#${issue.at}`;
    const semantic = details?.semantic;
    lines.push(semantic === undefined || semantic === exact ? `  in   ${exact}` : `  in   ${semantic}  (exact ${exact})`);
  }
  const candidates = issue.candidates ?? [];
  candidates.forEach((candidate, index) => {
    const record = candidate.path === issue.path ? "" : candidate.path;
    const address = candidate.at === undefined ? candidate.path : `${record}#${candidate.at}`;
    const note = details?.candidateNotes?.[index];
    const notes = [
      note?.line === undefined ? null : `line ${note.line}`,
      note?.derived === undefined ? null : `derived ${note.derived}`,
    ].filter((text) => text !== null);
    const text = notes.length === 0 ? address : `${address} (${notes.join(", ")})`;
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
export function formatIssues(issues: readonly IssueWithCandidates[], options: IssueListOptions = {}): string {
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
