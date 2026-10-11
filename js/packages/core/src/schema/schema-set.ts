import { RECORD_SHAPE_CODES } from "../config/configuration.js";
import { parseJsonUnit } from "../format/json.js";
import { parseYamlUnit } from "../format/yaml.js";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import type { NodeInit } from "../record/node-index.js";
import type { OversizedFile } from "../storage/storage.js";
import { decodeSource, type Position, type SourceText } from "../text/source-text.js";
import { sliceUnitText } from "../text/unit-text.js";
import type { Value, ValueObject } from "../value/value.js";
import { isObject, isSchemaKeyword, pointerTokens, subschemas, valueAtPointer } from "./walk.js";

/** The `$schema` of every schema vmd reads, which may also be left out. */
export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/** The largest schema file, in bytes, that vmd reads: a mebibyte, as for the configuration. */
export const MAX_SCHEMA_BYTES = 1024 * 1024;

/** What makes a collection's schema unusable, one problem of possibly several, each in the file it is in. */
export interface SchemaProblem {
  /**
   * `feature-unsupported` for a construct this version does not define, which may come from a newer minor version;
   * `storage-failed` for a file that is there and cannot be read; `schema-invalid` for every other problem.
   */
  readonly code: "schema-invalid" | "feature-unsupported" | "storage-failed";
  /** The schema file, relative to the schema directory. */
  readonly file: string;
  /** Where in the file, when the problem is at a place of it. */
  readonly position?: Position;
  readonly message: string;
  /** What may help, such as why a reader did not find a file. */
  readonly hint?: string;
}

/** A schema file as vmd read it. */
export interface SchemaDocument {
  /** Its path relative to the schema directory. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** Its value: an object, since a schema file holds a mapping. */
  readonly value: ValueObject;
  /** Gives the position of the value at a JSON Pointer of the file, or undefined when it has none. */
  position(pointer: string): Position | undefined;
}

/** A place in one of a schema set's files: the file, and a JSON Pointer into it. */
export interface SchemaLocation {
  readonly file: string;
  readonly pointer: string;
}

/** Writes a location as one string, `file#pointer`, which tells locations apart. */
export function locationKey(location: SchemaLocation): string {
  return `${location.file}#${location.pointer}`;
}

/** Reads a schema file of the schema directory by its path relative to it, as a configuration source does. */
export type SchemaReader = (path: string) => Promise<Outcome<Uint8Array | OversizedFile>>;

/** Writes a reference's place as one string: the location of the schema object that holds it, and its keyword. */
export function referenceKey(location: SchemaLocation, keyword: "$ref" | "$dynamicRef"): string {
  return `${locationKey(location)}|${keyword}`;
}

/** The members that identify a schema or a place in one, which stand only in schema objects. */
const IDENTIFIERS = ["$id", "$anchor", "$dynamicAnchor", "$schema"] as const;

/** A reference that a schema object holds, and where it leads. */
export interface SchemaReference {
  readonly keyword: "$ref" | "$dynamicRef";
  readonly from: SchemaLocation;
  /** The file it names and the fragment in it: a JSON Pointer, or a plain name. */
  readonly file: string;
  readonly pointer: string | null;
  readonly anchor: string | null;
  /** The location it leads to, once the files are read; null when it leads nowhere, which is a problem. */
  target: SchemaLocation | null;
}

/**
 * The schema files a collection's schema reads, with every schema object in them that a keyword or a reference reaches, the
 * references between them, and every problem found on the way. Built by {@link readSchemaSet}.
 */
export interface SchemaSet {
  readonly root: string;
  /** The files read, by path, in the order they were first named. */
  readonly files: ReadonlyMap<string, SchemaDocument>;
  /** Every schema object or boolean schema found, by {@link locationKey}. */
  readonly schemas: ReadonlyMap<string, { readonly location: SchemaLocation; readonly value: ValueObject | boolean }>;
  /** The `$ref` and the `$dynamicRef` of each schema object, by {@link referenceKey}. */
  readonly references: ReadonlyMap<string, SchemaReference>;
  /** The schema objects of each `$dynamicAnchor` name, in any file. */
  readonly dynamicAnchors: ReadonlyMap<string, readonly SchemaLocation[]>;
  readonly problems: readonly SchemaProblem[];
}

/**
 * Reads a collection's schema file and, transitively, every file its references name, each with vmd's JSON or YAML reader by
 * its extension (`.json`, `.yaml`, `.yml`), a byte order mark skipped. Every reference is checked as text before any file
 * is read for it: resolved against its file's path, it must name a file of the schema directory, without a scheme, an
 * authority or a query of its own, so that nothing outside the directory is ever read. Problems found are collected, never
 * thrown:
 *
 * - a file that does not exist, is larger than {@link MAX_SCHEMA_BYTES}, has another extension, is not UTF-8, or holds what
 *   vmd's readers refuse (YAML anchors, aliases and tags among it), or something other than a mapping;
 * - a file whose `$schema` is not {@link DRAFT_2020_12}, a `$schema` below a file's root, a schema object with `$id`, a
 *   reference that leaves the directory or is malformed, and one whose fragment names no schema object of its file, the
 *   inside of `const`, `enum`, `default`, `examples` and unknown keywords being no schema;
 * - an `$id`, `$anchor`, `$dynamicAnchor` or `$schema` member in a value that is not a schema, such as a `const`'s, since the
 *   validator would read it as a schema's and change what the value means;
 * - `storage-failed` for a file that the reader finds and cannot read.
 *
 * The codes the readers raise for the shape of a record do not apply to a schema, whose `$` members are JSON Schema's, and the
 * other issues of a record's validation are not structural, so neither is a problem.
 */
export async function readSchemaSet(root: string, read: SchemaReader): Promise<SchemaSet> {
  const reader = new SchemaSetReader(read);
  await reader.read(root);
  return reader.result(root);
}

class SchemaSetReader {
  readonly #read: SchemaReader;
  readonly #files = new Map<string, SchemaDocument>();
  /** The files asked for, read or not, so that each is read once. */
  readonly #asked = new Set<string>();
  readonly #schemas = new Map<string, { readonly location: SchemaLocation; readonly value: ValueObject | boolean }>();
  readonly #references = new Map<string, SchemaReference>();
  readonly #problems: SchemaProblem[] = [];

  constructor(read: SchemaReader) {
    this.#read = read;
  }

  async read(root: string): Promise<void> {
    const pending: string[] = [root];
    this.#asked.add(root);
    while (pending.length > 0) {
      const path = pending.shift() as string;
      const document = await this.#readFile(path);
      if (document === null) continue;
      this.#files.set(path, document);
      if (document.value.$schema !== undefined && document.value.$schema !== DRAFT_2020_12) {
        this.#problem(
          "schema-invalid",
          path,
          "/$schema",
          `$schema is ${describe(document.value.$schema)}; vmd's schemas are JSON Schema 2020-12, ${DRAFT_2020_12}`,
        );
      }
      this.#walk(path, "", document.value);
      for (const named of this.#namedFiles()) {
        if (this.#asked.has(named)) continue;
        this.#asked.add(named);
        pending.push(named);
      }
    }
  }

  result(root: string): SchemaSet {
    const anchors = new Map<string, Map<string, SchemaLocation>>();
    const dynamicAnchors = new Map<string, SchemaLocation[]>();
    for (const { location, value } of this.#schemas.values()) {
      if (!isObject(value)) continue;
      for (const keyword of ["$anchor", "$dynamicAnchor"] as const) {
        const name = value[keyword];
        if (typeof name !== "string") continue;
        const inFile = anchors.get(location.file) ?? new Map<string, SchemaLocation>();
        anchors.set(location.file, inFile);
        if (inFile.has(name) && locationKey(inFile.get(name) as SchemaLocation) !== locationKey(location)) {
          this.#problem(
            "schema-invalid",
            location.file,
            childPath(location.pointer, keyword),
            `the anchor ${name} is defined twice in ${location.file}`,
          );
        }
        inFile.set(name, location);
        if (keyword === "$dynamicAnchor") dynamicAnchors.set(name, [...(dynamicAnchors.get(name) ?? []), location]);
      }
    }
    // Deviation from the I2 design, recorded in issue #22: a reference that does not lead to a schema object is refused.
    // Every reference is resolved here, against the schema objects the walk found, which are all the validator sees as schemas.
    for (const reference of this.#references.values()) {
      if (!this.#files.has(reference.file)) continue;
      if (reference.anchor !== null) {
        reference.target = anchors.get(reference.file)?.get(reference.anchor) ?? null;
      } else {
        const location = { file: reference.file, pointer: reference.pointer as string };
        reference.target = this.#schemas.has(locationKey(location)) ? location : null;
      }
      if (reference.target === null) {
        const fragment = reference.anchor ?? reference.pointer;
        const document = this.#files.get(reference.file) as SchemaDocument;
        const there = reference.pointer === null ? undefined : valueAtPointer(document.value, reference.pointer);
        this.#problem(
          "schema-invalid",
          reference.from.file,
          childPath(reference.from.pointer, reference.keyword),
          there === undefined
            ? `${reference.keyword} names ${reference.file}#${fragment}, where ${reference.file} has no schema`
            : `${reference.keyword} names ${reference.file}#${fragment}, which is not a schema: a reference leads to a schema object, not into a keyword's data`,
        );
      }
    }
    return {
      root,
      files: this.#files,
      schemas: this.#schemas,
      references: this.#references,
      dynamicAnchors,
      problems: this.#problems,
    };
  }

  /** The files that references name and that are not asked for yet, in the order of the references. */
  *#namedFiles(): Iterable<string> {
    for (const reference of this.#references.values()) if (!this.#asked.has(reference.file)) yield reference.file;
  }

  /** Reads and parses one file, or records why it cannot and gives null. */
  async #readFile(path: string): Promise<SchemaDocument | null> {
    const extension = path.slice(path.lastIndexOf("."));
    if (extension !== ".json" && extension !== ".yaml" && extension !== ".yml") {
      this.#problem("schema-invalid", path, null, `${path} is not a .json, .yaml or .yml file`);
      return null;
    }
    const read = await this.#read(path);
    if (!read.ok) {
      if (read.issues.every((issue) => issue.code === "address-not-found")) {
        const hint = read.issues.find((issue) => issue.hint !== undefined)?.hint;
        this.#problems.push({
          code: "schema-invalid",
          file: path,
          message: `${path} does not exist`,
          ...(hint === undefined ? {} : { hint }),
        });
      } else {
        this.#problem(
          "storage-failed",
          path,
          null,
          `${path} cannot be read: ${read.issues.map((issue) => issue.message).join("; ")}`,
        );
      }
      return null;
    }
    if ("oversized" in read.value || read.value.length > MAX_SCHEMA_BYTES) {
      this.#problem("schema-invalid", path, null, `${path} is larger than ${MAX_SCHEMA_BYTES} bytes`);
      return null;
    }
    const bytes = read.value;
    const decoded = decodeSource("", bytes, "schema-invalid");
    if (!decoded.ok) {
      for (const issue of decoded.issues) this.#issueProblem(path, issue);
      return null;
    }
    const source = decoded.value;
    const parsed = extension === ".json" ? parseJson(source) : parseYaml(source);
    const problems = parsed.issues.filter((issue) => issue.class === "structural" && !RECORD_SHAPE_CODES.has(issue.code));
    for (const issue of problems) this.#issueProblem(path, issue);
    if (problems.length > 0) return null;
    if (parsed.value === null) {
      this.#problem("schema-invalid", path, null, `${path} does not hold a mapping`);
      return null;
    }
    const nodes = parsed.nodes;
    return {
      path,
      bytes,
      value: parsed.value,
      position: (pointer) => {
        const node = nodes.get(pointer);
        return node === undefined ? undefined : source.position((node.memberRange ?? node.range).start);
      },
    };
  }

  /** Records every schema object at and below a schema, in the file at `path`, with its references, `$id` refused. */
  #walk(path: string, pointer: string, value: ValueObject | boolean): void {
    const pending: { readonly pointer: string; readonly value: ValueObject | boolean }[] = [{ pointer, value }];
    while (pending.length > 0) {
      const next = pending.pop() as { readonly pointer: string; readonly value: ValueObject | boolean };
      const location = { file: path, pointer: next.pointer };
      const key = locationKey(location);
      if (this.#schemas.has(key)) continue;
      this.#schemas.set(key, { location, value: next.value });
      if (!isObject(next.value)) continue;
      const object = next.value;
      if (next.pointer !== "" && Object.hasOwn(object, "$schema")) {
        this.#problem(
          "schema-invalid",
          path,
          childPath(next.pointer, "$schema"),
          "$schema stands only at the root of a schema file, since a schema has no resources of its own",
        );
      }
      if (Object.hasOwn(object, "$id")) {
        this.#problem(
          "schema-invalid",
          path,
          childPath(next.pointer, "$id"),
          "a schema has no $id: a base URI of its own would change what its relative $refs mean",
        );
      }
      for (const keyword of ["$ref", "$dynamicRef"] as const) {
        const ref = object[keyword];
        if (typeof ref !== "string") continue;
        const resolved = resolveSchemaReference(path, ref);
        if ("problem" in resolved) {
          this.#problem(
            "schema-invalid",
            path,
            childPath(next.pointer, keyword),
            `${keyword} ${JSON.stringify(ref)} ${resolved.problem}`,
          );
          continue;
        }
        this.#references.set(referenceKey(location, keyword), { keyword, from: location, ...resolved, target: null });
      }
      this.#checkData(path, next.pointer, object);
      for (const subschema of subschemas(object, next.pointer)) {
        pending.push({ pointer: subschema.pointer, value: subschema.value as ValueObject | boolean });
      }
    }
  }

  // Deviation from the I2 design, recorded in issue #22: identifiers in data are refused, which narrows what 2020-12 allows,
  // since the validator would read them as a schema's.
  /**
   * Refuses an identifier in the data of a schema object: the values of its members that are not schemas (`const`, `enum`,
   * `default`, `examples`, unknown keywords, the members of `x-vmd-list` but its schemas). The validator records identifiers
   * wherever they stand, so one in data would become a schema's, and a `const` that holds one would never match.
   */
  #checkData(path: string, pointer: string, object: ValueObject): void {
    for (const [keyword, value] of Object.entries(object)) {
      if (
        isSchemaKeyword(keyword) ||
        keyword === "$ref" ||
        keyword === "$dynamicRef" ||
        IDENTIFIERS.some((name) => name === keyword)
      )
        continue;
      const at = childPath(pointer, keyword);
      if (keyword === "x-vmd-list" && isObject(value)) {
        for (const [member, inner] of Object.entries(value)) {
          if (member !== "items" && member !== "additional") this.#checkDataValue(path, childPath(at, member), inner);
        }
        continue;
      }
      this.#checkDataValue(path, at, value);
    }
  }

  #checkDataValue(path: string, pointer: string, value: Value): void {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) this.#checkDataValue(path, childPath(pointer, index), item);
      return;
    }
    if (!isObject(value)) return;
    for (const name of IDENTIFIERS) {
      if (Object.hasOwn(value, name)) {
        this.#problem(
          "schema-invalid",
          path,
          childPath(pointer, name),
          `${name} stands in ${pointer}, which is not a schema; vmd's schemas keep identifiers out of data, which the validator would take for a schema's`,
        );
      }
    }
    for (const [name, inner] of Object.entries(value)) this.#checkDataValue(path, childPath(pointer, name), inner);
  }

  #problem(code: SchemaProblem["code"], file: string, pointer: string | null, message: string): void {
    const position = pointer === null ? undefined : this.#files.get(file)?.position(pointer);
    this.#problems.push({ code, file, message, ...(position === undefined ? {} : { position }) });
  }

  #issueProblem(file: string, issue: Issue): void {
    this.#problems.push({
      code: "schema-invalid",
      file,
      message: issue.message,
      ...(issue.position === undefined ? {} : { position: issue.position }),
    });
  }
}

/** What a schema file holds once parsed: its mapping, or null for none, the nodes by JSON Pointer, and the reader's issues. */
interface ParsedSchemaFile {
  readonly value: ValueObject | null;
  readonly nodes: ReadonlyMap<string, NodeInit>;
  readonly issues: readonly Issue[];
}

function parseJson(source: SourceText): ParsedSchemaFile {
  const nodes = new Map<string, NodeInit>();
  const unit = parseJsonUnit({
    path: "",
    source,
    start: source.hasBom ? 1 : 0,
    end: source.text.length,
    at: "",
    nodes: {
      add: (parent, key, init) => {
        const at = childPath(parent, key);
        nodes.set(at, init);
        return at;
      },
    },
    notObjectCode: "root-not-object",
  });
  return { value: unit.value, nodes, issues: unit.issues };
}

function parseYaml(source: SourceText): ParsedSchemaFile {
  const unit = parseYamlUnit(source, sliceUnitText(source.text, source.hasBom ? 1 : 0, source.text.length), {
    path: "",
    at: "",
    unit: "front-matter",
  });
  const nodes = new Map<string, NodeInit>();
  for (const node of unit.nodes) nodes.set(childPath(node.parent, node.key), node.init);
  return { value: unit.value ?? null, nodes, issues: unit.issues };
}

/** A URI scheme at the start of a reference: `https:`, `file:`, `urn:`. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** The syntax of a plain-name fragment, as `$anchor` defines it (2020-12 Core, section 8.2.2). */
const ANCHOR_NAME = /^[A-Za-z_][-A-Za-z0-9._]*$/;

/**
 * Resolves a `$ref` or `$dynamicRef` written in the file at `from` (a path relative to the schema directory) against that
 * file's path, as RFC 3986 resolves a relative reference without a scheme, an authority or a query: the file it names, and
 * its fragment as a JSON Pointer or a plain name. Refuses, with what is wrong, a reference that has a scheme, an authority, a
 * query or a backslash, an absolute path, a path that climbs out of the schema directory or names a directory, a
 * percent-escape that is malformed, does not decode as UTF-8 or decodes to `/`, a fragment that is neither a JSON Pointer nor
 * a plain name, and a segment that is `.` or `..` once decoded.
 */
export function resolveSchemaReference(
  from: string,
  ref: string,
): { readonly file: string; readonly pointer: string | null; readonly anchor: string | null } | { readonly problem: string } {
  if (SCHEME.test(ref)) return { problem: "has a scheme of its own: a schema refers only to files of the schema directory" };
  if (ref.startsWith("//"))
    return { problem: "has an authority of its own: a schema refers only to files of the schema directory" };
  if (ref.includes("\\")) return { problem: "holds a backslash, which a URI reference does not" };
  const hash = ref.indexOf("#");
  const pathPart = hash === -1 ? ref : ref.slice(0, hash);
  const fragment = hash === -1 ? "" : ref.slice(hash + 1);
  if (pathPart.includes("?")) return { problem: "has a query, which names no file" };
  if (fragment.includes("#")) return { problem: "has a second #" };
  let file = from;
  if (pathPart !== "") {
    if (pathPart.startsWith("/")) return { problem: "has an absolute path, which leaves the schema directory" };
    const segments = from.split("/").slice(0, -1);
    const written = pathPart.split("/");
    for (const [index, segment] of written.entries()) {
      if (segment === ".") continue;
      if (segment === "..") {
        if (segments.length === 0) return { problem: "climbs out of the schema directory" };
        segments.pop();
        continue;
      }
      if (segment === "") {
        return { problem: index === written.length - 1 ? "names a directory, not a file" : "has an empty segment" };
      }
      const decoded = percentDecode(segment);
      if (decoded === null) return { problem: "has a percent-escape that is malformed or does not decode as UTF-8" };
      if (decoded.includes("/") || decoded === "." || decoded === "..") {
        return { problem: `has the segment ${JSON.stringify(segment)}, which names no file once decoded` };
      }
      segments.push(decoded);
    }
    if (written.at(-1) === "." || written.at(-1) === "..") return { problem: "names a directory, not a file" };
    file = segments.join("/");
  }
  const decodedFragment = percentDecode(fragment);
  if (decodedFragment === null)
    return { problem: "has a fragment whose percent-escapes are malformed or do not decode as UTF-8" };
  if (decodedFragment === "" || decodedFragment.startsWith("/")) {
    if (pointerTokens(decodedFragment) === null) return { problem: "has a fragment that is not a JSON Pointer" };
    return { file, pointer: decodedFragment, anchor: null };
  }
  if (!ANCHOR_NAME.test(decodedFragment)) return { problem: "has a fragment that is neither a JSON Pointer nor a plain name" };
  return { file, pointer: null, anchor: decodedFragment };
}

/** Decodes the percent-escapes of a URI component as UTF-8, or gives null for a malformed one. */
function percentDecode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** Describes a value for a message: a string in quotes, anything else as JSON. */
export function describe(value: Value): string {
  return JSON.stringify(value);
}
