import { childPath } from "../record/exact-path.js";
import { jcs } from "../value/jcs.js";
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
  /**
   * The shape of an item whose position is not known, as a semantic step's is not: every `prefixItems` entry and `items` of
   * each location, with the keyed list's schema for `key`, if one is given, as {@link SchemaShape.child} adds it.
   */
  anyItem(key: string | undefined): SchemaShape;
  /** The keyed list declared here; null when none is, or when unequal ones meet here (see `conflicts`). */
  readonly list: ListDeclaration | null;
  /** Whether an `x-vmd-list` here declares `multimap`, among unequal ones too, whose meeting leaves `list` null. */
  readonly multimap: boolean;
  /**
   * Whether any location here has an `x-vmd-list`, unequal ones included. Where it is true an item may be keyed: the
   * locations of an item at one position may declare a list although `list` is null for all positions together.
   */
  readonly declaresList: boolean;
  /**
   * The schemas of the keyed list declared here that an item with this key must also match, beside the array's own `items`:
   * of each location that declares it, the per-key schema of `key`, or else `additional` when that is a schema. None where
   * `list` is null.
   */
  listSchemas(key: string): readonly SchemaLocation[];
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

/** What {@link Spine.check} found: the first problems, by location and then message, and how many others it found. */
export interface SpineCheck {
  readonly problems: readonly SpineProblem[];
  readonly unlisted: number;
}

/** The two extension keywords that the spine carries. */
const DECLARATIONS = ["x-vmd-list", "x-vmd-ref"] as const;

/** How many locations a set that applies together holds before the pair walk takes its pairs one first member at a time. */
const LARGE_SET = 16;

/** How many locations the memo of closures holds at most before it is emptied. */
const MAX_CLOSURE_ENTRIES = 1 << 22;

/** How many name indexes the memo of the listed names' groupings holds at most before it is emptied: 32 MiB of them. */
const MAX_GROUPED_NAMES = 1 << 23;

/** The listed names grouped by how two lists of patterns take them, from {@link Spine.#nameGroups}. */
interface NameGroups {
  /** For each way of matching, the indexes of its names, in order. */
  readonly ways: readonly Int32Array[];
  /** The names each pattern of either list matches, as {@link Spine.#matches} gives them; shared, not copied. */
  readonly patterns: readonly Uint32Array[];
  /** How many listed names no pattern of either list matches. */
  readonly unmatched: number;
}

/** The union of one word of several bitsets. */
function unionAt(bitsets: readonly Uint32Array[], word: number): number {
  let union = 0;
  for (let index = 0; index < bitsets.length; index++) union |= (bitsets[index] as Uint32Array)[word] as number;
  return union;
}

/** Unequal values of one declaration keyword. */
const SEVERAL = Symbol("several");

/** The values of one declaration keyword below a location: none, the one value as JCS text, or several unequal ones. */
type DeclaredValues = undefined | string | typeof SEVERAL;

/**
 * What a schema location's spine below it holds, for the checks that need two locations together or every path: the values
 * of each declaration keyword, whether a keyed list or `unevaluatedItems` is there, and whether a location that gives
 * `format: uri-reference` or a `type` without strings is.
 */
interface SubtreeMarks {
  /** By the keyword's index in `DECLARATIONS`. */
  readonly declared: DeclaredValues[];
  hasList: boolean;
  hasUnevaluated: boolean;
  hasRefGuard: boolean;
}

/** The values of a declaration keyword below two locations together. */
function joinValues(one: DeclaredValues, other: DeclaredValues): DeclaredValues {
  if (one === other || other === undefined) return one;
  return one === undefined ? other : SEVERAL;
}

/** Whether the spine below a location holds a declaration or `unevaluatedItems`, so that it may show a problem with another. */
function declaresAny(marks: SubtreeMarks): boolean {
  return marks.hasUnevaluated || marks.declared.some((values) => values !== undefined);
}

/** Whether the spine below a location holds an `x-vmd-ref`. */
function declaresRef(marks: SubtreeMarks): boolean {
  return marks.declared[DECLARATIONS.indexOf("x-vmd-ref")] !== undefined;
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

/**
 * The spine of a schema set: the shapes of instance locations, built on demand and shared, and the checks that only the
 * spine can make. Valid only over a set whose extension keywords `checkExtensionKeywords` accepted.
 */
export class Spine {
  readonly #set: SchemaSet;
  readonly #shapes = new Map<string, Shape>();
  readonly #closures = new Map<string, readonly SchemaLocation[]>();
  #closureEntries = 0;
  readonly #maxClosureEntries: number;
  readonly #patterns = new Map<string, RegExp | null>();
  readonly #marks = new Map<string, SubtreeMarks>();
  readonly #matchesBySource = new Map<string, Uint32Array>();
  readonly #closedFromByLocation = new Map<string, number>();
  #pairsVisited = 0;
  #mustSteps = 0;
  #keyedIndexSteps = 0;
  #stepsComputed = 0;
  #nameSteps = 0;
  #nameGroupings = 0;
  readonly #groupsByPatterns = new Map<string, NameGroups>();
  #groupedNames = 0;
  readonly #maxGroupedNames: number;
  #markSteps = 0;
  #placeSteps = 0;
  #names: readonly string[] | undefined;
  readonly root: SchemaShape;

  /**
   * The spine of `set`. `maxClosureEntries` is how many locations the memo of closures holds before it is emptied, and
   * `maxGroupedNames` how many name indexes the memo of the listed names' groupings holds, for tests of those bounds;
   * positive integers.
   */
  constructor(set: SchemaSet, options: { readonly maxClosureEntries?: number; readonly maxGroupedNames?: number } = {}) {
    this.#set = set;
    this.#maxClosureEntries = options.maxClosureEntries ?? MAX_CLOSURE_ENTRIES;
    this.#maxGroupedNames = options.maxGroupedNames ?? MAX_GROUPED_NAMES;
    this.root = this.shape([{ file: set.root, pointer: "" }]);
  }

  /** How many name indexes the memo of the listed names' groupings holds now, one at least per grouping, for its tests. */
  get groupedNames(): number {
    let count = 0;
    for (const { ways } of this.#groupsByPatterns.values()) count += 1 + ways.reduce((sum, way) => sum + way.length, 0);
    return count;
  }

  /** How many locations the memo of closures holds now, for tests of its bound. */
  get memoizedLocations(): number {
    let count = 0;
    for (const closed of this.#closures.values()) count += closed.length;
    return count;
  }

  /** How many pairs of locations the last {@link Spine.check} visited: the work its pair walk did, for tests of its cost. */
  get pairsVisited(): number {
    return this.#pairsVisited;
  }

  /**
   * How many steps from a shape to a child shape have been computed rather than found in a shape's memo, for tests of the
   * cost of binding records: the items of a long list share their steps.
   */
  get stepsComputed(): number {
    return this.#stepsComputed;
  }

  /** Counts a step computed, for {@link Spine.stepsComputed}. */
  countStep(): void {
    this.#stepsComputed += 1;
  }

  /**
   * How many locations the last {@link Spine.check} stepped from while computing what applies beside a typed reference on
   * every path: the work of that fixed point, for tests of its cost.
   */
  get mustSteps(): number {
    return this.#mustSteps;
  }

  /**
   * How many locations the last {@link Spine.check} took up while finding whether every index at which a keyed list's item
   * can stand gives the format: for each array and each time what applies beside it changed, the locations beside it, and
   * those it looked at, index by index, for one giving the item the format. Not counted in {@link Spine.mustSteps}.
   */
  get keyedIndexSteps(): number {
    return this.#keyedIndexSteps;
  }

  /**
   * How many listed names the last {@link Spine.check} examined one by one while choosing the members that a pair of
   * locations taking members of any name steps to, for tests of its cost: for each pair, the names it skips because its own
   * `properties` name them; and for each grouping of the names by a pair of pattern lists, computed once (see
   * {@link Spine.nameGroupings}), the names some pattern matches. It leaves out the rest of that work: the words of the
   * patterns' bitsets that a grouping scans, and each pattern's test against every listed name.
   */
  get nameSteps(): number {
    return this.#nameSteps;
  }

  /**
   * How many times the last {@link Spine.check} grouped the listed names by the patterns of a pair of locations that take
   * members of any name: the work of those groupings, for tests of their cost.
   */
  get nameGroupings(): number {
    return this.#nameGroupings;
  }

  /**
   * How many parent entries and mark values the last {@link Spine.check} wrote or compared while marking what the spine below
   * each location holds: the work of that marking, for tests of its cost.
   */
  get markSteps(): number {
    return this.#markSteps;
  }

  /**
   * How many locations the last {@link Spine.check} took up in its walk of single locations, for the keyed lists' places:
   * the work of that walk, for tests of its cost.
   */
  get placeSteps(): number {
    return this.#placeSteps;
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
    for (let next = 0; next < pending.length; next++) {
      const location = pending[next] as SchemaLocation;
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
    // The closures of a long chain of references add up to the square of its length, so the memo is emptied before it holds
    // more than a bounded number of locations; what it held is computed again when asked for.
    if (this.#closureEntries + closed.length > this.#maxClosureEntries) {
      this.#closures.clear();
      this.#closureEntries = 0;
    }
    this.#closures.set(id, closed);
    this.#closureEntries += closed.length;
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
    return this.closure(this.#memberSchemas(location, name));
  }

  /** The subschemas that apply to a member of this name from one schema object, without what their `allOf` and `$ref` bring. */
  #memberSchemas(location: SchemaLocation, name: string): SchemaLocation[] {
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
    return found;
  }

  /**
   * The locations that apply to an item from one schema object: its `prefixItems` entry, else its `items`, and in its keyed
   * list the key's schema or `additional`; with what their `allOf` and `$ref` bring.
   */
  itemLocations(location: SchemaLocation, index: number, key: string | undefined): readonly SchemaLocation[] {
    return this.closure(this.#itemSchemas(location, index, key));
  }

  /** The subschemas that apply to an item from one schema object, without what their `allOf` and `$ref` bring. */
  #itemSchemas(location: SchemaLocation, index: number, key: string | undefined): SchemaLocation[] {
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
    return found;
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
   *   strings, must apply beside the declaration on every path that reaches it. A keyed list's item may stand at any index
   *   where an item can, and has the format when each such index gives it, from whichever location.
   *
   * What the root does not reach is not checked: a shared file's `$defs` may hold declarations other collections use.
   *
   * Gives the first `listed` problems by location and then message, all of them when `listed` is not given, and counts the
   * others: unequal declarations give a problem per pair of locations, which can be as many as the square of the schema.
   *
   * Cost: one walk of the locations the spine reaches, with the members, patterns and items of each, for the single-location
   * checks. The pairs are walked only between locations whose spine below holds what could meet: two unequal declarations,
   * or a keyed list and `unevaluatedItems`. A schema with none of them, or whose declarations are all equal, visits no pair.
   * In the worst case, two groups of co-applying locations with unequal declarations, the pairs grow with the product of the
   * groups' sizes, so quadratically in the schema. A pair takes a keyed list's item for each key it names at each index of
   * the longest `prefixItems` and past it, so its steps, and the pairs they lead to, grow with the keys times the
   * `prefixItems`: still at most quadratic, but reached with less schema. It takes no item at an index where an `items: false`
   * of either location, or of what their `allOf` and `$ref` bring, lets none stand, since no valid record holds one there. The locations that apply beside a typed reference
   * on every path are kept only for references whose own schema object lacks the format, and only of the locations that
   * could give it, which in the worst case is quadratic too. Whether every index at which a keyed list's item can stand gives
   * the format is found once per array and change of what applies beside it, whatever the keys: at most the indexes up to
   * the longest `prefixItems` beside it times the locations beside it, stopping at the first index that lacks it.
   *
   * Memory: linear in the schema, but for bitsets and the waiting pairs. The pairs met take a bit for each pair of locations
   * whose spine below holds a declaration or `unevaluatedItems`, in a row for the first of the pair once it is met. The
   * pairs waiting take two integers each, at most eight bytes for each pair met. The fixed point for the format keeps two
   * bitsets for each location above a reference that lacks the format: what applies beside it on every path, and what its
   * own `allOf` and `$ref` give, each a bit for each location that could give the format. Each of these takes at most the
   * square of the locations over eight bytes, the fixed point's twice that.
   *
   * @throws RangeError when `listed` is neither a non-negative integer nor infinite.
   */
  // Deviation from the I2 design, recorded in issue #22: the check walks pairs of locations rather than every set a path
  // reaches, which was exponential; a declaration reached off the spine is refused even where the spine reaches it too.
  check(listed = Number.POSITIVE_INFINITY): SpineCheck {
    // Unequal declarations give a problem per pair, as many as the square of the schema, so only the first `listed` by
    // location and message are kept, and the others counted.
    if (listed !== Number.POSITIVE_INFINITY && !(Number.isInteger(listed) && listed >= 0)) {
      throw new RangeError(`the problems to list must be a non-negative integer or Infinity, not ${listed}`);
    }
    let kept: SpineProblem[] = [];
    let found = 0;
    const keep = (location: SchemaLocation, message: string) => {
      found += 1;
      kept.push({ location, message });
      // Trimming when the kept problems reach twice those listed, plus a margin for a small `listed`, sorts each problem
      // a bounded number of times, so the trims cost O(problems × log listed) in all and hold O(listed) problems.
      if (kept.length > 2 * listed + 1024) kept = kept.sort(problemOrder).slice(0, listed);
    };
    // A pair is visited once, so its unequal declarations are reported once; the other problems can be met again.
    const reported = new Set<string>();
    const report = (location: SchemaLocation, message: string) => {
      const key = `${locationKey(location)}\n${message}`;
      if (reported.has(key)) return;
      reported.add(key);
      keep(location, message);
    };
    this.#checkOffSpine(report);
    this.#computeMarks();
    this.#checkPlaces(report);
    this.#checkRefFormats(report);
    this.#checkPairs(report, keep);
    const problems = kept.sort(problemOrder).slice(0, listed);
    return { problems, unlisted: found - problems.length };
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
   * and reports the keyed lists out of their place and the typed references without their format. What a location's
   * `allOf` and `$ref` bring is walked as a step of its own, so that the walk holds each location once per state rather
   * than once per closure that holds it.
   */
  #checkPlaces(report: (location: SchemaLocation, message: string) => void): void {
    // `sections` is how a section's $sections was reached: through `properties`, or through a pattern or
    // `additionalProperties` that takes it; null for a location that is not on a section's $sections.
    type Sections = "properties" | "other" | null;
    this.#placeSteps = 0;
    const pending: { readonly location: SchemaLocation; readonly section: boolean; readonly sections: Sections }[] = [
      { location: { file: this.#set.root, pointer: "" }, section: true, sections: null },
    ];
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
        this.#placeSteps += locations.length;
        for (const child of locations) pending.push({ location: child, section: childSection, sections: childSections });
      };
      // What allOf and $ref bring applies where this location does.
      if (Array.isArray(schema.allOf)) {
        schema.allOf.forEach((item, index) => {
          if (isSchemaValue(item)) push([at(location, "allOf", index)], section, sections);
        });
      }
      const reference = this.#set.references.get(referenceKey(location, "$ref"));
      if (reference !== undefined && reference.target !== null) push([reference.target], section, sections);
      const named = isObject(schema.properties) ? Object.keys(schema.properties) : [];
      for (const name of named) {
        push(this.#memberSchemas(location, name), false, section && name === "$sections" ? "properties" : null);
      }
      let patternTakesSections = false;
      if (isObject(schema.patternProperties)) {
        for (const source of Object.keys(schema.patternProperties)) {
          const matchesSections = this.pattern(source)?.test("$sections") === true;
          patternTakesSections ||= matchesSections;
          const taken = [at(location, "patternProperties", source)];
          push(taken, false, null);
          if (section && matchesSections && !named.includes("$sections")) push(taken, false, "other");
        }
      }
      if (isSchemaValue(schema.additionalProperties)) {
        const taken = [at(location, "additionalProperties")];
        push(taken, false, null);
        if (section && !named.includes("$sections") && !patternTakesSections) push(taken, false, "other");
      }
      const items = sections !== null;
      const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
      for (let index = 0; index <= prefix; index++) push(this.#itemSchemas(location, index, undefined), items, null);
      const list = schema["x-vmd-list"];
      if (isObject(list)) {
        for (const key of isObject(list.items) ? Object.keys(list.items) : [])
          push(this.#itemSchemas(location, prefix, key), items, null);
        if (isObject(list.additional)) push([at(at(location, "x-vmd-list"), "additional")], items, null);
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
   * Marks each location the spine reaches with what its spine below holds, by joining each location's marks into the
   * locations above it until nothing changes. A location's marks grow at most a few times (a keyword's values go from none
   * to one to several, and each flag is set once), and each growth moves up each edge once, so the work is linear.
   */
  #computeMarks(): void {
    this.#markSteps = 0;
    const parents = new Map<string, SchemaLocation[]>();
    const reached: SchemaLocation[] = [];
    const pending: SchemaLocation[] = [{ file: this.#set.root, pointer: "" }];
    while (pending.length > 0) {
      const location = pending.pop() as SchemaLocation;
      const key = locationKey(location);
      if (this.#marks.has(key)) continue;
      const schema = this.schemaAt(location);
      const marks: SubtreeMarks = {
        declared: DECLARATIONS.map(() => undefined),
        hasList: false,
        hasUnevaluated: false,
        hasRefGuard: false,
      };
      if (isObject(schema)) {
        DECLARATIONS.forEach((keyword, index) => {
          if (Object.hasOwn(schema, keyword)) marks.declared[index] = jcs(schema[keyword] as Value);
        });
        marks.hasList = Object.hasOwn(schema, "x-vmd-list");
        marks.hasUnevaluated = Object.hasOwn(schema, "unevaluatedItems");
        marks.hasRefGuard = guardsRefs(schema);
      }
      this.#marks.set(key, marks);
      reached.push(location);
      for (const { child } of this.#spineEdges(location)) {
        const childKey = locationKey(child);
        const above = parents.get(childKey);
        if (above === undefined) parents.set(childKey, [location]);
        else above.push(location);
        this.#markSteps += 1;
        pending.push(child);
      }
    }
    const work = [...reached];
    while (work.length > 0) {
      const location = work.pop() as SchemaLocation;
      const marks = this.#marks.get(locationKey(location)) as SubtreeMarks;
      for (const parent of parents.get(locationKey(location)) ?? []) {
        this.#markSteps += 1;
        const above = this.#marks.get(locationKey(parent)) as SubtreeMarks;
        let grew = false;
        for (let index = 0; index < DECLARATIONS.length; index++) {
          const joined = joinValues(above.declared[index], marks.declared[index]);
          if (joined !== above.declared[index]) {
            above.declared[index] = joined;
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
   * and holds only the locations whose spine below gives the format or such a type, as a bitset over those. A step to an
   * item where no item can stand, as {@link Spine.#closedFrom} tells from the parent, is no way of reaching the child, and a
   * reference that only such steps reach needs no format.
   *
   * A keyed list's item can stand at any index where an item can, and at each a different location may give it the format.
   * So a step to a keyed item also gives a mark of its own, beside the locations, when at every such index some location
   * that the parent's Must brings to the item gives the format or a type without strings. The mark says that the item's own
   * instance location has one on every path, though no single location does, so it passes through `allOf` and `$ref` and no
   * further. Whether a parent gives the mark is found once for each parent's Must, not once for each key.
   */
  #checkRefFormats(report: (location: SchemaLocation, message: string) => void): void {
    this.#mustSteps = 0;
    this.#keyedIndexSteps = 0;
    const locationOf = (key: string) => (this.#set.schemas.get(key) as { readonly location: SchemaLocation }).location;
    const needy: SchemaLocation[] = [];
    for (const [key, marks] of this.#marks) {
      if (!declaresRef(marks)) continue;
      const location = locationOf(key);
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
    for (let next = 0; next < pending.length; next++) {
      const location = pending[next] as SchemaLocation;
      const key = locationKey(location);
      if (visited.has(key)) continue;
      visited.add(key);
      order.push(location);
      for (const { child, edge } of this.#spineEdges(location)) {
        const marks = this.#marksOf(child);
        if (marks === undefined || !declaresRef(marks)) continue;
        const childKey = locationKey(child);
        const known = reasons.get(childKey);
        if (known === undefined) reasons.set(childKey, [{ parent: location, edge }]);
        else known.push({ parent: location, edge });
        pending.push(child);
      }
    }
    // The locations that could give the format, numbered for the bitsets.
    const usefulIds = new Map<string, number>();
    const usefulLocations: SchemaLocation[] = [];
    for (const [key, marks] of this.#marks) {
      if (!marks.hasRefGuard) continue;
      usefulIds.set(key, usefulLocations.length);
      usefulLocations.push(locationOf(key));
    }
    // The bit after them is the mark that every index a keyed item can stand at gives the format.
    const everyIndex = usefulLocations.length;
    const words = (everyIndex + 1 + 31) >>> 5;
    const add = (found: Uint32Array, location: SchemaLocation) => {
      const id = usefulIds.get(locationKey(location));
      if (id !== undefined) found[id >>> 5] = (found[id >>> 5] as number) | (1 << (id & 31));
    };
    const owns = new Map<string, Uint32Array>();
    const own = (location: SchemaLocation) => {
      const key = locationKey(location);
      let found = owns.get(key);
      if (found === undefined) {
        found = new Uint32Array(words);
        for (const closed of this.closure([location])) add(found, closed);
        owns.set(key, found);
      }
      return found;
    };
    // Must, by location key; undefined stands for every location, the fixed point's start.
    const must = new Map<string, Uint32Array | undefined>();
    for (const location of order) must.set(locationKey(location), undefined);
    const prefixOf = (location: SchemaLocation) => {
      const schema = this.schemaAt(location);
      return isObject(schema) && Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    };
    // Whether at each index below `closed`, the first at which no item can stand, some location in a parent's Must `above`
    // brings to an item one that gives the format or a type without strings. Memoized by `above`, which a parent's Must
    // replaces when it changes, so it is found once per parent and change, whatever the keys of its list.
    const indexesGuarded = new Map<string, { readonly above: Uint32Array; readonly guarded: boolean }>();
    const guardsEveryIndex = (parent: SchemaLocation, above: Uint32Array, closed: number): boolean => {
      const key = locationKey(parent);
      const known = indexesGuarded.get(key);
      if (known !== undefined && known.above === above) return known.guarded;
      const besides: SchemaLocation[] = [];
      let longest = 0;
      forEachBit(above, (id) => {
        if (id === everyIndex) return;
        const beside = usefulLocations[id] as SchemaLocation;
        besides.push(beside);
        longest = Math.max(longest, prefixOf(beside));
      });
      this.#keyedIndexSteps += besides.length;
      // From the longest prefixItems on, each location gives every item its items alike, so that index stands for the rest.
      const last = Math.min(closed - 1, longest);
      let guarded = true;
      for (let index = 0; index <= last && guarded; index++) {
        guarded = besides.some((beside) => {
          this.#keyedIndexSteps += 1;
          return this.itemLocations(beside, index, undefined).some((location) => guardsRefs(this.schemaAt(location)));
        });
      }
      indexesGuarded.set(key, { above, guarded });
      return guarded;
    };
    // What a step from a parent gives beside the child on every path; undefined, as for every location, while the parent's
    // is not known, and for a step to an item where none can stand, which is on no path that a valid record takes.
    const given = (parent: SchemaLocation, edge: SpineEdge): Uint32Array | undefined => {
      const above = must.get(locationKey(parent));
      if (above === undefined) return undefined;
      if (edge.kind === "same") return above;
      const closed = this.#closedFrom(parent);
      if (edge.kind === "prefix" && edge.index >= closed) return undefined;
      if (edge.kind === "items" && prefixOf(parent) >= closed) return undefined;
      if (edge.kind === "keyed" && closed === 0) return undefined;
      const found = new Uint32Array(words);
      if (edge.kind === "unnamed") return found;
      forEachBit(above, (id) => {
        if (id === everyIndex) return;
        this.#mustSteps += 1;
        const beside = usefulLocations[id] as SchemaLocation;
        // Every item of a keyed list, whatever its index, gets the items schema of a location without prefixItems.
        if (edge.kind === "keyed") {
          const schema = this.schemaAt(beside);
          if (prefixOf(beside) !== 0 || !isObject(schema) || !isSchemaValue(schema.items)) return;
          for (const location of this.closure([at(beside, "items")])) add(found, location);
          return;
        }
        const locations =
          edge.kind === "member"
            ? this.memberLocations(beside, edge.name)
            : edge.kind === "prefix"
              ? this.itemLocations(beside, edge.index, undefined)
              : prefixOf(beside) <= prefixOf(parent)
                ? this.itemLocations(beside, prefixOf(parent), undefined)
                : [];
        for (const location of locations) add(found, location);
      });
      if (edge.kind === "keyed" && guardsEveryIndex(parent, above, closed)) {
        found[everyIndex >>> 5] = (found[everyIndex >>> 5] as number) | (1 << (everyIndex & 31));
      }
      return found;
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const location of order) {
        const key = locationKey(location);
        let next: Uint32Array | undefined;
        if (key === locationKey(root)) {
          next = own(location);
        } else {
          for (const reason of reasons.get(key) ?? []) {
            const g = given(reason.parent, reason.edge);
            if (g === undefined) continue;
            if (next === undefined) next = g.slice();
            else for (let word = 0; word < words; word++) next[word] = (next[word] as number) & (g[word] as number);
          }
          if (next !== undefined) {
            const mine = own(location);
            for (let word = 0; word < words; word++) next[word] = (next[word] as number) | (mine[word] as number);
          }
        }
        const previous = must.get(key);
        if (next !== undefined && (previous === undefined || bitCount(next) !== bitCount(previous))) {
          must.set(key, next);
          changed = true;
        }
      }
    }
    for (const location of needy) {
      const beside = must.get(locationKey(location));
      // Undefined still: every path to it steps where no item can stand, so no valid record has a string there.
      if (beside === undefined) continue;
      let guarded = false;
      forEachBit(beside, (id) => {
        guarded ||= id === everyIndex || guardsRefs(this.schemaAt(usefulLocations[id] as SchemaLocation));
      });
      if (guarded) continue;
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
   *
   * The pairs met are kept as a bitset per location, over the locations that could show a problem, and the pairs waiting
   * in a stack of integers; the pairs of a large set of locations that apply together are taken from it one at a time. So
   * the walk holds no collection that grows with the pairs other than those, which take a bit and at most two integers each.
   */
  #checkPairs(
    report: (location: SchemaLocation, message: string) => void,
    reportPair: (location: SchemaLocation, message: string) => void,
  ): void {
    this.#pairsVisited = 0;
    this.#nameSteps = 0;
    this.#nameGroupings = 0;
    // Only locations whose spine below could show a problem with another are paired, and only with a location that could
    // show it with them: an unequal declaration, or a keyed list against unevaluatedItems.
    const ids = new Map<string, number>();
    const candidates: SchemaLocation[] = [];
    const candidateMarks: SubtreeMarks[] = [];
    for (const [key, marks] of this.#marks) {
      if (!declaresAny(marks)) continue;
      ids.set(key, candidates.length);
      candidates.push((this.#set.schemas.get(key) as { readonly location: SchemaLocation }).location);
      candidateMarks.push(marks);
    }
    const words = (candidates.length + 31) >>> 5;
    const met: (Uint32Array | undefined)[] = [];
    // Records the pair of these candidates, the smaller first, and says whether it is new.
    const meet = (one: number, other: number): boolean => {
      let row = met[one];
      if (row === undefined) {
        row = new Uint32Array(words);
        met[one] = row;
      }
      const word = row[other >>> 5] as number;
      const bit = 1 << (other & 31);
      if ((word & bit) !== 0) return false;
      row[other >>> 5] = word | bit;
      return true;
    };
    const waiting = new IntegerStack();
    // Sets of candidates too large to pair at once, each with the index of the next first member to pair.
    const large: { readonly members: readonly number[]; first: number }[] = [];
    const pairUp = (members: readonly number[], first: number) => {
      const one = members[first] as number;
      for (let second = first; second < members.length; second++) {
        const other = members[second] as number;
        const [low, high] = one <= other ? [one, other] : [other, one];
        if (!couldMeet([candidateMarks[low] as SubtreeMarks, candidateMarks[high] as SubtreeMarks])) continue;
        if (meet(low, high)) waiting.push(low, high);
      }
    };
    const addAll = (locations: readonly SchemaLocation[]) => {
      const members: number[] = [];
      const known = new Set<number>();
      for (const location of locations) {
        const id = ids.get(locationKey(location));
        if (id === undefined || known.has(id)) continue;
        known.add(id);
        members.push(id);
      }
      if (!couldMeet(members.map((id) => candidateMarks[id] as SubtreeMarks))) return;
      if (members.length > LARGE_SET) large.push({ members, first: 0 });
      else for (let first = 0; first < members.length; first++) pairUp(members, first);
    };
    addAll(this.closure([{ file: this.#set.root, pointer: "" }]));
    for (;;) {
      if (waiting.length === 0) {
        const set = large.at(-1);
        if (set === undefined) break;
        pairUp(set.members, set.first);
        set.first += 1;
        if (set.first === set.members.length) large.pop();
        continue;
      }
      const high = waiting.pop();
      const low = waiting.pop();
      this.#pairsVisited += 1;
      const one = candidates[low] as SchemaLocation;
      const other = candidates[high] as SchemaLocation;
      const first = this.schemaAt(one);
      const second = this.schemaAt(other);
      if (!isObject(first) || !isObject(second)) continue;
      this.#checkPair(one, first, other, second, report, reportPair);
      for (const step of this.#checkSteps(one, first, other, second)) {
        const applying =
          step.kind === "member"
            ? [...this.memberLocations(one, step.name), ...this.memberLocations(other, step.name)]
            : [...this.itemLocations(one, step.index, step.key), ...this.itemLocations(other, step.index, step.key)];
        addAll(applying);
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
        // Where no item can stand at any index, nothing below the keyed list applies to anything.
        const list = schema["x-vmd-list"];
        if (isObject(list) && isObject(list.additional) && this.#closedFrom(location) > 0) {
          addAll(this.closure([at(at(location, "x-vmd-list"), "additional")]));
        }
      }
    }
  }

  /**
   * The steps a pair follows: the members either location's `properties` names and the items at the indexes where an item
   * can stand, and every other name the schema lists anywhere that both locations take, through a pattern or
   * `additionalProperties`. Such a name is in the schema, so two declarations that meet there meet without the data's help.
   * This is conservative: the name may be listed where the pair does not apply.
   *
   * Of the other names, one stands for all those that the two locations take the same way, since they step to the same
   * locations; the walk's result, and its order, are those of stepping over every one.
   */
  #checkSteps(one: SchemaLocation, first: ValueObject, other: SchemaLocation, second: ValueObject): CheckStep[] {
    const steps = namedSteps(first, second, Math.min(this.#closedFrom(one), this.#closedFrom(other)));
    const takesUnnamed = (schema: ValueObject) =>
      isObject(schema.patternProperties) || isSchemaValue(schema.additionalProperties);
    if (!takesUnnamed(first) || !takesUnnamed(second)) return steps;
    const named = new Set(steps.flatMap((step) => (step.kind === "member" ? [step.name] : [])));
    for (const name of this.#unnamedWitnesses(first, second, named)) {
      if (this.memberLocations(one, name).length > 0 && this.memberLocations(other, name).length > 0) {
        steps.push({ kind: "member", name });
      }
    }
    return steps;
  }

  /**
   * The first index at which no item can stand where a location applies, because it, or what its `allOf` and `$ref` bring,
   * gives `items: false` past its `prefixItems`, or a `prefixItems` entry that is `false`; infinite where none does. An item
   * there fails that `false` whatever it holds, and an item past it needs one there, so declarations that meet only from
   * that index on meet in no valid record.
   */
  #closedFrom(location: SchemaLocation): number {
    const key = locationKey(location);
    let closed = this.#closedFromByLocation.get(key);
    if (closed === undefined) {
      closed = Number.POSITIVE_INFINITY;
      // Only the literal `false` is read. A schema that admits nothing, such as {not: {}}, also closes the index, but telling
      // such schemas apart is deciding whether a schema is satisfiable, which the check does not attempt; it stays
      // conservative there and refuses what meets past them. So does an `items: false` of a third location that applies
      // beside the pair without being brought by either, since the walk keeps pairs, not every set that applies together.
      for (const applied of this.closure([location])) {
        const schema = this.schemaAt(applied);
        if (!isObject(schema)) continue;
        const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
        const falseEntry = prefix.indexOf(false);
        if (falseEntry !== -1) closed = Math.min(closed, falseEntry);
        if (schema.items === false) closed = Math.min(closed, prefix.length);
      }
      this.#closedFromByLocation.set(key, closed);
    }
    return closed;
  }

  /**
   * One listed name for each way that two schema objects take the listed names `named` leaves out: by the patterns of each
   * that match the name, or by its `additionalProperties` where none does. Each is the first listed name taken that way.
   * A member of a name neither object's `properties` names gets, below each object, what that way gives, so these names step
   * to everything the others do.
   *
   * Cost, per call: for each way that some pattern gives, the names of that way that `named` holds, from the first, and one
   * more; and for the names no pattern matches, a scan of a word per 32 listed names for each pattern, until one that
   * `named` does not hold. So a pair costs the ways of its patterns, which can be as many as the names they match. The ways
   * come from
   * {@link Spine.#nameGroups}, computed once for each pair of pattern lists. `nameSteps` counts the names examined here and
   * in the groupings, not the words scanned.
   */
  #unnamedWitnesses(first: ValueObject, second: ValueObject, named: ReadonlySet<string>): string[] {
    const names = this.#listedNames();
    const { ways, patterns, unmatched } = this.#nameGroups(first, second);
    const witnesses: string[] = [];
    for (const way of ways) {
      for (const index of way) {
        this.#nameSteps += 1;
        const name = names[index] as string;
        if (named.has(name)) continue;
        witnesses.push(name);
        break;
      }
    }
    if (unmatched === 0) return witnesses;
    const words = (names.length + 31) >>> 5;
    unmatchedNames: for (let word = 0; word < words; word++) {
      const valid = word === words - 1 && names.length % 32 !== 0 ? 2 ** (names.length % 32) - 1 : 0xffffffff;
      const matched = unionAt(patterns, word);
      for (let bits = ~matched & valid; bits !== 0; bits &= bits - 1) {
        const index = word * 32 + (31 - Math.clz32(bits & -bits));
        this.#nameSteps += 1;
        const name = names[index] as string;
        if (named.has(name)) continue;
        witnesses.push(name);
        break unmatchedNames;
      }
    }
    return witnesses;
  }

  /**
   * The listed names grouped by how two schema objects' patterns take them: for each way of matching (which of each object's
   * patterns match the name), the indexes of its names in order; the patterns' matches; and how many names no pattern
   * matches. It depends only on the two lists of patterns, so it is memoized by them. A grouping holds the indexes of the
   * names its patterns match, and shares the patterns' bitsets; the memo is emptied before it would hold more than its
   * bound of indexes, or than one grouping when that alone is larger, and what it held is computed again when asked for.
   *
   * Cost, per pair of pattern lists: a scan of a word per 32 listed names for each pattern, and for each name a pattern
   * matches, a test of each pattern's bit. Besides, each distinct pattern is tested once against every listed name, the
   * first time a grouping needs it (see {@link Spine.#matches}).
   */
  #nameGroups(first: ValueObject, second: ValueObject): NameGroups {
    const sources = (schema: ValueObject) => (isObject(schema.patternProperties) ? Object.keys(schema.patternProperties) : []);
    const [firstSources, secondSources] = [sources(first), sources(second)];
    const id = JSON.stringify([firstSources, secondSources]);
    const known = this.#groupsByPatterns.get(id);
    if (known !== undefined) return known;
    this.#nameGroupings += 1;
    const names = this.#listedNames();
    const firstMatches = firstSources.map((source) => this.#matches(source));
    const secondMatches = secondSources.map((source) => this.#matches(source));
    const all = [...firstMatches, ...secondMatches];
    const way = (index: number) => {
      const bit = (matches: Uint32Array) => (((matches[index >>> 5] as number) >>> (index & 31)) & 1 ? "1" : "0");
      return `${firstMatches.map(bit).join("")} ${secondMatches.map(bit).join("")}`;
    };
    const byWay = new Map<string, number[]>();
    const words = (names.length + 31) >>> 5;
    let count = 0;
    for (let word = 0; word < words; word++) {
      const union = unionAt(all, word);
      for (let bits = union; bits !== 0; bits &= bits - 1) {
        const index = word * 32 + (31 - Math.clz32(bits & -bits));
        this.#nameSteps += 1;
        count += 1;
        const key = way(index);
        const found = byWay.get(key);
        if (found === undefined) byWay.set(key, [index]);
        else found.push(index);
      }
    }
    const groups: NameGroups = {
      ways: [...byWay.values()].map((group) => Int32Array.from(group)),
      patterns: all,
      unmatched: names.length - count,
    };
    // A grouping without matched names still takes an entry, counted as one index.
    const size = count + 1;
    if (this.#groupedNames + size > this.#maxGroupedNames) {
      this.#groupsByPatterns.clear();
      this.#groupedNames = 0;
    }
    this.#groupsByPatterns.set(id, groups);
    this.#groupedNames += size;
    return groups;
  }

  /** The listed names a `patternProperties` pattern matches: bit `i` for the `i`th, none for a pattern that does not compile. */
  #matches(source: string): Uint32Array {
    const known = this.#matchesBySource.get(source);
    if (known !== undefined) return known;
    const names = this.#listedNames();
    const matches = new Uint32Array((names.length + 31) >>> 5);
    const pattern = this.pattern(source);
    names.forEach((name, index) => {
      const word = index >>> 5;
      if (pattern?.test(name) === true) matches[word] = (matches[word] as number) | (1 << (index & 31));
    });
    this.#matchesBySource.set(source, matches);
    return matches;
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

  /**
   * Reports what two locations that apply together, or one with itself, show: unequal declarations through `reportPair`,
   * since they name the pair, which is visited once, and `unevaluatedItems` beside a keyed list through `report`.
   */
  #checkPair(
    one: SchemaLocation,
    first: ValueObject,
    other: SchemaLocation,
    second: ValueObject,
    report: (location: SchemaLocation, message: string) => void,
    reportPair: (location: SchemaLocation, message: string) => void,
  ): void {
    for (const keyword of DECLARATIONS) {
      if (!Object.hasOwn(first, keyword) || !Object.hasOwn(second, keyword)) continue;
      if (valuesEqual(first[keyword] as Value, second[keyword] as Value)) continue;
      const [a, b] = [locationKey(one), locationKey(other)].sort();
      reportPair(
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

/**
 * Whether the spines below these locations could show a problem together: two unequal declarations of one keyword, or a
 * keyed list and `unevaluatedItems`. For a single location, whether its spine below could show one by itself.
 */
function couldMeet(marks: readonly SubtreeMarks[]): boolean {
  let list = false;
  let unevaluated = false;
  for (let index = 0; index < DECLARATIONS.length; index++) {
    let values: DeclaredValues;
    for (const mark of marks) {
      values = joinValues(values, mark.declared[index]);
      if (values === SEVERAL) return true;
    }
  }
  for (const mark of marks) {
    list ||= mark.hasList;
    unevaluated ||= mark.hasUnevaluated;
  }
  return list && unevaluated;
}

/** Calls `visit` with the index of each bit set in a bitset, in increasing order. */
function forEachBit(bits: Uint32Array, visit: (index: number) => void): void {
  bits.forEach((word, at) => {
    for (let rest = word; rest !== 0; rest &= rest - 1) visit(at * 32 + (31 - Math.clz32(rest & -rest)));
  });
}

/** The number of bits set in a bitset. */
function bitCount(bits: Uint32Array): number {
  let count = 0;
  bits.forEach((word) => {
    for (let rest = word; rest !== 0; rest &= rest - 1) count += 1;
  });
  return count;
}

/** A stack of integers below 2^31, in typed arrays that grow by doubling, so that it can hold more than an array can. */
class IntegerStack {
  #items = new Int32Array(16);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  push(...values: number[]): void {
    for (const value of values) {
      if (this.#length === this.#items.length) {
        const grown = new Int32Array(this.#items.length * 2);
        grown.set(this.#items);
        this.#items = grown;
      }
      this.#items[this.#length] = value;
      this.#length += 1;
    }
  }

  /** Removes and gives the top integer; the stack must not be empty. */
  pop(): number {
    this.#length -= 1;
    return this.#items[this.#length] as number;
  }
}

/**
 * The order of the problems the check gives: by their location's file, then its pointer one reference token at a time, then
 * by message; tokens and messages compare their runs of digits as numbers, so `/allOf/2` comes before `/allOf/10`.
 */
function problemOrder(one: SpineProblem, other: SpineProblem): number {
  const byFile = naturalOrder(one.location.file, other.location.file);
  if (byFile !== 0) return byFile;
  const a = one.location.pointer.split("/");
  const b = other.location.pointer.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const byToken = naturalOrder(a[index] as string, b[index] as string);
    if (byToken !== 0) return byToken;
  }
  if (a.length !== b.length) return a.length - b.length;
  return naturalOrder(one.message, other.message);
}

/** Compares two strings by their runs of digits, as numbers, and of other characters, as text; then as text alone. */
function naturalOrder(one: string, other: string): number {
  const a = one.match(/[0-9]+|[^0-9]+/g) ?? [];
  const b = other.match(/[0-9]+|[^0-9]+/g) ?? [];
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const [x, y] = [a[index] as string, b[index] as string];
    if (x === y) continue;
    const digits = /^[0-9]/;
    if (digits.test(x) && digits.test(y)) {
      const byValue = compareDigits(x, y);
      if (byValue !== 0) return byValue;
    }
    return x < y ? -1 : 1;
  }
  if (a.length !== b.length) return a.length - b.length;
  return one < other ? -1 : one > other ? 1 : 0;
}

/** Compares two runs of decimal digits by their value, whatever their length. */
function compareDigits(one: string, other: string): number {
  const [a, b] = [one.replace(/^0+/, ""), other.replace(/^0+/, "")];
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
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
 * The steps that two schema objects name, which both follow together: the members `properties` names, the items at each
 * index `prefixItems` gives and past them, and the items of each key a keyed list names, at each of those indexes; of the
 * indexes, only those below `closed`, the first at which no item can stand.
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
  const last = Math.min(prefix, closed - 1);
  for (let index = 0; index <= last; index++) steps.push({ kind: "item", index });
  // An item with a key can stand at any open index, so its key's schema meets each prefixItems entry as well as items.
  for (const key of keys) for (let index = 0; index <= last; index++) steps.push({ kind: "item", index, key });
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
  readonly multimap: boolean;
  readonly declaresList: boolean;
  /** The longest `prefixItems` among the locations: an item at this index or later takes `items` from every location. */
  readonly #prefix: number;
  /** The locations of the `x-vmd-list` declarations here, with the keys their `items` name. */
  readonly #lists: readonly { readonly at: SchemaLocation; readonly declaration: ValueObject }[];
  /** Every key that the `items` of an `x-vmd-list` here names; an item with any other key takes `additional` alike. */
  readonly #namedKeys: ReadonlySet<string>;

  constructor(spine: Spine, locations: readonly SchemaLocation[]) {
    this.#spine = spine;
    this.locations = locations;
    const declarations = new Map<string, { readonly location: SchemaLocation; readonly value: Value }[]>();
    let format: string | null = null;
    let summary: boolean | null = null;
    let ordered: "asc" | "desc" | null = null;
    let prefix = 0;
    const listsHere: { readonly at: SchemaLocation; readonly declaration: ValueObject }[] = [];
    const namedKeys = new Set<string>();
    for (const location of locations) {
      const schema = spine.schemaAt(location);
      if (!isObject(schema)) continue;
      for (const keyword of DECLARATIONS) {
        if (!Object.hasOwn(schema, keyword)) continue;
        const found = declarations.get(keyword) ?? [];
        found.push({ location, value: schema[keyword] as Value });
        declarations.set(keyword, found);
      }
      if (Array.isArray(schema.prefixItems)) prefix = Math.max(prefix, schema.prefixItems.length);
      const list = schema["x-vmd-list"];
      if (isObject(list)) {
        listsHere.push({ at: at(location, "x-vmd-list"), declaration: list });
        if (isObject(list.items)) for (const key of Object.keys(list.items)) namedKeys.add(key);
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
    this.multimap = listsHere.some(({ declaration }) => declaration.type === "multimap");
    this.declaresList = listsHere.length > 0;
    this.#prefix = prefix;
    this.#lists = listsHere;
    this.#namedKeys = namedKeys;
  }

  child(step: ShapeStep): SchemaShape {
    // The memo is keyed by what the step's result depends on, so that the items of a long list share a few entries: an
    // index from the longest prefixItems on takes items everywhere, and a key no x-vmd-list names takes additional.
    let id: string;
    if ("member" in step) {
      id = `m${step.member}`;
    } else {
      id = `i${Math.min(step.item, this.#prefix)}${this.#keyId(step.key)}`;
    }
    let child = this.#children.get(id);
    if (child === undefined) {
      this.#spine.countStep();
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

  /** What an item step's result depends on of its key: none without a list, the key if a list names it, else any other. */
  #keyId(key: string | undefined): string {
    if (key === undefined || this.#lists.length === 0) return "";
    return this.#namedKeys.has(key) ? `\nk${key}` : "\nother";
  }

  anyItem(key: string | undefined): SchemaShape {
    // Memoized as child is, so that a step through a long prefixItems costs its positions once.
    const id = `a${this.#keyId(key)}`;
    let union = this.#children.get(id);
    if (union === undefined) {
      this.#spine.countStep();
      const shapes: SchemaShape[] = [];
      for (let index = 0; index <= this.#prefix; index++) {
        shapes.push(this.child(key === undefined ? { item: index } : { item: index, key }));
      }
      union = this.#spine.shape(unique(shapes.flatMap((shape) => shape.locations)));
      this.#children.set(id, union);
    }
    return union;
  }

  listSchemas(key: string): readonly SchemaLocation[] {
    if (this.list === null) return [];
    const found: SchemaLocation[] = [];
    for (const { at: listAt, declaration } of this.#lists) {
      if (isObject(declaration.items) && Object.hasOwn(declaration.items, key)) found.push(at(listAt, "items", key));
      else if (isObject(declaration.additional)) found.push(at(listAt, "additional"));
    }
    return found;
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
