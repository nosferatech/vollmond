import { childPath } from "../record/exact-path.js";
import type { Value, ValueObject } from "../value/value.js";

/**
 * How a keyword relates its subschemas to the instance: `spine` for the keywords whose subschema for an instance location does
 * not depend on the instance's validity, `off` for the other applicators, and `defs` for `$defs`, which applies nothing.
 */
export type SubschemaRole = "spine" | "off" | "defs";

/** A schema directly below a schema object, by the keyword that holds it. */
export interface Subschema {
  readonly keyword: string;
  /** Its JSON Pointer in the file. */
  readonly pointer: string;
  readonly value: Value;
  readonly role: SubschemaRole;
}

/** The JSON Schema 2020-12 keywords whose value is a schema, an array of schemas or a mapping to schemas, with their role. */
const SCHEMA_KEYWORDS: ReadonlyMap<string, { readonly form: "schema" | "array" | "map"; readonly role: SubschemaRole }> = new Map(
  [
    ["properties", { form: "map", role: "spine" }],
    ["patternProperties", { form: "map", role: "spine" }],
    ["additionalProperties", { form: "schema", role: "spine" }],
    ["prefixItems", { form: "array", role: "spine" }],
    ["items", { form: "schema", role: "spine" }],
    ["allOf", { form: "array", role: "spine" }],
    ["anyOf", { form: "array", role: "off" }],
    ["oneOf", { form: "array", role: "off" }],
    ["not", { form: "schema", role: "off" }],
    ["if", { form: "schema", role: "off" }],
    ["then", { form: "schema", role: "off" }],
    ["else", { form: "schema", role: "off" }],
    ["dependentSchemas", { form: "map", role: "off" }],
    ["contains", { form: "schema", role: "off" }],
    ["propertyNames", { form: "schema", role: "off" }],
    ["unevaluatedItems", { form: "schema", role: "off" }],
    ["unevaluatedProperties", { form: "schema", role: "off" }],
    ["contentSchema", { form: "schema", role: "off" }],
    ["$defs", { form: "map", role: "defs" }],
  ],
);

/** Whether a keyword of JSON Schema 2020-12 holds schemas: a schema, an array of them or a mapping to them. */
export function isSchemaKeyword(keyword: string): boolean {
  return SCHEMA_KEYWORDS.has(keyword);
}

/** Whether a value can be a schema: an object or a boolean. */
export function isSchemaValue(value: Value | undefined): value is ValueObject | boolean {
  return typeof value === "boolean" || isObject(value);
}

/** Whether a value is an object of the value view, not an array or null. */
export function isObject(value: Value | undefined): value is ValueObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lists the schemas directly below a schema object at `pointer`: those of the keywords of JSON Schema 2020-12 that hold
 * schemas, and the per-key schemas and `additional` of an `x-vmd-list`, which are on the spine. A keyword whose value has the
 * wrong form is skipped, since the meta-schema reports it; `$ref` and `$dynamicRef` are references, not subschemas.
 */
export function subschemas(object: ValueObject, pointer: string): Subschema[] {
  const found: Subschema[] = [];
  for (const [keyword, value] of Object.entries(object)) {
    const at = childPath(pointer, keyword);
    const known = SCHEMA_KEYWORDS.get(keyword);
    if (known !== undefined) {
      collect(found, keyword, at, value, known.form, known.role);
    } else if (keyword === "x-vmd-list" && isObject(value)) {
      if (Object.hasOwn(value, "items")) collect(found, keyword, childPath(at, "items"), value.items as Value, "map", "spine");
      if (Object.hasOwn(value, "additional")) {
        collect(found, keyword, childPath(at, "additional"), value.additional as Value, "schema", "spine");
      }
    }
  }
  return found;
}

function collect(
  found: Subschema[],
  keyword: string,
  at: string,
  value: Value,
  form: "schema" | "array" | "map",
  role: SubschemaRole,
): void {
  if (form === "schema") {
    if (isSchemaValue(value)) found.push({ keyword, pointer: at, value, role });
  } else if (form === "array") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isSchemaValue(item)) found.push({ keyword, pointer: childPath(at, index), value: item, role });
      });
    }
  } else if (isObject(value)) {
    for (const [name, item] of Object.entries(value)) {
      if (isSchemaValue(item)) found.push({ keyword, pointer: childPath(at, name), value: item, role });
    }
  }
}

/** Splits a JSON Pointer into its reference tokens, unescaped; null for a pointer that is not one (RFC 6901). */
export function pointerTokens(pointer: string): string[] | null {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  const tokens: string[] = [];
  for (const raw of pointer.slice(1).split("/")) {
    if (/~(?![01])/.test(raw)) return null;
    tokens.push(raw.replaceAll("~1", "/").replaceAll("~0", "~"));
  }
  return tokens;
}

/** Gives the value at a JSON Pointer, or undefined when there is none. Array indexes are decimal without leading zeros. */
export function valueAtPointer(root: Value, pointer: string): Value | undefined {
  const tokens = pointerTokens(pointer);
  if (tokens === null) return undefined;
  let current: Value | undefined = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      current = current[Number(token)];
    } else if (isObject(current)) {
      current = Object.hasOwn(current, token) ? current[token] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}
