// The spine's check against its first form, over random schemas and over the schemas that are costly for one of its parts:
// every reduction of its cost must leave what it reports unchanged. The first form gives its problems in the order its walks
// meet them, the check by location and then message, so the first form's are sorted before they are compared.

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { locationKey } from "./schema-set.js";
import { Spine, type SpineProblem } from "./spine.js";
import { OracleSpine } from "./spine-oracle.testkit.js";
import { randomSchemas, setOf } from "./spine-random.testkit.js";
import { chain, cycles, deepClosures, fanIn, formats, mixins, unequalBranches } from "./spine-shapes.testkit.js";

/** A piece of each kind of message the check gives. */
const KINDS = [
  "unequal x-vmd-",
  "off the schema's spine",
  "keys a section's",
  'keys by "@key"',
  "unevaluatedItems stands",
  "x-vmd-ref stands where",
];

/** A problem as its location's key and its message, which sort as the check orders its problems. */
const shown = (problem: SpineProblem) => `${locationKey(problem.location)}\n${problem.message}`;

/** Compares the check with its first form over one schema, and gives the first form's problems. */
async function compare(schema: unknown, listed: number): Promise<{ readonly expected: string[]; readonly spine: Spine } | null> {
  const set = await setOf(schema);
  if (set === null) return null;
  const oracle = new OracleSpine(set);
  const expected = oracle.check().map(shown).sort();
  const spine = new Spine(set);
  const all = spine.check();
  expect(all.problems.map(shown)).toEqual(expected);
  expect(all.unlisted).toBe(0);
  expect(spine.pairsVisited).toBe(oracle.pairsVisited);
  expect(spine.mustSteps).toBe(oracle.mustSteps);
  const some = new Spine(set).check(listed);
  expect(some.problems.map(shown)).toEqual(expected.slice(0, listed));
  expect(some.unlisted).toBe(Math.max(0, expected.length - listed));
  return { expected, spine };
}

describe("the spine's check", () => {
  test("reports what its first form reports, over random schemas", async () => {
    const seen = { accepted: 0, refused: 0, unnamed: 0, skipped: 0 };
    const kinds = new Map<string, number>(KINDS.map((kind) => [kind, 0]));
    await fc.assert(
      fc.asyncProperty(randomSchemas, fc.nat({ max: 4 }), async (schema, listed) => {
        const compared = await compare(schema, listed);
        if (compared === null) {
          seen.skipped += 1;
          return;
        }
        const { expected, spine } = compared;
        if (expected.length === 0) seen.accepted += 1;
        else seen.refused += 1;
        for (const kind of KINDS) {
          if (expected.some((problem) => problem.includes(kind))) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        }
        if (spine.nameSteps > 0) seen.unnamed += 1;
      }),
      { numRuns: 1000 },
    );
    // The schemas reach every part of the check: accepted and refused, every kind of problem, and pairs taking any name.
    expect(seen.skipped).toBeLessThan(100);
    expect(seen.accepted).toBeGreaterThan(100);
    expect(seen.refused).toBeGreaterThan(100);
    expect(seen.unnamed).toBeGreaterThan(100);
    for (const [kind, count] of kinds) expect(count, kind).toBeGreaterThan(50);
  }, 300_000);

  test.each([
    ["two cycles of definitions", cycles(22, 18)],
    ["two cycles that meet at their least common multiple", cycles(22, 18, true)],
    ["a chain of members over typed references", chain(30, 30)],
    ["references to one definition", fanIn(300)],
    ["bare typed references beside their formats", formats(40)],
    ["mixins", mixins(30, 3)],
    ["unequal branches", unequalBranches(30)],
    ["long closures", deepClosures(100)],
  ])("reports what its first form reports, over %s", async (_shape, schema) => {
    expect(await compare(schema, 3)).not.toBeNull();
  });
});
