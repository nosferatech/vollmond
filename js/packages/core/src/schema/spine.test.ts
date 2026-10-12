// The work the spine's check does, counted: it pairs only the locations that could show a problem together.

import { describe, expect, test } from "vitest";
import { succeed } from "../issue/outcome.js";
import { locationKey, readSchemaSet } from "./schema-set.js";
import { Spine } from "./spine.js";
import { chain, deepClosures, fanIn, unequalBranches } from "./spine-shapes.testkit.js";

/** The spine of a schema held in `s.json`, after its check, with the problems found. */
async function checked(schema: unknown): Promise<{ readonly spine: Spine; readonly problems: readonly string[] }> {
  const text = new TextEncoder().encode(JSON.stringify(schema));
  const set = await readSchemaSet("s.json", async () => succeed(text));
  expect(set.problems).toEqual([]);
  const spine = new Spine(set);
  const problems = spine.check().problems.map((problem) => problem.message);
  return { spine, problems };
}

/** The spine of a schema held in `s.json`, unchecked. */
async function spineOf(schema: unknown): Promise<Spine> {
  const text = new TextEncoder().encode(JSON.stringify(schema));
  const set = await readSchemaSet("s.json", async () => succeed(text));
  expect(set.problems).toEqual([]);
  return new Spine(set);
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

/** The pointers of a shape's locations. */
const pointers = (shape: { readonly locations: readonly { readonly pointer: string }[] }) =>
  shape.locations.map((location) => location.pointer);

describe("the shapes of keyed lists and their items", () => {
  const list = {
    type: "array",
    prefixItems: [{ title: "first" }],
    items: { title: "rest" },
    "x-vmd-list": { type: "map", keys: ["name"], items: { a: { title: "a" } }, additional: { title: "other" } },
  };

  test("an item at any position has every prefixItems entry and items, with the schema of its key", async () => {
    const { spine } = await checked({ properties: { l: list } });
    const shape = spine.root.child({ member: "l" });
    expect(pointers(shape.anyItem("a"))).toEqual([
      "/properties/l/prefixItems/0",
      "/properties/l/x-vmd-list/items/a",
      "/properties/l/items",
    ]);
    expect(pointers(shape.anyItem("b"))).toEqual([
      "/properties/l/prefixItems/0",
      "/properties/l/x-vmd-list/additional",
      "/properties/l/items",
    ]);
    expect(pointers(shape.anyItem(undefined))).toEqual(["/properties/l/prefixItems/0", "/properties/l/items"]);
  });

  test("the schemas an item is checked against for its key are the per-key schema, else additional", async () => {
    const { spine } = await checked({ properties: { l: list, m: { "x-vmd-list": { type: "map", keys: ["k"] } } } });
    const shape = spine.root.child({ member: "l" });
    expect(shape.listSchemas("a").map((location) => location.pointer)).toEqual(["/properties/l/x-vmd-list/items/a"]);
    expect(shape.listSchemas("b").map((location) => location.pointer)).toEqual(["/properties/l/x-vmd-list/additional"]);
    expect(spine.root.child({ member: "m" }).listSchemas("a")).toEqual([]);
    expect(spine.root.child({ member: "x" }).listSchemas("a")).toEqual([]);
  });

  test("multimap is whether any keyed list here declares it, unequal ones included", async () => {
    const multimap = { "x-vmd-list": { type: "multimap", keys: ["k"] } };
    const map = { "x-vmd-list": { type: "map", keys: ["k"] } };
    const { spine } = await checked({
      properties: { mm: multimap, m: map, plain: { type: "array" } },
      patternProperties: { "^c": multimap, d$: map },
    });
    expect(spine.root.child({ member: "mm" }).multimap).toBe(true);
    expect(spine.root.child({ member: "m" }).multimap).toBe(false);
    expect(spine.root.child({ member: "plain" }).multimap).toBe(false);
    const conflicting = spine.root.child({ member: "cd" });
    expect(conflicting.list).toBeNull();
    expect(conflicting.multimap).toBe(true);
    // Unequal declarations leave the array unkeyed, so neither one's schemas apply to its items.
    const { spine: withSchemas } = await checked({
      patternProperties: {
        "^c": { "x-vmd-list": { type: "multimap", keys: ["k"], additional: { title: "c" } } },
        d$: { "x-vmd-list": { type: "map", keys: ["k"], additional: { title: "d" } } },
      },
    });
    expect(withSchemas.root.child({ member: "cd" }).listSchemas("x")).toEqual([]);
    expect(withSchemas.root.child({ member: "c" }).listSchemas("x")).toHaveLength(1);
  });

  test("an item step past the longest prefixItems, or by a key no list names, is computed once whatever the index or key", async () => {
    const { spine } = await checked({ properties: { l: list } });
    const shape = spine.root.child({ member: "l" });
    const before = spine.stepsComputed;
    for (let index = 1; index < 1000; index++) shape.child({ item: index, key: `k${index}` });
    // Index 1 and up all take items, and every key but a takes additional: one step computed for them all.
    expect(spine.stepsComputed - before).toBe(1);
    shape.child({ item: 0, key: "k0" });
    shape.child({ item: 7, key: "a" });
    shape.child({ item: 7 });
    expect(spine.stepsComputed - before).toBe(4);
    expect(shape.child({ item: 5, key: "zz" })).toBe(shape.child({ item: 999, key: "yy" }));
  });

  // Review of #108, S2: the union of every position cost the prefixItems' length on each step of each proof.
  test("an item at any position is computed once per key a list names, and once for every other key", async () => {
    const long = { ...list, prefixItems: Array.from({ length: 4000 }, (_, index) => ({ title: `p${index}` })) };
    const { spine } = await checked({ properties: { l: long } });
    const shape = spine.root.child({ member: "l" });
    const before = spine.stepsComputed;
    shape.anyItem("b");
    // The union, and an item step at each of the 4,001 positions.
    expect(spine.stepsComputed - before).toBe(4002);
    const after = spine.stepsComputed;
    for (let index = 0; index < 1000; index++) shape.anyItem(`k${index}`);
    expect(spine.stepsComputed - after).toBe(0);
    shape.anyItem("a");
    expect(spine.stepsComputed - after).toBe(4002);
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

// Issue #110: the check gave a problem for every unequal pair, so a schema of 3,000 branches of one declaration beside 3,000
// of another (160 KB) held nine million problems and ran out of memory.
describe("the problems the spine's check gives", () => {
  test("at most the number asked for, the first by location, with a count of the rest", async () => {
    const spine = await spineOf(unequalBranches(300));
    const { problems, unlisted } = spine.check(10);
    expect(problems).toHaveLength(10);
    expect(unlisted).toBe(300 * 300 - 10);
    const shown = problems.map((problem) => `${locationKey(problem.location)} ${problem.message}`);
    expect(shown).toEqual([...shown].sort());
    expect(shown[0]).toContain("s.json#/allOf/0/x-vmd-ref unequal x-vmd-ref declarations");
  });

  test("all of them, sorted by location and then message, when no number is asked for", async () => {
    const spine = await spineOf(unequalBranches(3));
    const { problems, unlisted } = spine.check();
    expect(unlisted).toBe(0);
    const shown = problems.map((problem) => `${locationKey(problem.location)} ${problem.message}`);
    expect(shown).toHaveLength(9);
    expect(shown).toEqual([...shown].sort());
  });

  test.each([5, 40])("the same first problems whatever the number asked for, of %i² problems", async (branches) => {
    const all = (await spineOf(unequalBranches(branches))).check().problems;
    expect(all).toHaveLength(branches * branches);
    for (const listed of [0, 1, 7, 25, 26, 1599, 1600, 1601])
      expect((await spineOf(unequalBranches(branches))).check(listed)).toEqual({
        problems: all.slice(0, listed),
        unlisted: Math.max(0, branches * branches - listed),
      });
  });
});

// Issue #110: marking each location with what its spine below holds copied every value below into every location above, and
// copied a location's list of parents for each new parent.
describe("the work of marking what the spine below each location holds", () => {
  test("linear in a chain of members over many typed references", async () => {
    const { spine, problems } = await checked(chain(200, 200));
    expect(problems).toEqual([]);
    expect(spine.markSteps).toBeLessThan(20 * 400);
  });

  test("linear in the references to one definition", async () => {
    const { spine, problems } = await checked(fanIn(2000));
    expect(problems).toEqual([]);
    expect(spine.markSteps).toBeLessThan(20 * 2000);
  });
});

// Issue #110: the walk of single locations took up each member's whole closure, so members that each refer to one link of a
// long $ref chain held the square of its length, which ran out of memory near 1 MiB.
describe("the work of walking single locations", () => {
  test("linear in members that each refer to a link of one long chain of references", async () => {
    const { spine, problems } = await checked(deepClosures(400));
    expect(problems).toEqual([]);
    expect(spine.placeSteps).toBeLessThan(10 * 400);
  });
});
