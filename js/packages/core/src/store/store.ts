import type { AddressReading } from "../address/address.js";
import {
  type AddressUse,
  blockAnchorAddress,
  canonicalAddress,
  resolveStoreAddress,
  type StoreResolution,
  type Target,
} from "../address/resolve.js";
import type { BlockAnchorEntry } from "../anchor/anchor-table.js";
import { parseRecord } from "../format/parse-record.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import {
  COMPUTED_FIELD_NAMES,
  type ComputedFieldName,
  type ComputedFields,
  computeFields,
  NOT_COMPUTED_FIELDS,
} from "../meta/computed-fields.js";
import type { NodeInfo } from "../record/node-index.js";
import { blockText, valueAt } from "../record/node-value.js";
import type { ParsedRecord } from "../record/record.js";
import type { CountedPage, FileInfo, GrepMatch, GrepQuery, StorageReader } from "../storage/storage.js";
import type { ByteRange } from "../text/source-text.js";
import type { Value, ValueObject } from "../value/value.js";
import { readStoreConfiguration, type StoreConfiguration } from "./configuration.js";
import { IGNORED_PATH_GLOBS, storePathKind } from "./store-path.js";

/** The store's configuration file, relative to its root. */
const CONFIGURATION_PATH = ".vmd/config.yaml";

/** A file a store lists: a record or an asset, with what the backend says of it. */
export interface StoreEntry extends FileInfo {
  readonly kind: "record" | "asset";
  /** For a record, whether it could be read: false for one with a structural error, or one the backend could not read. */
  readonly readable?: boolean;
}

/** How many records a listing could not read, and what it counted them in. */
export interface UnreadableCount {
  readonly count: number;
  /** `page`: only the records on the page were read, so records elsewhere in the store are not counted. */
  readonly scope: "page";
}

/** A page of a store's records and assets, with the records on it that could not be read counted. */
export interface StorePage extends CountedPage<StoreEntry> {
  readonly unreadable: UnreadableCount;
}

/** The query of {@link Store.list}: the backend's, without the prefix and the paths to leave out, which the store sets. */
export interface StoreListQuery {
  /** Lists only the paths this glob matches, as a whole. */
  readonly glob?: string;
  /** The largest number of entries on the page, at least 1. */
  readonly limit: number;
  readonly cursor?: string;
}

/** The forms in which {@link Store.get} gives a node. */
export type NodeForm = "value" | "source" | "body";

/** What {@link Store.get} reads, beyond the address. */
export interface GetOptions {
  /**
   * The form: `value`, the node's value view (the default); `source`, its bytes in the file as text; or `body`, a section's
   * `$body`. A block anchor's value and body are its text.
   */
  readonly form?: NodeForm;
  /** The computed fields to give with the node: names, or `all` for every field but `@nodes`. */
  readonly meta?: readonly ComputedFieldName[] | "all";
  /** How the address is read: `raw` takes characters outside a fragment's as themselves, as the command line does. */
  readonly reading?: AddressReading;
}

/** A node as {@link Store.get} gives it: in the requested form, with the requested computed fields. */
export interface GetResult {
  /** The node in the requested form: its value view, its source text, or its `$body`. */
  readonly value: Value;
  /** The requested computed fields, when any were requested. */
  readonly meta?: ComputedFields;
}

/**
 * A node or a block anchor as an outline lists it: where it is, what it is called, and how large it is, without its content.
 */
export interface OutlineEntry {
  /** The node's exact path; for a block anchor, of its `$body`. */
  readonly at: string;
  /** The node's canonical address, as a fragment with its `#`, or `""` for the root; a block anchor's own. */
  readonly address: string;
  /** A section's key, or a member's name; absent for the root, a block anchor and an array item. */
  readonly key?: string;
  /** A section's `$title`, when it has one. */
  readonly title?: string;
  /** A section's depth, 0 for the root; absent for other nodes. */
  readonly depth?: number;
  /** The size of the node's source in the file, in bytes; for a block anchor, of its block. */
  readonly size: number;
  /**
   * For a block anchor, its block's range in the `$body`'s value, as `@range` gives it. It tells apart two blocks whose name
   * is not unique, since their canonical address is then the `$body`'s.
   */
  readonly range?: ByteRange;
  /**
   * For a section, the block anchors of its own `$body`, and for a `$body`, its block anchors, in document order, when the
   * outline goes down to them: they are one level below the section or the `$body`. Absent for other nodes, and for a
   * section or a `$body` at the outline's last level.
   */
  readonly blocks?: readonly OutlineEntry[];
}

/** The outline of a node: the node itself, the sections below it, and a data record's members. */
export interface Outline {
  /** The record's store path. */
  readonly path: string;
  readonly node: OutlineEntry;
  /** The sections below the node, at any depth up to the requested one, in document order. */
  readonly sections: readonly OutlineEntry[];
  /**
   * For the root of a JSON or YAML record, its top-level members but `$sections`, whose sections are listed in `sections`,
   * in document order, when the outline goes down one level; absent for any other node and for a Markdown record.
   */
  readonly members?: readonly OutlineEntry[];
}

/**
 * A store as one operation reads it: its configuration, and its records over a backend. Each record is read and parsed once
 * for the store's lifetime, however many reads need it, so a store is meant for one operation: a record changed in the backend
 * after it was read is not read again.
 */
export interface Store {
  readonly backend: StorageReader;
  readonly configuration: StoreConfiguration;
  /**
   * Reads and parses the record at a store path, once: the record, or its structural errors; a failure with `storage-failed`
   * when the backend cannot read it; or null when the store holds no record there, for a missing file, an asset or an ignored
   * path.
   */
  record(path: string): Promise<Outcome<ParsedRecord> | null>;
  /** Gives what {@link Store.record} read at a path, without reading: undefined when it was not read. */
  recordRead(path: string): Outcome<ParsedRecord> | null | undefined;
  /** Resolves an address, reading its record with {@link Store.record}. */
  resolve(address: string, use: AddressUse, reading?: AddressReading): Promise<Outcome<StoreResolution>>;
  /**
   * Reads the node a singular address names, in the requested form, with the requested computed fields. Fails as resolving
   * does, and with `usage-invalid` for the body form of a node that is neither a section, a `$body` nor a block anchor, since
   * the address is fine and the form does not apply. A section without a `$body` gives the empty string.
   * Requested fields that are not computed yet ({@link NOT_COMPUTED_FIELDS}) are given as `null`, with one warning
   * `field-not-computed` that names them.
   */
  get(address: string, options?: GetOptions): Promise<Outcome<GetResult>>;
  /**
   * Outlines the node a singular address names: the node, and each section below it whose depth below the node is at most
   * `depth`, every one when `depth` is absent; each section's block anchors, which are one level below it; and for the root of
   * a JSON or YAML record, its top-level members, one level below it. `depth` bounds them all alike, so that nothing is listed
   * more than `depth` levels below the node. A node that is not a section has no sections below it. Fails as resolving does.
   *
   * Throws a `RangeError` for a `depth` that is not an integer of at least 0.
   */
  outline(address: string, options?: { readonly depth?: number; readonly reading?: AddressReading }): Promise<Outcome<Outline>>;
  /**
   * Lists the store's records and assets in UTF-8 byte order of their paths, leaving out the paths vmd ignores, which are not
   * counted either. Each record on the page is read, to count those that cannot be; the records of other pages are not. Fails
   * as the backend's `list` does.
   */
  list(query: StoreListQuery): Promise<Outcome<StorePage>>;
  /** Searches the text of the store's records and assets as the backend's `grep` does, leaving out the paths vmd ignores. */
  grep(query: Omit<GrepQuery, "exclude">): Promise<Outcome<CountedPage<GrepMatch>>>;
}

/**
 * Opens a store over a backend: reads its configuration, `config` when given and the backend's `.vmd/config.yaml` otherwise,
 * and fails with that reading's issues, with `config-invalid` when the backend has no configuration file, or with the
 * backend's `storage-failed`. The configuration's warnings are the outcome's issues.
 */
export async function openStore(backend: StorageReader, options: { readonly config?: Uint8Array } = {}): Promise<Outcome<Store>> {
  let content = options.config;
  if (content === undefined) {
    const file = await backend.read(CONFIGURATION_PATH);
    if (!file.ok) {
      if (file.issues.some((issue) => issue.code !== "address-not-found")) return fail(file.issues);
      return fail([
        makeIssue({ code: "config-invalid", path: null, at: null, message: `the store has no ${CONFIGURATION_PATH}` }),
      ]);
    }
    content = file.value.content;
  }
  const configuration = readStoreConfiguration(content);
  if (!configuration.ok) return configuration;
  return succeed(new BackendStore(backend, configuration.value), configuration.issues);
}

class BackendStore implements Store {
  readonly backend: StorageReader;
  readonly configuration: StoreConfiguration;
  /** The records read, by path: the read under way, so that two reads of one path at once share it. */
  readonly #reads = new Map<string, Promise<Outcome<ParsedRecord> | null>>();
  /** The records read, by path, once each read has ended. */
  readonly #read = new Map<string, Outcome<ParsedRecord> | null>();

  constructor(backend: StorageReader, configuration: StoreConfiguration) {
    this.backend = backend;
    this.configuration = configuration;
  }

  record(path: string): Promise<Outcome<ParsedRecord> | null> {
    let reading = this.#reads.get(path);
    if (reading === undefined) {
      reading = this.#readRecord(path).then((outcome) => {
        this.#read.set(path, outcome);
        return outcome;
      });
      this.#reads.set(path, reading);
    }
    return reading;
  }

  recordRead(path: string): Outcome<ParsedRecord> | null | undefined {
    return this.#read.get(path);
  }

  async #readRecord(path: string): Promise<Outcome<ParsedRecord> | null> {
    if (storePathKind(path) !== "record") return null;
    const file = await this.backend.read(path);
    if (!file.ok) return file.issues.every((issue) => issue.code === "address-not-found") ? null : fail(file.issues);
    return parseRecord(path, file.value.content);
  }

  resolve(address: string, use: AddressUse, reading?: AddressReading): Promise<Outcome<StoreResolution>> {
    return resolveStoreAddress((path) => this.record(path), address, use, reading);
  }

  async get(address: string, options: GetOptions = {}): Promise<Outcome<GetResult>> {
    const resolved = await this.resolve(address, "singular", options.reading);
    if (!resolved.ok) return fail(resolved.issues);
    const { record, targets } = resolved.value;
    const target = targets[0] as Target;
    const value = formOf(record, target, options.form ?? "value");
    if (!value.ok) return fail(value.issues);
    if (options.meta === undefined) return succeed({ value: value.value });
    const meta = await computeFields(record, target, options.meta);
    const requested: readonly ComputedFieldName[] = options.meta === "all" ? COMPUTED_FIELD_NAMES : options.meta;
    const pending = NOT_COMPUTED_FIELDS.filter((name) => requested.includes(name));
    return succeed({ value: value.value, meta }, pending.length === 0 ? [] : [notComputedWarning(pending)]);
  }

  async outline(
    address: string,
    options: { readonly depth?: number; readonly reading?: AddressReading } = {},
  ): Promise<Outcome<Outline>> {
    const depth = options.depth;
    if (depth !== undefined && (!Number.isSafeInteger(depth) || depth < 0)) {
      throw new RangeError("depth must be an integer of at least 0");
    }
    const resolved = await this.resolve(address, "singular", options.reading);
    if (!resolved.ok) return fail(resolved.issues);
    const { record, targets } = resolved.value;
    const target = targets[0] as Target;
    const block = blockAnchorOf(record, target);
    const node = record.nodes.node(target.at) as NodeInfo;
    if (block !== undefined) {
      return succeed({ path: record.path, node: blockEntry(record, block), sections: [] });
    }
    // Whether the outline goes down to `levels` below the node.
    const reaches = (levels: number) => depth === undefined || levels <= depth;
    const sections =
      node.kind !== "section"
        ? []
        : record.nodes
            .sections()
            .filter((section) => section.at.startsWith(`${node.at}/`))
            .filter((section) => reaches(section.depth - node.depth))
            .map((section) => outlineEntry(record, section, reaches(section.depth - node.depth + 1)));
    const outline: Outline = { path: record.path, node: outlineEntry(record, node, reaches(1)), sections };
    if (node.at !== "" || record.format === "md" || !reaches(1)) return succeed(outline);
    const members = record.nodes
      .children("")
      .filter((member) => member.key !== "$sections")
      .map((member) => outlineEntry(record, member, false));
    return succeed({ ...outline, members });
  }

  async list(query: StoreListQuery): Promise<Outcome<StorePage>> {
    const listed = await this.backend.list({
      prefix: "",
      ...(query.glob === undefined ? {} : { glob: query.glob }),
      exclude: IGNORED_PATH_GLOBS,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    if (!listed.ok) return fail(listed.issues);
    const issues: Issue[] = [...listed.issues];
    // A record the backend could not read is left out of the page, and is still a record this page could not read.
    let unreadable = listed.issues.filter(
      (issue) => issue.code === "storage-failed" && issue.path !== null && storePathKind(issue.path) === "record",
    ).length;
    const items: StoreEntry[] = [];
    for (const file of listed.value.items) {
      if (storePathKind(file.path) !== "record") {
        items.push({ ...file, kind: "asset" });
        continue;
      }
      const read = await this.record(file.path);
      const readable = read?.ok === true;
      if (!readable) unreadable += 1;
      // A structural error is counted, not reported: it is the record's, and `get` reports it. A failed read is the listing's.
      if (read !== null && !read.ok) issues.push(...read.issues.filter((issue) => issue.code === "storage-failed"));
      items.push({ ...file, kind: "record", readable });
    }
    const { cursor, remaining } = listed.value;
    return succeed({ items, cursor, remaining, unreadable: { count: unreadable, scope: "page" } }, issues);
  }

  grep(query: Omit<GrepQuery, "exclude">): Promise<Outcome<CountedPage<GrepMatch>>> {
    return this.backend.grep({ ...query, exclude: IGNORED_PATH_GLOBS });
  }
}

/** Gives a resolved node in a form, or fails with `usage-invalid` for a body the node does not have. */
function formOf(record: ParsedRecord, target: Target, form: NodeForm): Outcome<Value> {
  const block = blockAnchorOf(record, target);
  const node = record.nodes.node(target.at) as NodeInfo;
  if (form === "source") {
    const range = block === undefined ? node.range : block.fileRange;
    return succeed(record.source.text.slice(record.source.utf16Index(range.start), record.source.utf16Index(range.end)));
  }
  if (block !== undefined) return succeed(blockText(record, block));
  const value = valueAt(record, node.at);
  if (form === "value") return succeed(value);
  if (node.kind === "section") return succeed(((value as ValueObject).$body as string | undefined) ?? "");
  if (node.key === "$body" && record.nodes.node(node.parent as string)?.kind === "section") return succeed(value);
  const shown = `${record.path}${target.address}`;
  return fail([
    makeIssue({
      code: "usage-invalid",
      path: record.path,
      at: null,
      message: `${shown} is not a section, so it has no $body`,
      hint: "--body reads a section, a $body or a block anchor; read this node without it",
    }),
  ]);
}

/** The warning for requested computed fields that are not computed yet, which a read gives as `null`. */
function notComputedWarning(names: readonly ComputedFieldName[]): Issue {
  const one = names.length === 1;
  const listed = one ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return makeIssue({
    code: "field-not-computed",
    path: null,
    at: null,
    message: `${listed} ${one ? "is" : "are"} not computed yet, so ${one ? "it is" : "they are"} given as null`,
  });
}

/** Finds the block anchor a target names, or undefined for a target that is a node. */
function blockAnchorOf(record: ParsedRecord, target: Target): BlockAnchorEntry | undefined {
  const range = target.range;
  if (range === undefined) return undefined;
  return record.anchors.anchors.find(
    (entry): entry is BlockAnchorEntry =>
      entry.kind === "block" && entry.at === target.at && entry.range.start === range.start && entry.range.end === range.end,
  );
}

/**
 * Gives the outline entry of a node: for a member, with its name; for a section or a `$body`, with its block anchors when
 * `withBlocks`.
 */
function outlineEntry(record: ParsedRecord, node: NodeInfo, withBlocks: boolean): OutlineEntry {
  const base = { at: node.at, address: canonicalAddress(record, node.at), size: sizeOf(node.range) };
  if (node.kind !== "section") {
    const member = typeof node.key === "string" ? { ...base, key: node.key } : base;
    return withBlocks && node.key === "$body" ? { ...member, blocks: blocksOf(record, node.at) } : member;
  }
  const key = record.sectionKeys.get(node.at);
  const title = (valueAt(record, node.at) as ValueObject).$title;
  const section: OutlineEntry = {
    ...base,
    ...(key === undefined ? {} : { key }),
    ...(typeof title === "string" ? { title } : {}),
    depth: node.depth,
  };
  return withBlocks ? { ...section, blocks: blocksOf(record, `${node.at}/$body`) } : section;
}

/** Gives the outline entries of the block anchors of the `$body` at an exact path, in document order. */
function blocksOf(record: ParsedRecord, body: string): OutlineEntry[] {
  return record.anchors.anchors
    .filter((entry): entry is BlockAnchorEntry => entry.kind === "block" && entry.at === body)
    .map((entry) => blockEntry(record, entry));
}

/** Gives the outline entry of a block anchor: its `$body`, its canonical address, its block's size and its range. */
function blockEntry(record: ParsedRecord, entry: BlockAnchorEntry): OutlineEntry {
  return {
    at: entry.at,
    address: blockAnchorAddress(record, entry),
    size: sizeOf(entry.fileRange),
    range: entry.range,
  };
}

/** The number of bytes in a range. */
function sizeOf(range: ByteRange): number {
  return range.end - range.start;
}
