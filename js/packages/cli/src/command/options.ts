// Reading the values of the read commands' options, and the details of the issues they print.

import type { ByteRange, Issue, Store } from "@vollmond/core";
import type { OptionValue } from "../arguments.js";
import type { CandidateNote, IssueDetails, IssueDetailsSource } from "../output/issues.js";
import { formatCount } from "../output/sizes.js";

/** A value read from an option, or the message that says why it is not one. */
export type OptionReading<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/**
 * Reads a whole number from `minimum` to `maximum` given to the option `name`, written with digits only and without a leading
 * zero, or gives `fallback` when the option is absent. Signs, decimals, exponents, white space and the empty string are refused.
 *
 * Precondition: `maximum` is a safe integer of at least `minimum`, and `minimum` is 0 or more.
 */
export function readWholeNumber<T>(
  value: OptionValue,
  name: string,
  range: { readonly minimum: number; readonly maximum: number },
  fallback: T,
): OptionReading<number | T> {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    const number = Number(value);
    if (number >= range.minimum && number <= range.maximum) return { ok: true, value: number };
  }
  const bounds =
    range.maximum === Number.MAX_SAFE_INTEGER
      ? `from ${formatCount(range.minimum)}`
      : `from ${formatCount(range.minimum)} to ${formatCount(range.maximum)}`;
  return { ok: false, message: `${name} takes a whole number ${bounds}, not ${JSON.stringify(value)}` };
}

/**
 * Checks that a command got between `minimum` and `maximum` arguments, and gives the message for one that did not; `what`
 * names them, as in "a path".
 */
export function argumentCountProblem(
  positionals: readonly string[],
  minimum: number,
  maximum: number,
  what: string,
): string | null {
  if (positionals.length < minimum) return `missing ${what}`;
  if (positionals.length > maximum) {
    const extra = positionals.slice(maximum).map((argument) => JSON.stringify(argument));
    return `unexpected argument${extra.length === 1 ? "" : "s"} ${extra.join(" ")}`;
  }
  return null;
}

/** Writes a byte range as the JSON output writes every range: `[start, end]`. */
export function rangeJson(range: ByteRange): readonly [number, number] {
  return [range.start, range.end];
}

/**
 * Gives the details of the issues of an operation over `store`: for an ambiguity, the line where each candidate starts and its
 * derived anchor, read from the candidate's record, which resolving the address read.
 */
export function storeIssueDetails(store: Store): IssueDetailsSource {
  return (issue: Issue): IssueDetails | undefined => {
    if (issue.candidates === undefined) return undefined;
    const candidateNotes = issue.candidates.map((candidate): CandidateNote | undefined => {
      const read = store.recordRead(candidate.path);
      if (read === undefined || read === null || !read.ok) return undefined;
      const record = read.value;
      const block =
        candidate.range === undefined
          ? undefined
          : record.anchors.anchors.find(
              (entry) =>
                entry.kind === "block" &&
                entry.at === candidate.at &&
                entry.range.start === candidate.range?.start &&
                entry.range.end === candidate.range?.end,
            );
      const node = record.nodes.node(candidate.at);
      if (node === undefined) return undefined;
      const start = block?.kind === "block" ? block.fileRange.start : node.range.start;
      const line = record.source.position(start).line;
      const derived = block === undefined && node.kind === "section" ? node.heading?.derivedAnchor : null;
      return derived === null || derived === undefined ? { line } : { line, derived: `#${derived}` };
    });
    return { candidateNotes };
  };
}
