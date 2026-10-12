import type { Collection } from "../config/configuration.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import { valueAt } from "../record/node-value.js";
import type { ParsedRecord } from "../record/record.js";
import { checkExtensionKeywords } from "./keywords.js";
import { readSchemaSet, type SchemaLocation, type SchemaProblem, type SchemaReader, type SchemaSet } from "./schema-set.js";
import { type SchemaShape, Spine } from "./spine.js";
import { compileSchemaSet, metaSchemaFailures, type ValidatorError } from "./validator.js";
import { type NativeFailure, violationIssues } from "./violations.js";
import { isObject, isSchemaValue } from "./walk.js";

// Deviation from the I2 design, recorded in issue #22: `validate` takes the parsed record, since a record's structure without
// its value comes with the binding and the index.
/** A collection's schema, loaded, checked and compiled: what validates its records and what its spine declares. */
export interface CollectionSchema {
  /** The collection's name. */
  readonly collection: string;
  /** The SHA-256 of the configuration and of every schema file the collection reads, in hexadecimal. */
  readonly digest: string;
  /** The spine's shape of a record's root. */
  readonly root: SchemaShape;
  // Deviation from the I2 design, recorded in issue #23: the binding hands its keyed lists' checks to `validate`, which
  // checks items against per-key schemas compiled at load, at their own locations, rather than through wrapper schemas, so
  // that one value's failures from both make one issue.
  /**
   * Validates a record's value view against the schema: one `schema-violation` per failing value, at its exact path, the
   * logical types of §4.3 included; none for a valid record. `lists` adds what the record's keyed lists require, which the
   * validator does not see inside `x-vmd-list`: items to check against per-key schemas, and failures found by evaluating the
   * lists natively, each folded into the issue of its value.
   *
   * Throws a `RangeError` for a schema location in `lists` that is not a per-key or `additional` schema of the set.
   */
  validate(record: ParsedRecord, lists?: ListChecks): readonly Issue[];
}

/** What a record's keyed lists add to its validation (see {@link CollectionSchema.validate}). */
export interface ListChecks {
  /** The items to check against a schema of a keyed list, each by its exact path in the record. */
  readonly subschemas: readonly { readonly at: string; readonly location: SchemaLocation }[];
  /** The failures found by evaluating the keyed lists natively, such as a missing required key. */
  readonly failures: readonly NativeFailure[];
}

/** What loading a collection's schema needs beyond the collection. */
export interface SchemaLoading {
  /** The configuration file's bytes, which the digest covers. */
  readonly configuration: Uint8Array;
  /** How the configuration file is named in messages, for the hint that says where schemas are. */
  readonly configurationName: string;
  /** The format version the store declares, which a `feature-unsupported` message names. */
  readonly declared: number;
  /** Reads a file of the schema directory. */
  readonly read: SchemaReader;
}

/** The spine of each schema loaded, for {@link spineOf}. */
const spines = new WeakMap<CollectionSchema, Spine>();

/** Gives the spine a collection's schema was loaded with, for tests that count the work its shapes do. */
export function spineOf(schema: CollectionSchema): Spine | undefined {
  return spines.get(schema);
}

/** The most problems an issue's message lists; it counts the others. */
const MAX_LISTED = 10;

/**
 * Loads a collection's schema: reads its file and the files its references name, checks them as vmd's rules for schemas say,
 * and compiles them with the validator. Gives null for a collection without a schema.
 *
 * Fails with one issue about the collection, with no path and no node, whose message lists every problem found, each with its
 * file and position: `storage-failed` when a file cannot be read; otherwise `feature-unsupported` when the schema uses an
 * `x-vmd-*` keyword this version does not define, which may come from a newer minor version, naming the store's declared
 * version; otherwise `schema-invalid`, for a schema that is missing, too large, not a valid 2020-12 schema, or breaks one of
 * vmd's rules (`$id`, YAML anchors, references out of the directory, extension keywords malformed or off the spine). Every
 * reader refuses the collection's records with that issue.
 *
 * The validator does not see inside `x-vmd-list`, whose lists a record's binding evaluates natively: the per-key and
 * `additional` schemas are compiled here, for {@link CollectionSchema.validate} to check items against.
 */
export async function loadCollectionSchema(
  collection: Collection,
  loading: SchemaLoading,
): Promise<Outcome<CollectionSchema> | null> {
  const root = collection.schema;
  if (root === undefined) return null;
  const set = await readSchemaSet(root, loading.read);
  const problems: SchemaProblem[] = [...set.problems];
  const metaRoots: { readonly file: string; readonly pointer: string; readonly value: unknown }[] = [];
  const listSchemas: SchemaLocation[] = [];
  for (const document of set.files.values()) metaRoots.push({ file: document.path, pointer: "", value: document.value });
  for (const { location, value } of set.schemas.values()) {
    if (!isObject(value)) continue;
    const document = set.files.get(location.file);
    for (const problem of checkExtensionKeywords(value, location.pointer)) {
      const position = document?.position(problem.pointer);
      problems.push({
        code: problem.unsupported === true ? "feature-unsupported" : "schema-invalid",
        file: location.file,
        message: problem.message,
        ...(position === undefined ? {} : { position }),
      });
    }
    // The meta-schema does not look into an unknown keyword, so the per-key schemas of a keyed list are checked on their own,
    // and compiled on their own for the items they apply to.
    const list = value["x-vmd-list"];
    if (!isObject(list)) continue;
    const at = childPath(location.pointer, "x-vmd-list");
    if (isObject(list.items)) {
      for (const [key, item] of Object.entries(list.items)) {
        if (!isSchemaValue(item)) continue;
        const pointer = childPath(childPath(at, "items"), key);
        metaRoots.push({ file: location.file, pointer, value: item });
        listSchemas.push({ file: location.file, pointer });
      }
    }
    if (isObject(list.additional)) {
      const pointer = childPath(at, "additional");
      metaRoots.push({ file: location.file, pointer, value: list.additional });
      listSchemas.push({ file: location.file, pointer });
    }
  }
  for (const meta of metaRoots) {
    const document = set.files.get(meta.file);
    for (const failure of await metaSchemaFailures(meta.value as never)) {
      const pointer = `${meta.pointer}${failure.pointer}`;
      const position = document?.position(pointer);
      problems.push({
        code: "schema-invalid",
        file: meta.file,
        message: `${pointer === "" ? "the schema" : pointer} is not valid JSON Schema 2020-12 (the meta-schema's ${failure.keywords.join(", ")})`,
        ...(position === undefined ? {} : { position }),
      });
    }
  }
  let spine: Spine | undefined;
  // The spine's problems that the issue does not list, which the spine counts without keeping.
  let unlisted = 0;
  if (problems.length === 0) {
    spine = new Spine(set);
    const checked = spine.check(MAX_LISTED);
    unlisted = checked.unlisted;
    for (const problem of checked.problems) {
      const position = set.files.get(problem.location.file)?.position(problem.location.pointer);
      problems.push({
        code: "schema-invalid",
        file: problem.location.file,
        message: problem.message,
        ...(position === undefined ? {} : { position }),
      });
    }
  }
  if (problems.length === 0 && spine !== undefined) {
    try {
      const compiled = await compileSchemaSet(set, loading.configuration, listSchemas);
      const shape = spine.root;
      const schema: CollectionSchema = {
        collection: collection.name,
        digest: compiled.digest,
        root: shape,
        validate: (record, lists) => {
          const errors: ValidatorError[] = compiled.validate(record.value);
          for (const { at, location } of lists?.subschemas ?? []) {
            const item = valueAt(record, at);
            // A failure's instance location is relative to the item, whose exact path comes first.
            for (const error of compiled.validateAt(location, item)) errors.push({ ...error, at: `${at}${error.at}` });
          }
          return violationIssues(record, set, errors, lists?.failures ?? []);
        },
      };
      spines.set(schema, spine);
      return succeed(schema);
    } catch (error) {
      // The set's own checks guarantee that every reference has a target in it, so a retrieval is a bug of those checks.
      if (!(error instanceof Error) || error.name === "RetrievalError") throw error;
      // The validator names files by the URIs core registered them under, which messages give as the files' paths.
      const message = error.message.replaceAll(/https:\/\/vmd\.invalid\/[0-9a-f]{64}\/schema\//g, "");
      problems.push({ code: "schema-invalid", file: root, message: `the validator cannot compile it: ${message}` });
    }
  }
  return fail([schemaIssue(collection, set, problems, loading, unlisted)]);
}

// Deviation from the I2 design, recorded in issue #22: one issue per collection lists every problem, rather than one issue
// per problem, since the specification reports a schema's issue once and the suite expects one for two YAML problems.
/**
 * The one issue of a collection whose schema cannot be used, listing its problems: those given, and `unlisted` more that
 * follow them and are only counted.
 */
function schemaIssue(
  collection: Collection,
  set: SchemaSet,
  problems: readonly SchemaProblem[],
  loading: SchemaLoading,
  unlisted: number,
): Issue {
  const code = problems.some((problem) => problem.code === "storage-failed")
    ? "storage-failed"
    : problems.some((problem) => problem.code === "feature-unsupported")
      ? "feature-unsupported"
      : "schema-invalid";
  const consequence = "so the collection's records cannot be read";
  const total = problems.length + unlisted;
  const only = total === 1 ? problems[0] : undefined;
  let message: string;
  if (only !== undefined && only.file === set.root && only.position === undefined && only.message.startsWith(`${set.root} `)) {
    message = `the schema ${set.root} of the collection ${collection.name} ${only.message.slice(set.root.length + 1)}, ${consequence}`;
  } else {
    const listed = problems.slice(0, MAX_LISTED).map((problem) => {
      const where =
        problem.position === undefined ? problem.file : `${problem.file}:${problem.position.line}:${problem.position.col}`;
      return `${where}: ${problem.message}`;
    });
    if (total > MAX_LISTED) listed.push(`and ${total - MAX_LISTED} more`);
    message = `the schema ${set.root} of the collection ${collection.name} cannot be used, ${consequence}: ${listed.join("; ")}`;
  }
  if (code === "feature-unsupported") {
    message += `; an x-vmd-* keyword this vmd does not define may come from a newer minor version, and the store declares format version ${loading.declared}`;
  }
  const hints = [`schemas are in the schema/ directory beside ${loading.configurationName}`];
  for (const problem of problems) if (problem.hint !== undefined && !hints.includes(problem.hint)) hints.push(problem.hint);
  return makeIssue({
    code,
    path: null,
    at: null,
    message,
    hint: hints.join("; "),
    ...(code === "feature-unsupported" ? { class: "operation" } : {}),
  });
}
