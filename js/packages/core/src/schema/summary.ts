// What a collection's schema says of its records, read along the spine: each field with its type and declarations, the keyed
// lists, and the required sections. It is what `vmd schema` prints, and reads no record.

import type { Value } from "../value/value.js";
import type { RefDeclaration } from "./keywords.js";
import { locationKey, type SchemaLocation } from "./schema-set.js";
import type { SchemaShape } from "./spine.js";
import { isObject } from "./walk.js";

/** A collection's schema as a summary for people and agents: its fields, its keyed lists and its required sections. */
export interface SchemaSummary {
  /** The collection's name. */
  readonly collection: string;
  /** Each field the schema names, in the order the schema names them, parents before their members. */
  readonly fields: readonly FieldSummary[];
  /** Each keyed list the schema declares, `$sections` included, in the order of its field. */
  readonly lists: readonly ListSummary[];
  /** The section keys a record must have: the `required` of the `x-vmd-list` of `$sections`; empty for none. */
  readonly sections: readonly string[];
  /** Whether the summary stops short somewhere: at a schema that refers back to one it is inside, or below eight levels. */
  readonly truncated: boolean;
}

/** One field of a schema, at a path of member names, `.` between them and `[]` for an array's items. */
export interface FieldSummary {
  /** Where it is: `status`, `meta.priority`, `tags[]`. */
  readonly path: string;
  /** The JSON types its `type` keywords allow, in their order; empty when none says. */
  readonly types: readonly string[];
  /** Whether a `required` of the object that holds it names it; an array's items are never required. */
  readonly required: boolean;
  /** Its logical type, from `format`, when it has one. */
  readonly format?: string;
  /** The values it may take, from `enum`, or `const` as the one value. */
  readonly enum?: readonly Value[];
  /** The order of its `enum` values, from `x-vmd-ordered`. */
  readonly ordered?: "asc" | "desc";
  /** Its `x-vmd-summary`, when it has one. */
  readonly summary?: boolean;
  /** Its typed reference's declaration, from `x-vmd-ref`. */
  readonly ref?: RefDeclaration;
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

/** Gives a schema object at a location, or undefined for a boolean schema or one not there. */
export type SchemaValueAt = (location: SchemaLocation) => Value | boolean | undefined;

/**
 * Summarizes a collection's schema from the spine's shape of its root, reading each location's keywords with `schemaAt`: the
 * members `properties` names, each with what `type`, `required`, `format`, `enum` or `const`, and the `x-vmd-*` keywords
 * say there, and below them the members of an object and the items of an array, down to eight levels; and the keyed lists.
 * A member that refers back to a schema it is inside is listed, and not gone into again, which `truncated` says.
 */
export function summarizeSchema(collection: string, root: SchemaShape, schemaAt: SchemaValueAt): SchemaSummary {
  const fields: FieldSummary[] = [];
  const lists: ListSummary[] = [];
  let truncated = false;
  let sections: readonly string[] = [];

  const objectsOf = (shape: SchemaShape) =>
    shape.locations.map(schemaAt).filter((value): value is Readonly<Record<string, Value>> => isObject(value));

  /** Whether a shape is reached again from inside itself, by a location of an object that holds it, or too deep. */
  const stops = (shape: SchemaShape, inside: ReadonlySet<string>, level: number) => {
    if (level < MAX_LEVELS && !shape.locations.some((location) => inside.has(locationKey(location)))) return false;
    truncated = true;
    return true;
  };

  const visit = (shape: SchemaShape, prefix: string, inside: ReadonlySet<string>, level: number) => {
    if (stops(shape, inside, level)) return;
    const within = new Set(inside);
    for (const location of shape.locations) within.add(locationKey(location));
    const objects = objectsOf(shape);
    const required = new Set<string>();
    const names: string[] = [];
    for (const object of objects) {
      if (Array.isArray(object.required)) for (const name of object.required) if (typeof name === "string") required.add(name);
      if (isObject(object.properties))
        for (const name of Object.keys(object.properties)) if (!names.includes(name)) names.push(name);
    }
    for (const name of names) {
      const child = shape.child({ member: name });
      const path = `${prefix}${name}`;
      const list = child.list;
      if (list !== null) {
        const listed = listSummary(path, list);
        lists.push(listed);
        if (prefix === "" && name === "$sections" && list.key === "@key") sections = listed.required;
      }
      if (name === "$sections" && prefix === "") continue;
      fields.push(fieldSummary(path, child, objectsOf(child), required.has(name)));
      descend(child, path, within, level);
    }
  };

  const descend = (shape: SchemaShape, path: string, inside: ReadonlySet<string>, level: number) => {
    const objects = objectsOf(shape);
    if (objects.some((object) => isObject(object.properties))) visit(shape, `${path}.`, inside, level + 1);
    if (objects.some((object) => object.items !== undefined || object.prefixItems !== undefined) && shape.list === null) {
      const item = shape.anyItem(undefined);
      const itemPath = `${path}[]`;
      fields.push(fieldSummary(itemPath, item, objectsOf(item), false));
      if (objectsOf(item).some((object) => isObject(object.properties))) visit(item, `${itemPath}.`, inside, level + 1);
    }
  };

  visit(root, "", new Set(), 0);
  return { collection, fields, lists, sections, truncated };
}

/** Gives a field's summary from its shape and the schema objects that apply there. */
function fieldSummary(
  path: string,
  shape: SchemaShape,
  objects: readonly Readonly<Record<string, Value>>[],
  required: boolean,
): FieldSummary {
  const types: string[] = [];
  let values: readonly Value[] | undefined;
  for (const object of objects) {
    const type = object.type;
    for (const name of Array.isArray(type) ? type : [type])
      if (typeof name === "string" && !types.includes(name)) types.push(name);
    if (values === undefined && Array.isArray(object.enum)) values = object.enum;
    if (values === undefined && object.const !== undefined) values = [object.const];
  }
  return {
    path,
    types,
    required,
    ...(shape.format === null ? {} : { format: shape.format }),
    ...(values === undefined ? {} : { enum: values }),
    ...(shape.ordered === null ? {} : { ordered: shape.ordered }),
    ...(shape.summary === null ? {} : { summary: shape.summary }),
    ...(shape.ref === null ? {} : { ref: shape.ref }),
  };
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
