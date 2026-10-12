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

/**
 * Two groups of `branches` allOf branches that take members of any name, each with a `$ref` to its group's declaration, beside
 * an unreferenced definition that lists `listed` names. `take` is how a branch takes them.
 */
function takers(branches: number, listed: number, take: object): unknown {
  const allOf = [];
  for (let branch = 0; branch < branches; branch++) allOf.push({ ...take, $ref: "#/$defs/one" });
  for (let branch = 0; branch < branches; branch++) allOf.push({ ...take, $ref: "#/$defs/many" });
  const properties: Record<string, unknown> = {};
  for (let name = 0; name < listed; name++) properties[`name${name}`] = {};
  return { allOf, $defs: { one: ref("one"), many: ref("many"), unused: { properties } } };
}

// Issue #109: a pair whose locations both take members of any name stepped over every name the schema lists, so the check's
// work was the pairs times the listed names.
describe("the listed names the spine's check examines", () => {
  test("one per pair for pairs that take every name through additionalProperties, however many are listed", async () => {
    const { spine, problems } = await checked(takers(20, 400, { additionalProperties: {} }));
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
    expect(spine.pairsVisited).toBeGreaterThan(400);
    expect(spine.nameSteps).toBeLessThanOrEqual(spine.pairsVisited);
  });

  test("the names the patterns match, not every listed name, for pairs that take members through patterns", async () => {
    // Both groups' pattern takes name1, name10 to name19 and name100 to name199; their additionalProperties the rest.
    const schema = takers(20, 400, { patternProperties: { "^name1": {} }, additionalProperties: {} });
    const { spine, problems } = await checked(schema);
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
    const matched = 111;
    expect(spine.nameSteps).toBeLessThanOrEqual(spine.pairsVisited * (matched + 1));
  });

  test("a pattern and additionalProperties that meet at a name only an unreferenced definition lists still meet", async () => {
    const { problems } = await checked({
      allOf: [{ patternProperties: { "^r": ref("one") } }, { additionalProperties: ref("many") }],
      $defs: { unused: { properties: { rx: {}, s: {} } } },
    });
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
  });

  test("two additionalProperties do not meet at a name only the pair's own properties lists", async () => {
    // rx is listed only by the second branch, whose additionalProperties does not take it.
    const { problems } = await checked({
      allOf: [{ additionalProperties: ref("one") }, { properties: { rx: {} }, additionalProperties: ref("many") }],
    });
    expect(problems).toEqual([]);
  });

  test("two additionalProperties meet at a name another location lists", async () => {
    const { problems } = await checked({
      allOf: [{ additionalProperties: ref("one") }, { properties: { rx: {} }, additionalProperties: ref("many") }],
      $defs: { unused: { properties: { rx: {}, s: {} } } },
    });
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
  });
});
