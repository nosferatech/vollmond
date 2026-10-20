import type { AnchorTable } from "../anchor/anchor-table.js";
import { hasStructuralError, type Issue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import type { ReferenceOccurrence } from "../reference/reference.js";
import type { Position, SourceText } from "../text/source-text.js";
import type { ValueObject } from "../value/value.js";
import type { NodeIndex } from "./node-index.js";

/** The format of a record, from its file's extension. */
export type RecordFormat = "md" | "yaml" | "json";

/**
 * What resolution, canonical addresses and checks read of a record that has no structural error: its path, format, node
 * index, anchors, section keys and the validation issues its parse found, without its value view or its source. A record
 * that was parsed is one ({@link ParsedRecord}), and so is one restored from the local index ({@link RestoredRecord}).
 */
export interface RecordStructure {
  /** The record's store path. */
  readonly path: string;
  readonly format: RecordFormat;
  readonly nodes: NodeIndex;
  /** The anchors and tags of the record. */
  readonly anchors: AnchorTable;
  // Deviation from the I1 design, recorded in issue #14: the design gives a section's key as the `key` of its node in the index,
  // which holds the section's index in `$sections`, as every other item's; the key goes here instead, so that the index
  // keeps one meaning of `key` for every node.
  /** The key of each section but the root, by its exact path: its `$anchor`, or else the slug of its title. */
  readonly sectionKeys: ReadonlyMap<string, string>;
  /** The validation issues found while parsing, such as duplicate keys; never a structural error. */
  readonly issues: readonly Issue[];
}

/** A record that parsed: it had no structural error. */
export interface ParsedRecord extends RecordStructure {
  /** The value view: the root section. */
  readonly value: ValueObject;
  readonly source: SourceText;
  /**
   * For a Markdown record, the links, images and link reference definitions of its titles and bodies, in document order, which
   * its parse collects. Absent for a JSON or YAML record, whose prose is parsed for them only when references are needed.
   */
  readonly links?: readonly ReferenceOccurrence[];
}

/**
 * What a record restored from the local index holds in place of its value view and source: what resolving and checking its
 * references reads of them, computed when the record was parsed.
 */
export interface StructureFacts {
  /**
   * The references the record makes whatever its schema, in document order: the links, images and definitions of its titles
   * and bodies, and its `$ref` objects without a declaration, as {@link ParsedRecord}'s are found.
   */
  readonly occurrences: readonly ReferenceOccurrence[];
  /** For a JSON or YAML record, the slug of each section's `$title` but the root's, by exact path; empty for Markdown. */
  readonly titleSlugs: ReadonlyMap<string, string>;
  /** The line and column of each byte offset that an issue of one of `occurrences` is positioned at. */
  readonly positions: ReadonlyMap<number, Position>;
}

/** A record restored from the local index: its structure, and the facts that stand in for its value view and source. */
export interface RestoredRecord extends RecordStructure {
  readonly facts: StructureFacts;
}

/** Whether a record's structure is a parsed record, with its value view and source. */
export function isParsedRecord(record: RecordStructure): record is ParsedRecord {
  return "source" in record;
}

/** Whether a record's structure was restored from the local index. */
export function isRestoredRecord(record: RecordStructure): record is RestoredRecord {
  return "facts" in record;
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
