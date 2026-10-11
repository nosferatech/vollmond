import { parseYamlUnit } from "../format/yaml.js";
import { type IssueCode, isIssueCode } from "../issue/codes.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { type SeveritySetting, settingsAllowed } from "../issue/severity.js";
import { childPath } from "../record/exact-path.js";
import type { NodeInit } from "../record/node-index.js";
import { checkStoragePath, compareUtf8, compileGlob } from "../storage/path.js";
import { checkPortableRegex, portableRegexToJavaScript } from "../storage/portable-regex.js";
import { decodeSource, type Position, type SourceText } from "../text/source-text.js";
import { sliceUnitText } from "../text/unit-text.js";
import type { Value, ValueObject } from "../value/value.js";

/** What vmd reads of a store's configuration: every member, with its default where the configuration leaves it out. */
export interface StoreConfiguration {
  /** The store's major format version: {@link SUPPORTED_FORMAT_VERSION}, since a configuration with another one is refused. */
  readonly vmd: number;
  /** The format version as the configuration declares it, a minor version included: `1`, or `1.2`. */
  readonly declared: number;
  /** How repeated keys and anchors are reported at the levels no schema declares: as errors, or as warnings. */
  readonly uniqueness: "strict" | "lenient";
  /** Whether the warnings about YAML 1.1 readers are on (`compatible`) or off (`minimal`). */
  readonly yamlQuoting: "compatible" | "minimal";
  /** The severities the configuration sets, by issue code, each within the limits that code allows. */
  readonly issues: ReadonlyMap<IssueCode, SeveritySetting>;
  /** The collections, in the UTF-8 byte order of their names. */
  readonly collections: readonly Collection[];
  /** The globs of the paths vmd ignores beyond `.vmd/` and dotfiles, as written. */
  readonly ignore: readonly string[];
}

/** A collection of the configuration: which records it holds, and the rules they follow. */
export interface Collection {
  /** Its name, which matches `[A-Za-z][A-Za-z0-9_-]*`. */
  readonly name: string;
  /** The globs over store paths whose records it holds: at least one. */
  readonly match: readonly string[];
  /** The globs of the paths it leaves out, of those `match` gives. */
  readonly exclude: readonly string[];
  /** Its schema's file, relative to the schema directory beside the configuration file; absent when it has none. */
  readonly schema?: string;
  /** A pattern in the portable regex subset that its records' file names must match; absent when there is none. */
  readonly filename?: string;
  /** Where its records' keys come from: the one group of a file-name pattern, or a field. */
  readonly key?: CollectionKey;
  /** What a query of the collection matches by default: records, or sections. */
  readonly queryTarget: "records" | "nodes";
}

// Deviation from the I2 design, recorded in issue #21: a collection's `key` is read and checked here, but no record's key is
// computed yet, since nothing uses one before the index's records table and the `collection:key` shorthand.
/** Where a collection's keys come from: the one capture group of a portable pattern over the file name, or a root field. */
export type CollectionKey = { readonly filename: string } | { readonly field: string };

/** The major format version of the stores this vmd reads. */
export const SUPPORTED_FORMAT_VERSION = 1;

/** The largest configuration file, in bytes, that vmd reads: a mebibyte, far more than any configuration needs. */
export const MAX_CONFIGURATION_BYTES = 1024 * 1024;

/**
 * Codes that the YAML reader raises for the shape of a record, which a configuration does not have: its members are not
 * sections or fields, so a `$` member is refused here as an unknown member rather than as a section's.
 */
const RECORD_SHAPE_CODES: ReadonlySet<IssueCode> = new Set([
  "dollar-member",
  "feature-unsupported",
  "reserved-member-type",
  "ref-malformed",
  "section-title-missing",
  "duplicate-tag",
]);

/** The pattern of a collection's name. */
const COLLECTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The members of a configuration, of a collection, of a collection's `key` and of its `query`. */
const CONFIGURATION_MEMBERS: ReadonlySet<string> = new Set([
  "vmd",
  "uniqueness",
  "yaml_quoting",
  "issues",
  "collections",
  "ignore",
]);
const COLLECTION_MEMBERS: ReadonlySet<string> = new Set(["match", "exclude", "schema", "filename", "key", "query"]);
const KEY_MEMBERS: ReadonlySet<string> = new Set(["filename", "field"]);
const QUERY_MEMBERS: ReadonlySet<string> = new Set(["target"]);

/**
 * Reads a store's configuration file: decodes it as UTF-8, parses it as one YAML document with vmd's YAML rules, and reads
 * every member, giving each one left out its default. A configuration file is not a record, so every issue has no `path` and
 * no node (`at` is null); a caller names the file where it prints them. Every problem is reported, each at its position.
 *
 * - Fails with `format-version-unsupported` alone for a major version other than {@link SUPPORTED_FORMAT_VERSION}, since a
 *   configuration of another major version may hold members this vmd does not know.
 * - Fails with `config-invalid` for a file larger than {@link MAX_CONFIGURATION_BYTES}, without parsing it; for one that is
 *   not UTF-8, not YAML, or holds what vmd's YAML refuses (an anchor, a tag, several documents, a repeated member...); for a
 *   document that is not a mapping; for a configuration without `vmd`, or whose `vmd` is not a number from 1; and for a member
 *   whose value is not one the member takes: a value of the wrong kind, a malformed glob, a collection name outside
 *   `[A-Za-z][A-Za-z0-9_-]*`, a schema path with a `.` or `..` segment, a pattern outside the portable subset, a key pattern
 *   without exactly one capture group, an unknown issue code, or a severity outside the limits that code allows.
 * - Fails with `feature-unsupported`, an operation issue, for a member this version does not define, at the top or in a
 *   collection, its key or its query, since a newer minor version may define it; the message names the declared version.
 * - Reads `vmd` as a major version, followed by a minor one after a point: `1.2` is major version 1, read without a warning.
 *   How a store writes a minor version is not decided yet, so only the major version is relied on.
 *
 * The configuration is frozen, with its collections and lists.
 */
export function readStoreConfiguration(content: Uint8Array): Outcome<StoreConfiguration> {
  if (content.length > MAX_CONFIGURATION_BYTES) {
    return fail([invalid(`the configuration is larger than ${MAX_CONFIGURATION_BYTES} bytes`, undefined)]);
  }
  const decoded = decodeSource("", content, "config-invalid");
  if (!decoded.ok) return fail(decoded.issues.map(configInvalid));
  const source = decoded.value;
  const start = source.hasBom ? 1 : 0;
  const unit = parseYamlUnit(source, sliceUnitText(source.text, start, source.text.length), {
    path: "",
    at: "",
    unit: "front-matter",
  });
  const problems = unit.issues.filter((issue) => !RECORD_SHAPE_CODES.has(issue.code)).map(configInvalid);
  if (problems.length > 0 || unit.value === undefined) {
    return fail(problems.length > 0 ? problems : [invalid("the configuration has no value", undefined)]);
  }
  const nodes = new Map<string, NodeInit>();
  for (const node of unit.nodes) nodes.set(childPath(node.parent, node.key), node.init);
  return new ConfigurationReader(source, nodes).read(unit.value);
}

/** The reading of one configuration's value, which collects every problem it finds. */
class ConfigurationReader {
  readonly #source: SourceText;
  /** Each node of the configuration's value by its exact path, for positions. */
  readonly #nodes: ReadonlyMap<string, NodeInit>;
  readonly #problems: Issue[] = [];
  /** How messages name the version the store declares. */
  #declared = "the store declares no format version";

  constructor(source: SourceText, nodes: ReadonlyMap<string, NodeInit>) {
    this.#source = source;
    this.#nodes = nodes;
  }

  /** Reads the configuration's members, and gives the configuration or every problem found. */
  read(value: ValueObject): Outcome<StoreConfiguration> {
    const declared = Object.hasOwn(value, "vmd") ? value.vmd : undefined;
    if (declared === undefined) {
      this.#invalid('the configuration has no "vmd", the store\'s format version; write "vmd: 1"', null);
    } else if (typeof declared !== "number" || !Number.isFinite(declared) || declared < 1) {
      this.#invalid(`"vmd", the store's format version, must be a number from 1, not ${describe(declared)}`, "/vmd");
    } else {
      if (Math.trunc(declared) !== SUPPORTED_FORMAT_VERSION) {
        return fail([
          makeIssue({
            code: "format-version-unsupported",
            path: null,
            at: null,
            message: `the store's format version is ${declared}, and this vmd reads major version ${SUPPORTED_FORMAT_VERSION} only`,
            hint: "use a vmd that supports the store's version",
            ...this.#positionField("/vmd"),
          }),
        ]);
      }
      this.#declared = `the store declares format version ${declared}`;
    }
    this.#unknownMembers(value, "", CONFIGURATION_MEMBERS, "the configuration");
    const uniqueness = this.#choice(value, "", "uniqueness", ["strict", "lenient"] as const) ?? "strict";
    const yamlQuoting = this.#choice(value, "", "yaml_quoting", ["compatible", "minimal"] as const) ?? "compatible";
    const issues = this.#issues(value);
    const collections = this.#collections(value);
    const ignore = this.#globs(value, "", "ignore", '"ignore"') ?? [];
    if (this.#problems.length > 0 || typeof declared !== "number") return fail(this.#problems);
    return succeed(
      Object.freeze({
        vmd: SUPPORTED_FORMAT_VERSION,
        declared,
        uniqueness,
        yamlQuoting,
        issues,
        collections: Object.freeze(collections),
        ignore: Object.freeze(ignore),
      }),
    );
  }

  /** Reads `issues`: a mapping from known codes to settings within each code's limits. */
  #issues(value: ValueObject): ReadonlyMap<IssueCode, SeveritySetting> {
    const entries = new Map<IssueCode, SeveritySetting>();
    const issues = this.#mapping(value, "", "issues", '"issues"');
    if (issues === undefined) return entries;
    for (const [code, setting] of Object.entries(issues)) {
      const at = childPath("/issues", code);
      if (!isIssueCode(code)) {
        this.#invalid(`"issues" names ${JSON.stringify(code)}, which is not an issue code`, at);
        continue;
      }
      const allowed = settingsAllowed(code);
      if (setting !== "off" && setting !== "warning" && setting !== "error") {
        this.#invalid(`"issues" sets ${code} to ${describe(setting)}; a setting is "off", "warning" or "error"`, at);
      } else if (!allowed.includes(setting)) {
        const limit =
          allowed.length === 0
            ? "it is a structural or an operation code, which cannot be configured"
            : "a validation error stays an error, so it can only be set to error";
        this.#invalid(`"issues" sets ${code} to ${setting}, but ${limit}`, at);
      } else {
        entries.set(code, setting);
      }
    }
    return entries;
  }

  /** Reads `collections`: a mapping from names to collections, kept in the byte order of the names. */
  #collections(value: ValueObject): Collection[] {
    const mapping = this.#mapping(value, "", "collections", '"collections"');
    if (mapping === undefined) return [];
    const collections: Collection[] = [];
    for (const [name, entry] of Object.entries(mapping)) {
      const at = childPath("/collections", name);
      if (!COLLECTION_NAME.test(name)) {
        this.#invalid(
          `the collection name ${JSON.stringify(name)} must start with a letter and hold only letters, digits, _ and -`,
          at,
        );
        continue;
      }
      if (!isMapping(entry)) {
        this.#invalid(`the collection ${name} must be a mapping, not ${describe(entry)}`, at);
        continue;
      }
      const collection = this.#collection(name, entry, at);
      if (collection !== undefined) collections.push(collection);
    }
    return collections.sort((a, b) => compareUtf8(a.name, b.name));
  }

  /**
   * Reads one collection, reporting its problems; gives undefined when it has no list of globs to match. A collection with
   * problems is given too, since its problems make the whole configuration invalid.
   */
  #collection(name: string, entry: ValueObject, at: string): Collection | undefined {
    const what = `the collection ${name}`;
    this.#unknownMembers(entry, at, COLLECTION_MEMBERS, what);
    const match = this.#globs(entry, at, "match", `the "match" of ${what}`);
    if (!Object.hasOwn(entry, "match")) {
      this.#invalid(`${what} has no "match", the globs of the records it holds`, at);
    } else if (Array.isArray(entry.match) && entry.match.length === 0) {
      this.#invalid(`the "match" of ${what} must give at least one glob`, childPath(at, "match"));
    }
    const exclude = this.#globs(entry, at, "exclude", `the "exclude" of ${what}`) ?? [];
    const schema = this.#schemaPath(entry, at, what);
    const filename = this.#pattern(entry, at, "filename", `the "filename" of ${what}`);
    const key = this.#key(entry, at, what);
    const queryTarget = this.#queryTarget(entry, at, what);
    if (match === undefined) return undefined;
    return Object.freeze({
      name,
      match: Object.freeze(match),
      exclude: Object.freeze(exclude),
      ...(schema === undefined ? {} : { schema }),
      ...(filename === undefined ? {} : { filename }),
      ...(key === undefined ? {} : { key: Object.freeze(key) }),
      queryTarget,
    });
  }

  /** Reads a collection's `schema`: a path relative to the schema directory, without `.` or `..` segments. */
  #schemaPath(entry: ValueObject, at: string, what: string): string | undefined {
    if (!Object.hasOwn(entry, "schema")) return undefined;
    const schema = entry.schema;
    const place = childPath(at, "schema");
    if (typeof schema !== "string") {
      this.#invalid(`the "schema" of ${what} must be a file name, not ${describe(schema)}`, place);
      return undefined;
    }
    const malformed = checkStoragePath(schema);
    if (malformed !== null) {
      this.#invalid(
        `the "schema" of ${what}, ${JSON.stringify(schema)}, must be a path in the schema directory, relative and without . or .. segments`,
        place,
      );
      return undefined;
    }
    return schema;
  }

  /** Reads a collection's `key`: exactly one of a file-name pattern with one capture group and a field name. */
  #key(entry: ValueObject, at: string, what: string): CollectionKey | undefined {
    const key = this.#mapping(entry, at, "key", `the "key" of ${what}`);
    if (key === undefined) return undefined;
    const place = childPath(at, "key");
    this.#unknownMembers(key, place, KEY_MEMBERS, `the "key" of ${what}`);
    const forms = ["filename", "field"].filter((form) => Object.hasOwn(key, form));
    if (forms.length !== 1) {
      this.#invalid(`the "key" of ${what} must give exactly one of "filename" and "field"`, place);
      return undefined;
    }
    if (forms[0] === "field") {
      const field = key.field;
      if (typeof field !== "string" || field === "") {
        this.#invalid(`the key field of ${what} must be a member name, not ${describe(field)}`, childPath(place, "field"));
        return undefined;
      }
      return { field };
    }
    const filename = this.#pattern(key, place, "filename", `the key pattern of ${what}`);
    if (filename === undefined) return undefined;
    const groups = captureGroupCount(filename);
    if (groups !== 1) {
      this.#invalid(
        `the key pattern of ${what} must have exactly one capture group, which gives the key; it has ${groups}`,
        childPath(place, "filename"),
      );
      return undefined;
    }
    return { filename };
  }

  /** Reads a collection's `query`, whose `target` is `records`, the default, or `nodes`. */
  #queryTarget(entry: ValueObject, at: string, what: string): "records" | "nodes" {
    const query = this.#mapping(entry, at, "query", `the "query" of ${what}`);
    if (query === undefined) return "records";
    const place = childPath(at, "query");
    this.#unknownMembers(query, place, QUERY_MEMBERS, `the "query" of ${what}`);
    return this.#choice(query, place, "target", ["records", "nodes"] as const) ?? "records";
  }

  /** Reads a member that is one of `choices`, reporting any other value; undefined when absent or invalid. */
  #choice<const T extends string>(object: ValueObject, at: string, member: string, choices: readonly T[]): T | undefined {
    if (!Object.hasOwn(object, member)) return undefined;
    const value = object[member];
    if (typeof value === "string" && (choices as readonly string[]).includes(value)) return value as T;
    const allowed = choices.map((choice) => JSON.stringify(choice)).join(" or ");
    this.#invalid(`${JSON.stringify(member)} must be ${allowed}, not ${describe(value)}`, childPath(at, member));
    return undefined;
  }

  /** Reads a member that must be a mapping, reporting any other value; undefined when absent or invalid. */
  #mapping(object: ValueObject, at: string, member: string, what: string): ValueObject | undefined {
    if (!Object.hasOwn(object, member)) return undefined;
    const value = object[member];
    if (isMapping(value)) return value;
    this.#invalid(`${what} must be a mapping, not ${describe(value)}`, childPath(at, member));
    return undefined;
  }

  /** Reads a member that must be a list of well-formed globs; undefined when absent or not a list. */
  #globs(object: ValueObject, at: string, member: string, what: string): string[] | undefined {
    if (!Object.hasOwn(object, member)) return undefined;
    const value = object[member];
    const place = childPath(at, member);
    if (!Array.isArray(value)) {
      this.#invalid(`${what} must be a list of globs, not ${describe(value)}`, place);
      return undefined;
    }
    const globs: string[] = [];
    value.forEach((glob: Value, index: number) => {
      const item = childPath(place, index);
      if (typeof glob !== "string") {
        this.#invalid(`${what} must hold globs, and its item ${index + 1} is ${describe(glob)}`, item);
        return;
      }
      const compiled = compileGlob(glob);
      if (!compiled.ok) {
        this.#invalid(`${what}: ${compiled.issues[0]?.message}`, item);
        return;
      }
      globs.push(glob);
    });
    return globs;
  }

  /** Reads a member that must be a pattern in the portable regex subset; undefined when absent or invalid. */
  #pattern(object: ValueObject, at: string, member: string, what: string): string | undefined {
    if (!Object.hasOwn(object, member)) return undefined;
    const value = object[member];
    const place = childPath(at, member);
    if (typeof value !== "string") {
      this.#invalid(`${what} must be a pattern, not ${describe(value)}`, place);
      return undefined;
    }
    const [problem] = checkPortableRegex(value);
    if (problem !== undefined) {
      this.#invalid(`${what}: ${problem.message}`, place);
      return undefined;
    }
    return value;
  }

  /** Reports each member of `object` that is not one of `known`, as `feature-unsupported`. */
  #unknownMembers(object: ValueObject, at: string, known: ReadonlySet<string>, what: string): void {
    for (const member of Object.keys(object)) {
      if (known.has(member)) continue;
      this.#problems.push(
        makeIssue({
          code: "feature-unsupported",
          class: "operation",
          path: null,
          at: null,
          message:
            `${what} has the member ${JSON.stringify(member)}, which this version of vmd does not define; it may come ` +
            `from a newer minor version of the format (${this.#declared})`,
          hint: "use a vmd that reads the store's version, or remove the member",
          ...this.#positionField(childPath(at, member)),
        }),
      );
    }
  }

  /** Reports a `config-invalid` at the node `at` names, or with no position for null. */
  #invalid(message: string, at: string | null): void {
    this.#problems.push(invalid(message, at === null ? undefined : this.#positionOf(at)));
  }

  /** The position of the node at an exact path: a member's from its name, an item's from its value. */
  #positionOf(at: string): Position | undefined {
    const init = this.#nodes.get(at);
    return init === undefined ? undefined : this.#source.position((init.memberRange ?? init.range).start);
  }

  /** The `position` member of an issue at the node `at` names, or none when the node has no position. */
  #positionField(at: string): { readonly position?: Position } {
    const position = this.#positionOf(at);
    return position === undefined ? {} : { position };
  }
}

/** Whether a value is a mapping: an object that is not a list. */
function isMapping(value: Value | undefined): value is ValueObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Counts the capture groups of a portable pattern. Precondition: the pattern is portable. */
function captureGroupCount(pattern: string): number {
  // An empty alternative makes every pattern match the empty string, so the match holds one entry per group.
  const match = new RegExp(`${portableRegexToJavaScript(pattern, false)}|`, "su").exec("");
  return (match as RegExpExecArray).length - 1;
}

/** Turns an issue of the decoder or the YAML reader into a `config-invalid` with the same message and position. */
function configInvalid(issue: Issue): Issue {
  return invalid(issue.message, issue.position);
}

/** A `config-invalid` issue. */
function invalid(message: string, position: Position | undefined): Issue {
  return makeIssue({ code: "config-invalid", path: null, at: null, message, ...(position === undefined ? {} : { position }) });
}

/** Describes a value for a message: its JSON text, or its kind for a collection. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return "a list";
  if (value !== null && typeof value === "object") return "a mapping";
  return JSON.stringify(value);
}
