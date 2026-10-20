// The local index's entries: a record's parse and its binding as rows of JSON, one per line, in the line format of the
// portable index, without the record's path and without its values, and the structures and bindings restored from them.

import type { AnchorEntry, TagEntry } from "../anchor/anchor-table.js";
import { anchorTableOf } from "../anchor/anchor-table.js";
import { type BindingParts, bindingOf, type KeyedList, type RecordBinding } from "../binding/binding.js";
import { ISSUE_CODES, type IssueClass, type IssueCode, type Severity } from "../issue/codes.js";
import { type Issue, type IssueInit, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { declaredDuplicate, isDeclaredDuplicate } from "../issue/severity.js";
import { type NodeIndex, NodeIndexBuilder, type NodeInfo, type ValueKind } from "../record/node-index.js";
import {
  isParsedRecord,
  type ParsedRecord,
  type RecordFormat,
  type RecordStructure,
  type RestoredRecord,
  recordFormatOf,
} from "../record/record.js";
import { schemaFreeOccurrences, typedOccurrence } from "../reference/extract.js";
import type { ReferenceForm, ReferenceOccurrence } from "../reference/reference.js";
import { sectionTitleSlugs } from "../reference/resolve.js";
import type { CollectionSchema } from "../schema/collection-schema.js";
import type { RefDeclaration } from "../schema/keywords.js";
import type { ByteRange, Position } from "../text/source-text.js";
import { MAX_ENTRY_BYTES } from "./cache.js";

// Deviation from the I2 design, recorded in issue #25: an entry starts with a header row of its own kind, `parse` or `binding`,
// rather than §6.1's `record` row, and a parse entry's header holds only the format and whether the record is readable, not
// its size, tokens or title, which nothing local reads; reference rows carry their issues' positions, and JSON and YAML
// section rows their title slugs.
/** One row of an entry: a JSON object whose `t` names its kind. */
type Row = Readonly<Record<string, unknown>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Gives the cache key of a file version's parse entry: its blob id and its format. A version is a git blob id, in lower-case
 * hexadecimal.
 */
export function parseEntryKey(version: string, format: RecordFormat): string {
  return `parse/${version}.${format}`;
}

/**
 * Gives the cache key of a file version's binding entry: its blob id, its format, the collection's name and the digest of
 * the collection's schema files ({@link CollectionSchema.bindingDigest}).
 */
export function bindingEntryKey(version: string, format: RecordFormat, schema: CollectionSchema): string {
  return `bind/${version}.${format}.${schema.collection}.${schema.bindingDigest}`;
}

/**
 * Writes a record's parse outcome as a parse entry: for a record that parsed, its node index, anchors, tags, section keys,
 * the references it makes whatever its schema with the position of each one's issues, its JSON or YAML sections' title
 * slugs, and its validation issues; for one that did not, its structural errors. No row holds the record's path or a value
 * of it, but for the raw text of each reference, so one entry serves every path with these bytes. The last row counts the
 * others, so an entry cut short is never read as a smaller record.
 *
 * Gives null, and so no entry, for an outcome the index cannot keep without its path, one with an issue about another
 * path, and for an entry that would be larger than `limit` bytes, {@link MAX_ENTRY_BYTES} by default. Writing stops as
 * soon as the rows written pass the bound, and a record with more nodes than the bound holds rows for writes none, so an
 * entry past it costs no more memory than the bound.
 */
export function parseEntry(outcome: Outcome<ParsedRecord>, path?: string, limit = MAX_ENTRY_BYTES): Uint8Array | null {
  const writer = new RowWriter(limit);
  try {
    if (!outcome.ok) {
      const own = path ?? outcome.issues[0]?.path ?? null;
      const format = own === null ? null : recordFormatOf(own);
      if (format === null) return null;
      writer.push({ t: "parse", format, readable: false });
      for (const issue of outcome.issues) {
        const row = issueRow(issue, own);
        if (row === null) return null;
        writer.push(row);
      }
      return writer.finish();
    }
    const record = outcome.value;
    // Every node row is at least this long, so a record with more nodes than the bound holds is refused before any is made.
    if (hasMoreNodesThan(record.nodes, Math.floor(limit / MIN_NODE_ROW_BYTES))) return null;
    writer.push({ t: "parse", format: record.format, readable: true });
    const slugs = record.format === "md" ? new Map<string, string>() : sectionTitleSlugs(record);
    for (const node of preOrder(record.nodes)) writer.push(nodeRow(record, node, slugs.get(node.at)));
    for (const entry of record.anchors.anchors) writer.push(anchorRow(entry));
    for (const tag of record.anchors.tags) writer.push({ t: "tag", tag: tag.tag, at: tag.at });
    for (const occurrence of schemaFreeOccurrences(record)) {
      writer.push(referenceRow(occurrence, positionOf(record, occurrence)));
    }
    for (const issue of record.issues) {
      const row = issueRow(issue, record.path);
      if (row === null) return null;
      writer.push(row);
    }
    return writer.finish();
  } catch {
    // Past the bound, or anything else that fails while writing: no entry, and the store goes on without one.
    return null;
  }
}

/**
 * Restores a parse entry under a store path: the record's structure, with the facts that stand in for its value and source,
 * or the structural errors of an unreadable record, each with the path. Gives null, a miss, for anything that is not a whole
 * entry of this format and of the path's record format: bytes cut short, a row of an unknown kind or with a member missing or
 * unknown, or nodes that do not make an index; and for one larger than `limit` bytes, {@link MAX_ENTRY_BYTES} by default,
 * which it does not decode.
 */
export function restoreStructure(bytes: Uint8Array, path: string, limit = MAX_ENTRY_BYTES): Outcome<RestoredRecord> | null {
  if (bytes.length > limit) return null;
  const rows = decodeRows(bytes);
  if (rows === null) return null;
  try {
    return restoreParse(rows, path);
  } catch {
    // Whatever the rows hold, a failure to make a record of them is a corrupt entry: the store parses instead.
    return null;
  }
}

/**
 * Writes a binding to a collection's schema as a binding entry: its keyed lists with each item's key, its typed references'
 * occurrences with the position of each one's issues, the declaration of each reference that has one, and its issues. The
 * shapes are left out: they are the schema's, and found again from it. Gives null for a binding the index cannot keep
 * without its path, and for an entry larger than `limit` bytes, as {@link parseEntry} does.
 */
export function bindingEntry(binding: RecordBinding, limit = MAX_ENTRY_BYTES): Uint8Array | null {
  const record = binding.record;
  const writer = new RowWriter(limit);
  try {
    writer.push({ t: "binding" });
    for (const list of [...binding.lists.values()].sort((a, b) => compareCodeUnits(a.at, b.at))) {
      const count = record.nodes.children(list.at).length;
      writer.push({ t: "list", at: list.at, type: list.type, keys: Array.from({ length: count }, (_, i) => list.keyOf(i)) });
    }
    for (const node of preOrder(record.nodes)) {
      const declaration = binding.declarationOf(node.at);
      if (declaration === null) continue;
      writer.push({ t: "declaration", at: node.at, ...declarationMembers(declaration) });
    }
    for (const at of binding.typedReferences) {
      const occurrence = typedOccurrence(binding, at);
      const { declaration: _, ...plain } = occurrence;
      writer.push(referenceRow(plain, typedPosition(binding, occurrence)));
    }
    for (const issue of binding.issues) {
      const row = issueRow(issue, record.path);
      if (row === null) return null;
      writer.push(row);
    }
    return writer.finish();
  } catch {
    return null;
  }
}

/**
 * Restores a binding entry over a record's structure and the collection's schema it was bound to, which the entry's key
 * names. Gives null, a miss, as {@link restoreStructure} does, and for an entry that does not fit the structure: a list at a
 * node that is not an array of that many items, a typed reference at a node that is not a string, a declaration at no node.
 */
export function restoreBinding<Record extends RecordStructure>(
  bytes: Uint8Array,
  record: Record,
  schema: CollectionSchema,
  limit = MAX_ENTRY_BYTES,
): RecordBinding<Record> | null {
  if (bytes.length > limit) return null;
  const rows = decodeRows(bytes);
  if (rows === null) return null;
  try {
    return restoreBound(rows, record, schema);
  } catch {
    return null;
  }
}

/** A row that does not belong in an entry, which makes the entry a miss. */
class EntryError extends Error {}

/** Throws an {@link EntryError} unless `condition` holds. */
function check(condition: boolean): asserts condition {
  if (!condition) throw new EntryError("not an entry");
}

/**
 * Fewer bytes than any node row takes: a row's members' names and punctuation, with each value as short as it can be or
 * shorter (an empty path and parent, a one-digit key and range, `null` for the kind), less three.
 */
const MIN_NODE_ROW_BYTES = '{"t":"node","at":"","parent":0,"key":0,"kind":"null","range":[0,0]}'.length - 3;

/** A bound on an entry's bytes was passed while writing it. */
class EntryTooLarge extends Error {}

/**
 * Writes rows as JSON lines, with the closing row that counts them, within a bound on the bytes: a row that would take the
 * text past it throws an {@link EntryTooLarge}. A JSON text has at least as many UTF-8 bytes as UTF-16 code units, so
 * counting units refuses nothing that fits and stops at the bound at the latest. The text is encoded once, into a buffer of
 * its exact size.
 */
class RowWriter {
  readonly #limit: number;
  readonly #lines: string[] = [];
  #units = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  push(row: Row): void {
    const line = JSON.stringify(row);
    this.#units += line.length + 1;
    if (this.#units > this.#limit) throw new EntryTooLarge("the entry is past its bound");
    this.#lines.push(line);
  }

  /** Gives the entry's bytes, or null when they are past the bound. */
  finish(): Uint8Array | null {
    const lines = this.#lines;
    lines.push(JSON.stringify({ t: "end", rows: lines.length }));
    let total = 0;
    for (const line of lines) total += utf8Length(line) + 1;
    if (total > this.#limit) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const line of lines) {
      offset += encoder.encodeInto(line, bytes.subarray(offset)).written;
      bytes[offset] = 0x0a;
      offset += 1;
    }
    return bytes;
  }
}

/** The number of bytes of a string in UTF-8, without encoding it. */
function utf8Length(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      length += 4;
      i += 1;
    } else length += 3;
  }
  return length;
}

/**
 * Decodes an entry's JSON lines one at a time, after checking the entry as a whole: it ends with a line break, and its
 * closing row reads and counts the rows before it. Gives null for an entry that fails those checks. A row that is not UTF-8,
 * not JSON or not an object throws an {@link EntryError} when it is reached. No line is decoded before it is needed, and no
 * row is kept after it is read, so a restore holds the entry's bytes and one row at a time.
 */
function decodeRows(bytes: Uint8Array): Iterable<Row> | null {
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) return null;
  let lines = 0;
  for (const byte of bytes) if (byte === 0x0a) lines += 1;
  const last = bytes.lastIndexOf(0x0a, bytes.length - 2) + 1;
  let end: Row;
  try {
    end = rowAt(bytes, last, bytes.length - 1);
  } catch {
    return null;
  }
  if (end.t !== "end" || end.rows !== lines - 1 || Object.keys(end).length !== 2) return null;
  return {
    *[Symbol.iterator]() {
      let start = 0;
      while (start < last) {
        const stop = bytes.indexOf(0x0a, start);
        yield rowAt(bytes, start, stop);
        start = stop + 1;
      }
    },
  };
}

/** Reads the row of one line, the bytes from `start` to `end`, or throws an {@link EntryError}. */
function rowAt(bytes: Uint8Array, start: number, end: number): Row {
  let row: unknown;
  try {
    // A line break is never part of a multibyte character, so a line is UTF-8 on its own.
    row = JSON.parse(decoder.decode(bytes.subarray(start, end)));
  } catch {
    throw new EntryError("not a row");
  }
  check(row !== null && typeof row === "object" && !Array.isArray(row));
  return row as Row;
}

/** Splits rows into the first and an iterable of the others, reading none but the first. */
function headed(rows: Iterable<Row>): { readonly header: Row | undefined; readonly rest: Iterable<Row> } {
  const iterator = rows[Symbol.iterator]();
  const first = iterator.next();
  return { header: first.done === true ? undefined : first.value, rest: { [Symbol.iterator]: () => iterator } };
}

/** Checks that a row has exactly these members, `optional` ones aside, and gives it. */
function shaped(row: Row, required: readonly string[], optional: readonly string[] = []): Row {
  for (const name of required) check(Object.hasOwn(row, name));
  for (const name of Object.keys(row)) check(name === "t" || required.includes(name) || optional.includes(name));
  return row;
}

/** The nodes of an index in pre-order, each after its parent and its earlier siblings, the order a builder takes them in. */
function* preOrder(nodes: NodeIndex): Generator<NodeInfo> {
  yield nodes.node("") as NodeInfo;
  // A frame per level, over the index's own lists of children, so that the walk holds no copy of them.
  const frames: { readonly children: readonly NodeInfo[]; index: number }[] = [{ children: nodes.children(""), index: 0 }];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1] as { readonly children: readonly NodeInfo[]; index: number };
    const node = frame.children[frame.index];
    if (node === undefined) {
      frames.pop();
      continue;
    }
    frame.index += 1;
    yield node;
    const children = nodes.children(node.at);
    if (children.length > 0) frames.push({ children, index: 0 });
  }
}

/** Whether an index has more than `count` nodes, counted no further than that. */
function hasMoreNodesThan(nodes: NodeIndex, count: number): boolean {
  let seen = 0;
  for (const _ of preOrder(nodes)) {
    seen += 1;
    if (seen > count) return true;
  }
  return false;
}

function rangeOf(range: ByteRange): [number, number] {
  return [range.start, range.end];
}

/** Reads a range written as `[start, end]`. */
function readRange(value: unknown): ByteRange {
  check(Array.isArray(value) && value.length === 2 && value.every((n) => Number.isSafeInteger(n)));
  return { start: value[0] as number, end: value[1] as number };
}

function nodeRow(record: ParsedRecord, node: NodeInfo, titleSlug: string | undefined): Row {
  const row: Record<string, unknown> = { t: "node", at: node.at, parent: node.parent, key: node.key, kind: node.kind };
  row.range = rangeOf(node.range);
  if (node.memberRange !== undefined) row.member = rangeOf(node.memberRange);
  if (node.kind === "section") {
    row.depth = node.depth;
    if (node.heading !== null) {
      row.heading = { level: node.heading.level, range: rangeOf(node.heading.range), derived: node.heading.derivedAnchor };
    }
    const key = record.sectionKeys.get(node.at);
    if (key !== undefined) row.section_key = key;
    if (titleSlug !== undefined) row.title_slug = titleSlug;
  }
  return row;
}

function anchorRow(entry: AnchorEntry): Row {
  if (entry.kind === "block") {
    return {
      t: "anchor",
      name: entry.name,
      kind: entry.kind,
      at: entry.at,
      range: rangeOf(entry.range),
      file: rangeOf(entry.fileRange),
    };
  }
  return entry.slug === undefined
    ? { t: "anchor", name: entry.name, kind: entry.kind, at: entry.at }
    : { t: "anchor", name: entry.name, kind: entry.kind, at: entry.at, slug: entry.slug };
}

/** The place a reference's issue is put at, as resolution finds it: its destination, or else the start of its node. */
function anchorOffsetOf(record: RecordStructure, occurrence: ReferenceOccurrence): number | undefined {
  return occurrence.destination?.start ?? record.nodes.node(occurrence.at)?.range.start;
}

function positionOf(record: ParsedRecord, occurrence: ReferenceOccurrence): Position | undefined {
  const offset = anchorOffsetOf(record, occurrence);
  return offset === undefined ? undefined : record.source.position(offset);
}

/** The position of a typed reference's issues, from the record's source or the restored binding's facts. */
function typedPosition(binding: RecordBinding, occurrence: ReferenceOccurrence): Position | undefined {
  const record = binding.record;
  const offset = anchorOffsetOf(record, occurrence);
  if (offset === undefined) return undefined;
  if (isParsedRecord(record)) return record.source.position(offset);
  return binding.restored?.positions.get(offset);
}

function referenceRow(occurrence: ReferenceOccurrence, position: Position | undefined): Row {
  const row: Record<string, unknown> = { t: "ref", form: occurrence.form, at: occurrence.at };
  if (occurrence.offset !== undefined) row.offset = occurrence.offset;
  row.raw = occurrence.raw;
  row.uri = occurrence.uri;
  if (occurrence.destination !== undefined) row.destination = rangeOf(occurrence.destination);
  if (position !== undefined) row.position = [position.offset, position.line, position.col];
  return row;
}

const FORMS: ReadonlySet<ReferenceForm> = new Set(["link", "definition", "image", "ref-object", "typed"]);

/** Reads a reference row: its occurrence, and the position of its issues. */
function readReference(row: Row): { occurrence: ReferenceOccurrence; position: Position | undefined } {
  shaped(row, ["form", "at", "raw", "uri"], ["offset", "destination", "position"]);
  check(FORMS.has(row.form as ReferenceForm) && typeof row.at === "string");
  check(typeof row.raw === "string" && typeof row.uri === "string");
  const occurrence: { -readonly [K in keyof ReferenceOccurrence]: ReferenceOccurrence[K] } = {
    form: row.form as ReferenceForm,
    at: row.at,
    raw: row.raw,
    uri: row.uri,
  };
  if (row.offset !== undefined) {
    check(Number.isSafeInteger(row.offset));
    occurrence.offset = row.offset as number;
  }
  // The members in the order a parse gives them, so that a restored occurrence compares as the parsed one does.
  const ordered: ReferenceOccurrence = {
    form: occurrence.form,
    at: occurrence.at,
    ...(occurrence.offset === undefined ? {} : { offset: occurrence.offset }),
    raw: occurrence.raw,
    uri: occurrence.uri,
    ...(row.destination === undefined ? {} : { destination: readRange(row.destination) }),
  };
  let position: Position | undefined;
  if (row.position !== undefined) {
    const value = row.position;
    check(Array.isArray(value) && value.length === 3 && value.every((n) => Number.isSafeInteger(n)));
    position = { offset: value[0] as number, line: value[1] as number, col: value[2] as number };
  }
  return { occurrence: ordered, position };
}

/**
 * Gives an issue as a row, without its path: an issue about the record itself, or about no record. Null for one about
 * another path, or one with candidates, which name paths.
 */
function issueRow(issue: Issue, path: string | null): Row | null {
  if ((issue.path !== null && issue.path !== path) || issue.candidates !== undefined) return null;
  const row: Record<string, unknown> = {
    t: "issue",
    code: issue.code,
    severity: issue.severity,
    class: issue.class,
    own: issue.path !== null,
    at: issue.at,
    message: issue.message,
  };
  if (issue.hint !== undefined) row.hint = issue.hint;
  if (issue.position !== undefined) row.position = [issue.position.offset, issue.position.line, issue.position.col];
  if (issue.offset !== undefined) row.offset = issue.offset;
  if (isDeclaredDuplicate(issue)) row.declared = true;
  return row;
}

/** Reads an issue row, with the record's path for an issue about it. */
function readIssue(row: Row, path: string): Issue {
  shaped(row, ["code", "severity", "class", "own", "at", "message"], ["hint", "position", "offset", "declared"]);
  check(typeof row.code === "string" && Object.hasOwn(ISSUE_CODES, row.code));
  check(typeof row.own === "boolean" && (row.at === null || typeof row.at === "string") && typeof row.message === "string");
  const init: { -readonly [K in keyof IssueInit]: IssueInit[K] } = {
    code: row.code as IssueCode,
    severity: row.severity as Severity,
    class: row.class as IssueClass,
    path: row.own ? path : null,
    at: row.at as string | null,
    message: row.message,
  };
  if (row.hint !== undefined) {
    check(typeof row.hint === "string");
    init.hint = row.hint;
  }
  if (row.position !== undefined) {
    const value = row.position;
    check(Array.isArray(value) && value.length === 3 && value.every((n) => Number.isSafeInteger(n)));
    init.position = { offset: value[0] as number, line: value[1] as number, col: value[2] as number };
  }
  if (row.offset !== undefined) {
    check(Number.isSafeInteger(row.offset));
    init.offset = row.offset as number;
  }
  const issue = makeIssue(init);
  if (row.declared === undefined) return issue;
  check(row.declared === true);
  return declaredDuplicate(issue);
}

const VALUE_KINDS: ReadonlySet<string> = new Set(["object", "array", "string", "number", "boolean", "null"]);

/** Restores a parse entry's rows, throwing an {@link EntryError} or a `RangeError` for rows that do not make one. */
function restoreParse(rows: Iterable<Row>, path: string): Outcome<RestoredRecord> {
  const { header, rest } = headed(rows);
  check(header !== undefined && header.t === "parse");
  shaped(header, ["format", "readable"]);
  const format = recordFormatOf(path);
  check(format !== null && header.format === format);
  if (header.readable === false) {
    const issues = [...rest].map((row) => {
      check(row.t === "issue");
      return readIssue(row, path);
    });
    check(issues.length > 0 && issues.every((issue) => issue.class === "structural"));
    return fail(issues);
  }
  check(header.readable === true);
  let builder: NodeIndexBuilder | null = null;
  const derived = new Map<string, string>();
  const expected = new Map<string, Row>();
  const sectionKeys = new Map<string, string>();
  const titleSlugs = new Map<string, string>();
  const anchors: AnchorEntry[] = [];
  const tags: TagEntry[] = [];
  const occurrences: ReferenceOccurrence[] = [];
  const positions = new Map<number, Position>();
  const issues: Issue[] = [];
  for (const row of rest) {
    switch (row.t) {
      case "node": {
        shaped(row, ["at", "parent", "key", "kind", "range"], ["member", "depth", "heading", "section_key", "title_slug"]);
        check(typeof row.at === "string" && (row.kind === "section" || VALUE_KINDS.has(row.kind as string)));
        check(issues.length === 0 && anchors.length === 0 && occurrences.length === 0);
        const range = readRange(row.range);
        const heading = readHeading(row.heading);
        if (row.parent === null) {
          check(builder === null && row.at === "" && row.key === null && row.kind === "section");
          builder = new NodeIndexBuilder({ range, ...(heading === null ? {} : { heading: heading.init }) });
        } else {
          check(builder !== null && typeof row.parent === "string");
          check(typeof row.key === "string" || Number.isSafeInteger(row.key));
          const kind: ValueKind = row.kind === "section" ? "object" : (row.kind as ValueKind);
          builder.add(row.parent, row.key as string | number, {
            kind,
            range,
            ...(row.member === undefined ? {} : { memberRange: readRange(row.member) }),
            ...(heading === null ? {} : { heading: heading.init }),
          });
        }
        if (heading?.derived != null) derived.set(row.at, heading.derived);
        if (row.section_key !== undefined) {
          check(typeof row.section_key === "string");
          sectionKeys.set(row.at, row.section_key);
        }
        if (row.title_slug !== undefined) {
          check(typeof row.title_slug === "string");
          titleSlugs.set(row.at, row.title_slug);
        }
        expected.set(row.at, row);
        break;
      }
      case "anchor":
        anchors.push(readAnchor(row));
        break;
      case "tag":
        shaped(row, ["tag", "at"]);
        check(typeof row.tag === "string" && typeof row.at === "string");
        tags.push({ tag: row.tag, at: row.at });
        break;
      case "ref": {
        const { occurrence, position } = readReference(row);
        check(occurrence.form !== "typed");
        occurrences.push(occurrence);
        if (position !== undefined) positions.set(position.offset, position);
        break;
      }
      case "issue":
        issues.push(readIssue(row, path));
        break;
      default:
        check(false);
    }
  }
  check(builder !== null);
  const nodes = builder.build(derived);
  // The builder decides which objects are sections, and their depths: they must be what was written.
  for (const [at, row] of expected) {
    // A row whose path is not its parent's and key's child names no node of the index the builder made.
    const node = nodes.node(at);
    check(node !== undefined && node.kind === row.kind);
    if (node.kind === "section") check(node.depth === row.depth);
    else check(row.depth === undefined && row.section_key === undefined && row.title_slug === undefined);
  }
  for (const entry of anchors) check(nodes.node(entry.at) !== undefined);
  for (const tag of tags) check(nodes.node(tag.at) !== undefined);
  for (const occurrence of occurrences) check(nodes.node(occurrence.at) !== undefined);
  check(issues.every((issue) => issue.class !== "structural"));
  if (format !== "md") {
    for (const section of nodes.sections()) check(section.at === "" || titleSlugs.has(section.at));
  }
  const record: RestoredRecord = Object.freeze({
    path,
    format,
    nodes,
    anchors: anchorTableOf(anchors, tags),
    sectionKeys,
    issues: Object.freeze(issues),
    facts: Object.freeze({ occurrences: Object.freeze(occurrences), titleSlugs, positions }),
  });
  return succeed(record);
}

/** Reads a section's heading, written as `{level, range, derived}`, or null for none. */
function readHeading(value: unknown): { init: { level: number; range: ByteRange }; derived: string | null } | null {
  if (value === undefined) return null;
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  const heading = shaped(value as Row, ["level", "range", "derived"]);
  check(Number.isSafeInteger(heading.level) && (heading.derived === null || typeof heading.derived === "string"));
  return { init: { level: heading.level as number, range: readRange(heading.range) }, derived: heading.derived as string | null };
}

function readAnchor(row: Row): AnchorEntry {
  check(typeof row.name === "string" && typeof row.at === "string");
  if (row.kind === "block") {
    shaped(row, ["name", "kind", "at", "range", "file"]);
    return { name: row.name, kind: "block", at: row.at, range: readRange(row.range), fileRange: readRange(row.file) };
  }
  check(row.kind === "explicit" || row.kind === "derived");
  shaped(row, ["name", "kind", "at"], ["slug"]);
  if (row.slug === undefined) return { name: row.name, kind: row.kind, at: row.at };
  check(typeof row.slug === "string");
  return { name: row.name, kind: row.kind, at: row.at, slug: row.slug };
}

function declarationMembers(declaration: RefDeclaration): Row {
  return { targets: declaration.targets, cardinality: declaration.cardinality, anchors: declaration.anchors };
}

function readDeclaration(row: Row): RefDeclaration {
  shaped(row, ["at", "targets", "cardinality", "anchors"]);
  const targets = row.targets;
  check(targets === null || (Array.isArray(targets) && targets.every((entry) => typeof entry === "string")));
  check(row.cardinality === "one" || row.cardinality === "many");
  check(row.anchors === "any" || row.anchors === "explicit");
  return Object.freeze({
    targets: targets === null ? null : Object.freeze([...(targets as string[])]),
    cardinality: row.cardinality,
    anchors: row.anchors,
  });
}

const LIST_TYPES: ReadonlySet<string> = new Set(["map", "multimap", "undeclared"]);

/** Restores a binding entry's rows over a structure, throwing for rows that do not make one. */
function restoreBound<Record extends RecordStructure>(
  rows: Iterable<Row>,
  record: Record,
  schema: CollectionSchema,
): RecordBinding<Record> {
  const { header, rest } = headed(rows);
  check(header !== undefined && header.t === "binding");
  shaped(header, []);
  const lists: { at: string; type: KeyedList["type"]; keys: (string | null)[] }[] = [];
  const declarations = new Map<string, RefDeclaration>();
  const typedReferences: string[] = [];
  const typed = new Map<string, ReferenceOccurrence>();
  const positions = new Map<number, Position>();
  const issues: Issue[] = [];
  for (const row of rest) {
    switch (row.t) {
      case "list": {
        shaped(row, ["at", "type", "keys"]);
        check(typeof row.at === "string" && LIST_TYPES.has(row.type as string) && Array.isArray(row.keys));
        const keys = row.keys as unknown[];
        check(keys.every((key) => key === null || typeof key === "string"));
        const node = record.nodes.node(row.at);
        check(node?.kind === "array" && record.nodes.children(row.at).length === keys.length);
        lists.push({ at: row.at, type: row.type as KeyedList["type"], keys: keys as (string | null)[] });
        break;
      }
      case "declaration":
        check(typeof row.at === "string" && record.nodes.node(row.at) !== undefined && !declarations.has(row.at));
        declarations.set(row.at, readDeclaration(row));
        break;
      case "ref": {
        const { occurrence, position } = readReference(row);
        check(occurrence.form === "typed" && record.nodes.node(occurrence.at)?.kind === "string");
        check(!typed.has(occurrence.at));
        typedReferences.push(occurrence.at);
        typed.set(occurrence.at, occurrence);
        if (position !== undefined) positions.set(position.offset, position);
        break;
      }
      case "issue":
        issues.push(readIssue(row, record.path));
        break;
      default:
        check(false);
    }
  }
  for (const at of typedReferences) {
    const declaration = declarations.get(at);
    check(declaration !== undefined);
    // The members in the order a binding's own occurrence has them, so that both serialize alike.
    const { form, raw, uri, destination } = typed.get(at) as ReferenceOccurrence;
    typed.set(at, Object.freeze({ form, at, raw, uri, declaration, ...(destination === undefined ? {} : { destination }) }));
  }
  const parts: BindingParts = {
    lists,
    typedReferences,
    declarations,
    issues,
    restored: Object.freeze({ typed, positions }),
  };
  return bindingOf(record, schema, parts);
}

/** Compares strings by UTF-16 code units, for an order that does not depend on the locale. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
