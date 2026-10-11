import { childPath } from "../record/exact-path.js";
import { type Value, type ValueObject, valuesEqual } from "../value/value.js";
import { type ListDeclaration, type RefDeclaration, readListDeclaration, readRefDeclaration } from "./keywords.js";
import { locationKey, type SchemaLocation, type SchemaSet } from "./schema-set.js";
import { isObject, isSchemaValue, subschemas } from "./walk.js";

/** A step from an instance location to one below it: a member by its name, or an array item by its index and, in a keyed list, its key. */
export type ShapeStep = { readonly member: string } | { readonly item: number; readonly key?: string };

// Deviation from the I2 design, recorded in issue #22: a shape has every schema location that applies, `child` gives one
// shape, and `conflicts` names unequal declarations that only the data brings together.
/**
 * What a collection's schema says of one instance location, as its spine sees it: the schema locations that apply there
 * whatever the instance holds, reached from the root through `properties`, `patternProperties`, `additionalProperties`,
 * `prefixItems`, `items`, `allOf`, `$ref` and an `x-vmd-list`'s own `items` and `additional`, and the declarations they carry.
 */
export interface SchemaShape {
  /** The schema locations that apply, each once, in the order the spine meets them. */
  readonly locations: readonly SchemaLocation[];
  /** The shape of the location one step below. A step no schema location names gives a shape with no locations. */
  child(step: ShapeStep): SchemaShape;
  /** The keyed list declared here; null when none is, or when unequal ones meet here (see `conflicts`). */
  readonly list: ListDeclaration | null;
  /** The typed reference declared here; null when none is, or when unequal ones meet here (see `conflicts`). */
  readonly ref: RefDeclaration | null;
  /**
   * The schema locations of unequal declarations that meet here, which only a member name in the data can bring together, as
   * two `patternProperties` patterns that both match it do; empty otherwise. The location then gets neither declaration.
   */
  readonly conflicts: readonly SchemaLocation[];
  /** The `format` given here, the logical type for comparisons; null when none is. */
  readonly format: string | null;
  /** The `x-vmd-summary` given here; null when none is. */
  readonly summary: boolean | null;
  /** The `x-vmd-ordered` given here; null when none is. */
  readonly ordered: "asc" | "desc" | null;
}

/** A problem the spine shows, at a schema location. */
export interface SpineProblem {
  readonly location: SchemaLocation;
  readonly message: string;
}

/**
 * The spine of a schema set: the shapes of instance locations, built on demand and shared, and the checks that only the
 * spine can make. Valid only over a set whose extension keywords `checkExtensionKeywords` accepted.
 */
export class Spine {
  readonly #set: SchemaSet;
  readonly #shapes = new Map<string, Shape>();
  readonly #patterns = new Map<string, RegExp | null>();
  readonly root: SchemaShape;

  constructor(set: SchemaSet) {
    this.#set = set;
    this.root = this.shape([{ file: set.root, pointer: "" }]);
  }

  /** The schema object or boolean schema at a location, or undefined where there is none. */
  schemaAt(location: SchemaLocation): ValueObject | boolean | undefined {
    return this.#set.schemas.get(locationKey(location))?.value;
  }

  /** The shape of the locations given and those their `allOf` and `$ref` bring, memoized by that set. */
  shape(locations: readonly SchemaLocation[]): Shape {
    const closed: SchemaLocation[] = [];
    const seen = new Set<string>();
    const pending = [...locations];
    while (pending.length > 0) {
      const location = pending.shift() as SchemaLocation;
      const key = locationKey(location);
      if (seen.has(key)) continue;
      const schema = this.schemaAt(location);
      if (schema === undefined) continue;
      seen.add(key);
      closed.push(location);
      if (!isObject(schema)) continue;
      if (Array.isArray(schema.allOf)) {
        schema.allOf.forEach((item, index) => {
          if (isSchemaValue(item))
            pending.push({ file: location.file, pointer: childPath(childPath(location.pointer, "allOf"), index) });
        });
      }
      const reference = this.#set.references.get(key);
      if (reference?.keyword === "$ref" && reference.target !== null) pending.push(reference.target);
    }
    const id = [...seen].sort().join("\n");
    let shape = this.#shapes.get(id);
    if (shape === undefined) {
      shape = new Shape(this, closed);
      this.#shapes.set(id, shape);
    }
    return shape;
  }

  /** The pattern of `patternProperties` as ECMA-262 runs it, with the `u` flag; null for one that does not compile. */
  pattern(source: string): RegExp | null {
    let pattern = this.#patterns.get(source);
    if (pattern === undefined) {
      try {
        pattern = new RegExp(source, "u");
      } catch {
        pattern = null;
      }
      this.#patterns.set(source, pattern);
    }
    return pattern;
  }

  /**
   * Checks what only the spine shows, from the root over every instance location the schema names:
   *
   * - an `x-vmd-list` or `x-vmd-ref` that the root reaches, through any keyword, but only off the spine;
   * - unequal declarations that the schema alone brings to one instance location, through `allOf`, a `$ref` beside other
   *   keywords, or a member that `properties` names and a `patternProperties` pattern matches;
   * - a `$sections` of a section keyed by anything but `@key`, and `@key` anywhere else;
   * - `unevaluatedItems` beside an `x-vmd-list`, which would fail items that the list evaluates;
   * - `x-vmd-ref` on a schema whose `type` allows a string, without `format: uri-reference`, where it would do nothing.
   *
   * What the root does not reach is not checked: a shared file's `$defs` may hold declarations other collections use.
   */
  check(): SpineProblem[] {
    const problems: SpineProblem[] = [];
    const reported = new Set<string>();
    const report = (location: SchemaLocation, message: string) => {
      const key = `${locationKey(location)}\n${message}`;
      if (reported.has(key)) return;
      reported.add(key);
      problems.push({ location, message });
    };
    this.#checkOffSpine(report);
    const visited = new Set<Shape>();
    const pending: { readonly shape: Shape; readonly section: boolean; readonly onSections: boolean }[] = [
      { shape: this.root as Shape, section: true, onSections: false },
    ];
    const visitedFlags = new Set<string>();
    while (pending.length > 0) {
      const { shape, section, onSections } = pending.pop() as (typeof pending)[number];
      const flagKey = `${shape.id}|${section}|${onSections}`;
      if (visitedFlags.has(flagKey)) continue;
      visitedFlags.add(flagKey);
      if (!visited.has(shape)) {
        visited.add(shape);
        shape.checkHere(report);
      }
      shape.checkPlacement(onSections, report);
      for (const child of shape.staticChildren(section, onSections)) pending.push(child);
    }
    return problems;
  }

  /** Reports each declaration that the root reaches only through a keyword off the spine. */
  #checkOffSpine(report: (location: SchemaLocation, message: string) => void): void {
    const onSpine = new Set<string>();
    const offSpine = new Map<string, { readonly location: SchemaLocation; readonly via: string }>();
    const pending: { readonly location: SchemaLocation; readonly via: string | null }[] = [
      { location: { file: this.#set.root, pointer: "" }, via: null },
    ];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const { location, via } = pending.pop() as (typeof pending)[number];
      const key = locationKey(location);
      const seenKey = `${via === null ? "spine" : "off"}|${key}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      if (via === null) onSpine.add(key);
      else if (!offSpine.has(key)) offSpine.set(key, { location, via });
      const schema = this.schemaAt(location);
      if (!isObject(schema)) continue;
      for (const subschema of subschemas(schema, location.pointer)) {
        if (subschema.role === "defs") continue;
        const offVia = via ?? (subschema.role === "off" ? subschema.keyword : null);
        pending.push({ location: { file: location.file, pointer: subschema.pointer }, via: offVia });
      }
      const reference = this.#set.references.get(key);
      if (reference !== undefined && reference.target !== null) {
        pending.push({ location: reference.target, via: via ?? (reference.keyword === "$ref" ? null : reference.keyword) });
      }
      if (reference?.keyword === "$dynamicRef" && reference.anchor !== null) {
        for (const target of this.#set.dynamicAnchors.get(reference.anchor) ?? [])
          pending.push({ location: target, via: via ?? "$dynamicRef" });
      }
    }
    for (const [key, { location, via }] of offSpine) {
      if (onSpine.has(key)) continue;
      const schema = this.schemaAt(location);
      if (!isObject(schema)) continue;
      for (const keyword of ["x-vmd-list", "x-vmd-ref"]) {
        if (!Object.hasOwn(schema, keyword)) continue;
        report(
          { file: location.file, pointer: childPath(location.pointer, keyword) },
          `${keyword} is reached only through ${via}, off the schema's spine; a keyed list or a typed reference stands where properties, patternProperties, additionalProperties, prefixItems, items, allOf and $ref lead, so that its meaning never depends on which branch the data satisfies`,
        );
      }
    }
  }
}

/** A shape: a set of schema locations closed under `allOf` and `$ref`. */
class Shape implements SchemaShape {
  readonly #spine: Spine;
  readonly locations: readonly SchemaLocation[];
  readonly id: string;
  readonly #children = new Map<string, Shape>();
  readonly list: ListDeclaration | null;
  readonly ref: RefDeclaration | null;
  readonly conflicts: readonly SchemaLocation[];
  readonly format: string | null;
  readonly summary: boolean | null;
  readonly ordered: "asc" | "desc" | null;
  /** The declarations here, by keyword, each with its location. */
  readonly #declarations: ReadonlyMap<string, readonly { readonly location: SchemaLocation; readonly value: Value }[]>;

  constructor(spine: Spine, locations: readonly SchemaLocation[]) {
    this.#spine = spine;
    this.locations = locations;
    this.id = locations.map(locationKey).sort().join("\n");
    const declarations = new Map<string, { readonly location: SchemaLocation; readonly value: Value }[]>();
    let format: string | null = null;
    let summary: boolean | null = null;
    let ordered: "asc" | "desc" | null = null;
    for (const location of locations) {
      const schema = spine.schemaAt(location);
      if (!isObject(schema)) continue;
      for (const keyword of ["x-vmd-list", "x-vmd-ref"]) {
        if (!Object.hasOwn(schema, keyword)) continue;
        const found = declarations.get(keyword) ?? [];
        found.push({ location, value: schema[keyword] as Value });
        declarations.set(keyword, found);
      }
      if (format === null && typeof schema.format === "string") format = schema.format;
      if (summary === null && typeof schema["x-vmd-summary"] === "boolean") summary = schema["x-vmd-summary"];
      if (ordered === null && (schema["x-vmd-ordered"] === "asc" || schema["x-vmd-ordered"] === "desc"))
        ordered = schema["x-vmd-ordered"];
    }
    this.#declarations = declarations;
    const conflicts: SchemaLocation[] = [];
    const lists = declarations.get("x-vmd-list") ?? [];
    const refs = declarations.get("x-vmd-ref") ?? [];
    const listsEqual = allEqual(lists);
    const refsEqual = allEqual(refs);
    if (!listsEqual) conflicts.push(...lists.map((found) => found.location));
    if (!refsEqual) conflicts.push(...refs.map((found) => found.location));
    const firstList = lists[0];
    const firstRef = refs[0];
    this.list =
      listsEqual && firstList !== undefined ? readListDeclaration(firstList.value as ValueObject, firstList.location) : null;
    this.ref = refsEqual && firstRef !== undefined ? readRefDeclaration(firstRef.value as ValueObject) : null;
    this.conflicts = conflicts;
    this.format = format;
    this.summary = summary;
    this.ordered = ordered;
  }

  child(step: ShapeStep): SchemaShape {
    return this.#child(step);
  }

  #child(step: ShapeStep): Shape {
    const id = "member" in step ? `m${step.member}` : `i${step.item}${step.key === undefined ? "" : `\n${step.key}`}`;
    let child = this.#children.get(id);
    if (child === undefined) {
      child = this.#spine.shape("member" in step ? this.#memberLocations(step.member) : this.#itemLocations(step.item, step.key));
      this.#children.set(id, child);
    }
    return child;
  }

  /** The locations that apply to a member of this name: each object's `properties` and matching patterns, else its `additionalProperties`. */
  #memberLocations(name: string): SchemaLocation[] {
    const found: SchemaLocation[] = [];
    for (const location of this.locations) {
      const schema = this.#spine.schemaAt(location);
      if (!isObject(schema)) continue;
      let matched = false;
      if (isObject(schema.properties) && Object.hasOwn(schema.properties, name)) {
        found.push(at(location, "properties", name));
        matched = true;
      }
      if (isObject(schema.patternProperties)) {
        for (const source of Object.keys(schema.patternProperties)) {
          if (this.#spine.pattern(source)?.test(name) === true) {
            found.push(at(location, "patternProperties", source));
            matched = true;
          }
        }
      }
      if (!matched && isSchemaValue(schema.additionalProperties)) found.push(at(location, "additionalProperties"));
    }
    return found;
  }

  /** The locations that apply to an item: each object's `prefixItems` entry, else its `items`, and in a keyed list the key's schema. */
  #itemLocations(index: number, key: string | undefined): SchemaLocation[] {
    const found: SchemaLocation[] = [];
    for (const location of this.locations) {
      const schema = this.#spine.schemaAt(location);
      if (!isObject(schema)) continue;
      if (Array.isArray(schema.prefixItems) && index < schema.prefixItems.length) found.push(at(location, "prefixItems", index));
      else if (isSchemaValue(schema.items)) found.push(at(location, "items"));
    }
    if (key !== undefined && this.list !== null) {
      const perKey = this.list.items.get(key);
      const listLocation = this.#declarations.get("x-vmd-list")?.[0]?.location as SchemaLocation;
      if (perKey !== undefined) found.push({ file: listLocation.file, pointer: perKey });
      else if (typeof this.list.additional === "object")
        found.push({ file: listLocation.file, pointer: this.list.additional.pointer });
    }
    return found;
  }

  /** Reports the problems of this shape's own declarations, wherever it stands. */
  checkHere(report: (location: SchemaLocation, message: string) => void): void {
    for (const [keyword, found] of this.#declarations) {
      if (allEqual(found)) continue;
      const where = found.map((declaration) => locationKey(declaration.location)).join(", ");
      report(
        {
          file: (found[0] as { location: SchemaLocation }).location.file,
          pointer: childPath((found[0] as { location: SchemaLocation }).location.pointer, keyword),
        },
        `unequal ${keyword} declarations apply to one instance location, from ${where}; declarations that meet must be equal`,
      );
    }
    const lists = this.#declarations.get("x-vmd-list") ?? [];
    if (lists.length > 0) {
      for (const location of this.locations) {
        const schema = this.#spine.schemaAt(location);
        if (isObject(schema) && Object.hasOwn(schema, "unevaluatedItems")) {
          report(
            { file: location.file, pointer: childPath(location.pointer, "unevaluatedItems") },
            "unevaluatedItems stands beside an x-vmd-list, which evaluates the items itself, so the validator would count them as unevaluated",
          );
        }
      }
    }
    const refs = this.#declarations.get("x-vmd-ref") ?? [];
    if (refs.length > 0 && !this.#has((schema) => schema.format === "uri-reference") && this.#allowsStrings()) {
      for (const declaration of refs) {
        report(
          { file: declaration.location.file, pointer: childPath(declaration.location.pointer, "x-vmd-ref") },
          "x-vmd-ref stands on a schema that allows a string, without format: uri-reference, so a string there would be no reference",
        );
      }
    }
  }

  /** Reports a keyed list that is on `$sections` and not keyed by `@key` alone, or keyed by `@key` elsewhere. */
  checkPlacement(onSections: boolean, report: (location: SchemaLocation, message: string) => void): void {
    for (const declaration of this.#declarations.get("x-vmd-list") ?? []) {
      const key = ((declaration.value as ValueObject).keys as readonly string[])[0];
      const where = { file: declaration.location.file, pointer: childPath(declaration.location.pointer, "x-vmd-list") };
      if (onSections && key !== "@key") {
        report(
          where,
          `x-vmd-list keys a section's $sections by ${JSON.stringify(key)}; sections are keyed by their section key, so $sections takes keys: ["@key"] only`,
        );
      } else if (!onSections && key === "@key") {
        report(
          where,
          'x-vmd-list keys by "@key" a list that is not a section\'s $sections; @key is the section key, which only sections have',
        );
      }
    }
  }

  /** Whether some object of this shape satisfies a test. */
  #has(test: (schema: ValueObject) => boolean): boolean {
    return this.locations.some((location) => {
      const schema = this.#spine.schemaAt(location);
      return isObject(schema) && test(schema);
    });
  }

  /** Whether every `type` of this shape allows a string; true when none is given. */
  #allowsStrings(): boolean {
    return !this.#has((schema) => {
      const type = schema.type;
      if (type === undefined) return false;
      return Array.isArray(type) ? !type.includes("string") : type !== "string";
    });
  }

  /**
   * The shapes of the instance locations below this one that the schema names, with whether each is a section and a
   * section's `$sections`: each member `properties` names, each pattern and `additionalProperties` alone, each `prefixItems`
   * entry, the other items, and the items of a keyed list by key.
   */
  staticChildren(section: boolean, onSections: boolean): { shape: Shape; section: boolean; onSections: boolean }[] {
    const children: { shape: Shape; section: boolean; onSections: boolean }[] = [];
    const names = new Set<string>();
    let prefix = 0;
    for (const location of this.locations) {
      const schema = this.#spine.schemaAt(location);
      if (!isObject(schema)) continue;
      if (isObject(schema.properties)) for (const name of Object.keys(schema.properties)) names.add(name);
      if (isObject(schema.patternProperties)) {
        for (const source of Object.keys(schema.patternProperties)) {
          children.push({
            shape: this.#spine.shape([at(location, "patternProperties", source)]),
            section: false,
            onSections: false,
          });
        }
      }
      if (isSchemaValue(schema.additionalProperties)) {
        children.push({ shape: this.#spine.shape([at(location, "additionalProperties")]), section: false, onSections: false });
      }
      if (Array.isArray(schema.prefixItems)) prefix = Math.max(prefix, schema.prefixItems.length);
    }
    for (const name of names) {
      children.push({ shape: this.#child({ member: name }), section: false, onSections: section && name === "$sections" });
    }
    const itemSection = onSections;
    for (let index = 0; index <= prefix; index++)
      children.push({ shape: this.#child({ item: index }), section: itemSection, onSections: false });
    if (this.list !== null) {
      for (const key of this.list.items.keys()) {
        children.push({ shape: this.#child({ item: prefix, key }), section: itemSection, onSections: false });
      }
      if (typeof this.list.additional === "object") {
        // A key the list does not name: the item gets `additional`.
        let other = "";
        while (this.list.items.has(other)) other += "-";
        children.push({ shape: this.#child({ item: prefix, key: other }), section: itemSection, onSections: false });
      }
    }
    return children;
  }
}

/** The location of a keyword's subschema below a location: `keyword`, then `name` when the keyword holds several. */
function at(location: SchemaLocation, keyword: string, name?: string | number): SchemaLocation {
  const keywordAt = childPath(location.pointer, keyword);
  return { file: location.file, pointer: name === undefined ? keywordAt : childPath(keywordAt, name) };
}

function allEqual(found: readonly { readonly value: Value }[]): boolean {
  const first = found[0];
  return first === undefined || found.every((declaration) => valuesEqual(declaration.value, first.value));
}
