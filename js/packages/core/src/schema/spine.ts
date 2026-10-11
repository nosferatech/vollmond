import { childPath } from "../record/exact-path.js";
import { type Value, type ValueObject, valuesEqual } from "../value/value.js";
import { type ListDeclaration, type RefDeclaration, readListDeclaration, readRefDeclaration } from "./keywords.js";
import { locationKey, referenceKey, type SchemaLocation, type SchemaSet } from "./schema-set.js";
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

/** The two extension keywords that the spine carries. */
const DECLARATIONS = ["x-vmd-list", "x-vmd-ref"] as const;

/**
 * A step of the spine's checks from one schema location: a member that a `properties` names, an item at an index, an item of
 * a keyed list by its key, or a member of a name the schema does not give (`pattern` for one a `patternProperties` pattern
 * matches, `additional` for one `additionalProperties` takes), which only the data names.
 */
type CheckStep =
  | { readonly kind: "member"; readonly name: string }
  | { readonly kind: "item"; readonly index: number; readonly key?: string };

/**
 * The spine of a schema set: the shapes of instance locations, built on demand and shared, and the checks that only the
 * spine can make. Valid only over a set whose extension keywords `checkExtensionKeywords` accepted.
 */
export class Spine {
  readonly #set: SchemaSet;
  readonly #shapes = new Map<string, Shape>();
  readonly #closures = new Map<string, readonly SchemaLocation[]>();
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

  /** The locations given and those their `allOf` and `$ref` bring, each once, in the order met. */
  closure(locations: readonly SchemaLocation[]): readonly SchemaLocation[] {
    const id = locations.map(locationKey).join("\n");
    const known = this.#closures.get(id);
    if (known !== undefined) return known;
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
          if (isSchemaValue(item)) pending.push(at(location, "allOf", index));
        });
      }
      const reference = this.#set.references.get(referenceKey(location, "$ref"));
      if (reference !== undefined && reference.target !== null) pending.push(reference.target);
    }
    this.#closures.set(id, closed);
    return closed;
  }

  /** The shape of the locations given and those their `allOf` and `$ref` bring, memoized by that set. */
  shape(locations: readonly SchemaLocation[]): Shape {
    const closed = this.closure(locations);
    const id = closed.map(locationKey).sort().join("\n");
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
   * The locations that apply to a member of this name from one schema object: its `properties` entry and the patterns that
   * match, else its `additionalProperties`; with what their `allOf` and `$ref` bring.
   */
  memberLocations(location: SchemaLocation, name: string): readonly SchemaLocation[] {
    const schema = this.schemaAt(location);
    if (!isObject(schema)) return [];
    const found: SchemaLocation[] = [];
    if (isObject(schema.properties) && Object.hasOwn(schema.properties, name)) found.push(at(location, "properties", name));
    if (isObject(schema.patternProperties)) {
      for (const source of Object.keys(schema.patternProperties)) {
        if (this.pattern(source)?.test(name) === true) found.push(at(location, "patternProperties", source));
      }
    }
    if (found.length === 0 && isSchemaValue(schema.additionalProperties)) found.push(at(location, "additionalProperties"));
    return this.closure(found);
  }

  /**
   * The locations that apply to an item from one schema object: its `prefixItems` entry, else its `items`, and in its keyed
   * list the key's schema or `additional`; with what their `allOf` and `$ref` bring.
   */
  itemLocations(location: SchemaLocation, index: number, key: string | undefined): readonly SchemaLocation[] {
    const schema = this.schemaAt(location);
    if (!isObject(schema)) return [];
    const found: SchemaLocation[] = [];
    if (Array.isArray(schema.prefixItems) && index < schema.prefixItems.length) found.push(at(location, "prefixItems", index));
    else if (isSchemaValue(schema.items)) found.push(at(location, "items"));
    const list = schema["x-vmd-list"];
    if (key !== undefined && isObject(list)) {
      const listAt = at(location, "x-vmd-list");
      if (isObject(list.items) && Object.hasOwn(list.items, key)) found.push(at(listAt, "items", key));
      else if (isObject(list.additional)) found.push(at(listAt, "additional"));
    }
    return this.closure(found);
  }

  /**
   * Checks what only the spine shows, from the root over every instance location the schema names:
   *
   * - an `x-vmd-list` or `x-vmd-ref` that the root reaches through a keyword off the spine, even if it is reached on the spine
   *   too, since it would then apply at one place and silently not at the other;
   * - unequal declarations that the schema alone brings to one instance location, through `allOf`, a `$ref` beside other
   *   keywords, or a member that `properties` names and a `patternProperties` pattern matches;
   * - a section's `$sections` keyed by anything but `@key`, and `@key` anywhere else; `$sections` is reached through
   *   `properties`, and through a pattern that matches it or an `additionalProperties` that takes it;
   * - `unevaluatedItems` that meets an `x-vmd-list` at one instance location, since it would fail items the list evaluates;
   * - `x-vmd-ref` on a schema whose `type` allows a string without `format: uri-reference`, both read from the schema object
   *   and what its `allOf` and `$ref` bring, where a string would be no reference.
   *
   * What the root does not reach is not checked: a shared file's `$defs` may hold declarations other collections use. The
   * check walks pairs of locations that apply at one instance location, and single locations with what kind of node they
   * are at, so its cost grows with the square of the number of schema locations, never with the number of paths.
   */
  // Deviation from the I2 design, recorded in issue #22: the check walks pairs of locations rather than every set a path
  // reaches, which was exponential; a declaration reached off the spine is refused even where the spine reaches it too.
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
    this.#checkPlaces(report);
    this.#checkPairs(report);
    return problems;
  }

  /** Reports each declaration that the root reaches through a keyword off the spine, on the spine too or not. */
  #checkOffSpine(report: (location: SchemaLocation, message: string) => void): void {
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
      if (via !== null && !offSpine.has(key)) offSpine.set(key, { location, via });
      const schema = this.schemaAt(location);
      if (!isObject(schema)) continue;
      for (const subschema of subschemas(schema, location.pointer)) {
        if (subschema.role === "defs") continue;
        const offVia = via ?? (subschema.role === "off" ? subschema.keyword : null);
        pending.push({ location: { file: location.file, pointer: subschema.pointer }, via: offVia });
      }
      const ref = this.#set.references.get(referenceKey(location, "$ref"));
      if (ref !== undefined && ref.target !== null) pending.push({ location: ref.target, via });
      const dynamic = this.#set.references.get(referenceKey(location, "$dynamicRef"));
      if (dynamic !== undefined) {
        // A $dynamicRef lands on its own target, or on any $dynamicAnchor of its name that the dynamic scope holds.
        const targets = dynamic.target === null ? [] : [dynamic.target];
        if (dynamic.anchor !== null) targets.push(...(this.#set.dynamicAnchors.get(dynamic.anchor) ?? []));
        for (const target of targets) pending.push({ location: target, via: via ?? "$dynamicRef" });
      }
    }
    for (const { location, via } of offSpine.values()) {
      const schema = this.schemaAt(location);
      if (!isObject(schema)) continue;
      for (const keyword of DECLARATIONS) {
        if (!Object.hasOwn(schema, keyword)) continue;
        report(
          at(location, keyword),
          `${keyword} is reached through ${via}, off the schema's spine; a keyed list or a typed reference stands only where properties, patternProperties, additionalProperties, prefixItems, items, allOf and $ref lead, so that its meaning never depends on which branch the data satisfies`,
        );
      }
    }
  }

  /**
   * Walks the single locations the spine reaches, each with whether it applies to a section and to a section's `$sections`,
   * and reports the keyed lists out of their place and the typed references without their format.
   */
  #checkPlaces(report: (location: SchemaLocation, message: string) => void): void {
    const pending: { readonly location: SchemaLocation; readonly section: boolean; readonly onSections: boolean }[] = [];
    for (const location of this.closure([{ file: this.#set.root, pointer: "" }]))
      pending.push({ location, section: true, onSections: false });
    const seen = new Set<string>();
    while (pending.length > 0) {
      const { location, section, onSections } = pending.pop() as (typeof pending)[number];
      const seenKey = `${section}|${onSections}|${locationKey(location)}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      const schema = this.schemaAt(location);
      if (!isObject(schema)) continue;
      this.#checkPlacement(location, schema, onSections, report);
      if (Object.hasOwn(schema, "x-vmd-ref")) this.#checkRefFormat(location, report);
      const push = (locations: readonly SchemaLocation[], childSection: boolean, childOnSections: boolean) => {
        for (const child of locations) pending.push({ location: child, section: childSection, onSections: childOnSections });
      };
      const named = isObject(schema.properties) ? Object.keys(schema.properties) : [];
      for (const name of named) push(this.memberLocations(location, name), false, section && name === "$sections");
      let patternTakesSections = false;
      if (isObject(schema.patternProperties)) {
        for (const source of Object.keys(schema.patternProperties)) {
          const matchesSections = this.pattern(source)?.test("$sections") === true;
          patternTakesSections ||= matchesSections;
          const closed = this.closure([at(location, "patternProperties", source)]);
          push(closed, false, false);
          if (section && matchesSections && !named.includes("$sections")) push(closed, false, true);
        }
      }
      if (isSchemaValue(schema.additionalProperties)) {
        const closed = this.closure([at(location, "additionalProperties")]);
        push(closed, false, false);
        if (section && !named.includes("$sections") && !patternTakesSections) push(closed, false, true);
      }
      const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
      for (let index = 0; index <= prefix; index++) push(this.itemLocations(location, index, undefined), onSections, false);
      const list = schema["x-vmd-list"];
      if (isObject(list)) {
        for (const key of isObject(list.items) ? Object.keys(list.items) : [])
          push(this.itemLocations(location, prefix, key), onSections, false);
        if (isObject(list.additional)) push(this.closure([at(at(location, "x-vmd-list"), "additional")]), onSections, false);
      }
    }
  }

  /** Reports a keyed list that is on `$sections` and not keyed by `@key` alone, or keyed by `@key` elsewhere. */
  #checkPlacement(
    location: SchemaLocation,
    schema: ValueObject,
    onSections: boolean,
    report: (location: SchemaLocation, message: string) => void,
  ): void {
    const list = schema["x-vmd-list"];
    if (!isObject(list)) return;
    const key = (list.keys as readonly string[])[0];
    const where = at(location, "x-vmd-list");
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

  /** Reports an `x-vmd-ref` whose schema, with what its `allOf` and `$ref` bring, allows a string without the URI format. */
  #checkRefFormat(location: SchemaLocation, report: (location: SchemaLocation, message: string) => void): void {
    const own = this.closure([location])
      .map((closed) => this.schemaAt(closed))
      .filter(isObject);
    const format = own.some((schema) => schema.format === "uri-reference");
    // Every `type` must allow a string for the value to be one; with no `type`, a string is allowed.
    const allowsStrings = own.every((schema) => {
      const type = schema.type;
      if (type === undefined) return true;
      return Array.isArray(type) ? type.includes("string") : type === "string";
    });
    if (!format && allowsStrings) {
      report(
        at(location, "x-vmd-ref"),
        "x-vmd-ref stands on a schema that allows a string, without format: uri-reference, so a string there would be no reference",
      );
    }
  }

  /**
   * Walks the pairs of locations that apply together at one instance location, from the root's, and reports unequal
   * declarations and `unevaluatedItems` beside a keyed list. A pair steps to the pairs of what each of its locations gives
   * the same step. A member of a name the schema does not give is followed from each location alone, since only a name in
   * the data brings two such locations together.
   */
  #checkPairs(report: (location: SchemaLocation, message: string) => void): void {
    const pending: (readonly [SchemaLocation, SchemaLocation])[] = [];
    const seen = new Set<string>();
    const addAll = (locations: readonly SchemaLocation[]) => {
      for (let first = 0; first < locations.length; first++) {
        for (let second = first; second < locations.length; second++) {
          pending.push([locations[first] as SchemaLocation, locations[second] as SchemaLocation]);
        }
      }
    };
    addAll(this.closure([{ file: this.#set.root, pointer: "" }]));
    while (pending.length > 0) {
      const [one, other] = pending.pop() as readonly [SchemaLocation, SchemaLocation];
      const keys = [locationKey(one), locationKey(other)].sort();
      const pairKey = keys.join("\n\n");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const first = this.schemaAt(one);
      const second = this.schemaAt(other);
      if (!isObject(first) || !isObject(second)) continue;
      this.#checkPair(one, first, other, second, report);
      for (const step of checkSteps(first, second)) {
        const applying =
          step.kind === "member"
            ? [...this.memberLocations(one, step.name), ...this.memberLocations(other, step.name)]
            : [...this.itemLocations(one, step.index, step.key), ...this.itemLocations(other, step.index, step.key)];
        addAll(unique(applying));
      }
      for (const [location, schema] of [
        [one, first],
        [other, second],
      ] as const) {
        if (isObject(schema.patternProperties)) {
          for (const source of Object.keys(schema.patternProperties))
            addAll(this.closure([at(location, "patternProperties", source)]));
        }
        if (isSchemaValue(schema.additionalProperties)) addAll(this.closure([at(location, "additionalProperties")]));
        const list = schema["x-vmd-list"];
        if (isObject(list) && isObject(list.additional)) {
          addAll(this.closure([at(at(location, "x-vmd-list"), "additional")]));
        }
      }
    }
  }

  /** Reports what two locations that apply together, or one with itself, show. */
  #checkPair(
    one: SchemaLocation,
    first: ValueObject,
    other: SchemaLocation,
    second: ValueObject,
    report: (location: SchemaLocation, message: string) => void,
  ): void {
    for (const keyword of DECLARATIONS) {
      if (!Object.hasOwn(first, keyword) || !Object.hasOwn(second, keyword)) continue;
      if (valuesEqual(first[keyword] as Value, second[keyword] as Value)) continue;
      const [a, b] = [locationKey(one), locationKey(other)].sort();
      report(
        at(locationKey(one) === a ? one : other, keyword),
        `unequal ${keyword} declarations apply to one instance location, from ${a}, ${b}; declarations that meet must be equal`,
      );
    }
    for (const [list, beside] of [[first, other] as const, [second, one] as const]) {
      const besideSchema = this.schemaAt(beside);
      if (Object.hasOwn(list, "x-vmd-list") && isObject(besideSchema) && Object.hasOwn(besideSchema, "unevaluatedItems")) {
        report(
          at(beside, "unevaluatedItems"),
          "unevaluatedItems stands beside an x-vmd-list, which evaluates the items itself, so the validator would count them as unevaluated",
        );
      }
    }
  }
}

/** The steps that two schema objects name, which both follow together: the members `properties` names, and the items. */
function checkSteps(first: ValueObject, second: ValueObject): CheckStep[] {
  const steps: CheckStep[] = [];
  const names = new Set<string>();
  let prefix = 0;
  const keys = new Set<string>();
  for (const schema of [first, second]) {
    if (isObject(schema.properties)) for (const name of Object.keys(schema.properties)) names.add(name);
    if (Array.isArray(schema.prefixItems)) prefix = Math.max(prefix, schema.prefixItems.length);
    const list = schema["x-vmd-list"];
    if (isObject(list) && isObject(list.items)) for (const key of Object.keys(list.items)) keys.add(key);
  }
  for (const name of names) steps.push({ kind: "member", name });
  for (let index = 0; index <= prefix; index++) steps.push({ kind: "item", index });
  for (const key of keys) steps.push({ kind: "item", index: prefix, key });
  return steps;
}

/** A shape: a set of schema locations closed under `allOf` and `$ref`. */
class Shape implements SchemaShape {
  readonly #spine: Spine;
  readonly locations: readonly SchemaLocation[];
  readonly #children = new Map<string, Shape>();
  readonly list: ListDeclaration | null;
  readonly ref: RefDeclaration | null;
  readonly conflicts: readonly SchemaLocation[];
  readonly format: string | null;
  readonly summary: boolean | null;
  readonly ordered: "asc" | "desc" | null;

  constructor(spine: Spine, locations: readonly SchemaLocation[]) {
    this.#spine = spine;
    this.locations = locations;
    const declarations = new Map<string, { readonly location: SchemaLocation; readonly value: Value }[]>();
    let format: string | null = null;
    let summary: boolean | null = null;
    let ordered: "asc" | "desc" | null = null;
    for (const location of locations) {
      const schema = spine.schemaAt(location);
      if (!isObject(schema)) continue;
      for (const keyword of DECLARATIONS) {
        if (!Object.hasOwn(schema, keyword)) continue;
        const found = declarations.get(keyword) ?? [];
        found.push({ location, value: schema[keyword] as Value });
        declarations.set(keyword, found);
      }
      if (format === null && typeof schema.format === "string") format = schema.format;
      if (summary === null && typeof schema["x-vmd-summary"] === "boolean") summary = schema["x-vmd-summary"];
      if (ordered === null && (schema["x-vmd-ordered"] === "asc" || schema["x-vmd-ordered"] === "desc")) {
        ordered = schema["x-vmd-ordered"];
      }
    }
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
    const id = "member" in step ? `m${step.member}` : `i${step.item}${step.key === undefined ? "" : `\n${step.key}`}`;
    let child = this.#children.get(id);
    if (child === undefined) {
      const locations = this.locations.flatMap((location) =>
        "member" in step
          ? this.#spine.memberLocations(location, step.member)
          : this.#spine.itemLocations(location, step.item, step.key),
      );
      child = this.#spine.shape(unique(locations));
      this.#children.set(id, child);
    }
    return child;
  }
}

/** The location of a keyword's subschema below a location: `keyword`, then `name` when the keyword holds several. */
function at(location: SchemaLocation, keyword: string, name?: string | number): SchemaLocation {
  const keywordAt = childPath(location.pointer, keyword);
  return { file: location.file, pointer: name === undefined ? keywordAt : childPath(keywordAt, name) };
}

/** The locations given, each once, in their order. */
function unique(locations: readonly SchemaLocation[]): SchemaLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = locationKey(location);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allEqual(found: readonly { readonly value: Value }[]): boolean {
  const first = found[0];
  return first === undefined || found.every((declaration) => valuesEqual(declaration.value, first.value));
}
