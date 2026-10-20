// The work the spine's check does, counted: it pairs only the locations that could show a problem together.

import { describe, expect, test } from "vitest";
import { succeed } from "../issue/outcome.js";
import { locationKey, readSchemaSet } from "./schema-set.js";
import { Spine, type SpineProblem } from "./spine.js";
import { bareReferenceChain, chain, deepClosures, fanIn, unequalBranches } from "./spine-shapes.testkit.js";

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
async function spineOf(
  schema: unknown,
  options: { readonly maxClosureEntries?: number; readonly maxGroupedNames?: number } = {},
): Promise<Spine> {
  const text = new TextEncoder().encode(JSON.stringify(schema));
  const set = await readSchemaSet("s.json", async () => succeed(text));
  expect(set.problems).toEqual([]);
  return new Spine(set, options);
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

// Issue #138's predicted cost: a keyed list's item may stand at any open index, so the format is looked for at each index,
// which must be done once for the array, not again for each key that needs it.
describe("the work of finding the format at each index a keyed item can stand at", () => {
  const uri = { format: "uri-reference" };
  /** A keyed list of `keys` keys whose schemas lack the format, under `prefixItems` and `items: false`. */
  const keyed = (keys: number, prefixItems: readonly unknown[]) => {
    const items = Object.fromEntries(Array.from({ length: keys }, (_, key) => [`k${key}`, { type: "string", "x-vmd-ref": {} }]));
    return {
      type: "object",
      properties: { l: { type: "array", prefixItems, items: false, "x-vmd-list": { type: "map", keys: ["name"], items } } },
    };
  };

  test("is done once per array, however many keys need it", async () => {
    const prefix = Array.from({ length: 50 }, () => uri);
    const one = await checked(keyed(1, prefix));
    const many = await checked(keyed(200, prefix));
    expect(one.problems).toEqual([]);
    expect(many.problems).toEqual([]);
    expect(one.spine.keyedIndexSteps).toBeGreaterThanOrEqual(50);
    expect(one.spine.keyedIndexSteps).toBeLessThanOrEqual(2 * 50);
    expect(many.spine.keyedIndexSteps).toBe(one.spine.keyedIndexSteps);
  });

  // Review of the per-index check: arrays that share one definition each have their own parent, so a memo per parent alone
  // scanned the definition's indexes and branches again for each array, arrays × prefixItems × branches in all.
  test("reads the indexes a location gives once, however many arrays it applies beside", async () => {
    /** `arrays` keyed lists, each with a $ref to one definition whose branch j alone gives the format at index j. */
    const shared = (arrays: number) => {
      const size = 64;
      const allOf = Array.from({ length: size }, (_, branch) => ({
        prefixItems: Array.from({ length: size }, (_, index) => (index === branch ? uri : true)),
      }));
      const properties = Object.fromEntries(
        Array.from({ length: arrays }, (_, array) => [
          `l${array}`,
          { $ref: "#/$defs/a", "x-vmd-list": { type: "map", keys: ["name"], items: { foo: { $ref: "#/$defs/s" } } } },
        ]),
      );
      const a = { type: "array", prefixItems: Array.from({ length: size }, () => true), items: false, allOf };
      return { type: "object", properties, $defs: { a, s: { type: "string", "x-vmd-ref": {} } } };
    };
    const one = await checked(shared(1));
    const many = await checked(shared(21));
    expect(one.problems).toEqual([]);
    expect(many.problems).toEqual([]);
    // Each further array costs the 66 locations beside it, each taken up once and with the two words of its 64 indexes.
    expect(many.spine.keyedIndexSteps - one.spine.keyedIndexSteps).toBeLessThanOrEqual(20 * 66 * 4);
  });
});

describe("the order of the problems", () => {
  const where = (problems: readonly SpineProblem[]) => problems.map((problem) => problem.location.pointer);

  test("by location, an array index as a number: /allOf/2 before /allOf/10", async () => {
    // Twelve branches: 0 to 5 declare x-vmd-ref {}, 6 to 11 cardinality many, so each of 0 to 5 meets each of 6 to 11.
    const { problems } = (await spineOf(unequalBranches(6))).check();
    expect(where(problems).slice(0, 6)).toEqual(Array.from({ length: 6 }, () => "/allOf/0/x-vmd-ref"));
    // A pair's problem stands at the first of its two locations as text, which for 2 to 5 beside 10 and 11 is 10 or 11.
    const locations = [0, 1, 2, 3, 4, 5, 10, 11].map((index) => `/allOf/${index}/x-vmd-ref`);
    expect([...new Set(where(problems))]).toEqual(locations);
    // At one location, the messages name the other of the pair, also in the order of its index.
    const partners = problems.slice(0, 6).map((problem) => /, s\.json#\/allOf\/([0-9]+);/.exec(problem.message)?.[1]);
    expect(partners).toEqual(["6", "7", "8", "9", "10", "11"]);
  });

  test("by location one reference token at a time: /a/b before /a-b, and a location before those below it", async () => {
    const one = { type: "object", "x-vmd-ref": {} };
    const many = { type: "object", "x-vmd-ref": { cardinality: "many" } };
    const { problems } = (
      await spineOf({
        type: "object",
        properties: {
          "a-b": { allOf: [one, many] },
          a: { allOf: [{ properties: { b: { allOf: [one, many] } } }, one, many] },
        },
      })
    ).check();
    expect(where(problems)).toEqual([
      "/properties/a/allOf/0/properties/b/allOf/0/x-vmd-ref",
      "/properties/a/allOf/1/x-vmd-ref",
      "/properties/a-b/allOf/0/x-vmd-ref",
    ]);
  });
});

describe("the number of problems asked for", () => {
  test.each([-1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY])("is refused when it is %s", async (listed) => {
    const spine = await spineOf(unequalBranches(2));
    expect(() => spine.check(listed)).toThrow(RangeError);
  });

  test.each([0, 3, Number.POSITIVE_INFINITY])("is taken when it is %s", async (listed) => {
    const { problems, unlisted } = (await spineOf(unequalBranches(2))).check(listed);
    expect(problems.length + unlisted).toBe(4);
  });
});

// Review of #114: the memo of closures, which a long chain of references fills with the square of its length, is emptied
// when it reaches its bound.
describe("the memo of closures", () => {
  test("is emptied when it would hold more than its bound, to the same problems", async () => {
    const unbounded = await spineOf(bareReferenceChain(200));
    const all = unbounded.check();
    expect(unbounded.memoizedLocations).toBeGreaterThan(5000);
    const bounded = await spineOf(bareReferenceChain(200), { maxClosureEntries: 1000 });
    expect(bounded.check()).toEqual(all);
    expect(bounded.memoizedLocations).toBeLessThanOrEqual(1000);
    expect(bounded.memoizedLocations).toBeGreaterThan(0);
  });
});

/** `count` patterns that match no listed name, each taking any member. */
const unmatching = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`^z${index}`, {}]));

// Review of #113: each pair grouped the listed names by which of its patterns match them, a scan of a word per 32 names for
// each pattern, though the grouping depends only on the two pattern sets.
describe("the groupings of listed names the spine's check computes", () => {
  test("one for pairs whose locations all have one pattern set, however many pairs there are", async () => {
    const { spine, problems } = await checked(takers(20, 7000, { patternProperties: unmatching(50) }));
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
    expect(spine.pairsVisited).toBeGreaterThan(400);
    expect(spine.nameGroupings).toBe(1);
  });

  test("one per pair of distinct pattern sets", async () => {
    // The first group takes members through `^a`, the second through `^b`: at most the four ordered pairs of the two sets.
    const allOf = [];
    for (let branch = 0; branch < 20; branch++) allOf.push({ patternProperties: { "^a": {} }, $ref: "#/$defs/one" });
    for (let branch = 0; branch < 20; branch++) allOf.push({ patternProperties: { "^b": {} }, $ref: "#/$defs/many" });
    const listed = Object.fromEntries(["a1", "a2", "b1", "c1"].map((name) => [name, {}]));
    const { spine, problems } = await checked({
      allOf,
      $defs: { one: ref("one"), many: ref("many"), unused: { properties: listed } },
    });
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
    expect(spine.pairsVisited).toBeGreaterThan(400);
    expect(spine.nameGroupings).toBeGreaterThanOrEqual(1);
    expect(spine.nameGroupings).toBeLessThanOrEqual(4);
  });

  // Review of #125: a grouping visited every listed name, so pairs that each have their own pattern list, whose groupings
  // the memo never shares, paid for every listed name again.
  test("the names some pattern matches, not every listed name, when every pair has its own pattern list", async () => {
    const allOf = [];
    for (let branch = 0; branch < 20; branch++) allOf.push({ patternProperties: { [`^z${branch}$`]: {} }, $ref: "#/$defs/one" });
    for (let branch = 0; branch < 20; branch++) allOf.push({ patternProperties: { [`^y${branch}$`]: {} }, $ref: "#/$defs/many" });
    const listed = Object.fromEntries(Array.from({ length: 7000 }, (_, index) => [`name${index}`, {}]));
    const { spine, problems } = await checked({
      allOf,
      $defs: { one: ref("one"), many: ref("many"), unused: { properties: listed } },
    });
    expect(problems.some((message) => message.startsWith("unequal x-vmd-ref declarations"))).toBe(true);
    expect(spine.pairsVisited).toBeGreaterThan(400);
    expect(spine.nameGroupings).toBeGreaterThan(300);
    // No pattern matches a listed name, so a grouping holds no name, only its entry, and each pair examines one name: the
    // first that none matches.
    expect(spine.groupedNames).toBeLessThanOrEqual(spine.nameGroupings);
    expect(spine.nameSteps).toBeLessThanOrEqual(spine.pairsVisited);
  });
});

describe("the memo of the listed names' groupings", () => {
  test("is emptied when it would hold more than its bound, to the same problems", async () => {
    // Four groups of branches with four pattern lists: a grouping for each pair of groups that meets, of the 50 names one
    // of the two lists matches, counted with one for the grouping itself.
    const allOf = [];
    for (const [group, source] of ["^a", "^b", "^c", "^d"].entries()) {
      for (let branch = 0; branch < 5; branch++) {
        allOf.push({ patternProperties: { [source]: {} }, $ref: group % 2 === 0 ? "#/$defs/one" : "#/$defs/many" });
      }
    }
    const listed = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`${"abcd"[index % 4]}${index}`, {}]));
    const schema = { allOf, $defs: { one: ref("one"), many: ref("many"), unused: { properties: listed } } };
    const unbounded = await spineOf(schema);
    const all = unbounded.check();
    expect(all.problems.length).toBeGreaterThan(0);
    expect(unbounded.groupedNames).toBeGreaterThan(150);
    const bounded = await spineOf(schema, { maxGroupedNames: 100 });
    expect(bounded.check()).toEqual(all);
    expect(bounded.groupedNames).toBeLessThanOrEqual(100);
    expect(bounded.groupedNames).toBeGreaterThan(0);
  });
});
