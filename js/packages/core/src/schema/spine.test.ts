// The work the spine's check does, counted: it pairs only the locations that could show a problem together.

import { describe, expect, test } from "vitest";
import { succeed } from "../issue/outcome.js";
import { readSchemaSet } from "./schema-set.js";
import { Spine } from "./spine.js";

/** The spine of a schema held in `s.json`, after its check, with the problems found. */
async function checked(schema: unknown): Promise<{ readonly spine: Spine; readonly problems: readonly string[] }> {
  const text = new TextEncoder().encode(JSON.stringify(schema));
  const set = await readSchemaSet("s.json", async () => succeed(text));
  expect(set.problems).toEqual([]);
  const spine = new Spine(set);
  const problems = spine.check().map((problem) => problem.message);
  return { spine, problems };
}

/** `branches` allOf branches, each naming the same `names` properties, each given by `property`. */
function wide(branches: number, names: number, property: (branch: number, name: number) => unknown): unknown {
  const allOf = [];
  for (let branch = 0; branch < branches; branch++) {
    const properties: Record<string, unknown> = {};
    for (let name = 0; name < names; name++) properties[`p${name}`] = property(branch, name);
    allOf.push({ properties });
  }
  return { allOf };
}

const ref = (cardinality: string) => ({ type: "string", format: "uri-reference", "x-vmd-ref": { cardinality } });

// Review of #97's recheck, item 1: the walk visited every pair of co-applying locations, K² · M for K allOf branches that
// name M properties, whether or not the schema declares anything.
describe("the pairs the spine's check visits", () => {
  test("none for a schema without declarations or unevaluatedItems, however many locations apply together", async () => {
    const { spine, problems } = await checked(wide(60, 10, () => ({ type: "string" })));
    expect(problems).toEqual([]);
    expect(spine.pairsVisited).toBe(0);
  });

  test("none for branches that all give one equal declaration, which cannot be unequal", async () => {
    const { spine, problems } = await checked(wide(60, 10, (_branch, name) => (name === 0 ? ref("one") : { type: "string" })));
    expect(problems).toEqual([]);
    expect(spine.pairsVisited).toBe(0);
  });

  test("a few for one branch whose declaration differs, which is found", async () => {
    const { spine, problems } = await checked(
      wide(60, 10, (branch, name) => (name === 0 ? ref(branch === 59 ? "many" : "one") : { type: "string" })),
    );
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
    // The root's pairs with the odd branch, and the pairs at p0: linear in the branches, not quadratic.
    expect(spine.pairsVisited).toBeLessThan(60 * 4);
  });

  test("a declaration that a location shares with another reached earlier still counts in both", async () => {
    // d0 is reached first through the second allOf branch, then again below d1, whose spine must learn d0's declaration
    // although d0 was marked before d1 was reached.
    const { problems } = await checked({
      allOf: [{ $ref: "#/$defs/d1" }, { $ref: "#/$defs/d0" }],
      properties: { p: { properties: { x: ref("many") } } },
      $defs: { d0: { properties: { x: ref("one") } }, d1: { properties: { p: { $ref: "#/$defs/d0" } } } },
    });
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
  });

  // Review of #97's second recheck, item 1: two patterns, or a pattern and additionalProperties, meet at a name that only a
  // third co-applying location lists, which the schema names, so the conflict is static.
  test.each([
    [
      "two patterns",
      {
        allOf: [
          { patternProperties: { "^r": ref("one") } },
          { patternProperties: { "^r": ref("many") } },
          { properties: { rx: true } },
        ],
      },
    ],
    [
      "a pattern and additionalProperties",
      {
        allOf: [{ additionalProperties: ref("one") }, { patternProperties: { "^r": ref("many") } }, { properties: { rx: true } }],
      },
    ],
  ])("%s that meet at a name a third location lists are unequal declarations", async (_case, schema) => {
    const { problems } = await checked(schema);
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
  });

  test("a keyed list and an unevaluatedItems that patterns bring to a name another location lists meet", async () => {
    const { problems } = await checked({
      $defs: { D1: { patternProperties: { "^[ab]$": { unevaluatedItems: false } } } },
      patternProperties: { "^a$": { allOf: [{ "x-vmd-list": { type: "map", keys: ["k"] } }] } },
      allOf: [{ properties: { a: {} }, allOf: [{ $ref: "#/$defs/D1" }] }],
    });
    expect(problems.some((message) => message.startsWith("unevaluatedItems stands beside an x-vmd-list"))).toBe(true);
  });

  // Review of #97's second recheck, optional b: the candidates are filtered before they are paired, which the count shows.
  test("plain branches beside one that conflicts with itself are not paired", async () => {
    const one = ref("one");
    const { spine, problems } = await checked({
      allOf: [
        { properties: { a: { allOf: [{ properties: { r: one } }, { properties: { r: ref("many") } }] } } },
        ...Array.from({ length: 50 }, () => ({ properties: { a: { type: "object" } } })),
      ],
    });
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
    expect(spine.pairsVisited).toBeLessThanOrEqual(10);
  });

  test("a keyed list and an unevaluatedItems in different branches still meet", async () => {
    const { problems } = await checked({
      allOf: [
        { properties: { l: { type: "array", "x-vmd-list": { type: "map", keys: ["k"] } } } },
        { properties: { l: { unevaluatedItems: false } } },
      ],
    });
    expect(problems.some((message) => message.startsWith("unevaluatedItems stands beside an x-vmd-list"))).toBe(true);
  });
});
