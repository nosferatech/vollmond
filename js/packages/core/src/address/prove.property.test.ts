// Property test 6 of the I2 design: the proof of singular addresses agrees with evaluation. Over generated schemas of nested
// objects and lists, some declared map and some multimap, and records generated from them without duplicates where keys must
// be unique, an address the proof accepts never evaluates to several nodes, and an address that crosses a multimap list
// whose data repeats the key is refused. Its expected verdict, whether the address crosses a list declared multimap, is
// read from the generator's own tree, not from core's spine; the suite's addresses/cardinality cases are the independent part
// for sections.

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { bindRecord } from "../binding/binding.js";
import { record, usable } from "../schema/schema.testkit.js";
import { resolveAddress } from "./resolve.js";

/** A node of a generated schema: an object of named members, a list of objects, or a leaf. */
type Node =
  | { readonly kind: "object"; readonly members: Readonly<Record<string, Node>> }
  | { readonly kind: "list"; readonly list: "map" | "multimap" | "none"; readonly item: Node & { readonly kind: "object" } }
  | { readonly kind: "leaf" };

const MEMBERS = ["m", "n", "o"] as const;
const KEYS = ["x", "y", "z"] as const;

const node: fc.Arbitrary<Node> = fc.letrec<{ node: Node; object: Node & { kind: "object" } }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constant({ kind: "leaf" } as const),
    tie("object"),
    fc.record({ kind: fc.constant("list" as const), list: fc.constantFrom("map", "multimap", "none"), item: tie("object") }),
  ),
  object: fc.record({
    kind: fc.constant("object" as const),
    members: fc.dictionary(fc.constantFrom(...MEMBERS), tie("node"), { maxKeys: 2 }),
  }),
})).object;

/** The schema of a generated node. */
function schemaOf(tree: Node): unknown {
  switch (tree.kind) {
    case "leaf":
      return {};
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(Object.entries(tree.members).map(([name, member]) => [name, schemaOf(member)])),
      };
    case "list":
      return {
        type: "array",
        items: schemaOf(tree.item),
        ...(tree.list === "none" ? {} : { "x-vmd-list": { type: tree.list, keys: ["k"] } }),
      };
  }
}

/**
 * A record of a generated node, with the choices drawn from `pick`: lists of up to three items, keyed from {@link KEYS},
 * distinct in a map and drawn freely in a multimap. Gives the value and, for each node, its semantic steps and whether the
 * path crosses a list declared multimap, and whether it crosses one through a key the list repeats.
 */
function instance(tree: Node, pick: () => number): { value: unknown; paths: Path[] } {
  const paths: Path[] = [];
  const build = (at: Node, steps: string[], crosses: boolean, repeats: boolean): unknown => {
    paths.push({ steps, crosses, repeats });
    switch (at.kind) {
      case "leaf":
        return 1;
      case "object": {
        const value: Record<string, unknown> = {};
        for (const [name, member] of Object.entries(at.members)) {
          value[name] = build(member, [...steps, name], crosses, repeats);
        }
        return value;
      }
      case "list": {
        const count = pick() % 4;
        const keys: string[] =
          at.list === "map"
            ? [...KEYS].slice(0, count)
            : Array.from({ length: count }, () => KEYS[pick() % KEYS.length] as string);
        return keys.map((key, index) => {
          const step = at.list === "none" ? String(index) : key;
          const repeated = at.list === "multimap" && keys.filter((each) => each === key).length > 1;
          const item = build(at.item, [...steps, step], crosses || at.list === "multimap", repeats || repeated) as Record<
            string,
            unknown
          >;
          return { k: key, ...item };
        });
      }
    }
  };
  const value = build(tree, [], false, false);
  return { value, paths };
}

interface Path {
  readonly steps: readonly string[];
  readonly crosses: boolean;
  readonly repeats: boolean;
}

describe("the proof against evaluation (property 6)", () => {
  test("an address the proof accepts never evaluates to several nodes, and one through a repeated multimap key is refused", {
    timeout: 300_000,
  }, async () => {
    let refused = 0;
    let accepted = 0;
    await fc.assert(
      fc.asyncProperty(node, fc.array(fc.nat(), { minLength: 64, maxLength: 64 }), async (tree, choices) => {
        let next = 0;
        const pick = () => choices[next++ % choices.length] as number;
        const { value, paths } = instance(tree, pick);
        const binding = bindRecord(record(JSON.stringify(value)), await usable(schemaOf(tree)));
        expect(binding.issues).toEqual([]);
        for (const { steps, crosses, repeats } of paths) {
          if (steps.length === 0) continue;
          const outcome = resolveAddress(binding, { kind: "semantic", steps }, "singular");
          const code = outcome.ok ? null : outcome.issues[0]?.code;
          // The proof refuses exactly the addresses that cross a list declared multimap...
          expect(code === "address-not-singular").toBe(crosses);
          // ...so an accepted address names its node alone, and a key the data repeats is never accepted.
          if (!crosses) expect(outcome.ok).toBe(true);
          if (repeats) expect(code).toBe("address-not-singular");
          if (crosses) refused += 1;
          else accepted += 1;
        }
      }),
      { numRuns: 300 },
    );
    expect(refused).toBeGreaterThan(20);
    expect(accepted).toBeGreaterThan(20);
  });
});
