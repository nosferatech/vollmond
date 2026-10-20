// The snapshot of a store's last full check, the "previous index": each file's version, and each reference's status and
// targets, kept by the local index under the store's own key.

import type { Reference, ReferenceStatus, ReferenceTarget } from "../reference/reference.js";
import type { ByteRange } from "../text/source-text.js";
import { MAX_ENTRY_BYTES } from "./cache.js";

// Deviation from the I2 design, recorded in issue #26: a reference's row keeps its URI, §14.2's target address, so that a
// check of what changed finds the records that name a changed path although nothing was there at the last full check, where
// the design matched resolved targets only.
/** A reference as the snapshot keeps it: where it is made, what it says, and what it resolved to. */
export interface SnapshotReference {
  readonly from: { readonly path: string; readonly at: string; readonly offset?: number };
  readonly form: Reference["form"];
  readonly raw: string;
  /** The URI reference vmd resolved, which names the path the reference is to, whether or not anything is there. */
  readonly uri: string;
  readonly status: ReferenceStatus;
  readonly targets: readonly SnapshotTarget[];
}

/** A target as the snapshot keeps it: a node or a block anchor of a record, or an asset or a directory, by its path. */
export type SnapshotTarget =
  | { readonly path: string; readonly at: string; readonly range?: ByteRange }
  | { readonly path: string; readonly kind: "asset" | "directory" };

/** The snapshot of a full check. */
export interface Snapshot {
  /**
   * The digest of what the check read beyond the files: the configuration, each collection's schema files, and the alias
   * file's version. A snapshot made with other inputs is not current.
   */
  readonly inputs: string;
  /** Each file the check listed, by path, with its version; null for one the backend could not read. */
  readonly files: ReadonlyMap<string, string | null>;
  /** Every reference of every record checked, in the order of the check. */
  readonly references: readonly SnapshotReference[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Gives a reference as the snapshot keeps it. */
export function snapshotReference(reference: Reference): SnapshotReference {
  const { path, at, offset } = reference.from;
  return {
    from: offset === undefined ? { path, at } : { path, at, offset },
    form: reference.form,
    raw: reference.raw,
    uri: reference.uri,
    status: reference.status,
    targets: reference.targets.map(snapshotTarget),
  };
}

function snapshotTarget(target: ReferenceTarget): SnapshotTarget {
  if ("kind" in target) return { path: target.path, kind: target.kind };
  return target.range === undefined
    ? { path: target.path, at: target.at }
    : { path: target.path, at: target.at, range: { start: target.range.start, end: target.range.end } };
}

/**
 * Writes a snapshot as JSON lines: a header with the inputs, a row per file, a row per reference, and a closing count. Gives
 * null for one that would be larger than `limit` bytes, {@link MAX_ENTRY_BYTES} by default, and stops writing once the rows
 * pass it.
 */
export function snapshotRows(snapshot: Snapshot, limit = MAX_ENTRY_BYTES): Uint8Array | null {
  const lines: string[] = [];
  let units = 0;
  const push = (row: unknown): boolean => {
    const line = JSON.stringify(row);
    // A JSON text has at least as many UTF-8 bytes as UTF-16 code units.
    units += line.length + 1;
    lines.push(line);
    return units <= limit;
  };
  if (!push({ t: "snapshot", inputs: snapshot.inputs })) return null;
  for (const [path, version] of snapshot.files) if (!push({ t: "file", path, version })) return null;
  for (const reference of snapshot.references) if (!push({ t: "ref", ...reference })) return null;
  if (!push({ t: "end", rows: lines.length })) return null;
  const bytes = encoder.encode(`${lines.join("\n")}\n`);
  return bytes.length <= limit ? bytes : null;
}

/**
 * Reads a snapshot written by {@link snapshotRows}, or gives null for bytes that are not a whole one: larger than `limit`,
 * {@link MAX_ENTRY_BYTES} by default, cut short, or with a row or a member that is not what {@link snapshotRows} writes.
 */
export function readSnapshot(bytes: Uint8Array, limit = MAX_ENTRY_BYTES): Snapshot | null {
  if (bytes.length > limit) return null;
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return null;
  }
  if (!text.endsWith("\n")) return null;
  const rows: unknown[] = [];
  try {
    for (const line of text.slice(0, -1).split("\n")) rows.push(JSON.parse(line));
  } catch {
    return null;
  }
  const end = rows.pop();
  const header = rows[0];
  if (!isObject(end) || end.t !== "end" || end.rows !== rows.length || Object.keys(end).length !== 2) return null;
  if (!isObject(header) || header.t !== "snapshot" || typeof header.inputs !== "string") return null;
  const files = new Map<string, string | null>();
  const references: SnapshotReference[] = [];
  for (const row of rows.slice(1)) {
    if (!isObject(row)) return null;
    if (row.t === "file" && typeof row.path === "string" && (row.version === null || typeof row.version === "string")) {
      files.set(row.path, row.version);
      continue;
    }
    const reference = row.t === "ref" ? readReference(row) : null;
    if (reference === null) return null;
    references.push(reference);
  }
  return { inputs: header.inputs, files, references };
}

const STATUSES: ReadonlySet<string> = new Set(["ok", "dangling", "ambiguous", "aliased", "unreadable"]);
const FORMS: ReadonlySet<string> = new Set(["link", "definition", "image", "ref-object", "typed"]);

/** Reads a snapshot's reference row, or gives null for one that is not one. */
function readReference(row: Readonly<Record<string, unknown>>): SnapshotReference | null {
  const from = row.from;
  if (!isObject(from) || typeof from.path !== "string" || typeof from.at !== "string") return null;
  if (from.offset !== undefined && !Number.isSafeInteger(from.offset)) return null;
  if (typeof row.form !== "string" || !FORMS.has(row.form) || typeof row.raw !== "string") return null;
  if (typeof row.uri !== "string") return null;
  if (typeof row.status !== "string" || !STATUSES.has(row.status) || !Array.isArray(row.targets)) return null;
  const targets: SnapshotTarget[] = [];
  for (const target of row.targets) {
    const read = readTarget(target);
    if (read === null) return null;
    targets.push(read);
  }
  return {
    from: {
      path: from.path,
      at: from.at,
      ...(from.offset === undefined ? {} : { offset: from.offset as number }),
    },
    form: row.form as SnapshotReference["form"],
    raw: row.raw,
    uri: row.uri,
    status: row.status as ReferenceStatus,
    targets,
  };
}

/** Reads a snapshot's target, or gives null for one that is not one. */
function readTarget(target: unknown): SnapshotTarget | null {
  if (!isObject(target) || typeof target.path !== "string") return null;
  if ("kind" in target) {
    return target.kind === "asset" || target.kind === "directory" ? { path: target.path, kind: target.kind } : null;
  }
  if (typeof target.at !== "string") return null;
  if (target.range === undefined) return { path: target.path, at: target.at };
  const range = target.range;
  if (!isObject(range) || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return null;
  return { path: target.path, at: target.at, range: { start: range.start as number, end: range.end as number } };
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The statuses whose targets a refs-in count counts: those of a reference that reaches its target. */
const REACHING: ReadonlySet<ReferenceStatus> = new Set(["ok", "aliased"]);

/**
 * Gives the refs-in counts of one record from a snapshot: the number of references, `ok` or `aliased`, that have a target at
 * a node or below it, each reference once per node however many of its targets are there; for a block anchor, those whose
 * target is that block. The root's count is every reference into the record by a node of it.
 */
export function refsInCounts(snapshot: Snapshot, path: string): RefsInCounts {
  const reaching = snapshot.references.filter(
    (reference) => REACHING.has(reference.status) && reference.targets.some((target) => target.path === path),
  );
  const count = (node: TargetNode) =>
    reaching.filter((reference) => reference.targets.some((target) => isTargetIn(target, node))).length;
  return { node: (at) => count({ path, at }), block: (at, range) => count({ path, at, range }) };
}

/** A node of a record, or a block anchor of its `$body` at `at` with its range, that references may have as a target. */
export interface TargetNode {
  readonly path: string;
  readonly at: string;
  readonly range?: ByteRange;
}

/**
 * Whether a reference's target is the node or below it: for a block anchor, the same block; for a node, the node itself or a
 * node or block anchor whose exact path is below it, the record's root holding them all. What the refs-in counts count and
 * what `refs --to` lists, by one rule, so that they cannot drift apart.
 */
export function isTargetIn(target: SnapshotTarget | ReferenceTarget, node: TargetNode): boolean {
  if (target.path !== node.path || !("at" in target)) return false;
  const range = node.range;
  if (range !== undefined) return target.at === node.at && target.range?.start === range.start && target.range?.end === range.end;
  // Every exact path but the root's starts with `/`, so the root holds every node.
  return target.at === node.at || target.at.startsWith(`${node.at}/`);
}

/** The refs-in counts of one record's nodes and block anchors. */
export interface RefsInCounts {
  /** The count of the node at an exact path, the references into nodes below it included. */
  node(at: string): number;
  /** The count of the block anchor of the `$body` at `at` with this range. */
  block(at: string, range: ByteRange): number;
}
