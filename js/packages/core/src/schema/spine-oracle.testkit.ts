// The spine's check as it stood before its costs were reduced, kept as the oracle of the differential tests: the new check
// must report what this one reports, over random schemas small enough for this one to finish. Only the check is kept; the
// shapes are the spine's own. It carries three changes of behaviour made with the check, marked where they stand: a keyed
// list's item meets the prefixItems entry of every index; no item is taken where an items: false or a prefixItems entry
// that is false lets none stand, by the pairs or by the paths of the format check; and a keyed item has the format where
// every index it can stand at gives it.

import { childPath } from "../record/exact-path.js";
import { jcs } from "../value/jcs.js";
import { type Value, type ValueObject, valuesEqual } from "../value/value.js";
import { type RefDeclaration, readRefDeclaration, sameRefDeclaration } from "./keywords.js";
import { locationKey, referenceKey, type SchemaLocation, type SchemaSet } from "./schema-set.js";
import type { SpineProblem } from "./spine.js";
import { isObject, isSchemaValue, subschemas } from "./walk.js";

/** The two extension keywords that the spine carries. */
const DECLARATIONS = ["x-vmd-list", "x-vmd-ref"] as const;

/** In the format check's Must, the mark that every index a keyed item can stand at gives the item the format; no location key. */
const EVERY_INDEX = "every index";

/**
 * What a schema location's spine below it holds, for the checks that need two locations together or every path: the
 * declarations by their value, whether a keyed list or `unevaluatedItems` is there, and whether a location that gives
 * `format: uri-reference` or a `type` without strings is.
 */
interface SubtreeMarks {
  readonly classes: Set<string>;
  hasList: boolean;
  hasUnevaluated: boolean;
  hasRefGuard: boolean;
}

/** How a location is reached from its parent on the spine, for the locations that apply beside it on every path. */
type SpineEdge =
  | { readonly kind: "same" }
  | { readonly kind: "member"; readonly name: string }
  | { readonly kind: "prefix"; readonly index: number }
  | { readonly kind: "items" }
  | { readonly kind: "keyed" }
  | { readonly kind: "unnamed" };

/**
 * A step of the spine's checks from one schema location: a member that a `properties` names, an item at an index, an item of
 * a keyed list by its key, or a member of a name the schema does not give (`pattern` for one a `patternProperties` pattern
 * matches, `additional` for one `additionalProperties` takes), which only the data names.
 */
type CheckStep =
  | { readonly kind: "member"; readonly name: string }
  | { readonly kind: "item"; readonly index: number; readonly key?: string };

/** The spine's check, in its first form. Valid only over a set whose extension keywords `checkExtensionKeywords` accepted. */
export class OracleSpine {
  readonly #set: SchemaSet;
  readonly #closures = new Map<string, readonly SchemaLocation[]>();
  readonly #patterns = new Map<string, RegExp | null>();
  readonly #marks = new Map<string, SubtreeMarks>();
  #pairsVisited = 0;
  #mustSteps = 0;
  #names: readonly string[] | undefined;

  constructor(set: SchemaSet) {
    this.#set = set;
  }

  /** How many pairs of locations the last {@link OracleSpine.check} visited: the work its pair walk did, for tests of its cost. */
  get pairsVisited(): number {
    return this.#pairsVisited;
  }

  /**
   * How many locations the last {@link OracleSpine.check} stepped from while computing what applies beside a typed reference on
   * every path: the work of that fixed point, for tests of its cost.
   */
  get mustSteps(): number {
    return this.#mustSteps;
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
   * - `x-vmd-ref` where some path lets a string stand without `format: uri-reference`: the format, or a `type` without
   *   strings, must apply beside the declaration on every path that reaches it.
   *
   * What the root does not reach is not checked: a shared file's `$defs` may hold declarations other collections use.
   *
   * Cost: one walk of the locations the spine reaches, with the members, patterns and items of each, for the single-location
   * checks. The pairs are walked only between locations whose spine below holds what could meet: two unequal declarations,
   * or a keyed list and `unevaluatedItems`. A schema with none of them, or whose declarations are all equal, visits no pair.
   * In the worst case, two groups of co-applying locations with unequal declarations, the pairs grow with the product of the
   * groups' sizes, so quadratically in the schema. The locations that apply beside a typed reference on every path are kept
   * only for references whose own schema object lacks the format, and only of the locations that could give it, which in
   * the worst case is quadratic too.
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
    this.#computeMarks();
    this.#checkPlaces(report);
    this.#checkRefFormats(report);
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
    // `sections` is how a section's $sections was reached: through `properties`, or through a pattern or
    // `additionalProperties` that takes it; null for a location that is not on a section's $sections.
    type Sections = "properties" | "other" | null;
    const pending: { readonly location: SchemaLocation; readonly section: boolean; readonly sections: Sections }[] = [];
    for (const location of this.closure([{ file: this.#set.root, pointer: "" }]))
      pending.push({ location, section: true, sections: null });
    const seen = new Set<string>();
    while (pending.length > 0) {
      const { location, section, sections } = pending.pop() as (typeof pending)[number];
      const seenKey = `${section}|${sections}|${locationKey(location)}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      const schema = this.schemaAt(location);
      if (!isObject(schema)) continue;
      this.#checkPlacement(location, schema, sections, report);
      const push = (locations: readonly SchemaLocation[], childSection: boolean, childSections: Sections) => {
        for (const child of locations) pending.push({ location: child, section: childSection, sections: childSections });
      };
      const named = isObject(schema.properties) ? Object.keys(schema.properties) : [];
      for (const name of named) {
        push(this.memberLocations(location, name), false, section && name === "$sections" ? "properties" : null);
      }
      let patternTakesSections = false;
      if (isObject(schema.patternProperties)) {
        for (const source of Object.keys(schema.patternProperties)) {
          const matchesSections = this.pattern(source)?.test("$sections") === true;
          patternTakesSections ||= matchesSections;
          const closed = this.closure([at(location, "patternProperties", source)]);
          push(closed, false, null);
          if (section && matchesSections && !named.includes("$sections")) push(closed, false, "other");
        }
      }
      if (isSchemaValue(schema.additionalProperties)) {
        const closed = this.closure([at(location, "additionalProperties")]);
        push(closed, false, null);
        if (section && !named.includes("$sections") && !patternTakesSections) push(closed, false, "other");
      }
      const items = sections !== null;
      const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
      for (let index = 0; index <= prefix; index++) push(this.itemLocations(location, index, undefined), items, null);
      const list = schema["x-vmd-list"];
      if (isObject(list)) {
        for (const key of isObject(list.items) ? Object.keys(list.items) : [])
          push(this.itemLocations(location, prefix, key), items, null);
        if (isObject(list.additional)) push(this.closure([at(at(location, "x-vmd-list"), "additional")]), items, null);
      }
    }
  }

  /** Reports a keyed list that is on `$sections` and not keyed by `@key` alone, or keyed by `@key` elsewhere. */
  #checkPlacement(
    location: SchemaLocation,
    schema: ValueObject,
    sections: "properties" | "other" | null,
    report: (location: SchemaLocation, message: string) => void,
  ): void {
    const list = schema["x-vmd-list"];
    if (!isObject(list)) return;
    const key = (list.keys as readonly string[])[0];
    const where = at(location, "x-vmd-list");
    if (sections !== null && key !== "@key") {
      const way =
        sections === "other"
          ? "; a pattern or additionalProperties brings this list to $sections, which properties: {$sections: false} keeps it from"
          : "";
      report(
        where,
        `x-vmd-list keys a section's $sections by ${JSON.stringify(key)}; sections are keyed by their section key, so $sections takes keys: ["@key"] only${way}`,
      );
    } else if (sections === null && key === "@key") {
      report(
        where,
        'x-vmd-list keys by "@key" a list that is not a section\'s $sections; @key is the section key, which only sections have',
      );
    }
  }

  /** The spine locations below a location, with how each is reached from it: its subschemas on the spine, and its `$ref`. */
  #spineEdges(location: SchemaLocation): { readonly child: SchemaLocation; readonly edge: SpineEdge }[] {
    const schema = this.schemaAt(location);
    if (!isObject(schema)) return [];
    const edges: { readonly child: SchemaLocation; readonly edge: SpineEdge }[] = [];
    for (const subschema of subschemas(schema, location.pointer)) {
      if (subschema.role !== "spine") continue;
      const child = { file: location.file, pointer: subschema.pointer };
      const last = subschema.pointer
        .slice(subschema.pointer.lastIndexOf("/") + 1)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
      const edge: SpineEdge =
        subschema.keyword === "allOf"
          ? { kind: "same" }
          : subschema.keyword === "properties"
            ? { kind: "member", name: last }
            : subschema.keyword === "prefixItems"
              ? { kind: "prefix", index: Number(last) }
              : subschema.keyword === "items"
                ? { kind: "items" }
                : subschema.keyword === "x-vmd-list"
                  ? { kind: "keyed" }
                  : { kind: "unnamed" };
      edges.push({ child, edge });
    }
    const reference = this.#set.references.get(referenceKey(location, "$ref"));
    if (reference !== undefined && reference.target !== null) edges.push({ child: reference.target, edge: { kind: "same" } });
    return edges;
  }

  /**
   * Marks each location the spine reaches with what its spine below holds, by propagating each location's own marks to the
   * locations above it until nothing changes; each mark moves up each edge once.
   */
  #computeMarks(): void {
    const parents = new Map<string, SchemaLocation[]>();
    const reached: SchemaLocation[] = [];
    const pending: SchemaLocation[] = [{ file: this.#set.root, pointer: "" }];
    while (pending.length > 0) {
      const location = pending.pop() as SchemaLocation;
      const key = locationKey(location);
      if (this.#marks.has(key)) continue;
      const schema = this.schemaAt(location);
      const marks: SubtreeMarks = { classes: new Set(), hasList: false, hasUnevaluated: false, hasRefGuard: false };
      if (isObject(schema)) {
        for (const keyword of DECLARATIONS)
          if (Object.hasOwn(schema, keyword)) marks.classes.add(`${keyword} ${jcs(schema[keyword] as Value)}`);
        marks.hasList = Object.hasOwn(schema, "x-vmd-list");
        marks.hasUnevaluated = Object.hasOwn(schema, "unevaluatedItems");
        marks.hasRefGuard = guardsRefs(schema);
      }
      this.#marks.set(key, marks);
      reached.push(location);
      for (const { child } of this.#spineEdges(location)) {
        const childKey = locationKey(child);
        parents.set(childKey, [...(parents.get(childKey) ?? []), location]);
        pending.push(child);
      }
    }
    const work = [...reached];
    while (work.length > 0) {
      const location = work.pop() as SchemaLocation;
      const marks = this.#marks.get(locationKey(location)) as SubtreeMarks;
      for (const parent of parents.get(locationKey(location)) ?? []) {
        const above = this.#marks.get(locationKey(parent)) as SubtreeMarks;
        let grew = false;
        for (const mark of marks.classes) {
          if (!above.classes.has(mark)) {
            above.classes.add(mark);
            grew = true;
          }
        }
        for (const flag of ["hasList", "hasUnevaluated", "hasRefGuard"] as const) {
          if (marks[flag] && !above[flag]) {
            above[flag] = true;
            grew = true;
          }
        }
        if (grew) work.push(parent);
      }
    }
  }

  /** The marks of a location the spine reaches; none for one it does not. */
  #marksOf(location: SchemaLocation): SubtreeMarks | undefined {
    return this.#marks.get(locationKey(location));
  }

  /**
   * Reports each `x-vmd-ref` that some path reaches without `format: uri-reference` or a `type` without strings applying
   * beside it. What applies beside a location L on every path, Must(L), is the greatest fixed point of: L's own `allOf`
   * and `$ref` closure, and the intersection over each way L is reached from a parent P of what P's Must gives the same
   * step. Only the references whose own closure lacks the format need it, so Must is computed for the locations above them,
   * and holds only the locations whose spine below gives the format or such a type.
   */
  #checkRefFormats(report: (location: SchemaLocation, message: string) => void): void {
    this.#mustSteps = 0;
    const needy: SchemaLocation[] = [];
    for (const [key, marks] of this.#marks) {
      if (![...marks.classes].some((mark) => mark.startsWith("x-vmd-ref "))) continue;
      const location = (this.#set.schemas.get(key) as { readonly location: SchemaLocation }).location;
      const schema = this.schemaAt(location);
      if (!isObject(schema) || !Object.hasOwn(schema, "x-vmd-ref")) continue;
      if (this.closure([location]).some((closed) => guardsRefs(this.schemaAt(closed)))) continue;
      needy.push(location);
    }
    if (needy.length === 0) return;
    // The locations above a needy reference, each with the ways it is reached from its parents.
    const reasons = new Map<string, { readonly parent: SchemaLocation; readonly edge: SpineEdge }[]>();
    const order: SchemaLocation[] = [];
    const root = { file: this.#set.root, pointer: "" };
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const location = pending.shift() as SchemaLocation;
      const key = locationKey(location);
      if (visited.has(key)) continue;
      visited.add(key);
      order.push(location);
      for (const { child, edge } of this.#spineEdges(location)) {
        const marks = this.#marksOf(child);
        if (marks === undefined || ![...marks.classes].some((mark) => mark.startsWith("x-vmd-ref "))) continue;
        const childKey = locationKey(child);
        reasons.set(childKey, [...(reasons.get(childKey) ?? []), { parent: location, edge }]);
        pending.push(child);
      }
    }
    const useful = (location: SchemaLocation) => this.#marksOf(location)?.hasRefGuard === true;
    const own = (location: SchemaLocation) => new Set(this.closure([location]).filter(useful).map(locationKey));
    const locationOf = (key: string) => (this.#set.schemas.get(key) as { readonly location: SchemaLocation }).location;
    // Must, by location key; undefined stands for every location, the fixed point's start.
    const must = new Map<string, Set<string> | undefined>();
    for (const location of order) must.set(locationKey(location), undefined);
    const prefixOf = (location: SchemaLocation) => {
      const schema = this.schemaAt(location);
      return isObject(schema) && Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    };
    const given = (parent: SchemaLocation, edge: SpineEdge): Set<string> | undefined => {
      const above = must.get(locationKey(parent));
      if (above === undefined) return undefined;
      if (edge.kind === "same") return above;
      // Changed with the check: a step to an item where none can stand is on no path.
      const closed = this.#closedFrom(parent);
      if (edge.kind === "prefix" && edge.index >= closed) return undefined;
      if (edge.kind === "items" && prefixOf(parent) >= closed) return undefined;
      if (edge.kind === "keyed" && closed === 0) return undefined;
      const found = new Set<string>();
      if (edge.kind === "unnamed") return found;
      // Every item of a keyed list, whatever its index, gets the items schema of a location without prefixItems.
      if (edge.kind === "keyed") {
        for (const key of above) {
          if (key === EVERY_INDEX) continue;
          this.#mustSteps += 1;
          const beside = locationOf(key);
          const schema = this.schemaAt(beside);
          if (prefixOf(beside) !== 0 || !isObject(schema) || !isSchemaValue(schema.items)) continue;
          for (const location of this.closure([at(beside, "items")])) if (useful(location)) found.add(locationKey(location));
        }
        // Changed with the check: at each index where an item can stand, some location beside the parent gives the item the
        // format; the mark stands for that, at the item's own instance location only.
        const besides = [...above].filter((key) => key !== EVERY_INDEX).map(locationOf);
        const last = Math.min(closed - 1, Math.max(0, ...besides.map(prefixOf)));
        let guarded = true;
        for (let index = 0; index <= last; index++) {
          const locations = besides.flatMap((beside) => this.itemLocations(beside, index, undefined));
          if (!locations.some((location) => guardsRefs(this.schemaAt(location)))) guarded = false;
        }
        if (guarded) found.add(EVERY_INDEX);
        return found;
      }
      for (const key of above) {
        if (key === EVERY_INDEX) continue;
        this.#mustSteps += 1;
        const beside = locationOf(key);
        const locations =
          edge.kind === "member"
            ? this.memberLocations(beside, edge.name)
            : edge.kind === "prefix"
              ? this.itemLocations(beside, edge.index, undefined)
              : prefixOf(beside) <= prefixOf(parent)
                ? this.itemLocations(beside, prefixOf(parent), undefined)
                : [];
        for (const location of locations) if (useful(location)) found.add(locationKey(location));
      }
      return found;
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const location of order) {
        const key = locationKey(location);
        let next: Set<string> | undefined;
        if (key === locationKey(root)) {
          next = own(location);
        } else {
          for (const reason of reasons.get(key) ?? []) {
            const g = given(reason.parent, reason.edge);
            if (g === undefined) continue;
            next = next === undefined ? new Set(g) : new Set([...next].filter((item) => g.has(item)));
          }
          if (next !== undefined) for (const item of own(location)) next.add(item);
        }
        const previous = must.get(key);
        if (next !== undefined && (previous === undefined || next.size !== previous.size)) {
          must.set(key, next);
          changed = true;
        }
      }
    }
    for (const location of needy) {
      const beside = must.get(locationKey(location));
      // Changed with the check: every path to it steps where no item can stand.
      if (beside === undefined) continue;
      if ([...beside].some((key) => key === EVERY_INDEX || guardsRefs(this.schemaAt(locationOf(key))))) continue;
      report(
        at(location, "x-vmd-ref"),
        "x-vmd-ref stands where a path lets a string stand without format: uri-reference, so a string there would be no reference; give the format, or a type without strings, beside it on every path",
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
    this.#pairsVisited = 0;
    const pending: (readonly [SchemaLocation, SchemaLocation])[] = [];
    const seen = new Set<string>();
    // Only locations whose spine below could show a problem with another are paired, and only with a location that could
    // show it with them: an unequal declaration, or a keyed list against unevaluatedItems.
    const addAll = (locations: readonly SchemaLocation[]) => {
      const candidates = locations.filter((location) => {
        const marks = this.#marksOf(location);
        return marks !== undefined && (marks.classes.size > 0 || marks.hasUnevaluated);
      });
      if (!couldMeet(candidates.map((location) => this.#marksOf(location) as SubtreeMarks))) return;
      for (let first = 0; first < candidates.length; first++) {
        for (let second = first; second < candidates.length; second++) {
          const one = candidates[first] as SchemaLocation;
          const other = candidates[second] as SchemaLocation;
          if (couldMeet([this.#marksOf(one) as SubtreeMarks, this.#marksOf(other) as SubtreeMarks])) pending.push([one, other]);
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
      this.#pairsVisited += 1;
      const first = this.schemaAt(one);
      const second = this.schemaAt(other);
      if (!isObject(first) || !isObject(second)) continue;
      this.#checkPair(one, first, other, second, report);
      for (const step of this.#checkSteps(one, first, other, second)) {
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
        // Changed with the check: not where no item can stand at any index.
        if (isObject(list) && isObject(list.additional) && this.#closedFrom(location) > 0) {
          addAll(this.closure([at(at(location, "x-vmd-list"), "additional")]));
        }
      }
    }
  }

  /**
   * The steps a pair follows: the members either location's `properties` names and the items, and every other name the
   * schema lists anywhere that both locations take, through a pattern or `additionalProperties`. Such a name is in the
   * schema, so two declarations that meet there meet without the data's help. This is conservative: the name may be listed
   * where the pair does not apply.
   */
  #checkSteps(one: SchemaLocation, first: ValueObject, other: SchemaLocation, second: ValueObject): CheckStep[] {
    const steps = namedSteps(first, second, Math.min(this.#closedFrom(one), this.#closedFrom(other)));
    const takesUnnamed = (schema: ValueObject) =>
      isObject(schema.patternProperties) || isSchemaValue(schema.additionalProperties);
    if (!takesUnnamed(first) || !takesUnnamed(second)) return steps;
    const named = new Set(steps.flatMap((step) => (step.kind === "member" ? [step.name] : [])));
    for (const name of this.#listedNames()) {
      if (named.has(name)) continue;
      if (this.memberLocations(one, name).length > 0 && this.memberLocations(other, name).length > 0) {
        steps.push({ kind: "member", name });
      }
    }
    return steps;
  }

  /**
   * The first index at which no item can stand where a location applies, because it, or what its `allOf` and `$ref` bring,
   * gives `items: false` past its `prefixItems`, or a `prefixItems` entry that is `false`; infinite where none does.
   */
  // Changed with the check: an item at or past such a false fails one whatever it holds, so nothing meets there.
  #closedFrom(location: SchemaLocation): number {
    let closed = Number.POSITIVE_INFINITY;
    for (const applied of this.closure([location])) {
      const schema = this.schemaAt(applied);
      if (!isObject(schema)) continue;
      const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
      if (prefix.includes(false)) closed = Math.min(closed, prefix.indexOf(false));
      if (schema.items === false) closed = Math.min(closed, prefix.length);
    }
    return closed;
  }

  /** Every member name a `properties` of the schema set lists, in any schema object. */
  #listedNames(): readonly string[] {
    if (this.#names === undefined) {
      const names = new Set<string>();
      for (const { value } of this.#set.schemas.values()) {
        if (isObject(value) && isObject(value.properties)) for (const name of Object.keys(value.properties)) names.add(name);
      }
      this.#names = [...names];
    }
    return this.#names;
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
    // An x-vmd-ref of one location, beside an unequal one on the $ref member the other takes.
    for (const [object, schema, holder] of [[one, first, other] as const, [other, second, one] as const]) {
      if (!Object.hasOwn(schema, "x-vmd-ref")) continue;
      for (const member of this.memberLocations(holder, "$ref")) {
        const memberSchema = this.schemaAt(member);
        if (!isObject(memberSchema) || !Object.hasOwn(memberSchema, "x-vmd-ref")) continue;
        const [own, members] = [schema["x-vmd-ref"], memberSchema["x-vmd-ref"]].map((value) =>
          readRefDeclaration(value as ValueObject),
        );
        if (sameRefDeclaration(own as RefDeclaration, members as RefDeclaration)) continue;
        report(
          at(object, "x-vmd-ref"),
          `an x-vmd-ref on a $ref object and an unequal one on its $ref member apply to one reference, from ${locationKey(object)}, ${locationKey(member)}; which one applies is not decided, so they must be equal`,
        );
      }
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

/**
 * Whether the spines below these locations could show a problem together: two unequal declarations of one keyword, or a
 * keyed list and `unevaluatedItems`. For a single location, whether its spine below could show one by itself.
 */
function couldMeet(marks: readonly SubtreeMarks[]): boolean {
  const values = new Map<string, string>();
  let list = false;
  let unevaluated = false;
  for (const mark of marks) {
    list ||= mark.hasList;
    unevaluated ||= mark.hasUnevaluated;
    for (const declaration of mark.classes) {
      const keyword = declaration.slice(0, declaration.indexOf(" "));
      const known = values.get(keyword);
      if (known !== undefined && known !== declaration) return true;
      values.set(keyword, declaration);
    }
  }
  return list && unevaluated;
}

/** Whether a schema object keeps a string from standing without the URI format: it gives the format, or a type without strings. */
function guardsRefs(schema: ValueObject | boolean | undefined): boolean {
  if (!isObject(schema)) return false;
  if (schema.format === "uri-reference") return true;
  const type = schema.type;
  if (type === undefined) return false;
  return Array.isArray(type) ? !type.includes("string") : type !== "string";
}

/**
 * The steps that two schema objects name, which both follow together: the members `properties` names, and the items at the
 * indexes below `closed`, the first at which no item can stand.
 */
function namedSteps(first: ValueObject, second: ValueObject, closed: number): CheckStep[] {
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
  // Changed with the check: no index from `closed` on.
  const last = Math.min(prefix, closed - 1);
  for (let index = 0; index <= last; index++) steps.push({ kind: "item", index });
  // Changed with the check: an item with a key can stand at any index, so its key's schema meets each prefixItems entry.
  for (const key of keys) for (let index = 0; index <= last; index++) steps.push({ kind: "item", index, key });
  return steps;
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
