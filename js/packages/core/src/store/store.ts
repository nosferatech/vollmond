import type { AddressReading } from "../address/address.js";
import {
  type AddressUse,
  blockAnchorAddress,
  canonicalAddress,
  type ParsedSubject,
  type ResolutionSubject,
  resolveStoreAddress,
  type StoreResolution,
  subjectRecord,
  type Target,
} from "../address/resolve.js";
import type { BlockAnchorEntry } from "../anchor/anchor-table.js";
import { bindRecord, bindStructure, type RecordBinding } from "../binding/binding.js";
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
import { entryBound, type IndexCache, MAX_ENTRY_BYTES, SNAPSHOT_KEY } from "../index/cache.js";
import { bindingEntry, bindingEntryKey, parseEntry, parseEntryKey, restoreBinding, restoreStructure } from "../index/entries.js";
import {
  type RefsInCounts,
  readSnapshot,
  refsInCounts,
  type Snapshot,
  snapshotReference,
  snapshotRows,
} from "../index/snapshot.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { isDeclaredDuplicate } from "../issue/severity.js";
import { type ComputedFieldName, type ComputedFields, computeFields } from "../meta/computed-fields.js";
import type { NodeInfo } from "../record/node-index.js";
import { blockText, valueAt } from "../record/node-value.js";
import { type ParsedRecord, type RecordStructure, recordFormatOf } from "../record/record.js";
import { ALIASES_PATH, aliasFileTooLarge, MAX_ALIAS_FILE_BYTES, NO_ALIASES, readAliases } from "../reference/aliases.js";
import type { Reference } from "../reference/reference.js";
import { ReferenceResolver } from "../reference/resolve.js";
import { type CollectionSchema, loadCollectionSchema } from "../schema/collection-schema.js";
import { MAX_SCHEMA_BYTES } from "../schema/schema-set.js";
import { storageFailureReason } from "../storage/failure-reason.js";
import { listEveryFile } from "../storage/list-every-file.js";
import { compareUtf8 } from "../storage/path.js";
import type { CountedPage, FileInfo, GrepMatch, GrepQuery, OversizedFile, StorageReader } from "../storage/storage.js";
import type { ByteRange } from "../text/source-text.js";
import type { Value, ValueObject } from "../value/value.js";
import { filenameMismatch } from "./path-rules.js";

/** The store's configuration file, relative to its root. */
const CONFIGURATION_PATH = ".vmd/config.yaml";

/** How many paths a page of the listing that the reference resolver reads holds. */
const REFERENCE_LIST_PAGE = 1000;

/** The directory of the store's own configuration's schemas, relative to its root. */
const SCHEMA_DIRECTORY = ".vmd/schema";

export { MAX_SCHEMA_BYTES };

/**
 * Where a store's configuration comes from: the configuration file's bytes, and the schema directory beside it, from which
 * the collections' schemas are read.
 */
export interface ConfigurationSource {
  /** The configuration file's bytes. */
  readonly content: Uint8Array;
  /**
   * The schema directory as messages name it, ending in a separator: `.vmd/schema/` for a store's own configuration, or the
   * `schema/` directory beside a configuration file a caller was given, such as `examples/schema/`.
   */
  readonly schemaDirectory: string;
  /**
   * Reads a file of the schema directory by its path relative to that directory, which has no `.` or `..` segment. Fails with
   * `address-not-found` when there is none, whose hint the store passes on, and with another issue when it cannot be read,
   * whose message says why, such as `EACCES`, without naming the file, which the store's message about the schema names. A
   * source may stop reading after one byte more than {@link MAX_SCHEMA_BYTES}, or give a larger file as an `OversizedFile`
   * without reading it, since a longer file is refused whatever it holds.
   */
  readSchema(path: string): Promise<Outcome<Uint8Array | OversizedFile>>;
}

/**
 * How a store's readers treat a record that does not validate. `best-effort` reads every record without a structural error;
 * `strict` also refuses one whose data breaks its collection's schema: a `schema-violation`, a `duplicate-key` at a level the
 * schema declares `type: map`, or a `filename-mismatch`.
 */
export type ReadMode = "best-effort" | "strict";

/** A file a store lists: a record or an asset, with what the backend says of it. */
export interface StoreEntry extends FileInfo {
  readonly kind: "record" | "asset";
  /**
   * For a record, whether it could be read: false for one with a structural error, one the backend could not read, one of a
   * collection whose schema cannot be used, and, in the strict read mode, one the mode refuses.
   */
  readonly readable?: boolean;
  /** For a record of a collection, the collection's name; absent for a record that no collection, or several, claim. */
  readonly collection?: string;
}

/** How many records a listing could not read, and what it counted them in. */
export interface UnreadableCount {
  readonly count: number;
  /**
   * `page`: only the records on the page were read, so records elsewhere in the store are not counted; `store`: every record
   * the listing's glob matches, on every page, as a store over the local index counts them.
   */
  readonly scope: "page" | "store";
}

/** A page of a store's records and assets, with the records on it that could not be read counted. */
export interface StorePage extends CountedPage<StoreEntry> {
  readonly unreadable: UnreadableCount;
}

// Deviation from the I2 design, recorded in issue #24: references are queried by where they are made (`from`) only; the
// references into a node (`to`) come with the commands and counts that need them.
/** What {@link Store.references} gives the references of. */
export interface ReferencesQuery {
  /** The references made in the node this singular address names and below it; every record's when absent. */
  readonly from?: string;
  /** How `from` is read: `raw` takes characters outside a fragment's as themselves, as the command line does. */
  readonly reading?: AddressReading;
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
   * The references into the node or the block anchor, those into nodes below it included, `ok` or `aliased`, each once, as
   * the store's last full check resolved them: given when the store is over the local index and the snapshot of that check is
   * current, the store unchanged since; absent otherwise.
   */
  readonly refsIn?: number;
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
   * How the store's readers treat a record that does not validate: what {@link Store.resolve}, and the reads made through it,
   * refuse, and what {@link Store.list} and {@link Store.references} count or report. References' statuses and
   * {@link Store.check} do not depend on it.
   */
  readonly readMode: ReadMode;
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
  /**
   * Reads a record as {@link Store.record} does and binds it to its collection's schema, once: its keyed lists, its shapes
   * and its issues, the schema's included. A record that no collection, or several, claim, or whose collection has no
   * schema, is bound without one. Fails, or gives null, as {@link Store.record} does, in either read mode: references and
   * checks share it.
   */
  binding(path: string): Promise<Outcome<RecordBinding<ParsedRecord>> | null>;
  /**
   * Resolves an address in the record's binding, read with {@link Store.binding}, and fails as that read does. In the strict
   * read mode, also fails with the issues the mode refuses the record for, when it has any, and with those only (see
   * {@link ReadMode}).
   */
  resolve(address: string, use: AddressUse, reading?: AddressReading): Promise<Outcome<StoreResolution>>;
  /**
   * Reads the node a singular address names, in the requested form, with the requested computed fields. Fails as resolving
   * does, and with `usage-invalid` for the body form of a node that is neither a section, a `$body` nor a block anchor, since
   * the address is fine and the form does not apply. A section without a `$body` gives the empty string. `@collection` is the
   * name of the record's collection, absent for a record that no collection, or several, claim; `@issues` has the severities
   * the configuration gives. `@refs` resolves the node's references, so it reads the store's file list and alias file, and
   * fails as {@link Store.references} does.
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
   * record refused for its collection's schema is counted, and the schema's issue is reported once. In the strict read mode, a
   * record the mode refuses is counted too, and its issues are not reported. Fails as the backend's `list` does.
   */
  list(query: StoreListQuery): Promise<Outcome<StorePage>>;
  /** Searches the text of the store's records and assets as the backend's `grep` does, leaving out the paths vmd ignores. */
  grep(query: Omit<GrepQuery, "exclude">): Promise<Outcome<CountedPage<GrepMatch>>>;
  /**
   * Checks the store, or some of its records, and gives the issues found as the outcome's issues, with the severities the
   * configuration gives them (see `checkStore`). A record of a collection whose schema cannot be used is checked for
   * everything else. Fails as the backend's `list` does, and as {@link Store.references} does.
   */
  check(options?: CheckOptions): Promise<Outcome<CheckSummary>>;
  /**
   * Gives the references made in a node and below it, or in every record of the store, each resolved against the store, in
   * document order of each record and the records in UTF-8 byte order of their paths. References that leave the store are not
   * given. Without `from`, a record that cannot be read is left out: in the strict read mode, a record the mode refuses too,
   * and the issues of each record left out are the outcome's, unless some collections' schemas cannot be used, which fails the
   * read with each such schema's issue, once. With `from`, the read fails as resolving `from` does. A reference's status does
   * not depend on the read mode. Fails with `alias-file-invalid` for an alias file that cannot be read as one, or one larger
   * than `MAX_ALIAS_FILE_BYTES`, which is refused by its size before it is read, and as the backend's `list` and `read` do.
   */
  references(query?: ReferencesQuery): Promise<Outcome<readonly Reference[]>>;
  /**
   * Gives the canonical address of the node at an exact path of a record, as a fragment with its `#`, or `""` for the root:
   * what an issue's `in` line names the node by. The record is read as checks read it, from the local index where it holds
   * it, bound to its collection's schema when that can be used. Undefined when the store holds no readable record there, or
   * the record has no node at `at`.
   */
  nodeAddress(path: string, at: string): Promise<string | undefined>;
  /**
   * Gives a collection's schema, loaded, checked and compiled once for the store's lifetime: null for a collection without
   * one, or a failure with the one issue that makes it unusable, which readers refuse the collection's records with (see
   * `loadCollectionSchema`).
   */
  schema(collection: Collection): Promise<Outcome<CollectionSchema> | null>;
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
  options: {
    readonly configuration?: ConfigurationSource;
    /** How the store's readers treat a record that does not validate; `best-effort` by default. */
    readonly readMode?: ReadMode;
    /**
     * The local index, which checks, listings and the resolution of references read records from, and write what they parse
     * to; a full check keeps its snapshot there, which outlines read their refs-in counts from. None by default. Reads of a
     * node's value, `get` and `outline` themselves, parse the record.
     */
    readonly index?: IndexCache;
  } = {},
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
  const store = new BackendStore(backend, configuration.value, source, options.readMode ?? "best-effort", options.index ?? null);
  return succeed(store, configuration.issues);
}

/**
 * Gives the configuration source of a configuration file kept in a store's `.vmd/`, whose schemas are files of the store in
 * `.vmd/schema/`, read through the backend as any file of the store is, so that the backend's rules apply to them. A schema
 * larger than {@link MAX_SCHEMA_BYTES} is refused by its size before it is read. A schema that the backend finds no file for
 * fails with `address-not-found`, whose hint says that a backend may refuse a path reached through a symbolic link, unless
 * files lie below its path, which makes it a directory: that fails with `storage-failed`, since the file is there but cannot
 * be read as one. A backend that cannot read the file fails with its own issue, less the `cannot read <path>: ` that
 * {@link StorageReader} starts such a message with, since the store's message about the schema names the file.
 */
export function storeConfigurationSource(backend: StorageReader, content: Uint8Array): ConfigurationSource {
  return {
    content,
    schemaDirectory: `${SCHEMA_DIRECTORY}/`,
    readSchema: async (path) => {
      const stored = `${SCHEMA_DIRECTORY}/${path}`;
      const file = await backend.read(stored, { maxBytes: MAX_SCHEMA_BYTES });
      if (file.ok) return succeed("oversized" in file.value ? file.value : file.value.content);
      if (!file.issues.every((issue) => issue.code === "address-not-found")) {
        return fail(
          file.issues.map((issue) => {
            const reason = storageFailureReason(issue.message, stored);
            return reason === issue.message ? issue : { ...issue, message: reason };
          }),
        );
      }
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
      return fail([
        makeIssue({ code: "storage-failed", path: null, at: null, message: "it is a directory, not a regular file" }),
      ]);
    },
  };
}

class BackendStore implements Store {
  readonly backend: StorageReader;
  readonly configuration: StoreConfiguration;
  readonly readMode: ReadMode;
  readonly classifier: PathClassifier;
  readonly #source: ConfigurationSource;
  /** The records read, by path: the read under way, so that two reads of one path at once share it. */
  readonly #reads = new Map<string, Promise<Outcome<ParsedRecord> | null>>();
  /** The records read, by path, once each read has ended. */
  readonly #read = new Map<string, Outcome<ParsedRecord> | null>();
  /** The parses of records, whatever their collections' schemas, with the version of the bytes parsed, by path. */
  readonly #parses = new Map<string, Promise<ParseRead>>();
  /** The local index, or null. */
  readonly #index: IndexCache | null;
  /** The largest entry or snapshot the store writes or reads, in bytes: the index's own bound, at most the default. */
  readonly #limit: number;
  /** The version of each file the store's listings gave, by path, which the local index looks entries up by. */
  readonly #versions = new Map<string, string>();
  /** The structure of each record, from the local index or its parse, by path, with the version it is of. */
  readonly #structures = new Map<string, Promise<StructureRead>>();
  /** The bindings that checks and references read, from the local index or computed, by path. */
  readonly #indexedBindings = new Map<string, Promise<Outcome<RecordBinding> | null>>();
  /** The bindings of records read, by path. */
  readonly #bindings = new Map<string, Promise<Outcome<RecordBinding<ParsedRecord>> | null>>();
  /** Each collection's schema, loaded once, when it is first looked at: null for a collection without one. */
  readonly #schemas = new Map<Collection, Promise<Outcome<CollectionSchema> | null>>();
  /** The resolver of the store's references, made when references are first needed. */
  #resolver: Promise<Outcome<ReferenceResolver>> | undefined;

  constructor(
    backend: StorageReader,
    configuration: StoreConfiguration,
    source: ConfigurationSource,
    readMode: ReadMode,
    index: IndexCache | null,
  ) {
    this.backend = backend;
    this.configuration = configuration;
    this.readMode = readMode;
    this.classifier = new PathClassifier(configuration);
    this.#source = source;
    this.#index = index;
    this.#limit = Math.min(index?.maxEntryBytes ?? MAX_ENTRY_BYTES, MAX_ENTRY_BYTES);
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

  binding(path: string): Promise<Outcome<RecordBinding<ParsedRecord>> | null> {
    let binding = this.#bindings.get(path);
    if (binding === undefined) {
      binding = this.#bind(path);
      this.#bindings.set(path, binding);
    }
    return binding;
  }

  /** Reads a record and binds it to its collection's schema, which a readable record's collection can use, or has none. */
  async #bind(path: string): Promise<Outcome<RecordBinding<ParsedRecord>> | null> {
    const read = await this.record(path);
    if (read === null || !read.ok) return read;
    const collection = collectionOfRecord(this.classify(path));
    const schema = collection === undefined ? null : await this.schema(collection);
    return succeed(bindRecord(read.value, schema?.ok === true ? schema.value : null));
  }

  /**
   * Gives a record's binding as the store's readers read it: {@link Store.binding}'s, failing in the strict read mode with the
   * issues the mode refuses the record for. References and checks read the binding itself, so that the mode changes neither.
   */
  async #readerBinding(path: string): Promise<Outcome<RecordBinding<ParsedRecord>> | null> {
    const bound = await this.binding(path);
    if (this.readMode !== "strict" || bound === null || !bound.ok) return bound;
    const refusals = strictRefusals(bound.value, collectionOfRecord(this.classify(path)));
    return refusals.length > 0 ? fail(refusals) : bound;
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
    return this.#parse(path).then((read) => read.outcome);
  }

  /** Reads and parses a record once, with the version of the bytes parsed: null where nothing was parsed. */
  #parse(path: string): Promise<ParseRead> {
    let parsing = this.#parses.get(path);
    if (parsing === undefined) {
      parsing = this.backend.read(path, { maxBytes: MAX_RECORD_BYTES }).then((file): ParseRead => {
        if (!file.ok) return { outcome: fail(file.issues), version: null };
        if ("oversized" in file.value) return { outcome: fail([recordTooLarge(path)]), version: null };
        return { outcome: parseRecord(path, file.value.content), version: file.value.version };
      });
      this.#parses.set(path, parsing);
    }
    return parsing;
  }

  schema(collection: Collection): Promise<Outcome<CollectionSchema> | null> {
    let schema = this.#schemas.get(collection);
    if (schema === undefined) {
      schema = loadCollectionSchema(collection, {
        configuration: this.#source.content,
        schemaDirectory: this.#source.schemaDirectory,
        declared: this.configuration.declared,
        read: (path) => this.#source.readSchema(path),
      });
      this.#schemas.set(collection, schema);
    }
    return schema;
  }

  async schemaIssue(collection: Collection): Promise<Issue | null> {
    const schema = await this.schema(collection);
    return schema === null || schema.ok ? null : (schema.issues[0] as Issue);
  }

  check(options?: CheckOptions): Promise<Outcome<CheckSummary>> {
    return checkStore(this, options);
  }

  // The local index. A store without one reads every record from its parse, as before; with one, `check`, `references` and
  // `list` read structures and bindings from its entries, looked up by the versions the store's listings gave, and write an
  // entry for each record they parse, keyed by the version of the bytes parsed.

  async previousCheck(): Promise<Snapshot | null> {
    const index = this.#index;
    if (index === null) return null;
    const entry = await index.read(SNAPSHOT_KEY);
    const snapshot = entry === null ? null : readSnapshot(entry, this.#limit);
    if (snapshot === null || snapshot.inputs !== (await this.#inputs())) return null;
    return snapshot;
  }

  parsed(path: string): boolean {
    return this.#parses.has(path);
  }

  async nodeAddress(path: string, at: string): Promise<string | undefined> {
    const bound = await this.indexedBinding(path);
    let subject: ResolutionSubject | null = bound?.ok === true ? bound.value : null;
    if (subject === null) {
      const structure = await this.structure(path);
      if (!structure.ok) return undefined;
      subject = structure.value;
    }
    return subjectRecord(subject).nodes.node(at) === undefined ? undefined : canonicalAddress(subject, at);
  }

  listed(files: readonly FileInfo[]): void {
    for (const file of files) this.#versions.set(file.path, file.version);
  }

  structure(path: string): Promise<Outcome<RecordStructure>> {
    return this.#structure(path).then((read) => read.outcome);
  }

  /** Gives a record's structure, once: from the local index's parse entry for its listed version, or from its parse. */
  #structure(path: string): Promise<StructureRead> {
    let reading = this.#structures.get(path);
    if (reading === undefined) {
      reading = this.#readStructure(path);
      this.#structures.set(path, reading);
    }
    return reading;
  }

  async #readStructure(path: string): Promise<StructureRead> {
    const index = this.#index;
    const listed = this.#versions.get(path);
    const format = recordFormatOf(path);
    if (index !== null && listed !== undefined && format !== null && !this.#parses.has(path)) {
      const entry = await index.read(parseEntryKey(listed, format));
      const restored = entry === null ? null : restoreStructure(entry, path, this.#limit);
      if (restored !== null) return { outcome: restored, version: listed };
    }
    const parsed = await this.#parse(path);
    if (index !== null && parsed.version !== null && format !== null) {
      const rows = parseEntry(parsed.outcome, path, this.#entryBound(parsed.outcome));
      if (rows !== null) await index.write(parseEntryKey(parsed.version, format), rows);
    }
    return parsed;
  }

  /** The largest entry the store writes for a record of this parse: by the record's size, under the index's bound. */
  #entryBound(outcome: Outcome<ParsedRecord>): number {
    return entryBound(outcome.ok ? outcome.value.source.bytes.length : 0, this.#limit);
  }

  /** Writes the parse entry of a record this store parsed, when it is over the local index. */
  async #keepParse(path: string): Promise<void> {
    const index = this.#index;
    const format = recordFormatOf(path);
    if (index === null || format === null || !this.#parses.has(path)) return;
    const parsed = await this.#parse(path);
    const rows = parsed.version === null ? null : parseEntry(parsed.outcome, path, this.#entryBound(parsed.outcome));
    if (rows !== null) await index.write(parseEntryKey(parsed.version as string, format), rows);
  }

  indexedBinding(path: string): Promise<Outcome<RecordBinding> | null> {
    if (this.#index === null) return this.binding(path);
    let binding = this.#indexedBindings.get(path);
    if (binding === undefined) {
      binding = this.#indexedBind(path);
      this.#indexedBindings.set(path, binding);
    }
    return binding;
  }

  /**
   * Binds a record as {@link Store.binding} does, but from its structure: a binding entry of the local index where it holds
   * one for the record's version and its collection's schema files, a structure bound without a schema where it has none,
   * and otherwise from its parse, written to the index.
   */
  async #indexedBind(path: string): Promise<Outcome<RecordBinding> | null> {
    const found = this.classify(path);
    if (found.kind !== "record") return null;
    const collection = collectionOfRecord(found);
    const schema = collection === undefined ? null : await this.schema(collection);
    if (schema !== null && !schema.ok) {
      const stat = await this.backend.stat(path);
      if (!stat.ok && stat.issues.every((issue) => issue.code === "address-not-found")) return null;
      return fail([schema.issues[0] as Issue]);
    }
    const { outcome: structure, version } = await this.#structure(path);
    if (!structure.ok) return structure.issues.every((issue) => issue.code === "address-not-found") ? null : structure;
    if (schema === null) return succeed(bindStructure(structure.value));
    const index = this.#index as IndexCache;
    const key = version === null ? null : bindingEntryKey(version, structure.value.format, schema.value);
    if (key !== null) {
      const entry = await index.read(key);
      const restored = entry === null ? null : restoreBinding(entry, structure.value, schema.value, this.#limit);
      if (restored !== null) return succeed(restored);
    }
    // A binding needs the record's value: the parse of the bytes the structure is of, unless the file changed since.
    const parsed = await this.#parse(path);
    if (!parsed.outcome.ok)
      return parsed.outcome.issues.every((issue) => issue.code === "address-not-found") ? null : parsed.outcome;
    const binding = bindRecord(parsed.outcome.value, schema.value);
    const rows = bindingEntry(binding, this.#entryBound(parsed.outcome));
    if (rows !== null && parsed.version !== null) {
      await index.write(bindingEntryKey(parsed.version, binding.record.format, schema.value), rows);
    }
    return succeed(binding);
  }

  async checked(files: readonly FileInfo[], unread: readonly string[], references: readonly Reference[]): Promise<void> {
    const index = this.#index;
    if (index === null) return;
    const listing = new Map<string, string | null>();
    for (const file of files) listing.set(file.path, file.version);
    for (const path of unread) listing.set(path, null);
    const snapshot = { inputs: await this.#inputs(), files: listing, references: references.map(snapshotReference) };
    const rows = snapshotRows(snapshot, this.#limit);
    if (rows !== null) await index.write(SNAPSHOT_KEY, rows);
  }

  /**
   * The digest of what a check reads beyond the files it lists, which a snapshot is current only with: the configuration's
   * bytes, each collection's schema files, or why its schema cannot be used, and the alias file's version.
   */
  async #inputs(): Promise<string> {
    const parts: unknown[] = [await sha256Hex(this.#source.content)];
    for (const collection of this.configuration.collections) {
      const schema = await this.schema(collection);
      parts.push([collection.name, schema === null ? null : schema.ok ? schema.value.bindingDigest : schema.issues[0]?.message]);
    }
    const aliases = await this.backend.stat(ALIASES_PATH);
    parts.push(aliases.ok ? aliases.value.version : aliases.issues.map((issue) => issue.code));
    return sha256Hex(new TextEncoder().encode(JSON.stringify(parts)));
  }

  /**
   * Gives the refs-in counts of a record from the snapshot of the store's last full check, when the store is over the local
   * index and the snapshot is current: every file listed now has the version it had then, no other file is there, and the
   * configuration, the schemas and the alias file are as they were. Null otherwise, and for a listing that fails.
   */
  async #refsIn(path: string): Promise<RefsInCounts | null> {
    const index = this.#index;
    if (index === null) return null;
    const entry = await index.read(SNAPSHOT_KEY);
    const snapshot = entry === null ? null : readSnapshot(entry, this.#limit);
    if (snapshot === null) return null;
    const listed = await listEveryFile(this.backend, this.classifier.ignoredGlobs);
    if (!listed.ok) return null;
    const now = new Map<string, string | null>();
    for (const file of listed.value) now.set(file.path, file.version);
    for (const issue of listed.issues) if (issue.code === "storage-failed" && issue.path !== null) now.set(issue.path, null);
    if (now.size !== snapshot.files.size) return null;
    for (const [file, version] of now) if (snapshot.files.get(file) !== version) return null;
    if (snapshot.inputs !== (await this.#inputs())) return null;
    return refsInCounts(snapshot, path);
  }

  /**
   * Gives the resolver of the store's references, made once. `listing`, the store's files but the ignored ones as a check
   * has just listed them, spares a second listing; without it, the resolver lists the store itself.
   */
  referenceResolver(listing?: readonly string[]): Promise<Outcome<ReferenceResolver>> {
    this.#resolver ??= this.#readReferenceResolver(listing);
    return this.#resolver;
  }

  /** Lists the store's files but the ignored ones, unless given them, and reads its alias file, for the resolver. */
  async #readReferenceResolver(listing: readonly string[] | undefined): Promise<Outcome<ReferenceResolver>> {
    const files: string[] = listing === undefined ? [] : [...listing];
    let cursor: string | null = null;
    while (listing === undefined) {
      const page = await this.backend.list({
        prefix: "",
        exclude: this.classifier.ignoredGlobs,
        limit: REFERENCE_LIST_PAGE,
        ...(cursor === null ? {} : { cursor }),
      });
      if (!page.ok) return fail(page.issues);
      for (const file of page.value.items) files.push(file.path);
      // A file the backend could not read when listing it is still there, for a reference to it.
      for (const issue of page.issues) if (issue.code === "storage-failed" && issue.path !== null) files.push(issue.path);
      cursor = page.value.cursor;
      if (cursor === null) break;
    }
    let aliases = NO_ALIASES;
    const file = await this.backend.read(ALIASES_PATH, { maxBytes: MAX_ALIAS_FILE_BYTES });
    if (file.ok) {
      if ("oversized" in file.value) return fail([aliasFileTooLarge()]);
      const read = readAliases(file.value.content);
      if (!read.ok) return fail(read.issues);
      aliases = read.value;
    } else if (!file.issues.every((issue) => issue.code === "address-not-found")) {
      return fail(file.issues);
    }
    const store = {
      classify: (path: string) => this.classify(path),
      binding: (path: string) => this.indexedBinding(path),
      collections: new Set(this.configuration.collections.map((collection) => collection.name)),
      exists: (path: string, directory: boolean) => this.#exists(path, directory),
    };
    return succeed(new ReferenceResolver(store, files, aliases));
  }

  /** Whether a file is at `path`, or below it for `directory`, ignored paths included; a file it cannot read is there. */
  async #exists(path: string, directory: boolean): Promise<boolean> {
    if (directory) {
      const below = await this.backend.list({ prefix: `${path}/`, limit: 1 });
      return below.ok && (below.value.items.length > 0 || below.issues.some((issue) => issue.code === "storage-failed"));
    }
    const stat = await this.backend.stat(path);
    return stat.ok || !stat.issues.every((issue) => issue.code === "address-not-found");
  }

  async references(query: ReferencesQuery = {}): Promise<Outcome<readonly Reference[]>> {
    const resolver = await this.referenceResolver();
    if (!resolver.ok) return fail(resolver.issues);
    if (query.from === undefined) {
      const references: Reference[] = [];
      const refusals: Issue[] = [];
      // The issues of the collections whose schemas cannot be used, once each: they have no record path.
      const schemaIssues: Issue[] = [];
      for (const path of resolver.value.recordPaths().sort(compareUtf8)) {
        const read = this.readMode === "strict" ? await this.#readerBinding(path) : await this.indexedBinding(path);
        if (read === null) continue;
        if (read.ok) {
          for (const reference of await resolver.value.referencesOf(read.value)) references.push(reference);
        } else if (this.readMode === "strict") {
          for (const issue of read.issues) {
            if (issue.path !== null) refusals.push(issue);
            else if (!schemaIssues.includes(issue)) schemaIssues.push(issue);
          }
        }
      }
      return schemaIssues.length > 0 ? fail(schemaIssues) : succeed(references, refusals);
    }
    const resolved = await this.resolve(query.from, "singular", query.reading);
    if (!resolved.ok) return fail(resolved.issues);
    const { record, targets } = resolved.value;
    const target = targets[0] as Target;
    const references = await resolver.value.referencesOf(resolved.value.binding ?? record, target.at);
    const range = target.range;
    if (range === undefined) return succeed(references);
    return succeed(references.filter((reference) => inBlock(reference, target.at, range)));
  }

  resolve(address: string, use: AddressUse, reading?: AddressReading): Promise<Outcome<StoreResolution>> {
    return resolveStoreAddress((path) => this.#readerBinding(path), address, use, reading);
  }

  async get(address: string, options: GetOptions = {}): Promise<Outcome<GetResult>> {
    const resolved = await this.resolve(address, "singular", options.reading);
    if (!resolved.ok) return fail(resolved.issues);
    const { record, targets } = resolved.value;
    const subject: ParsedSubject = resolved.value.binding ?? record;
    const target = targets[0] as Target;
    const value = formOf(record, target, options.form ?? "value");
    if (!value.ok) return fail(value.issues);
    if (options.meta === undefined) return succeed({ value: value.value });
    const collection = collectionOfRecord(this.classify(record.path));
    let references: readonly Reference[] | undefined;
    if (options.meta === "all" || options.meta.includes("@refs")) {
      const resolver = await this.referenceResolver();
      if (!resolver.ok) return fail(resolver.issues);
      references = await resolver.value.referencesOf(subject, target.at);
    }
    const meta = await computeFields(subject, target, options.meta, {
      severities: this.configuration,
      ...(collection === undefined ? {} : { collection: collection.name }),
      ...(references === undefined ? {} : { references }),
    });
    return succeed({ value: value.value, meta });
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
    const subject: ParsedSubject = resolved.value.binding ?? record;
    const target = targets[0] as Target;
    const block = blockAnchorOf(record, target);
    const node = record.nodes.node(target.at) as NodeInfo;
    await this.#keepParse(record.path);
    const counts = await this.#refsIn(record.path);
    const counted = (entry: OutlineEntry) => (counts === null ? entry : withRefsIn(entry, counts));
    if (block !== undefined) {
      return succeed({ path: record.path, node: counted(blockEntry(subject, block)), sections: [] });
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
            .map((section) => counted(outlineEntry(subject, section, reaches(section.depth - node.depth + 1))));
    const outline: Outline = { path: record.path, node: counted(outlineEntry(subject, node, reaches(1))), sections };
    if (node.at !== "" || record.format === "md" || !reaches(1)) return succeed(outline);
    const members = record.nodes
      .children("")
      .filter((member) => member.key !== "$sections")
      .map((member) => counted(outlineEntry(subject, member, false)));
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
    if (this.#index !== null) this.listed(listed.value.items);
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
      const read =
        this.readMode === "strict"
          ? await this.#readerBinding(file.path)
          : this.#index === null
            ? await this.record(file.path)
            : await this.indexedBinding(file.path);
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
    if (this.#index === null) {
      return succeed({ items, cursor, remaining, unreadable: { count: unreadable, scope: "page" } }, issues);
    }
    const counted = await this.#unreadableRecords(query.glob);
    if (!counted.ok) return fail(counted.issues);
    // The pages of the whole listing hold the page's own listing issues again, as other objects.
    const shown = new Set(issues.map(issueKey));
    for (const issue of counted.issues) {
      if (shown.has(issueKey(issue))) continue;
      shown.add(issueKey(issue));
      issues.push(issue);
    }
    return succeed({ items, cursor, remaining, unreadable: { count: counted.value, scope: "store" } }, issues);
  }

  // Deviation from the I2 design, recorded in issue #25: in the strict read mode the count reads each record's parse, since
  // what the mode refuses is decided on the parse-based binding; the command line has no strict mode until `--strict`.
  /**
   * Counts the records that a listing over the local index could not read, on every page of a glob's listing: as `list` counts
   * a page's, each read from the index where it holds it, in the strict read mode from its parse. Gives the issues behind the
   * count as `list` gives a page's: the listing's, a failed read's, and each unusable schema's once. Fails as `list` does.
   */
  async #unreadableRecords(glob: string | undefined): Promise<Outcome<number>> {
    const listed = await listEveryFile(this.backend, this.classifier.ignoredGlobs, glob);
    if (!listed.ok) return fail(listed.issues);
    this.listed(listed.value);
    const issues: Issue[] = [...listed.issues];
    let count = listed.issues.filter(
      (issue) => issue.code === "storage-failed" && issue.path !== null && this.classify(issue.path).kind === "record",
    ).length;
    for (const file of listed.value) {
      if (this.classify(file.path).kind !== "record") continue;
      const read = this.readMode === "strict" ? await this.#readerBinding(file.path) : await this.indexedBinding(file.path);
      if (read?.ok === true) continue;
      count += 1;
      for (const issue of read?.issues ?? []) {
        if (issue.path === null ? !issues.includes(issue) : issue.code === "storage-failed") issues.push(issue);
      }
    }
    return succeed(count, issues);
  }

  grep(query: Omit<GrepQuery, "exclude">): Promise<Outcome<CountedPage<GrepMatch>>> {
    return this.backend.grep({ ...query, exclude: this.classifier.ignoredGlobs });
  }
}

/**
 * Gives the issues that the strict read mode refuses a bound record for, in the binding's order and then the file name's: its
 * schema violations, its repeated keys at levels the schema declares `type: map`, and its file name when its collection's rule
 * rejects it. Empty for a record the mode reads.
 */
// Not `ref-target-not-allowed`: whether the strict mode refuses a record whose typed reference points where its declaration
// forbids is the implementation's choice, since such a break often comes from a change in the record it points to, and vmd
// does not refuse it, so that a change elsewhere never hides a record; `check` reports the reference.
function strictRefusals(binding: RecordBinding, collection: Collection | undefined): Issue[] {
  const refusals = binding.issues.filter((issue) => issue.code === "schema-violation" || isDeclaredDuplicate(issue));
  const mismatch = collection === undefined ? null : filenameMismatch(binding.record.path, collection);
  return mismatch === null ? refusals : [...refusals, mismatch];
}

/** A record's parse, with the version of the bytes parsed: null where nothing was parsed, such as a file not read. */
interface ParseRead {
  readonly outcome: Outcome<ParsedRecord>;
  readonly version: string | null;
}

/** A record's structure, with the version of the file it is of: null where it is of no bytes read. */
interface StructureRead {
  readonly outcome: Outcome<RecordStructure>;
  readonly version: string | null;
}

/** What tells two issues apart in a listing's report: their code, path, node and message. */
function issueKey(issue: Issue): string {
  return JSON.stringify([issue.code, issue.path, issue.at, issue.message]);
}

/** The SHA-256 of bytes, in hexadecimal. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

/** Whether a reference is in the block of a `$body` at `at` that `range` gives, by its offset in the `$body`. */
function inBlock(reference: Reference, at: string, range: ByteRange): boolean {
  const offset = reference.offset;
  return reference.at === at && offset !== undefined && offset >= range.start && offset < range.end;
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
function outlineEntry(subject: ParsedSubject, node: NodeInfo, withBlocks: boolean): OutlineEntry {
  const record = subjectRecord(subject);
  const base = { at: node.at, address: canonicalAddress(subject, node.at), size: sizeOf(node.range) };
  if (node.kind !== "section") {
    const member = typeof node.key === "string" ? { ...base, key: node.key } : base;
    return withBlocks && node.key === "$body" ? { ...member, blocks: blocksOf(subject, node.at) } : member;
  }
  const key = record.sectionKeys.get(node.at);
  const title = (valueAt(record, node.at) as ValueObject).$title;
  const section: OutlineEntry = {
    ...base,
    ...(key === undefined ? {} : { key }),
    ...(typeof title === "string" ? { title } : {}),
    depth: node.depth,
  };
  return withBlocks ? { ...section, blocks: blocksOf(subject, `${node.at}/$body`) } : section;
}

/** Gives the outline entries of the block anchors of the `$body` at an exact path, in document order. */
function blocksOf(subject: ParsedSubject, body: string): OutlineEntry[] {
  const record = subjectRecord(subject);
  return record.anchors.anchors
    .filter((entry): entry is BlockAnchorEntry => entry.kind === "block" && entry.at === body)
    .map((entry) => blockEntry(subject, entry));
}

/** Gives the outline entry of a block anchor: its `$body`, its canonical address, its block's size and its range. */
function blockEntry(subject: ParsedSubject, entry: BlockAnchorEntry): OutlineEntry {
  return {
    at: entry.at,
    address: blockAnchorAddress(subject, entry),
    size: sizeOf(entry.fileRange),
    range: entry.range,
  };
}

/** Gives an outline entry with its refs-in count, and its block anchors' counts. */
function withRefsIn(entry: OutlineEntry, counts: RefsInCounts): OutlineEntry {
  const refsIn = entry.range === undefined ? counts.node(entry.at) : counts.block(entry.at, entry.range);
  const blocks = entry.blocks?.map((block) => withRefsIn(block, counts));
  return { ...entry, refsIn, ...(blocks === undefined ? {} : { blocks }) };
}

/** The number of bytes in a range. */
function sizeOf(range: ByteRange): number {
  return range.end - range.start;
}
