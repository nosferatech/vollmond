import {
  blockAnchorAddress,
  canonicalAddress,
  type ResolutionSubject,
  subjectBinding,
  subjectRecord,
  type Target,
} from "../address/resolve.js";
import type { BlockAnchorEntry } from "../anchor/anchor-table.js";
import type { IssueCode, Severity } from "../issue/codes.js";
import { applySeverities, type SeverityConfiguration } from "../issue/severity.js";
import type { NodeInfo } from "../record/node-index.js";
import { blockText, valueAt } from "../record/node-value.js";
import type { ParsedRecord } from "../record/record.js";
import type { Reference, ReferenceStatus, ReferenceTarget } from "../reference/reference.js";
import type { ByteRange } from "../text/source-text.js";
import { nodeVersion } from "../value/digest.js";

/** The computed fields a caller can request, in the order a read that requests them all gives them. */
export const COMPUTED_FIELD_NAMES = [
  "@path",
  "@at",
  "@address",
  "@key",
  "@anchors",
  "@version",
  "@source",
  "@range",
  "@issues",
  "@refs",
  "@collection",
  "@depth",
  "@nodes",
] as const;

/** The name of a computed field. */
export type ComputedFieldName = (typeof COMPUTED_FIELD_NAMES)[number];

/** An anchor as `@anchors` lists it. */
export interface ComputedAnchor {
  readonly name: string;
  readonly kind: "explicit" | "derived" | "block";
}

/** Where a node is in its file, as `@source` gives it. */
export interface SourceLocation {
  /** The node's bytes in the file, which a read in source form returns. */
  readonly range: ByteRange;
  /** The line of the range's start, from 1. */
  readonly line: number;
  /** The column of the range's start, in code points from 1. */
  readonly col: number;
  /** For an object member, from the start of its key to the end of its value. */
  readonly memberRange?: ByteRange;
}

/** A reference as `@refs` lists it: what `refs` gives, without where the reference is but a link's offset. */
export interface ComputedReference {
  readonly raw: string;
  readonly status: ReferenceStatus;
  readonly targets: readonly ReferenceTarget[];
  /** For a link, an image or a definition, its offset in the `$body` or `$title` that holds it, in UTF-8 bytes. */
  readonly offset?: number;
}

/** An issue as `@issues` lists it. */
export interface ComputedIssue {
  readonly code: IssueCode;
  readonly severity: Severity;
  readonly at: string | null;
  readonly message: string;
}

/**
 * The computed fields of a node or a block anchor: each requested field that applies to it, in the order requested. A field
 * that does not apply is absent: `@key` for the root and a block anchor, `@depth` and `@nodes` for a node that is not a
 * section, `@range` for anything but a block anchor.
 */
export interface ComputedFields {
  /** The record's store path. */
  readonly "@path"?: string;
  /** The node's exact path; for a block anchor, that of its `$body`. */
  readonly "@at"?: string;
  /** The canonical address, as a fragment with its `#`, or `""` for the root. */
  readonly "@address"?: string;
  /** The section key of a section, and the member name or index of any other node. */
  readonly "@key"?: string | number;
  /** The anchors that name the node: its explicit and derived anchors; for a block anchor, itself. */
  readonly "@anchors"?: readonly ComputedAnchor[];
  /** The node version of the node's value; for a block anchor, of its text as a string. */
  readonly "@version"?: string;
  /** Where the node is in its file; for a block anchor, its block. */
  readonly "@source"?: SourceLocation;
  /** For a block anchor, its range in the `$body`'s value. */
  readonly "@range"?: ByteRange;
  /** The issues found while parsing that are attached to the node; for a block anchor, those at its offsets. */
  readonly "@issues"?: readonly ComputedIssue[];
  /** The references the node and the nodes below it make, in document order; for a block anchor, those in its block. */
  readonly "@refs"?: readonly ComputedReference[];
  /** The name of the record's collection; absent for a record that no collection, or several, claim. */
  readonly "@collection"?: string;
  /** A section's depth, 0 for the root. */
  readonly "@depth"?: number;
  /** For a section, the same requested fields of each section below it, at any depth, by exact path. */
  readonly "@nodes"?: Readonly<Record<string, ComputedFields>>;
}

/** What the store knows of a record that its computed fields need beyond the record itself. */
export interface ComputedFieldContext {
  /** The name of the record's collection, for `@collection`; absent for a record in none. */
  readonly collection?: string;
  /** The configuration's severities, which `@issues` applies; without them, issues have their default severities. */
  readonly severities?: SeverityConfiguration;
  /** The references of the record, resolved, for `@refs`: at least those of the node and below it. */
  readonly references?: readonly Reference[];
}

// Deviation from the I1 design, recorded in issue #15: the subject is a node's exact path or a target, not a path alone, since a
// block anchor has computed fields of its own (`@range`, its anchor) and shares its `$body`'s path. A target, and not any
// object with a range, so that a node of the index, whose range is in the file, cannot be taken for a block anchor.
/**
 * Computes the requested fields of a node of a record, given by its exact path, or of a target that resolving an address in
 * the record gave, which may be a block anchor. The record is a parsed one, or its binding to its collection's schema, which
 * gives a keyed-list item its key as `@key` and in `@address`, proves the canonical address singular, and adds the schema's
 * issues to `@issues`. `all` requests every field but `@nodes`, which is requested by
 * name. `@refs` lists those of the context's references that the node, or a node below it, makes, and is absent when the
 * context gives no references, since resolving them needs the store. `@collection` is the context's collection, absent
 * without one. `@issues` holds the issues found while parsing, with the
 * context's severities applied, or with their default severities when it gives none.
 *
 * Throws a `RangeError` when the record has no node at the path, for a target of another record, and for a target with a
 * range that is not one of the record's block anchors. `@version` hashes the value with the runtime's Web Crypto API.
 */
export async function computeFields(
  of: ResolutionSubject,
  subject: string | Target,
  names: readonly ComputedFieldName[] | "all",
  context: ComputedFieldContext = {},
): Promise<ComputedFields> {
  const record = subjectRecord(of);
  const requested = names === "all" ? COMPUTED_FIELD_NAMES.filter((name) => name !== "@nodes") : [...new Set(names)];
  const at = typeof subject === "string" ? subject : subject.at;
  if (typeof subject !== "string" && subject.path !== record.path) {
    throw new RangeError(`the target is in ${subject.path}, not in ${record.path}`);
  }
  const node = record.nodes.node(at);
  if (node === undefined) throw new RangeError(`no node at ${JSON.stringify(at)}`);
  const range = typeof subject === "string" ? undefined : subject.range;
  const block = range === undefined ? undefined : blockAnchorOf(record, at, range);
  const fields: Record<string, unknown> = {};
  for (const name of requested) {
    const value = await fieldOf(of, node, block, name, requested, context);
    if (value !== undefined) fields[name] = value;
  }
  return fields as ComputedFields;
}

/** Gives one computed field of a node or a block anchor, or undefined where it does not apply. */
async function fieldOf(
  of: ResolutionSubject,
  node: NodeInfo,
  block: BlockAnchorEntry | undefined,
  name: ComputedFieldName,
  requested: readonly ComputedFieldName[],
  context: ComputedFieldContext,
): Promise<unknown> {
  const record = subjectRecord(of);
  const binding = subjectBinding(of);
  switch (name) {
    case "@path":
      return record.path;
    case "@at":
      return node.at;
    case "@address":
      return block === undefined ? canonicalAddress(of, node.at) : blockAnchorAddress(of, block);
    case "@key":
      // The root is a section without an entry in the section keys.
      if (block !== undefined) return undefined;
      if (node.kind === "section") return record.sectionKeys.get(node.at);
      // An item of a keyed list has its key; one without a key keeps its index.
      if (typeof node.key === "number" && node.parent !== null) {
        const list = binding?.lists.get(node.parent);
        const key = list === undefined || list.type === "undeclared" ? null : list.keyOf(node.key);
        if (key !== null) return key;
      }
      return node.key;
    case "@anchors":
      if (block !== undefined) return [{ name: block.name, kind: block.kind }];
      return record.anchors.of(node.at).map(({ name: anchor, kind }) => ({ name: anchor, kind }));
    case "@version":
      return nodeVersion(block === undefined ? valueAt(record, node.at) : blockText(record, block));
    case "@source": {
      const range = block === undefined ? node.range : block.fileRange;
      const { line, col } = record.source.position(range.start);
      const location: SourceLocation =
        block === undefined && node.memberRange !== undefined
          ? { range, line, col, memberRange: node.memberRange }
          : { range, line, col };
      return location;
    }
    case "@range":
      return block?.range;
    case "@issues": {
      const issues = binding?.issues ?? record.issues;
      return (context.severities === undefined ? issues : applySeverities(issues, context.severities))
        .filter((issue) => issue.at === node.at)
        .filter(
          (issue) =>
            block === undefined ||
            (issue.offset !== undefined && issue.offset >= block.range.start && issue.offset < block.range.end),
        )
        .map(({ code, severity, at, message }) => ({ code, severity, at, message }));
    }
    case "@depth":
      return block === undefined && node.kind === "section" ? node.depth : undefined;
    case "@nodes": {
      if (block !== undefined || node.kind !== "section") return undefined;
      const inner = requested.filter((field) => field !== "@nodes");
      const below: Record<string, ComputedFields> = {};
      for (const section of record.nodes.sections()) {
        if (section.at.startsWith(`${node.at}/`)) below[section.at] = await computeFields(of, section.at, inner, context);
      }
      return below;
    }
    case "@collection":
      return context.collection;
    case "@refs": {
      if (context.references === undefined) return undefined;
      const inside = (reference: Reference) =>
        block === undefined
          ? node.at === "" || reference.at === node.at || reference.at.startsWith(`${node.at}/`)
          : reference.at === block.at &&
            reference.offset !== undefined &&
            reference.offset >= block.range.start &&
            reference.offset < block.range.end;
      return context.references.filter(inside).map(
        ({ raw, status, targets, offset }): ComputedReference => ({
          raw,
          status,
          targets,
          ...(offset === undefined ? {} : { offset }),
        }),
      );
    }
  }
}

/** Finds the block anchor of a `$body` with exactly this range, throwing a `RangeError` when there is none. */
function blockAnchorOf(record: ParsedRecord, at: string, range: ByteRange): BlockAnchorEntry {
  for (const entry of record.anchors.anchors) {
    if (entry.kind === "block" && entry.at === at && entry.range.start === range.start && entry.range.end === range.end) {
      return entry;
    }
  }
  throw new RangeError(`no block anchor at ${JSON.stringify(at)} [${range.start}, ${range.end})`);
}
