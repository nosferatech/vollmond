import { type Issue, makeIssue } from "../issue/issue.js";
import { declaredDuplicate } from "../issue/severity.js";
import { childPath } from "../record/exact-path.js";
import type { NodeInfo } from "../record/node-index.js";
import { isParsedRecord, type ParsedRecord, type RecordStructure } from "../record/record.js";
import type { ReferenceOccurrence } from "../reference/reference.js";
import type { CollectionSchema, ListChecks } from "../schema/collection-schema.js";
import type { ListDeclaration, RefDeclaration } from "../schema/keywords.js";
import { LOGICAL_TYPES, type LogicalType } from "../schema/logical-types.js";
import type { SchemaLocation } from "../schema/schema-set.js";
import type { SchemaShape } from "../schema/spine.js";
import type { NativeFailure } from "../schema/violations.js";
import type { Position } from "../text/source-text.js";
import { type Value, type ValueObject, valuesEqual } from "../value/value.js";

/**
 * An array whose items are identified by a key: a section's `$sections`, keyed by the section keys, or an array that its
 * schema declares with `x-vmd-list`, keyed by a member of its items.
 */
export interface KeyedList {
  /** The array's exact path. */
  readonly at: string;
  /** The declared uniqueness of the keys; `undeclared` for a `$sections` that no schema declares, which the store's mode governs. */
  readonly type: "map" | "multimap" | "undeclared";
  /** Gives the key of the item at an index: its section key, or its key member's string value; null for an item without one. */
  keyOf(index: number): string | null;
  // Deviation from the I2 design, recorded in issue #23: the lookup by key, which the design leaves to the resolver, is the
  // list's, so that a step through a long list is one map lookup.
  /** Gives the indexes of the items whose key is `key`, compared by code point, in their order; none when no item has it. */
  indexesOf(key: string): readonly number[];
}

// Deviation from the I2 design, recorded in issue #23: the binding gives one shape per node, as the spine does; it leaves the
// collection to the store, which classifies the path; and of its references it gives the typed strings only, since the links
// of a JSON or YAML record's prose need a parse that a plain read must not pay for. Deviation recorded in issue #25: the local
// index keeps no shapes, which are the loaded schema's own objects, and a restored binding finds them again from the schema.
/**
 * What a record is under its collection's schema, computed once per record and schema: its keyed lists, the schema's shape of
 * each node, its typed references, and its issues, those of the parse adjusted for the levels the schema declares and those
 * of the schema.
 */
export interface RecordBinding<Record extends RecordStructure = RecordStructure> {
  /** The record bound: parsed, or restored from the local index. */
  readonly record: Record;
  /** The record's keyed lists, by exact path: every `$sections`, and every array the schema declares a keyed list. */
  readonly lists: ReadonlyMap<string, KeyedList>;
  /**
   * The exact paths of the record's typed references, in no particular order: each string whose shape declares `x-vmd-ref`
   * and that is a URI reference, but the `$ref` member of a JSON Reference, which is the object's reference. A string that is
   * no URI reference has its `schema-violation` from the schema's `format` instead.
   */
  readonly typedReferences: readonly string[];
  /**
   * Gives the `x-vmd-ref` declaration of the reference at an exact path: a typed string's; a JSON Reference's own, or else
   * its `$ref` member's, none where declarations conflict there or the two differ; null for any other node.
   */
  declarationOf(at: string): RefDeclaration | null;
  /** Gives the schema's shape of the node at an exact path; null for a record bound without a schema, or a path with no node. */
  shape(at: string): SchemaShape | null;
  /**
   * The record's validation issues, with their default severities: the parse's, with each `duplicate-key` among sections at
   * a level declared `multimap` dropped and each at a level declared `map` marked as declared, then the schema's.
   */
  readonly issues: readonly Issue[];
  /**
   * For a binding restored from the local index, what stands in for the record's values: its typed references' occurrences
   * and their issues' positions. Absent for a binding computed from a parsed record, or from a structure without a schema.
   */
  readonly restored?: BindingFacts;
}

/** What a binding restored from the local index holds in place of the values of its typed references. */
export interface BindingFacts {
  /** The occurrence of each typed reference, by its exact path, with its declaration. */
  readonly typed: ReadonlyMap<string, ReferenceOccurrence>;
  /** The line and column of each byte offset that an issue of a typed reference is positioned at. */
  readonly positions: ReadonlyMap<number, Position>;
}

/** The check of `format: uri-reference`, the validator's own, which a typed reference's string must pass. */
const URI_REFERENCE = LOGICAL_TYPES.get("uri-reference") as LogicalType;

/** How a node is reached, which says what its members are: a section, a section's `$sections`, or any other value. */
type Place = "section" | "sections" | "value";

/**
 * Binds a record to its collection's schema, or to none for a record outside collections or whose collection has no usable
 * schema. One walk of the value view beside the schema's spine gives each node its shape and finds the keyed lists, which
 * are then evaluated natively, as the validator does not see inside `x-vmd-list`:
 *
 * - an item of a list keyed by a member gets its key from that member's string value; one without a string there has no key
 *   and a `schema-violation`;
 * - under `type: map`, each item after the first whose key repeats is a `duplicate-key`, marked as declared so that no mode
 *   lowers it; `multimap` allows repeats;
 * - a required key that no item has is a `schema-violation` at the list, an item whose key `additional: false` refuses one at
 *   the item, and an item is validated against its key's per-key schema, or `additional` when that is a schema;
 * - a member that two `patternProperties` patterns bring unequal declarations to is a `schema-violation`, and gets neither;
 * - a string whose shape declares `x-vmd-ref`, and that is a URI reference, is a typed reference;
 * - a JSON Reference whose shape and whose `$ref` member's declare `x-vmd-ref` differently as written, which only a member
 *   name in the data brings together, is a `schema-violation`, and gets neither;
 * - a `duplicate-key` the parse raised among the sections of a level declared `multimap` is dropped, unless a field of the
 *   section shares the name before it, and one at a level declared `map` is marked as declared.
 *
 * Without a schema, every `$sections` is an undeclared keyed list and the parse's issues stay as they are. Cost: linear in the
 * record's nodes; a list's items share their shapes, and keys are looked up in a map.
 */
export function bindRecord(record: ParsedRecord, schema: CollectionSchema | null): RecordBinding<ParsedRecord> {
  const binder = new Binder(record);
  if (schema === null) {
    binder.bindSections();
  } else {
    binder.walk(schema.root);
  }
  const issues = binder.adjustedParseIssues();
  if (schema !== null) {
    for (const issue of schema.validate(record, binder.checks)) issues.push(issue);
    for (const issue of binder.duplicates) issues.push(issue);
  }
  const shapes = binder.shapes;
  const declarations = binder.declarations;
  return Object.freeze({
    record,
    lists: binder.lists,
    typedReferences: Object.freeze(binder.typed),
    declarationOf: (at: string) => declarations.get(at) ?? null,
    shape: (at: string) => shapes.get(at) ?? null,
    issues: Object.freeze(issues),
  });
}

/**
 * Binds a record's structure to no schema, as {@link bindRecord} binds a record whose collection has no usable schema: every
 * `$sections` is an undeclared keyed list, and the parse's issues stay as they are. It reads no value, so a structure restored
 * from the local index binds as its parse would.
 */
export function bindStructure<Record extends RecordStructure>(record: Record): RecordBinding<Record> {
  const binder = new Binder(record);
  binder.bindSections();
  return Object.freeze({
    record,
    lists: binder.lists,
    typedReferences: Object.freeze([]),
    declarationOf: () => null,
    shape: () => null,
    issues: Object.freeze(binder.adjustedParseIssues()),
  });
}

/** What a binding restored from the local index is made of: what its computation found, without the schema's shapes. */
export interface BindingParts {
  /** Each keyed list, by exact path, with its type and the key of each item. */
  readonly lists: readonly { readonly at: string; readonly type: KeyedList["type"]; readonly keys: readonly (string | null)[] }[];
  readonly typedReferences: readonly string[];
  /** The declaration of each reference that has one, by exact path. */
  readonly declarations: ReadonlyMap<string, RefDeclaration>;
  readonly issues: readonly Issue[];
  readonly restored: BindingFacts;
}

/**
 * Makes a binding from what its computation found, as the local index keeps it, over a record and the schema it was bound
 * to. The shape of each node is found again from the schema when first asked, step by step down from the root, each item of
 * a keyed list by its key, as {@link bindRecord}'s walk finds it, so it is the same object the computation gave.
 */
export function bindingOf<Record extends RecordStructure>(
  record: Record,
  schema: CollectionSchema,
  parts: BindingParts,
): RecordBinding<Record> {
  const lists = new Map<string, KeyedList>();
  for (const list of parts.lists) lists.set(list.at, new Keys(list.at, list.type, list.keys));
  const shapes = new Map<string, SchemaShape>([["", schema.root]]);
  const shape = (at: string): SchemaShape | null => {
    const known = shapes.get(at);
    if (known !== undefined) return known;
    // The nearest ancestor whose shape is known, then down from it.
    const path: NodeInfo[] = [];
    let node = record.nodes.node(at);
    while (node !== undefined && !shapes.has(node.at)) {
      path.push(node);
      node = node.parent === null ? undefined : record.nodes.node(node.parent);
    }
    if (node === undefined) return null;
    let current = shapes.get(node.at) as SchemaShape;
    for (const step of path.reverse()) {
      const parent = step.parent as string;
      if (typeof step.key === "number") {
        const key = lists.get(parent)?.keyOf(step.key) ?? null;
        current = current.child(key === null ? { item: step.key } : { item: step.key, key });
      } else {
        current = current.child({ member: step.key as string });
      }
      shapes.set(step.at, current);
    }
    return current;
  };
  const declarations = parts.declarations;
  return Object.freeze({
    record,
    lists,
    typedReferences: Object.freeze([...parts.typedReferences]),
    declarationOf: (at: string) => declarations.get(at) ?? null,
    shape,
    issues: Object.freeze([...parts.issues]),
    restored: parts.restored,
  });
}

/** A keyed list over the keys of its items, with the index of its keys built when first asked. */
class Keys implements KeyedList {
  readonly at: string;
  readonly type: "map" | "multimap" | "undeclared";
  readonly #keys: readonly (string | null)[];
  #byKey: Map<string, number[]> | undefined;

  constructor(at: string, type: "map" | "multimap" | "undeclared", keys: readonly (string | null)[]) {
    this.at = at;
    this.type = type;
    this.#keys = keys;
  }

  keyOf(index: number): string | null {
    return this.#keys[index] ?? null;
  }

  indexesOf(key: string): readonly number[] {
    if (this.#byKey === undefined) {
      const byKey = new Map<string, number[]>();
      this.#keys.forEach((each, index) => {
        if (each === null) return;
        const found = byKey.get(each);
        if (found === undefined) byKey.set(each, [index]);
        else found.push(index);
      });
      this.#byKey = byKey;
    }
    return this.#byKey.get(key) ?? [];
  }
}

/** One binding's walk: what it found, and the checks it hands to the validator. */
class Binder {
  readonly #record: RecordStructure;
  readonly lists = new Map<string, KeyedList>();
  readonly shapes = new Map<string, SchemaShape>();
  readonly duplicates: Issue[] = [];
  /** The exact paths of the typed references found. */
  readonly typed: string[] = [];
  /** The declarations of the JSON References that have one, by exact path. */
  readonly declarations = new Map<string, RefDeclaration>();
  readonly #subschemas: { readonly at: string; readonly location: SchemaLocation }[] = [];
  readonly #failures: NativeFailure[] = [];

  constructor(record: RecordStructure) {
    this.#record = record;
  }

  /** The record as parsed, which only a walk beside a schema reads: its value and its source. */
  get #parsed(): ParsedRecord {
    if (!isParsedRecord(this.#record))
      throw new RangeError("binding to a schema reads the record's value, so it needs the parse");
    return this.#record;
  }

  /** The keyed lists' checks for the validator. */
  get checks(): ListChecks {
    return { subschemas: this.#subschemas, failures: this.#failures };
  }

  /** Makes each section's `$sections` an undeclared keyed list, for a record bound without a schema. */
  bindSections(): void {
    for (const section of this.#record.nodes.sections()) {
      const at = childPath(section.at, "$sections");
      if (this.#record.nodes.node(at)?.kind !== "array") continue;
      this.lists.set(at, new Keys(at, "undeclared", this.#sectionKeys(at)));
    }
  }

  /** Walks the value view from the root, whose shape is given, beside the spine. */
  walk(root: SchemaShape): void {
    const pending: { readonly at: string; readonly value: Value; readonly shape: SchemaShape; readonly place: Place }[] = [
      { at: "", value: this.#parsed.value, shape: root, place: "section" },
    ];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const { at, value, shape, place } = next;
      this.shapes.set(at, shape);
      if (shape.conflicts.length > 0) this.#failures.push({ at, message: conflictMessage(shape.conflicts) });
      if (typeof value === "string") {
        // A readable record holds a `$ref` member only in a JSON Reference.
        if (shape.ref !== null && !at.endsWith("/$ref") && URI_REFERENCE.check(value)) {
          this.typed.push(at);
          this.declarations.set(at, shape.ref);
        }
      } else if (Array.isArray(value)) {
        const declaration = shape.list;
        const keys =
          place === "sections" ? this.#sectionKeys(at) : declaration === null ? null : this.#memberKeys(at, value, declaration);
        if (keys !== null) {
          this.lists.set(at, new Keys(at, declaration?.type ?? "undeclared", keys));
          if (declaration !== null) this.#evaluate(at, shape, declaration, keys, place === "sections");
        }
        const childPlace: Place = place === "sections" ? "section" : "value";
        value.forEach((item, index) => {
          const key = keys?.[index] ?? undefined;
          const step = key === undefined || key === null ? { item: index } : { item: index, key };
          pending.push({ at: childPath(at, index), value: item, shape: shape.child(step), place: childPlace });
        });
      } else if (value !== null && typeof value === "object") {
        // A readable record holds a `$ref` member only in a JSON Reference, outside sections.
        if (typeof (value as ValueObject).$ref === "string") this.#declareReference(at, shape);
        for (const [name, member] of Object.entries(value as ValueObject)) {
          const childPlace: Place = place === "section" && name === "$sections" ? "sections" : "value";
          pending.push({ at: childPath(at, name), value: member, shape: shape.child({ member: name }), place: childPlace });
        }
      }
    }
  }

  /**
   * Finds the declaration of the JSON Reference at `at`, whose shape is given: its own `x-vmd-ref`, or else its `$ref`
   * member's. None where either shape's declarations conflict, which has its `schema-violation` already, or where both
   * declare and their declarations differ as written, which a member name in the data alone brought together, since the
   * schema's check refuses them where the schema alone does: that object gets a `schema-violation` too.
   */
  #declareReference(at: string, shape: SchemaShape): void {
    const member = shape.child({ member: "$ref" });
    if (shape.conflicts.length > 0 || member.conflicts.length > 0) return;
    const own = shape.ref;
    const members = member.ref;
    // Both apply to the one reference, so they must be equal, compared as written as the schema's check compares them.
    if (own !== null && members !== null && !valuesEqual(shape.refWritten as Value, member.refWritten as Value)) {
      this.#failures.push({
        at,
        message:
          "its schema and its $ref member's declare unequal x-vmd-ref, which only this member's name brings together; declarations that meet must be equal, so it gets neither",
      });
      return;
    }
    const declaration = own ?? members;
    if (declaration !== null) this.declarations.set(at, declaration);
  }

  /** The section key of each item of the `$sections` at `at`. */
  #sectionKeys(at: string): (string | null)[] {
    return this.#record.nodes.children(at).map((child) => this.#record.sectionKeys.get(child.at) ?? null);
  }

  /** The key of each item of a list keyed by a member, with a failure for each item that has none. */
  #memberKeys(at: string, items: readonly Value[], declaration: ListDeclaration): (string | null)[] {
    const member = declaration.key === "@key" ? null : declaration.key.member;
    return items.map((item, index) => {
      // A keyed list on $sections is keyed by @key, which the spine allows nowhere else.
      if (member === null) return null;
      const object = item !== null && typeof item === "object" && !Array.isArray(item) ? (item as ValueObject) : null;
      const key = object !== null && Object.hasOwn(object, member) ? object[member] : undefined;
      if (typeof key === "string") return key;
      this.#failures.push({
        at: childPath(at, index),
        message:
          key === undefined
            ? `has no key member ${JSON.stringify(member)}, which the keyed list's items must have`
            : `its key member ${JSON.stringify(member)} is not a string, as the keyed list's keys must be`,
      });
      return null;
    });
  }

  /** Evaluates a declared keyed list natively: its per-key schemas, `additional`, `required`, and the uniqueness of a map. */
  #evaluate(
    at: string,
    shape: SchemaShape,
    declaration: ListDeclaration,
    keys: readonly (string | null)[],
    sections: boolean,
  ): void {
    const first = new Map<string, number>();
    keys.forEach((key, index) => {
      if (key === null) return;
      const itemAt = childPath(at, index);
      for (const location of shape.listSchemas(key)) this.#subschemas.push({ at: itemAt, location });
      if (declaration.additional === false && !declaration.items.has(key)) {
        this.#failures.push({
          at: itemAt,
          message: `has the key ${JSON.stringify(key)}, which the keyed list does not name, and its additional is false`,
        });
      }
      const earlier = first.get(key);
      if (earlier === undefined) {
        first.set(key, index);
      } else if (declaration.type === "map" && !sections) {
        // The parse has raised the repeats among sections, which adjustedParseIssues marks.
        this.duplicates.push(this.#duplicate(itemAt, key, childPath(at, earlier)));
      }
    });
    for (const key of declaration.required) {
      if (!first.has(key)) {
        this.#failures.push({ at, message: `has no item with the key ${JSON.stringify(key)}, which the keyed list requires` });
      }
    }
  }

  /** The declared `duplicate-key` of an item whose key an earlier item of its list has. */
  #duplicate(at: string, key: string, earlier: string): Issue {
    const node = this.#record.nodes.node(at) as NodeInfo;
    return declaredDuplicate(
      makeIssue({
        code: "duplicate-key",
        path: this.#record.path,
        at,
        message: `the key ${JSON.stringify(key)} is also the key of ${earlier} in the same list, which its schema declares a map`,
        position: this.#parsed.source.position(node.range.start),
      }),
    );
  }

  /**
   * The parse's issues, with each `duplicate-key` of a section that repeats an earlier sibling section's key adjusted for the
   * level's declaration: marked as declared under `map`; dropped under `multimap`, unless a field of the section with that
   * name comes before it, which the store's mode still governs.
   */
  adjustedParseIssues(): Issue[] {
    const issues: Issue[] = [];
    for (const issue of this.#record.issues) {
      if (issue.code !== "duplicate-key" || issue.at === null) {
        issues.push(issue);
        continue;
      }
      const adjusted = this.#adjusted(issue, issue.at);
      if (adjusted !== null) issues.push(adjusted);
    }
    return issues;
  }

  /** A parse's `duplicate-key` at `at`, adjusted for its level's declaration; null where the declaration allows it. */
  #adjusted(issue: Issue, at: string): Issue | null {
    const nodes = this.#record.nodes;
    const node = nodes.node(at);
    if (node?.kind !== "section" || node.parent === null) return issue;
    const list = this.lists.get(node.parent);
    if (list === undefined || list.type === "undeclared") return issue;
    const key = this.#record.sectionKeys.get(at) as string;
    const index = node.key as number;
    if ((list.indexesOf(key)[0] as number) >= index) return issue;
    if (list.type === "map") return declaredDuplicate(issue);
    const holder = nodes.node(node.parent)?.parent as string;
    const field = key.startsWith("$") ? undefined : nodes.node(childPath(holder, key));
    const fieldFirst = field !== undefined && (field.memberRange ?? field.range).start < node.range.start;
    return fieldFirst ? issue : null;
  }
}

/** The message of a member that patterns bring unequal declarations to. */
function conflictMessage(conflicts: readonly SchemaLocation[]): string {
  const where = conflicts.map((location) => `${location.file}#${location.pointer}`).join(", ");
  return `its name brings unequal declarations of the schema together, from ${where}, so it gets neither: declarations that meet must be equal`;
}
