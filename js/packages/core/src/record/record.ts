import { hasStructuralError, type Issue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import type { SourceText } from "../text/source-text.js";
import type { ValueObject } from "../value/value.js";
import type { NodeIndex } from "./node-index.js";

/** The format of a record, from its file's extension. */
export type RecordFormat = "md" | "yaml" | "json";

// Deviation from the I1 design, recorded in issue #10: no `anchors` member yet, since the anchor table needs the slug rule,
// which comes with section keys and anchors.
/** A record that parsed: it had no structural error. */
export interface ParsedRecord {
  /** The record's store path. */
  readonly path: string;
  readonly format: RecordFormat;
  /** The value view: the root section. */
  readonly value: ValueObject;
  readonly source: SourceText;
  readonly nodes: NodeIndex;
  /** The validation issues found while parsing, such as duplicate keys; never a structural error. */
  readonly issues: readonly Issue[];
}

/**
 * Gives the format of a record from its path's extension, `.md`, `.yaml`, `.yml` or `.json`, compared exactly, or null for a
 * path that is not a record's.
 */
export function recordFormatOf(path: string): RecordFormat | null {
  const dot = path.lastIndexOf(".");
  if (dot <= path.lastIndexOf("/") + 1) return null;
  switch (path.slice(dot)) {
    case ".md":
      return "md";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".json":
      return "json";
    default:
      return null;
  }
}

/**
 * Gives a parse's outcome from everything it found: a failure with the structural errors when there is one, and otherwise the
 * record, which `record` builds with the issues on it. The outcome of a success carries no issues of its own, so that each is
 * reported once. Issues of other classes found alongside a structural error are dropped, since the record they describe has
 * no value view.
 */
export function parseOutcome(
  issues: readonly Issue[],
  record: (issues: readonly Issue[]) => ParsedRecord,
): Outcome<ParsedRecord> {
  if (hasStructuralError(issues)) return fail(issues.filter((issue) => issue.class === "structural"));
  return succeed(record(issues));
}
