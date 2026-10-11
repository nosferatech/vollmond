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
import { type CheckOptions, type CheckSummary, checkStore } from "../check/check.js";
import { collectionOfRecord, type PathClass, PathClassifier } from "../config/classify.js";
import {
  type Collection,
  MAX_CONFIGURATION_BYTES,
  readStoreConfiguration,
  type StoreConfiguration,
} from "../config/configuration.js";
import { MAX_RECORD_BYTES } from "../format/limits.js";
import { parseRecord, recordTooLarge } from "../format/parse-record.js";
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
import type { CountedPage, FileInfo, GrepMatch, GrepQuery, OversizedFile, StorageReader } from "../storage/storage.js";
import type { ByteRange } from "../text/source-text.js";
import type { Value, ValueObject } from "../value/value.js";

/** The store's configuration file, relative to its root. */
const CONFIGURATION_PATH = ".vmd/config.yaml";

/** The directory of the store's own configuration's schemas, relative to its root. */
const SCHEMA_DIRECTORY = ".vmd/schema";

/** The largest schema file, in bytes, that vmd reads: a mebibyte, as for the configuration. */
export const MAX_SCHEMA_BYTES = 1024 * 1024;

/**
 * Where a store's configuration comes from: the configuration file's bytes, and the schema directory beside it, from which
 * the collections' schemas are read.
 */
export interface ConfigurationSource {
  /** The configuration file's bytes. */
  readonly content: Uint8Array;
  /** The configuration file as messages name it: `.vmd/config.yaml`, or the path a caller was given. */
  readonly name: string;
  /**
   * Reads a file of the schema directory by its path relative to that directory, which has no `.` or `..` segment. Fails with
   * `address-not-found` when there is none, whose hint the store passes on, and with another issue when it cannot be read. A
   * source may stop reading after one byte more than {@link MAX_SCHEMA_BYTES}, or give a larger file as an `OversizedFile`
   * without reading it, since a longer file is refused whatever it holds.
   */
  readSchema(path: string): Promise<Outcome<Uint8Array | OversizedFile>>;
}

/** A file a store lists: a record or an asset, with what the backend says of it. */
export interface StoreEntry extends FileInfo {
  readonly kind: "record" | "asset";
  /**
   * For a record, whether it could be read: false for one with a structural error, one the backend could not read, and one of
   * a collection whose schema cannot be used.
   */
  readonly readable?: boolean;
  /** For a record of a collection, the collection's name; absent for a record that no collection, or several, claim. */
  readonly collection?: string;
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
  /** Gives what a store path is under the configuration: ignored, an asset, or a record with the collections that claim it. */
  classify(path: string): PathClass;
  /**
   * Reads and parses the record at a store path, once: the record, or its structural errors; a failure with `storage-failed`
   * when the backend cannot read it; a failure with the issue of its collection's schema when that schema cannot be used,
   * since without it the record would be read wrongly; or null when the store holds no record there, for a missing file, an
   * asset or an ignored path.
   */
  record(path: string): Promise<Outcome<ParsedRecord> | null>;
  /** Gives what {@link Store.record} read at a path, without reading: undefined when it was not read. */
  recordRead(path: string): Outcome<ParsedRecord> | null | undefined;
  /** Resolves an address, reading its record with {@link Store.record}. */
  resolve(address: string, use: AddressUse, reading?: AddressReading): Promise<Outcome<StoreResolution>>;
  /**
   * Reads the node a singular address names, in the requested form, with the requested computed fields. Fails as resolving
   * does, and with `usage-invalid` for the body form of a node that is neither a section, a `$body` nor a block anchor, since
   * the address is fine and the form does not apply. A section without a `$body` gives the empty string. `@collection` is the
   * name of the record's collection, absent for a record that no collection, or several, claim; `@issues` has the severities
   * the configuration gives. Requested fields that are not computed yet ({@link NOT_COMPUTED_FIELDS}) are given as `null`,
   * with one warning `field-not-computed` that names them.
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
   * counted either. Each record on the page is read, to count those that cannot be; the records of other pages are not. A
   * record refused for its collection's schema is counted, and the schema's issue is reported once. Fails as the backend's
   * `list` does.
   */
  list(query: StoreListQuery): Promise<Outcome<StorePage>>;
  /** Searches the text of the store's records and assets as the backend's `grep` does, leaving out the paths vmd ignores. */
  grep(query: Omit<GrepQuery, "exclude">): Promise<Outcome<CountedPage<GrepMatch>>>;
  /**
   * Checks the store, or some of its records, and gives the issues found as the outcome's issues, with the severities the
   * configuration gives them (see `checkStore`). A record of a collection whose schema cannot be used is checked for
   * everything else. Fails as the backend's `list` does.
   */
  check(options?: CheckOptions): Promise<Outcome<CheckSummary>>;
}

/**
 * Opens a store over a backend: reads its configuration, from `configuration` when given and otherwise from the backend's
 * `.vmd/config.yaml`, with the schemas in `.vmd/schema/`. Those are read as any other file of the store, so the backend's
 * rules apply to them: the local filesystem's refuses a path reached through a symbolic link. A configuration file larger
 * than `MAX_CONFIGURATION_BYTES` is refused by its size before it is read. Fails with that reading's issues, with
 * `config-invalid` when the backend has no configuration file or a larger one, or with the backend's `storage-failed`. The
 * configuration's warnings are the outcome's issues. Schemas are read when a record of their collection is first read or
 * checked, not here.
 */
export async function openStore(
  backend: StorageReader,
  options: { readonly configuration?: ConfigurationSource } = {},
): Promise<Outcome<Store>> {
  let source = options.configuration;
  if (source === undefined) {
    const file = await backend.read(CONFIGURATION_PATH, { maxBytes: MAX_CONFIGURATION_BYTES });
    if (!file.ok) {
      if (file.issues.some((issue) => issue.code !== "address-not-found")) return fail(file.issues);
      return fail([
        makeIssue({
          code: "config-invalid",
          path: null,
          at: null,
          message: `the store has no ${CONFIGURATION_PATH}`,
          hint: "the configuration must be a file of the store: a backend may refuse one reached through a symbolic link",
        }),
      ]);
    }
    const read = file.value;
    if ("oversized" in read) {
      return fail([
        makeIssue({
          code: "config-invalid",
          path: null,
          at: null,
          message: `the configuration is larger than ${MAX_CONFIGURATION_BYTES} bytes`,
        }),
      ]);
    }
    source = storeConfigurationSource(backend, read.content);
  }
  const configuration = readStoreConfiguration(source.content);
  if (!configuration.ok) return configuration;
  return succeed(new BackendStore(backend, configuration.value, source), configuration.issues);
}

/**
 * Gives the configuration source of a configuration file kept in a store's `.vmd/`, whose schemas are files of the store in
 * `.vmd/schema/`, read through the backend as any file of the store is, so that the backend's rules apply to them. A schema
 * larger than {@link MAX_SCHEMA_BYTES} is refused by its size before it is read. A schema that the backend finds no file for
 * fails with `address-not-found`, whose hint says that a backend may refuse a path reached through a symbolic link, unless
 * files lie below its path, which makes it a directory: that fails with `storage-failed`, since the file is there but cannot
 * be read as one. A backend that cannot read the file fails with its own issue.
 */
export function storeConfigurationSource(
  backend: StorageReader,
  content: Uint8Array,
  name: string = CONFIGURATION_PATH,
): ConfigurationSource {
  return {
    content,
    name,
    readSchema: async (path) => {
      const stored = `${SCHEMA_DIRECTORY}/${path}`;
      const file = await backend.read(stored, { maxBytes: MAX_SCHEMA_BYTES });
      if (file.ok) return succeed("oversized" in file.value ? file.value : file.value.content);
      if (!file.issues.every((issue) => issue.code === "address-not-found")) return fail(file.issues);
      const below = await backend.list({ prefix: `${stored}/`, limit: 1 });
      if (!below.ok || below.value.items.length === 0) {
        return fail([
          makeIssue({
            code: "address-not-found",
            path: null,
            at: null,
            message: `${stored} does not exist`,
            hint: "a schema must be a regular file of the store: a backend may refuse one reached through a symbolic link",
          }),
        ]);
      }
      return fail([makeIssue({ code: "storage-failed", path: null, at: null, message: `${stored} is a directory, not a file` })]);
    },
  };
}

class BackendStore implements Store {
  readonly backend: StorageReader;
  readonly configuration: StoreConfiguration;
  readonly classifier: PathClassifier;
  readonly #source: ConfigurationSource;
  /** The records read, by path: the read under way, so that two reads of one path at once share it. */
  readonly #reads = new Map<string, Promise<Outcome<ParsedRecord> | null>>();
  /** The records read, by path, once each read has ended. */
  readonly #read = new Map<string, Outcome<ParsedRecord> | null>();
  /** The parses of records, whatever their collections' schemas, by path. */
  readonly #parses = new Map<string, Promise<Outcome<ParsedRecord>>>();
  /** The issue of each collection's schema, null for one that can be used, as it is first looked at. */
  readonly #schemaIssues = new Map<Collection, Promise<Issue | null>>();

  constructor(backend: StorageReader, configuration: StoreConfiguration, source: ConfigurationSource) {
    this.backend = backend;
    this.configuration = configuration;
    this.classifier = new PathClassifier(configuration);
    this.#source = source;
  }

  classify(path: string): PathClass {
    return this.classifier.classify(path);
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

  // Deviation from the I2 design, recorded in issue #21: every read of a record of a collection with a schema reads the schema
  // first, `ls` included, so that a reader refuses the record when its schema cannot be used, as the specification now says.
  /** Reads a record for a reader: null where the store holds none, the schema's issue for a refused one, or its parse. */
  async #readRecord(path: string): Promise<Outcome<ParsedRecord> | null> {
    const found = this.classify(path);
    if (found.kind !== "record") return null;
    const collection = collectionOfRecord(found);
    if (collection !== undefined) {
      const schemaIssue = await this.schemaIssue(collection);
      if (schemaIssue !== null) {
        const stat = await this.backend.stat(path);
        if (!stat.ok && stat.issues.every((issue) => issue.code === "address-not-found")) return null;
        return fail([schemaIssue]);
      }
    }
    const parsed = await this.parse(path);
    return !parsed.ok && parsed.issues.every((issue) => issue.code === "address-not-found") ? null : parsed;
  }

  parse(path: string): Promise<Outcome<ParsedRecord>> {
    let parsing = this.#parses.get(path);
    if (parsing === undefined) {
      parsing = this.backend.read(path, { maxBytes: MAX_RECORD_BYTES }).then((file) => {
        if (!file.ok) return fail(file.issues);
        return "oversized" in file.value ? fail([recordTooLarge(path)]) : parseRecord(path, file.value.content);
      });
      this.#parses.set(path, parsing);
    }
    return parsing;
  }

  schemaIssue(collection: Collection): Promise<Issue | null> {
    let issue = this.#schemaIssues.get(collection);
    if (issue === undefined) {
      issue = this.#readSchemaIssue(collection);
      this.#schemaIssues.set(collection, issue);
    }
    return issue;
  }

  // TODO(#22): the schema is only read and its size checked; compiling it, and validating the records, come with schemas.
  /** Reads a collection's schema file, and gives the issue that makes it unusable, or null when it can be used. */
  async #readSchemaIssue(collection: Collection): Promise<Issue | null> {
    const path = collection.schema;
    if (path === undefined) return null;
    const read = await this.#source.readSchema(path);
    let problem: string | null = null;
    // A file that is there and cannot be read is the storage's failure; a missing or oversized one is the schema's.
    let code: "schema-invalid" | "storage-failed" = "schema-invalid";
    let sourceHint: string | undefined;
    if (!read.ok) {
      if (read.issues.every((issue) => issue.code === "address-not-found")) {
        problem = "does not exist";
        sourceHint = read.issues.find((issue) => issue.hint !== undefined)?.hint;
      } else {
        code = "storage-failed";
        problem = `cannot be read: ${read.issues.map((issue) => issue.message).join("; ")}`;
      }
    } else if ("oversized" in read.value || read.value.length > MAX_SCHEMA_BYTES) {
      problem = `is larger than ${MAX_SCHEMA_BYTES} bytes`;
    }
    if (problem === null) return null;
    return makeIssue({
      code,
      path: null,
      at: null,
      message: `the schema ${path} of the collection ${collection.name} ${problem}, so the collection's records cannot be read`,
      hint: `schemas are in the schema/ directory beside ${this.#source.name}${sourceHint === undefined ? "" : `; ${sourceHint}`}`,
    });
  }

  check(options?: CheckOptions): Promise<Outcome<CheckSummary>> {
    return checkStore(this, options);
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
    const collection = collectionOfRecord(this.classify(record.path));
    const meta = await computeFields(record, target, options.meta, {
      severities: this.configuration,
      ...(collection === undefined ? {} : { collection: collection.name }),
    });
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
      exclude: this.classifier.ignoredGlobs,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    if (!listed.ok) return fail(listed.issues);
    const issues: Issue[] = [...listed.issues];
    // A record the backend could not read is left out of the page, and is still a record this page could not read.
    let unreadable = listed.issues.filter(
      (issue) => issue.code === "storage-failed" && issue.path !== null && this.classify(issue.path).kind === "record",
    ).length;
    const items: StoreEntry[] = [];
    for (const file of listed.value.items) {
      const found = this.classify(file.path);
      if (found.kind !== "record") {
        items.push({ ...file, kind: "asset" });
        continue;
      }
      const read = await this.record(file.path);
      const readable = read?.ok === true;
      if (!readable) unreadable += 1;
      // A structural error is counted, not reported: it is the record's, and `get` reports it. A failed read is the listing's,
      // and so is a schema that cannot be used, reported once however many of its records the page holds.
      if (read !== null && !read.ok) {
        for (const issue of read.issues) {
          if (issue.path === null ? !issues.includes(issue) : issue.code === "storage-failed") issues.push(issue);
        }
      }
      const collection = collectionOfRecord(found);
      items.push({ ...file, kind: "record", readable, ...(collection === undefined ? {} : { collection: collection.name }) });
    }
    const { cursor, remaining } = listed.value;
    return succeed({ items, cursor, remaining, unreadable: { count: unreadable, scope: "page" } }, issues);
  }

  grep(query: Omit<GrepQuery, "exclude">): Promise<Outcome<CountedPage<GrepMatch>>> {
    return this.backend.grep({ ...query, exclude: this.classifier.ignoredGlobs });
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
