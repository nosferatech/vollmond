import { collectionOfRecord, type PathClassifier } from "../config/classify.js";
import type { Collection, StoreConfiguration } from "../config/configuration.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { applySeverities } from "../issue/severity.js";
import type { ParsedRecord } from "../record/record.js";
import type { ReferenceResolver } from "../reference/resolve.js";
import type { CollectionSchema } from "../schema/collection-schema.js";
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
}

/** What a check covered, beyond its issues. */
export interface CheckSummary {
  /** How many records were checked, those the backend could not read included. */
  readonly records: number;
  /** How many of them have no value view: a structural error, or a file the backend could not read when listing or reading it. */
  readonly unreadable: number;
}

/** What {@link checkStore} needs of a store. */
export interface CheckedStore {
  readonly backend: StorageReader;
  readonly configuration: StoreConfiguration;
  readonly classifier: PathClassifier;
  /** Parses a record, whatever its collection's schema, once for the store's lifetime. */
  parse(path: string): Promise<Outcome<ParsedRecord>>;
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

/** How many paths a page of the listing that a check reads holds. */
const LIST_PAGE = 1000;

/**
 * Checks a store's records and paths, and gives every issue found, with the severities the configuration gives them, those
 * that are off left out, in the byte order of their paths (issues without a path first) and then of their positions:
 *
 * - each record's structural errors, or the validation issues parsing found; a file the backend could not read is
 *   `storage-failed`;
 * - for a record that parses, of a collection whose schema can be used, the schema's violations (`schema-violation`);
 * - the path rules over every listed path (`path-invalid`, `path-case-conflict`), records and assets alike;
 * - `collection-conflict` for a record that several collections claim, which is then checked as a record of none;
 *   `filename-mismatch` for a record whose name does not match its collection's pattern;
 * - once per collection, the issue that makes its schema unusable; the collection's records are still checked for everything
 *   else;
 * - the issues of the references of each record without a structural error, resolved against the store as readers read it,
 *   and `alias-shadowed` for a record's path, or an anchor of it, that an alias has as its old name.
 *
 * With `records`, only those records' issues are reported, and a collection's schema issue only when one of them is in it.
 * Fails as the backend's `list` does, with nothing checked, and with the issue of an alias file that cannot be read as one,
 * since without its aliases references would be reported dangling that are not.
 */
export async function checkStore(store: CheckedStore, options: CheckOptions = {}): Promise<Outcome<CheckSummary>> {
  const listed = await listAll(store);
  if (!listed.ok) return listed;
  const issues: Issue[] = [...listed.issues];
  const paths: ListedPath[] = [];
  const records: { readonly path: string; readonly collections: readonly Collection[] }[] = [];
  for (const file of listed.value) {
    const found = store.classifier.classify(file.path);
    if (found.kind === "ignored") continue;
    paths.push({ path: file.path, kind: found.kind });
    if (found.kind === "record") records.push({ path: file.path, collections: found.collections });
  }
  issues.push(...pathRuleIssues(paths));

  const scope = options.records === undefined ? null : new Set(options.records);
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
  let unreadable = failedRecords;
  // A file the backend could not read when listing it is still there, for a reference to it.
  const unread = listed.issues.flatMap((issue) => (issue.code === "storage-failed" && issue.path !== null ? [issue.path] : []));
  const resolver = await store.referenceResolver([...listed.value.map((file) => file.path), ...unread]);
  if (!resolver.ok) return fail(resolver.issues);
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
    const parsed = await store.parse(record.path);
    if (parsed.ok) {
      issues.push(...parsed.value.issues);
      const schema = collection === undefined ? null : await store.schema(collection);
      if (schema?.ok === true) issues.push(...schema.value.validate(parsed.value));
    } else {
      unreadable += 1;
      issues.push(...parsed.issues);
    }
    issues.push(...(await resolver.value.issuesOf(record.path, parsed.ok ? parsed.value : null)));
  }
  for (const collection of store.configuration.collections) {
    if (!collectionsInScope.has(collection)) continue;
    const schemaIssue = await store.schemaIssue(collection);
    if (schemaIssue !== null) issues.push(schemaIssue);
  }
  const reported = applySeverities(
    issues.filter((issue) => issue.path === null || inScope(issue.path)),
    store.configuration,
  );
  return succeed({ records: checked, unreadable }, sortIssues(reported));
}

/** Lists every file of the store but the ignored ones, page by page, with the issues of the pages. */
async function listAll(store: CheckedStore): Promise<Outcome<FileInfo[]>> {
  const files: FileInfo[] = [];
  const issues: Issue[] = [];
  let cursor: string | null = null;
  do {
    const page = await store.backend.list({
      prefix: "",
      exclude: store.classifier.ignoredGlobs,
      limit: LIST_PAGE,
      ...(cursor === null ? {} : { cursor }),
    });
    if (!page.ok) return fail(page.issues);
    files.push(...page.value.items);
    issues.push(...page.issues);
    cursor = page.value.cursor;
  } while (cursor !== null);
  return succeed(files, issues);
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
