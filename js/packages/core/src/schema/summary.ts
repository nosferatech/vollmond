// What a collection's schema says of its records, read along the spine: each field with its type and declarations, the keyed
// lists, and the required sections. It is what `vmd schema` prints, and reads no record.

import { jcs } from "../value/jcs.js";
import type { Value } from "../value/value.js";
import type { RefDeclaration } from "./keywords.js";
import { locationKey, type SchemaLocation } from "./schema-set.js";
import type { SchemaShape } from "./spine.js";
import { isObject } from "./walk.js";

/** A collection's schema as a summary for people and agents: its fields, its keyed lists and its required sections. */
export interface SchemaSummary {
  /** The collection's name. */
  readonly collection: string;
  /**
   * Each field the schema names, in the order the schema names them, parents before their members. A field whose members or
   * items another field has the same schema for says so with `sameAs`, and its members are not listed again.
   */
  readonly fields: readonly FieldSummary[];
  /** Each keyed list the schema declares, `$sections` included, in the order of its field. */
  readonly lists: readonly ListSummary[];
  /** The section keys a record must have: the `required` of the `x-vmd-list` of `$sections`; empty for none. */
  readonly sections: readonly string[];
  /** Whether the record allows no members but those its schema names, `additionalProperties: false`. */
  readonly closed?: true;
  /** The keywords at the record's root whose schemas the summary does not go into (see {@link FieldSummary.notShown}). */
  readonly notShown?: readonly string[];
  /** Whether the summary stops short: below eight levels of members, or past 10,000 fields. */
  readonly truncated: boolean;
}

/** One field of a schema, at a path of member names, `.` between them and `[]` for an array's items. */
export interface FieldSummary {
  /** Where it is: `status`, `meta.priority`, `tags[]`. */
  readonly path: string;
  /**
   * The JSON types it may have: those every `type` keyword that applies allows, `integer` within `number`, in the first's
   * order; empty when none says.
   */
  readonly types: readonly string[];
  /** Whether a `required` of the object that holds it names it; an array's items are never required. */
  readonly required: boolean;
  /** Its logical type, from `format`, when it has one. */
  readonly format?: string;
  /** The values it may take: those every `enum`, or `const` as its one value, that applies allows. */
  readonly enum?: readonly Value[];
  /** The order of its `enum` values, from `x-vmd-ordered`. */
  readonly ordered?: "asc" | "desc";
  /** Its `x-vmd-summary`, when it has one. */
  readonly summary?: boolean;
  /** Its typed reference's declaration, from `x-vmd-ref`. */
  readonly ref?: RefDeclaration;
  /** Whether it allows no members but those its schema names, `additionalProperties: false`. */
  readonly closed?: true;
  /**
   * The path of an earlier field with the same schema, whose members and items stand for this one's, listed there; `""` for
   * the record itself.
   */
  readonly sameAs?: string;
  /** Whether {@link sameAs} is a field this one is inside: the schema is recursive there. */
  readonly recursive?: true;
  /**
   * The keywords here whose schemas the summary does not go into, so that what they add is not shown: `anyOf`, `oneOf`, `not`,
   * `if`, `then`, `else`, `dependentSchemas`, `$dynamicRef`, `patternProperties`, `additionalProperties` and
   * `unevaluatedProperties` with a schema, `contains`, and `x-vmd-list items`, a keyed list's per-key schemas.
   */
  readonly notShown?: readonly string[];
}

/** A keyed list a schema declares with `x-vmd-list`. */
export interface ListSummary {
  /** The path of the array, as {@link FieldSummary.path} writes one; `$sections` for a record's sections. */
  readonly path: string;
  readonly type: "map" | "multimap";
  /** What keys its items: `@key`, the section key, or a member's name. */
  readonly key: string;
  /** The keys it must hold. */
  readonly required: readonly string[];
  /** The keys that have a schema of their own. */
  readonly items: readonly string[];
  /** Whether items with other keys are allowed: `true`, `false`, or `schema` when they must match a schema. */
  readonly additional: boolean | "schema";
}

/** How many levels of members the summary goes down at most. */
const MAX_LEVELS = 8;

/** How many fields the summary lists at most. */
const MAX_FIELDS = 10_000;

/** The keywords whose schemas the summary does not go into, as {@link FieldSummary.notShown} names them, in this order. */
const NOT_SHOWN = [
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "$dynamicRef",
  "patternProperties",
  "additionalProperties",
  "unevaluatedProperties",
  "contains",
] as const;

/** The keywords of a schema object that say nothing of the instance, which a location of `$ref` alone holds beside it. */
const ANNOTATIONS: ReadonlySet<string> = new Set(["$ref", "$comment", "title", "description"]);

/** Gives a schema object at a location, or undefined for a boolean schema or one not there. */
export type SchemaValueAt = (location: SchemaLocation) => Value | boolean | undefined;

type SchemaObject = Readonly<Record<string, Value>>;

/**
 * Summarizes a collection's schema from the spine's shape of its root, reading each location's keywords with `schemaAt`: the
 * members `properties` names, each with what `type`, `required`, `format`, `enum` or `const`, and the `x-vmd-*` keywords
 * say there, intersected over the locations that apply; below them the members of an object and the items of an array, an
 * array's arrays included; and the keyed lists. Each distinct schema is gone into once: a later field with the same
 * schema names the first with `sameAs`, so that shared definitions cost their size, not the number of ways to reach them, and
 * a recursive schema ends where it repeats. What the summary does not go into is named in `notShown`. It goes down eight
 * levels and lists 10,000 fields at most, which `truncated` says.
 */
export function summarizeSchema(collection: string, root: SchemaShape, schemaAt: SchemaValueAt): SchemaSummary {
  const fields: FieldSummary[] = [];
  const lists: ListSummary[] = [];
  let truncated = false;
  let sections: readonly string[] = [];
  /** The path of the first field gone into for each distinct schema, by the schema's key. */
  const firstPath = new Map<string, string>();

  const objectsOf = (shape: SchemaShape) =>
    shape.locations.map(schemaAt).filter((value): value is SchemaObject => isObject(value));

  /** Lists a field, then goes into its members and items unless an earlier field had its schema. */
  const field = (shape: SchemaShape, path: string, required: boolean, ancestors: readonly string[], level: number) => {
    if (fields.length >= MAX_FIELDS) {
      truncated = true;
      return;
    }
    const objects = objectsOf(shape);
    const key = schemaKey(shape, objects);
    const earlier = firstPath.get(key);
    const deep = objects.some(hasMembersOrItems);
    if (earlier !== undefined && deep) {
      const recursive = ancestors.includes(earlier);
      fields.push({ ...fieldSummary(path, shape, objects, required), sameAs: earlier, ...(recursive ? { recursive } : {}) });
      return;
    }
    if (deep) firstPath.set(key, path);
    fields.push(fieldSummary(path, shape, objects, required));
    descend(shape, objects, path, [...ancestors, path], level);
  };

  /** Goes into the members and the items of the schema at `path`. */
  const descend = (
    shape: SchemaShape,
    objects: readonly SchemaObject[],
    path: string,
    ancestors: readonly string[],
    level: number,
  ) => {
    if (objects.some((object) => isObject(object.properties))) members(shape, objects, `${path}.`, ancestors, level + 1);
    if (objects.some((object) => object.items !== undefined || object.prefixItems !== undefined)) {
      field(shape.anyItem(undefined), `${path}[]`, false, ancestors, level + 1);
    }
  };

  /** Lists the members `properties` names at a shape, each once, but those a schema forbids. */
  const members = (
    shape: SchemaShape,
    objects: readonly SchemaObject[],
    prefix: string,
    ancestors: readonly string[],
    level: number,
  ) => {
    if (level >= MAX_LEVELS) {
      truncated = true;
      return;
    }
    const required = new Set<string>();
    const names = new Set<string>();
    const forbidden = new Set<string>();
    for (const object of objects) {
      if (Array.isArray(object.required)) for (const name of object.required) if (typeof name === "string") required.add(name);
      if (!isObject(object.properties)) continue;
      for (const [name, schema] of Object.entries(object.properties)) {
        names.add(name);
        if (schema === false) forbidden.add(name);
      }
    }
    for (const name of names) {
      if (fields.length >= MAX_FIELDS) {
        truncated = true;
        return;
      }
      if (forbidden.has(name)) continue;
      const child = shape.child({ member: name });
      const path = `${prefix}${name}`;
      const list = child.list;
      if (list !== null) {
        const listed = listSummary(path, list);
        lists.push(listed);
        if (prefix === "" && name === "$sections" && list.key === "@key") sections = listed.required;
      }
      if (name === "$sections" && prefix === "") continue;
      field(child, path, required.has(name), ancestors, level);
    }
  };

  const rootObjects = objectsOf(root);
  // The record itself is the first field of its schema, at the path "", so that a member that refers back to it says so.
  firstPath.set(schemaKey(root, rootObjects), "");
  members(root, rootObjects, "", [""], 0);
  const notShown = notShownIn(root, rootObjects);
  return {
    collection,
    fields,
    lists,
    sections,
    ...(closedIn(rootObjects) ? { closed: true as const } : {}),
    ...(notShown.length === 0 ? {} : { notShown }),
    truncated,
  };
}

/** Whether a schema object names members or items, which a summary goes into. */
function hasMembersOrItems(object: SchemaObject): boolean {
  return isObject(object.properties) || object.items !== undefined || object.prefixItems !== undefined;
}

/**
 * The key of a shape's schema: the locations that apply there but those that hold only `$ref` and annotations beside it, which
 * add nothing of their own, so that two fields that refer to one definition have one key.
 */
function schemaKey(shape: SchemaShape, objects: readonly SchemaObject[]): string {
  const kept = shape.locations.filter((_, index) => {
    const object = objects[index];
    return object === undefined || !Object.keys(object).every((name) => ANNOTATIONS.has(name));
  });
  return kept.map(locationKey).sort().join("\n");
}

/** Gives a field's summary from its shape and the schema objects that apply there. */
function fieldSummary(path: string, shape: SchemaShape, objects: readonly SchemaObject[], required: boolean): FieldSummary {
  const typeSets: (readonly string[])[] = [];
  const valueSets: (readonly Value[])[] = [];
  for (const object of objects) {
    const type = object.type;
    if (type !== undefined) typeSets.push((Array.isArray(type) ? type : [type]).filter((name) => typeof name === "string"));
    if (Array.isArray(object.enum)) valueSets.push(object.enum);
    if (object.const !== undefined) valueSets.push([object.const]);
  }
  const values = valueSets.length === 0 ? undefined : commonValues(valueSets);
  const notShown = notShownIn(shape, objects);
  return {
    path,
    types: commonTypes(typeSets),
    required,
    ...(shape.format === null ? {} : { format: shape.format }),
    ...(values === undefined ? {} : { enum: values }),
    ...(shape.ordered === null ? {} : { ordered: shape.ordered }),
    ...(shape.summary === null ? {} : { summary: shape.summary }),
    ...(shape.ref === null ? {} : { ref: shape.ref }),
    ...(closedIn(objects) ? { closed: true as const } : {}),
    ...(notShown.length === 0 ? {} : { notShown }),
  };
}

/**
 * Gives the types every set allows, in the first set's order, `integer` counting as allowed by `number`: an integer is
 * a number, so `number` and `integer` meet at `integer`. Empty for no sets.
 */
function commonTypes(sets: readonly (readonly string[])[]): string[] {
  if (sets.length === 0) return [];
  const allows = (set: readonly string[], type: string) => set.includes(type) || (type === "integer" && set.includes("number"));
  const candidates: string[] = [];
  for (const set of sets) for (const type of set) if (!candidates.includes(type)) candidates.push(type);
  const common = candidates.filter((type) => sets.every((set) => allows(set, type)));
  return common.includes("number") && common.includes("integer") ? common.filter((type) => type !== "integer") : common;
}

/** Gives the values every set holds, by their canonical JSON, in the first set's order. */
function commonValues(sets: readonly (readonly Value[])[]): Value[] {
  const [first, ...rest] = sets as [readonly Value[], ...(readonly Value[])[]];
  const others = rest.map((set) => new Set(set.map(jcs)));
  const seen = new Set<string>();
  return first.filter((value) => {
    const text = jcs(value);
    if (seen.has(text) || !others.every((set) => set.has(text))) return false;
    seen.add(text);
    return true;
  });
}

/** Whether a schema object that applies allows no members but those it names. */
function closedIn(objects: readonly SchemaObject[]): boolean {
  return objects.some((object) => object.additionalProperties === false);
}

/** The keywords at a shape whose schemas the summary does not go into, each once, in {@link NOT_SHOWN}'s order. */
function notShownIn(shape: SchemaShape, objects: readonly SchemaObject[]): string[] {
  const found = NOT_SHOWN.filter((keyword) =>
    objects.some((object) => {
      const value = object[keyword];
      if (value === undefined) return false;
      if (keyword === "additionalProperties" || keyword === "unevaluatedProperties") return isObject(value);
      if (keyword === "patternProperties") return isObject(value) && Object.keys(value).length > 0;
      return true;
    }),
  );
  const list = shape.list;
  const perKey = list !== null && (list.items.size > 0 || typeof list.additional !== "boolean");
  return perKey ? [...found, "x-vmd-list items"] : [...found];
}

/** Gives a keyed list's summary from its declaration. */
function listSummary(path: string, list: NonNullable<SchemaShape["list"]>): ListSummary {
  return {
    path,
    type: list.type,
    key: list.key === "@key" ? "@key" : list.key.member,
    required: [...list.required],
    items: [...list.items.keys()],
    additional: typeof list.additional === "boolean" ? list.additional : "schema",
  };
}
