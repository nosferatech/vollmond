import { bindStructure, type RecordBinding } from "../binding/binding.js";
import { collectionOfRecord, type PathClassifier } from "../config/classify.js";
import type { Collection, StoreConfiguration } from "../config/configuration.js";
import type { Snapshot } from "../index/snapshot.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { applySeverities } from "../issue/severity.js";
import type { RecordStructure } from "../record/record.js";
import { ALIASES_PATH } from "../reference/aliases.js";
import type { Reference } from "../reference/reference.js";
import type { ReferenceResolver } from "../reference/resolve.js";
import { resolveReferenceUri } from "../reference/uri.js";
import type { CollectionSchema } from "../schema/collection-schema.js";
import { listEveryFile } from "../storage/list-every-file.js";
import { compareUtf8 } from "../storage/path.js";
import type { FileInfo, StorageReader } from "../storage/storage.js";
import { filenameMismatch, type ListedPath, pathRuleIssues } from "../store/path-rules.js";

/** What {@link checkStore} checks. */
export interface CheckOptions {
  /**
   * The store paths of the records whose issues to report; every record when absent. Paths that name no record of the store
   * are left out. The other records are still listed, so that the rules across paths, such as case conflicts, see them.
   */
  readonly records?: readonly string[];
  /**
   * The store paths that changed, such as since a revision, deleted ones included: the check reports the issues of the records
   * among them that are there now, and of every record with a reference that names one of them, or reaches one, or names or
   * reaches a directory above one. A change to the alias file makes it a check of the whole store, since any reference may
   * depend on it, and so does a file created, changed or removed at a path an alias names, an old or a new path of a record
   * alias or the record of an anchor alias; the caller widens it the same way for a change to the configuration or its
   * schemas, which only it can see. The path rules' issues that involve a changed path are reported wherever they land, such
   * as an unchanged path's case conflict with an added one.
   * Without a current snapshot of the last full check, every record's references are resolved to find them.
   */
  readonly changed?: readonly string[];
}

/** What a check covered, beyond its issues. */
export interface CheckSummary {
  /** How many records were checked, those the backend could not read included. */
  readonly records: number;
  /** How many of them have no value view: a structural error, or a file the backend could not read when listing or reading it. */
  readonly unreadable: number;
  /** How many references the records checked make, each resolved. */
  readonly references: number;
  /** How many of the records checked were read from their files, to parse them or to bind them, a read that failed included. */
  readonly parsed: number;
  /**
   * How many of the records checked were checked from the local index alone, without reading their files: the records checked
   * less those parsed and those the backend could not read when listing them.
   */
  readonly fromIndex: number;
}

/** What {@link checkStore} needs of a store. */
export interface CheckedStore {
  readonly backend: StorageReader;
  readonly configuration: StoreConfiguration;
  readonly classifier: PathClassifier;
  /**
   * Learns the versions of the files a check listed, so that their records are read from the local index where it holds
   * them.
   */
  listed(files: readonly FileInfo[]): void;
  /**
   * Gives a record's structure, whatever its collection's schema, once for the store's lifetime: its parse, or what the local
   * index keeps of it.
   */
  structure(path: string): Promise<Outcome<RecordStructure>>;
  /**
   * Reads a record as readers do and binds it to its collection's schema, once for the store's lifetime: the binding that
   * references into the record resolve in, from the local index where it holds it.
   */
  indexedBinding(path: string): Promise<Outcome<RecordBinding> | null>;
  /**
   * The snapshot of the store's last full check, when the store is over the local index and the snapshot was made with the
   * configuration, schemas and alias file the store has now; null otherwise. Its rows hold for a record only while the
   * record's version is the one the snapshot lists.
   */
  previousCheck(): Promise<Snapshot | null>;
  /** Whether the store has read the record's file, to parse it, in its lifetime so far. */
  parsed(path: string): boolean;
  /** Keeps what a check of the whole store found: the files it listed, and every reference resolved. */
  checked(files: readonly FileInfo[], unread: readonly string[], references: readonly Reference[]): Promise<void>;
  /** The issue that makes a collection's schema unusable, the same one each time; null when its schema can be used or it has none. */
  schemaIssue(collection: Collection): Promise<Issue | null>;
  /**
   * The resolver of the store's references, the same one each time, or why there is none, such as an invalid alias file;
   * `listing` is the store's files but the ignored ones, which the check has listed.
   */
  referenceResolver(listing: readonly string[]): Promise<Outcome<ReferenceResolver>>;
  /** A collection's schema, the same each time; null for a collection without one, a failure for one that cannot be used. */
  schema(collection: Collection): Promise<Outcome<CollectionSchema> | null>;
}

/**
 * Checks a store's records and paths, and gives every issue found, with the severities the configuration gives them, those
 * that are off left out, in the byte order of their paths (issues without a path first) and then of their positions:
 *
 * - each record's structural errors, or the validation issues parsing found, adjusted for the levels its schema declares; a
 *   file the backend could not read is `storage-failed`;
 * - for a record that parses, of a collection whose schema can be used, the schema's violations (`schema-violation`) and the
 *   repeated keys of the lists it declares a map (`duplicate-key`);
 * - the path rules over every listed path (`path-invalid`, `path-case-conflict`), records and assets alike;
 * - `collection-conflict` for a record that several collections claim, which is then checked as a record of none;
 *   `filename-mismatch` for a record whose name does not match its collection's pattern;
 * - once per collection, the issue that makes its schema unusable; the collection's records are still checked for everything
 *   else;
 * - the issues of the references of each record without a structural error, resolved against the store as readers read it,
 *   and `alias-shadowed` for a record's path, or a name a first step reaches in it, an anchor or a root key, that an alias
 *   has as its old name.
 *
 * With `records`, only those records' issues are reported, and a collection's schema issue only when one of them is in it.
 * A check of the whole store hands what it found to the store, which keeps it as the snapshot of the local index.
 * Fails as the backend's `list` does, with nothing checked, and with the issue of an alias file that cannot be read as one,
 * since without its aliases references would be reported dangling that are not.
 */
export async function checkStore(store: CheckedStore, options: CheckOptions = {}): Promise<Outcome<CheckSummary>> {
  if (options.records !== undefined && options.changed !== undefined) {
    throw new RangeError("a check takes records or changed, not both");
  }
  const listed = await listEveryFile(store.backend, store.classifier.ignoredGlobs);
  if (!listed.ok) return listed;
  store.listed(listed.value);
  const issues: Issue[] = [...listed.issues];
  const paths: ListedPath[] = [];
  const records: { readonly path: string; readonly collections: readonly Collection[] }[] = [];
  for (const file of listed.value) {
    const found = store.classifier.classify(file.path);
    if (found.kind === "ignored") continue;
    paths.push({ path: file.path, kind: found.kind });
    if (found.kind === "record") records.push({ path: file.path, collections: found.collections });
  }
  // A check of what changed reports the path rules' issues that involve a changed path, wherever they land; another check, those
  // of the paths in its scope, through the filter below.
  const changedPaths = options.changed === undefined ? null : new Set(options.changed);
  const pathIssues = pathRuleIssues(paths, changedPaths === null ? {} : { involving: changedPaths });
  if (changedPaths === null) for (const issue of pathIssues) issues.push(issue);

  // A file the backend could not read when listing it is still there, for a reference to it.
  const unread = listed.issues.flatMap((issue) => (issue.code === "storage-failed" && issue.path !== null ? [issue.path] : []));
  const resolver = await store.referenceResolver([...listed.value.map((file) => file.path), ...unread]);
  if (!resolver.ok) return fail(resolver.issues);
  let scope: ReadonlySet<string> | null = options.records === undefined ? null : new Set(options.records);
  // Deviation from the I2 design, recorded in issue #26: a change to the alias file, or a file created, changed or removed at a
  // path an alias names, can change where any reference through an alias leads, so it makes the check one of the whole store.
  const aliasPaths = resolver.value.aliasPaths();
  if (changedPaths !== null && !changedPaths.has(ALIASES_PATH) && ![...changedPaths].some((path) => aliasPaths.has(path))) {
    const versions = new Map(listed.value.map((file) => [file.path, file.version]));
    scope = await changedScope(store, resolver.value, records, versions, changedPaths);
  }
  const inScope = (path: string) => scope === null || scope.has(path);
  const collectionsInScope = new Set<Collection>(scope === null ? store.configuration.collections : []);
  // A record the backend could not read is left out of the listing, with its storage-failed, and is still a record checked
  // that could not be read, as `ls` counts it.
  const failedRecords = listed.issues.filter(
    (issue) =>
      issue.code === "storage-failed" &&
      issue.path !== null &&
      inScope(issue.path) &&
      store.classifier.classify(issue.path).kind === "record",
  ).length;
  let checked = failedRecords;
  let parsed = 0;
  const references: Reference[] = [];
  let unreadable = failedRecords;
  for (const record of records) {
    if (!inScope(record.path)) continue;
    checked += 1;
    const collection = collectionOfRecord({ kind: "record", collections: record.collections });
    if (record.collections.length > 1) issues.push(conflict(record.path, record.collections));
    if (collection !== undefined) {
      collectionsInScope.add(collection);
      const mismatch = filenameMismatch(record.path, collection);
      if (mismatch !== null) issues.push(mismatch);
    }
    const read = await checkedBinding(store, record.path, collection);
    const binding = read.ok ? read.value : null;
    if (binding !== null) {
      for (const issue of binding.issues) issues.push(issue);
    } else {
      unreadable += 1;
      for (const issue of read.issues) issues.push(issue);
    }
    for (const issue of await resolver.value.issuesOf(record.path, binding, references)) issues.push(issue);
    if (store.parsed(record.path)) parsed += 1;
  }
  if (scope === null) await store.checked(listed.value, unread, references);
  for (const collection of store.configuration.collections) {
    if (!collectionsInScope.has(collection)) continue;
    const schemaIssue = await store.schemaIssue(collection);
    if (schemaIssue !== null) issues.push(schemaIssue);
  }
  const inScopeIssues = issues.filter((issue) => issue.path === null || inScope(issue.path));
  // In a check of the whole store the path issues are among the others; in a part of it, those that involve a changed path.
  const pathIssuesShown = changedPaths === null ? [] : scope === null ? pathRuleIssues(paths) : pathIssues;
  const reported = applySeverities([...inScopeIssues, ...pathIssuesShown], store.configuration);
  const summary: CheckSummary = {
    records: checked,
    unreadable,
    references: references.length,
    parsed,
    fromIndex: checked - parsed - failedRecords,
  };
  return succeed(summary, sortIssues(reported));
}

/**
 * Gives a record's binding as a check reads it: the store's, which references into the record share, or its structure bound to
 * no schema when its collection's schema cannot be used, since readers refuse such a record; and fails with the record's
 * structural errors, or the backend's issue.
 */
async function checkedBinding(
  store: CheckedStore,
  path: string,
  collection: Collection | undefined,
): Promise<Outcome<RecordBinding>> {
  const structure = await store.structure(path);
  if (!structure.ok) return structure;
  const schema = collection === undefined ? null : await store.schema(collection);
  const bound = schema === null || schema.ok ? await store.indexedBinding(path) : null;
  return succeed(bound?.ok === true ? bound.value : bindStructure(structure.value));
}

/** What a reference says and reached, as a check of what changed looks at it, whether from a snapshot or resolved now. */
interface CitingReference {
  readonly uri: string;
  readonly targets: readonly { readonly path: string; readonly kind?: string }[];
}

/**
 * Gives the paths whose issues a check of what changed reports: every changed path, and the records with a reference that
 * cites a changed path. It loops over the records listed now, never over the snapshot's: a record whose version is the one the
 * snapshot lists is looked at through the snapshot's rows, and any other, changed since or added, through its own references,
 * resolved now; without a current snapshot, every record is. A record unchanged since the snapshot makes the same references,
 * and each one's route passes through the path its URI names, the directories above it, its targets, and the paths its aliases
 * name; a change at an alias's path makes the check one of the whole store, so a stale snapshot costs work and never hides a
 * record.
 */
async function changedScope(
  store: CheckedStore,
  resolver: ReferenceResolver,
  records: readonly { readonly path: string; readonly collections: readonly Collection[] }[],
  versions: ReadonlyMap<string, string>,
  paths: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  const snapshot = await store.previousCheck();
  const rows = new Map<string, CitingReference[]>();
  for (const reference of snapshot?.references ?? []) {
    let held = rows.get(reference.from.path);
    if (held === undefined) {
      held = [];
      rows.set(reference.from.path, held);
    }
    held.push(reference);
  }
  // Every changed path, a record the backend could not read when listing it included, which a check reports.
  const scope = new Set<string>(paths);
  for (const record of records) {
    if (paths.has(record.path)) continue;
    const version = versions.get(record.path);
    let references: readonly CitingReference[];
    if (snapshot !== null && version !== undefined && snapshot.files.get(record.path) === version) {
      references = rows.get(record.path) ?? [];
    } else {
      const checked = await checkedBinding(store, record.path, collectionOfRecord({ kind: "record", ...record }));
      references = checked.ok ? await resolver.referencesOf(checked.value) : [];
    }
    if (references.some((reference) => cites(record.path, reference, paths))) scope.add(record.path);
  }
  return scope;
}

/**
 * Whether a reference made in the record at `citing` cites one of `paths`: the path its URI names, or the path of one of its
 * targets, is one of them, or is a directory above one.
 */
function cites(citing: string, reference: CitingReference, paths: ReadonlySet<string>): boolean {
  const reaches = (path: string, directory: boolean) => {
    if (!directory) return paths.has(path);
    for (const changed of paths) if (path === "" || changed.startsWith(`${path}/`)) return true;
    return false;
  };
  const named = resolveReferenceUri(citing, reference.uri);
  if (named.kind === "store" && reaches(named.path, named.directory)) return true;
  return reference.targets.some((target) => reaches(target.path, target.kind === "directory"));
}

/** The `collection-conflict` of a record that several collections claim. */
function conflict(path: string, collections: readonly Collection[]): Issue {
  const names = collections.map((collection) => collection.name).join(", ");
  return makeIssue({
    code: "collection-conflict",
    path,
    at: "",
    message: `${path} is matched by the collections ${names}, and a record belongs to at most one; it is read without a schema`,
    hint: "narrow the match globs, or exclude the record from all but one collection",
  });
}

/** Sorts issues by path in UTF-8 byte order, those without a path first, then by position, keeping the order of equals. */
function sortIssues(issues: Issue[]): Issue[] {
  return issues.sort((a, b) => {
    if (a.path !== b.path) {
      if (a.path === null) return -1;
      if (b.path === null) return 1;
      return compareUtf8(a.path, b.path);
    }
    return (a.position?.offset ?? -1) - (b.position?.offset ?? -1);
  });
}
