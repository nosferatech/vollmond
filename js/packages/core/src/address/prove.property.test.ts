// Property test 6 of the I2 design: the proof of singular addresses agrees with evaluation.
//
// The generator draws a semantic tree first: a record's root section, with fields and child sections, objects, and lists of
// objects that are declared map or multimap or not at all, whose items may differ by position (prefixItems), and whose
// declarations may differ in `required`. It renders the tree as JSON Schema in one of several equivalent forms: members in
// `properties` or in an anchored `patternProperties`, schemas split over `allOf`, moved to `$defs` behind a `$ref`, or given
// to a keyed list's items through per-key schemas and `additional`. Records are drawn from the tree without duplicates where
// keys must be unique.
//
// The expected verdict is the rule of the design's section 4.4 applied to the tree, not to the schema: every place a step can
// reach counts, at every position of a list, and a step crosses a multimap when it leaves a section whose child sections, or a
// list whose items, are declared multimap. So the oracle does not read the JSON Schema that core's spine reads. Besides the
// exact verdict: an accepted address resolves to its node alone, and an address through a key the data repeats is refused.

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { bindRecord } from "../binding/binding.js";
import { record, usable } from "../schema/schema.testkit.js";
import { resolveAddress } from "./resolve.js";

type ListType = "map" | "multimap" | "none";

interface ObjectNode {
  readonly kind: "object";
  readonly members: Readonly<Record<string, Node>>;
}

interface ListNode {
  readonly kind: "list";
  readonly list: ListType;
  /** Whether a map requires the key `x`, which makes two declarations unequal. */
  readonly requiresX: boolean;
  /** The member that keys the items; two lists keyed by different members are unequal declarations too. */
  readonly keyMember: "k" | "j";
  readonly prefix: readonly ObjectNode[];
  readonly item: ObjectNode;
}

interface SectionNode {
  readonly kind: "section";
  readonly members: Readonly<Record<string, Node>>;
  readonly sections: SectionsNode | null;
}

interface SectionsNode {
  readonly list: ListType;
  readonly prefix: readonly SectionNode[];
  readonly item: SectionNode;
}

type Node = ObjectNode | ListNode | { readonly kind: "leaf" };

/** Field and member names, and keys: two alphabets, so that a field never shares a name with a section or a key member. */
const MEMBERS = ["m", "n"] as const;
const KEYS = ["x", "y", "z"] as const;
/** A step that names no member, no key and no index anywhere. */
const MISSING = "w";

const listType = fc.constantFrom<ListType>("map", "multimap", "none");

const trees = fc.letrec<{ node: Node; object: ObjectNode; section: SectionNode; sections: SectionsNode }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constant({ kind: "leaf" } as const),
    tie("object"),
    fc
      .record({
        kind: fc.constant("list" as const),
        list: listType,
        requiresX: fc.boolean(),
        keyMember: fc.constantFrom<"k" | "j">("k", "j"),
        prefix: fc.array(tie("object"), { maxLength: 2 }),
        item: tie("object"),
        // A first position like the others but for the required keys, or the key members, of its lists: unequal
        // declarations that meet only in a step whose position is not known, the case the review of #108 found the proof
        // missed.
        twin: fc.constantFrom<Flip | null>(null, "required", "key"),
      })
      .map(({ twin, ...list }): ListNode => (twin === null ? list : { ...list, prefix: [flipped(list.item, twin)] })),
  ),
  object: fc.record({
    kind: fc.constant("object" as const),
    members: fc.dictionary(fc.constantFrom(...MEMBERS), tie("node"), { maxKeys: 2 }),
  }),
  section: fc.record({
    kind: fc.constant("section" as const),
    members: fc.dictionary(fc.constantFrom(...MEMBERS), tie("node"), { maxKeys: 2 }),
    sections: fc.option(tie("sections"), { depthSize: "small" }),
  }),
  sections: fc
    .record({
      list: listType,
      prefix: fc.array(tie("section"), { maxLength: 2 }),
      item: tie("section"),
      twin: fc.constantFrom<Flip | null>(null, "required", "key"),
    })
    .map(
      ({ twin, ...sections }): SectionsNode =>
        twin === null ? sections : { ...sections, prefix: [flipped(sections.item, twin)] },
    ),
}));

/** What a twin position changes in the lists below it: whether they require x, or the member that keys them. */
type Flip = "required" | "key";

/** A copy of a node whose lists below differ from the original's as `flip` says. */
function flipped<T extends Node | SectionNode>(node: T, flip: Flip): T {
  const members = (of: Readonly<Record<string, Node>>) =>
    Object.fromEntries(Object.entries(of).map(([name, member]) => [name, flipped(member, flip)]));
  switch (node.kind) {
    case "leaf":
      return node;
    case "object":
      return { ...node, members: members(node.members) };
    case "list":
      return {
        ...node,
        ...(flip === "required" ? { requiresX: !node.requiresX } : { keyMember: node.keyMember === "k" ? "j" : "k" }),
        prefix: node.prefix.map((each) => flipped(each, flip)),
        item: flipped(node.item, flip),
      };
    case "section":
      return {
        ...node,
        members: members(node.members),
        sections:
          node.sections === null
            ? null
            : {
                ...node.sections,
                prefix: node.sections.prefix.map((each) => flipped(each, flip)),
                item: flipped(node.sections.item, flip),
              },
      };
  }
}

/** Draws a number from a stream of choices. */
type Pick = () => number;

/** Renders a tree as JSON Schema, choosing among equivalent forms with `pick`. */
class Renderer {
  readonly defs: Record<string, unknown> = {};
  readonly #pick: Pick;

  constructor(pick: Pick) {
    this.#pick = pick;
  }

  /** A schema, perhaps moved to `$defs` and referenced, perhaps split over `allOf`. */
  #wrap(parts: readonly Record<string, unknown>[]): unknown {
    const choice = this.#pick() % 4;
    const merged = Object.assign({}, ...parts);
    if (choice === 1 && parts.length > 1) return { allOf: parts };
    if (choice === 2) {
      const name = `d${Object.keys(this.defs).length}`;
      this.defs[name] = merged;
      return { $ref: `#/$defs/${name}` };
    }
    return merged;
  }

  /** The schema of an object's or a section's members, in properties or anchored patterns. */
  #members(members: Readonly<Record<string, Node>>): Record<string, unknown> {
    const rendered = Object.fromEntries(Object.entries(members).map(([name, member]) => [name, this.node(member)]));
    if (Object.keys(rendered).length === 0 || this.#pick() % 2 === 0) return { properties: rendered };
    return { patternProperties: Object.fromEntries(Object.entries(rendered).map(([name, schema]) => [`^${name}$`, schema])) };
  }

  node(tree: Node): unknown {
    switch (tree.kind) {
      case "leaf":
        return {};
      case "object":
        return this.#wrap([{ type: "object" }, this.#members(tree.members)]);
      case "list":
        return this.#list(
          tree.list,
          tree.requiresX,
          [tree.keyMember],
          tree.prefix.map((each) => this.node(each)),
          this.node(tree.item),
        );
    }
  }

  section(tree: SectionNode): unknown {
    const members = this.#members(tree.members);
    const sections = tree.sections;
    if (sections === null) return this.#wrap([{ type: "object" }, members]);
    const list = this.#list(
      sections.list,
      false,
      ["@key"],
      sections.prefix.map((each) => this.section(each)),
      this.section(sections.item),
    );
    const own = (members.properties ?? {}) as Record<string, unknown>;
    return this.#wrap([{ type: "object" }, { ...members, properties: { ...own, $sections: list } }]);
  }

  /** A list: its declaration, its positions' schemas, or per-key schemas and additional standing for items. */
  #list(type: ListType, requiresX: boolean, keys: string[], prefix: readonly unknown[], item: unknown): unknown {
    const declaration = type === "none" ? null : { type, keys, ...(type === "map" && requiresX ? { required: ["x"] } : {}) };
    if (declaration !== null && prefix.length === 0 && this.#pick() % 3 === 0) {
      const perKey = Object.fromEntries(KEYS.map((key) => [key, item]));
      return this.#wrap([{ type: "array" }, { "x-vmd-list": { ...declaration, items: perKey, additional: item } }]);
    }
    // items stays beside prefixItems: in another allOf branch it would apply to every item, the first ones too.
    const parts: Record<string, unknown>[] = [
      { type: "array" },
      { items: item, ...(prefix.length > 0 ? { prefixItems: prefix } : {}) },
    ];
    if (declaration !== null) parts.push({ "x-vmd-list": declaration });
    return this.#wrap(parts);
  }
}

interface Path {
  readonly steps: readonly string[];
  /** Whether the path takes a key the data repeats in a multimap list. */
  readonly repeats: boolean;
}

/** The keys of a list's items: distinct, starting with x, unless it is a multimap. */
function keysOf(type: ListType, pick: Pick, requiresX: boolean): string[] {
  const count = Math.max(pick() % 4, requiresX && type === "map" ? 1 : 0);
  return type === "multimap" ? Array.from({ length: count }, () => KEYS[pick() % KEYS.length] as string) : KEYS.slice(0, count);
}

/** A record of a tree, with the semantic steps of every node but the root. */
function instance(root: SectionNode, pick: Pick): { value: unknown; paths: Path[] } {
  const paths: Path[] = [];
  const members = (of: Readonly<Record<string, Node>>, steps: string[], repeats: boolean) => {
    const value: Record<string, unknown> = {};
    for (const [name, member] of Object.entries(of)) value[name] = build(member, [...steps, name], repeats);
    return value;
  };
  const build = (at: Node, steps: string[], repeats: boolean): unknown => {
    paths.push({ steps, repeats });
    switch (at.kind) {
      case "leaf":
        return 1;
      case "object":
        return members(at.members, steps, repeats);
      case "list": {
        const keys = keysOf(at.list, pick, at.requiresX);
        return keys.map((key, index) => {
          const step = at.list === "none" ? String(index) : key;
          const repeated = at.list === "multimap" && keys.filter((each) => each === key).length > 1;
          const item = build(at.prefix[index] ?? at.item, [...steps, step], repeats || repeated) as object;
          return { [at.keyMember]: key, ...item };
        });
      }
    }
  };
  const section = (at: SectionNode, steps: string[], repeats: boolean): Record<string, unknown> => {
    const value = members(at.members, steps, repeats);
    const sections = at.sections;
    if (sections === null) return value;
    // An undeclared level is unique by the strict default, so its keys are distinct as a map's are.
    const keys = keysOf(sections.list === "none" ? "map" : sections.list, pick, false);
    value.$sections = keys.map((key, index) => {
      const repeated = sections.list === "multimap" && keys.filter((each) => each === key).length > 1;
      const child = [...steps, key];
      paths.push({ steps: child, repeats: repeats || repeated });
      return { $title: key, ...section(sections.prefix[index] ?? sections.item, child, repeats || repeated) };
    });
    return value;
  };
  return { value: section(root, [], false), paths };
}

/** A place a step may stand at in the tree, as the oracle reads it. */
type Place = { readonly kind: "section"; readonly node: SectionNode } | { readonly kind: "value"; readonly node: Node };

/**
 * Whether the rule of §4.4, applied to the tree, refuses these steps: from every place the previous step can reach, a step
 * crosses a multimap when it leaves a section whose child sections, or a list whose items, are declared multimap; and it
 * reaches a member of that name, every position's child section of a section, and every position's item of a keyed list, or
 * the item at an index of a list that is not keyed.
 */
function oracleRefuses(root: SectionNode, steps: readonly string[]): boolean {
  let places: Place[] = [{ kind: "section", node: root }];
  for (const step of steps) {
    const next: Place[] = [];
    for (const place of places) {
      if (place.kind === "section") {
        const sections = place.node.sections;
        if (sections?.list === "multimap") return true;
        const member = place.node.members[step];
        if (member !== undefined) next.push({ kind: "value", node: member });
        if (sections !== null) {
          for (const child of [...sections.prefix, sections.item]) next.push({ kind: "section", node: child });
        }
      } else if (place.node.kind === "object") {
        const member = place.node.members[step];
        if (member !== undefined) next.push({ kind: "value", node: member });
      } else if (place.node.kind === "list") {
        const list = place.node;
        if (list.list === "multimap") return true;
        if (list.list !== "none") {
          for (const item of [...list.prefix, list.item]) next.push({ kind: "value", node: item });
        } else if (/^(0|[1-9][0-9]*)$/.test(step)) {
          next.push({ kind: "value", node: list.prefix[Number(step)] ?? list.item });
        }
      }
    }
    places = next;
  }
  return false;
}

describe("the proof against evaluation (property 6)", () => {
  test("refuses exactly what the rule refuses on the tree; accepted addresses name one node; repeated keys are refused", {
    timeout: 600_000,
  }, async () => {
    let refused = 0;
    let accepted = 0;
    let missingRefused = 0;
    let missingNotFound = 0;
    await fc.assert(
      fc.asyncProperty(trees.section, fc.array(fc.nat(), { minLength: 97, maxLength: 97 }), async (tree, choices) => {
        let next = 0;
        const pick = () => choices[next++ % choices.length] as number;
        const renderer = new Renderer(pick);
        const rootSchema = renderer.section(tree) as Record<string, unknown>;
        const schema = Object.keys(renderer.defs).length === 0 ? rootSchema : { allOf: [rootSchema], $defs: renderer.defs };
        const { value, paths } = instance(tree, pick);
        const binding = bindRecord(record(JSON.stringify(value)), await usable(schema));
        expect(binding.issues).toEqual([]);
        for (const { steps, repeats } of paths) {
          const outcome = resolveAddress(binding, { kind: "semantic", steps }, "singular");
          const code = outcome.ok ? null : outcome.issues[0]?.code;
          const expected = oracleRefuses(tree, steps);
          expect({ steps, refused: code === "address-not-singular" }).toEqual({ steps, refused: expected });
          if (!expected) expect(outcome.ok).toBe(true);
          if (repeats) expect(code).toBe("address-not-singular");
          if (expected) refused += 1;
          else accepted += 1;
          // The same path with one step naming nothing: refused by the same rule, and otherwise not found, never resolved.
          for (const [index] of steps.entries()) {
            const missing = steps.map((step, at) => (at === index ? MISSING : step));
            const missed = resolveAddress(binding, { kind: "semantic", steps: missing }, "singular");
            const missedCode = missed.ok ? "resolved" : missed.issues[0]?.code;
            const refuses = oracleRefuses(tree, missing);
            expect({ missing, code: missedCode }).toEqual({
              missing,
              code: refuses ? "address-not-singular" : "address-not-found",
            });
            if (refuses) missingRefused += 1;
            else missingNotFound += 1;
          }
        }
      }),
      { numRuns: 300 },
    );
    expect(refused).toBeGreaterThan(50);
    expect(accepted).toBeGreaterThan(50);
    expect(missingRefused).toBeGreaterThan(50);
    expect(missingNotFound).toBeGreaterThan(50);
  });
});
