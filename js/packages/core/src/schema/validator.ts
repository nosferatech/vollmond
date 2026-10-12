import { removeUriSchemePlugin } from "@hyperjump/browser";
import {
  registerSchema,
  type SchemaObject,
  setShouldValidateFormat,
  unregisterSchema,
  type Validator,
  validate,
} from "@hyperjump/json-schema/draft-2020-12";
import { addFormat, type EvaluationPlugin, setFormatHandler } from "@hyperjump/json-schema/experimental";
import { uri as instanceUri } from "@hyperjump/json-schema/instance/experimental";
import type { Value, ValueObject } from "../value/value.js";
import { LOGICAL_TYPES } from "./logical-types.js";
import { DRAFT_2020_12, locationKey, type SchemaLocation, type SchemaSet } from "./schema-set.js";
import { isObject, pointerTokens } from "./walk.js";

// The adapter over @hyperjump/json-schema, whose registry, format handlers and format setting are global to the process. Core
// registers each schema set under URIs of its own digest, so that one set of bytes is registered once whatever the number of
// stores that read it, and other bytes never meet an "already registered" error; a bounded memo of the sets keeps the registry
// from growing without end. The format handlers are vmd's own, for the logical types' names only, set once.

/** A failure the validator reports, folded so that no applicator's branches are reported beside it. */
export interface ValidatorError {
  /** The failing keyword's identifier, such as `https://json-schema.org/keyword/type`; `validate` for a `false` schema. */
  readonly keyword: string;
  /** The keyword's location: the schema file and the JSON Pointer of the keyword (of the `false` schema for `validate`). */
  readonly file: string;
  readonly pointer: string;
  /** The instance location as an exact path; for a member name that a `propertyNames` refuses, the member's. */
  readonly at: string;
  /** Whether the failing value is a member name, which `propertyNames` checks, rather than a value. */
  readonly name: boolean;
}

/** A schema set compiled by the validator. */
export interface CompiledSchemaSet {
  /** The SHA-256 of the configuration and the set's files, in hexadecimal. */
  readonly digest: string;
  /** Validates a value against the set's root schema, giving its folded failures, none for a valid value. */
  validate(value: Value): ValidatorError[];
  /**
   * Validates a value against one of the schemas the set was compiled with besides its root, such as a keyed list's per-key
   * schema, giving its folded failures with instance locations relative to the value.
   *
   * Throws a `RangeError` for a location the set was not compiled with.
   */
  validateAt(location: SchemaLocation, value: Value): ValidatorError[];
}

/** The keywords whose failure stands for its subschemas' failures, which are then not reported. */
const FOLDED_KEYWORDS: ReadonlySet<string> = new Set([
  "https://json-schema.org/keyword/anyOf",
  "https://json-schema.org/keyword/oneOf",
  "https://json-schema.org/keyword/not",
  "https://json-schema.org/keyword/contains",
]);

/** The identifier hyperjump gives the failure of a `false` schema. */
export const FALSE_SCHEMA_KEYWORD = "https://json-schema.org/evaluation/validate";

/** The most schema sets kept registered in the process; registering one more unregisters the least recently used. */
export const MAX_REGISTERED_SETS = 64;

/** The host of the URIs core registers schemas under, which never resolves (RFC 2606, section 2). */
const BASE = "https://vmd.invalid/";

interface RegisteredSet {
  readonly uris: readonly string[];
  readonly files: ReadonlyMap<string, string>;
  /** The compiled schemas, by URI: the root of each collection schema file the set was compiled for, and the others asked for. */
  readonly validators: Map<string, Promise<Validator>>;
}

/** The schema sets registered, by digest, the most recently used last. */
const registered = new Map<string, RegisteredSet>();

let formatsSet = false;

/** Registers vmd's format handlers for the logical types of §4.3 and turns format assertion on, once for the process. */
function setFormats(): void {
  if (formatsSet) return;
  formatsSet = true;
  for (const [name, type] of LOGICAL_TYPES) {
    const id = `${BASE}format/${name}`;
    addFormat({ id, handler: (value) => type.check(value as Value) });
    setFormatHandler("https://json-schema.org/keyword/draft-2020-12/format", name, id);
    setFormatHandler("https://json-schema.org/keyword/draft-2020-12/format-assertion", name, id);
  }
  setShouldValidateFormat(true);
}

/**
 * Registers a schema set with the validator and compiles its root and the schemas at `others`, or reuses the registration
 * and compilations of the same bytes made earlier in the process. Every `$ref` and `$dynamicRef` is rewritten to the absolute
 * URI of its target, which the set has resolved, so that the validator resolves nothing itself and never retrieves anything.
 * Rejects with the validator's error for a schema it cannot compile, such as one with a pattern that is not a regular
 * expression; the set must have no problems, its references must have targets, and each of `others` must be a schema object
 * or a boolean schema of the set.
 */
export async function compileSchemaSet(
  set: SchemaSet,
  configuration: Uint8Array,
  others: readonly SchemaLocation[] = [],
): Promise<CompiledSchemaSet> {
  setFormats();
  const digest = await digestOf(set, configuration);
  let entry = registered.get(digest);
  if (entry === undefined) {
    entry = register(set, digest);
    if (registered.size > MAX_REGISTERED_SETS) {
      const [oldest, evicted] = registered.entries().next().value as [string, RegisteredSet];
      for (const uri of evicted.uris) unregisterSchema(uri);
      registered.delete(oldest);
    }
  } else {
    registered.delete(digest);
    registered.set(digest, entry);
  }
  const files = entry.files;
  const validator = await compiled(entry, files.get(set.root) as string);
  const atLocation = new Map<string, Validator>();
  for (const location of others) {
    const uri = `${files.get(location.file) as string}#${encodePointer(location.pointer)}`;
    atLocation.set(locationKey(location), await compiled(entry, uri));
  }
  return {
    digest,
    validate: (value) => run(validator, value, files),
    validateAt: (location, value) => {
      const found = atLocation.get(locationKey(location));
      if (found === undefined) throw new RangeError(`the schema set was not compiled with ${locationKey(location)}`);
      return run(found, value, files);
    },
  };
}

/** Compiles the schema at a URI of a registered set, once per registration. */
function compiled(entry: RegisteredSet, uri: string): Promise<Validator> {
  let compiling = entry.validators.get(uri);
  if (compiling === undefined) {
    compiling = validate(uri);
    entry.validators.set(uri, compiling);
    // A failed compilation is not kept, so that it is attempted, and reported, again.
    compiling.catch(() => entry.validators.delete(uri));
  }
  return compiling;
}

/**
 * Removes the validator's `http`, `https` and `file` URI schemes for the whole process, a second line of defense behind
 * core's own checks, which already keep the validator from retrieving anything. Registered schemas are still served. Core
 * never calls it, since the schemes are global to the process and another user of the validator in a host may need them; a
 * host that runs vmd alone, such as the CLI, calls it once at start.
 */
export function closeValidatorUriSchemes(): void {
  for (const scheme of ["http", "https", "file"]) removeUriSchemePlugin(scheme);
}

/** How many schema sets are registered now, for tests of the bound. */
export function registeredSetCount(): number {
  return registered.size;
}

// Deviation from the I2 design, recorded in issue #22: references are rewritten to their targets' URIs, so that core's
// resolution of a reference is the only one and the validator never resolves one differently.
/** Registers every file of a set under its digest's URIs, its references rewritten to absolute URIs. */
function register(set: SchemaSet, digest: string): RegisteredSet {
  const files = new Map<string, string>();
  for (const path of set.files.keys())
    files.set(path, `${BASE}${digest}/schema/${path.split("/").map(encodeURIComponent).join("/")}`);
  const copies = new Map<string, Value>();
  for (const [path, document] of set.files) copies.set(path, copy(document.value));
  for (const reference of set.references.values()) {
    if (reference.target === null) continue;
    const holder = objectAt(copies.get(reference.from.file) as Value, reference.from.pointer);
    const target = files.get(reference.target.file) as string;
    holder[reference.keyword] =
      reference.anchor !== null && reference.keyword === "$dynamicRef"
        ? `${target}#${reference.anchor}`
        : `${target}#${encodePointer(reference.target.pointer)}`;
  }
  const uris: string[] = [];
  try {
    for (const [path, value] of copies) {
      const uri = files.get(path) as string;
      registerSchema(value as SchemaObject, uri, DRAFT_2020_12);
      uris.push(uri);
    }
  } catch (error) {
    // All or nothing: a set registered in part would make its next registration fail with "already registered".
    for (const uri of uris) unregisterSchema(uri);
    throw error;
  }
  const entry: RegisteredSet = { uris, files, validators: new Map() };
  registered.set(digest, entry);
  return entry;
}

/** Runs a compiled validator over a value, collecting its failures with the folding plugin. */
function run(validator: Validator, value: Value, files: ReadonlyMap<string, string>): ValidatorError[] {
  const plugin = new FoldingPlugin();
  validator(value as SchemaObject, { plugins: [plugin as EvaluationPlugin] });
  const byUri = new Map<string, string>();
  for (const [path, uri] of files) byUri.set(uri, path);
  return plugin.errors.map((error) => toError(error, byUri));
}

/** A failure as the plugin records it, before its URIs are read. */
interface RawError {
  readonly keyword: string;
  readonly location: string;
  readonly instance: string;
}

// Deviation from the I2 design, recorded in issue #22: the folding of failures follows the evaluation, through a plugin,
// rather than keyword locations, which a `$ref` under an applicator would leave outside it.
/**
 * An evaluation plugin that records failures as hyperjump's BASIC output does, except that a failing `anyOf`, `oneOf`, `not`
 * or `contains` stands alone, without its subschemas' failures, which are about branches or items that need not be valid. The
 * folding follows the evaluation, so it holds through a `$ref` whatever the locations of the subschemas.
 */
class FoldingPlugin {
  errors: RawError[] = [];

  afterKeyword(
    node: [string, string, unknown],
    instance: Parameters<typeof instanceUri>[0],
    context: { vmdErrors?: RawError[] },
    valid: boolean,
    schemaContext: { vmdErrors?: RawError[] },
    keyword: { simpleApplicator?: boolean },
  ): void {
    if (valid) return;
    schemaContext.vmdErrors ??= [];
    if (keyword.simpleApplicator !== true) {
      schemaContext.vmdErrors.push({ keyword: node[0], location: node[1], instance: instanceUri(instance) });
    }
    // One push per failure: spreading them into one call's arguments overflows the stack for a large array.
    if (context.vmdErrors !== undefined && !FOLDED_KEYWORDS.has(node[0])) {
      for (const error of context.vmdErrors) schemaContext.vmdErrors.push(error);
    }
  }

  afterSchema(
    url: string,
    instance: Parameters<typeof instanceUri>[0],
    context: { ast: Record<string, unknown>; vmdErrors?: RawError[] },
    valid: boolean,
  ): void {
    if (typeof context.ast[url] === "boolean" && !valid) {
      context.vmdErrors ??= [];
      context.vmdErrors.push({ keyword: FALSE_SCHEMA_KEYWORD, location: url, instance: instanceUri(instance) });
    }
    this.errors = context.vmdErrors ?? [];
  }
}

/**
 * Reads a raw failure's URIs: its keyword location as a file and a JSON Pointer, and its instance location as an exact path.
 * Throws an `Error` for a location in a notation this adapter does not know, which is a bug: the instance locations are
 * `#` and a percent-encoded JSON Pointer, or `#*` and one for the name of the member it ends with.
 */
function toError(error: RawError, byUri: ReadonlyMap<string, string>): ValidatorError {
  const hash = error.location.indexOf("#");
  const file = byUri.get(hash === -1 ? error.location : error.location.slice(0, hash));
  const pointer = hash === -1 ? "" : decodeURIComponent(error.location.slice(hash + 1));
  if (file === undefined || pointerTokens(pointer) === null) throw new Error(`unexpected keyword location ${error.location}`);
  const name = error.instance.startsWith("#*");
  const at = decodeURIComponent(error.instance.slice(name ? 2 : 1));
  if (!error.instance.startsWith("#") || pointerTokens(at) === null || (name && at === "")) {
    throw new Error(`unexpected instance location ${error.instance}`);
  }
  return { keyword: error.keyword, file, pointer, at, name };
}

/** Copies a value of the value view into plain mutable objects with null prototypes. */
function copy(value: Value): Value {
  if (Array.isArray(value)) return value.map(copy);
  if (!isObject(value)) return value;
  const copied: Record<string, Value> = Object.create(null);
  for (const [name, member] of Object.entries(value)) copied[name] = copy(member);
  return copied as ValueObject;
}

/** The mutable object at a JSON Pointer of a copy, which the set has found to be a schema object there. */
function objectAt(root: Value, pointer: string): Record<string, Value> {
  let current: Value = root;
  for (const token of pointerTokens(pointer) as string[]) {
    current = (Array.isArray(current) ? current[Number(token)] : (current as ValueObject)[token]) as Value;
  }
  return current as unknown as Record<string, Value>;
}

/** Writes a JSON Pointer as a URI fragment: each reference token escaped, then percent-encoded. */
function encodePointer(pointer: string): string {
  return (pointerTokens(pointer) as string[])
    .map((token) => `/${encodeURIComponent(token.replaceAll("~", "~0").replaceAll("/", "~1"))}`)
    .join("");
}

/** The SHA-256 of the configuration and of every file of the set, each with its path and length, in hexadecimal. */
async function digestOf(set: SchemaSet, configuration: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(`configuration\0${configuration.length}\0`), configuration];
  for (const path of [...set.files.keys()].sort()) {
    const bytes = (set.files.get(path) as { readonly bytes: Uint8Array }).bytes;
    parts.push(encoder.encode(`\0${path}\0${bytes.length}\0`), bytes);
  }
  const total = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    total.set(part, offset);
    offset += part.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", total));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The compiled 2020-12 meta-schema, for checking schema files before they are compiled. */
let metaValidator: Promise<Validator> | undefined;

// Deviation from the I2 design, recorded in issue #22: core checks schemas against the meta-schema itself before compiling
// them, since the validator's own check gives no locations unless a process-wide setting changes.
/** A place in a schema file that the 2020-12 meta-schema refuses, with the keywords of the meta-schema that fail there. */
export interface MetaSchemaFailure {
  readonly pointer: string;
  readonly keywords: readonly string[];
}

/**
 * Validates a schema value against the JSON Schema 2020-12 meta-schema, giving each place that fails, folded as instances
 * are. A part of a schema that the meta-schema does not see, such as the per-key schemas inside an `x-vmd-list`, is given
 * as its own value.
 */
export async function metaSchemaFailures(value: Value): Promise<MetaSchemaFailure[]> {
  metaValidator ??= validate(DRAFT_2020_12);
  const validator = await metaValidator;
  const plugin = new FoldingPlugin();
  validator(value as SchemaObject, { plugins: [plugin as EvaluationPlugin] });
  const byPointer = new Map<string, Set<string>>();
  for (const error of plugin.errors) {
    const pointer = decodeURIComponent(error.instance.replace(/^#\*?/, ""));
    const keywords = byPointer.get(pointer) ?? new Set<string>();
    keywords.add(error.keyword.slice(error.keyword.lastIndexOf("/") + 1));
    byPointer.set(pointer, keywords);
  }
  return [...byPointer].map(([pointer, keywords]) => ({ pointer, keywords: [...keywords] }));
}
