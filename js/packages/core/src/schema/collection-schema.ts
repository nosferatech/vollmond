import type { Collection } from "../config/configuration.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import type { ParsedRecord } from "../record/record.js";
import { checkExtensionKeywords } from "./keywords.js";
import { readSchemaSet, type SchemaProblem, type SchemaReader, type SchemaSet } from "./schema-set.js";
import { type SchemaShape, Spine } from "./spine.js";
import { compileSchemaSet, metaSchemaFailures } from "./validator.js";
import { violationIssues } from "./violations.js";
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
  /**
   * Validates a record's value view against the schema: one `schema-violation` per failing value, at its exact path, the
   * logical types of §4.3 included; none for a valid record.
   */
  validate(record: ParsedRecord): readonly Issue[];
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
 * The keyed lists that `x-vmd-list` declares are not evaluated yet: their per-key schemas, required keys and uniqueness are
 * checked once records are bound to their schema.
 */
// TODO(#23): keyed lists are evaluated natively with the binding of keyed lists; until then the validator checks every
// other keyword, and `x-vmd-list` is only checked for its form and its place on the spine.
export async function loadCollectionSchema(
  collection: Collection,
  loading: SchemaLoading,
): Promise<Outcome<CollectionSchema> | null> {
  const root = collection.schema;
  if (root === undefined) return null;
  const set = await readSchemaSet(root, loading.read);
  const problems: SchemaProblem[] = [...set.problems];
  const metaRoots: { readonly file: string; readonly pointer: string; readonly value: unknown }[] = [];
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
    // The meta-schema does not look into an unknown keyword, so the per-key schemas of a keyed list are checked on their own.
    const list = value["x-vmd-list"];
    if (!isObject(list)) continue;
    const at = childPath(location.pointer, "x-vmd-list");
    if (isObject(list.items)) {
      for (const [key, item] of Object.entries(list.items)) {
        if (isSchemaValue(item))
          metaRoots.push({ file: location.file, pointer: childPath(childPath(at, "items"), key), value: item });
      }
    }
    if (isObject(list.additional))
      metaRoots.push({ file: location.file, pointer: childPath(at, "additional"), value: list.additional });
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
      const compiled = await compileSchemaSet(set, loading.configuration);
      const shape = spine.root;
      return succeed({
        collection: collection.name,
        digest: compiled.digest,
        root: shape,
        validate: (record) => violationIssues(record, set, compiled.validate(record.value)),
      });
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
