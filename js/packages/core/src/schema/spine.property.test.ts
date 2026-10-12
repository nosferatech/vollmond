// The spine's check against its first form, over random schemas: every reduction of its cost must leave what it reports, and
// in which order, unchanged.

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { locationKey } from "./schema-set.js";
import { Spine, type SpineProblem } from "./spine.js";
import { OracleSpine } from "./spine-oracle.testkit.js";
import { randomSchemas, setOf } from "./spine-random.testkit.js";

/** A piece of each kind of message the check gives. */
const KINDS = [
  " unequal ",
  "off the schema's spine",
  "keys a section's",
  'keys by "@key"',
  "unevaluatedItems stands",
  "x-vmd-ref stands where",
];

const shown = (problem: SpineProblem) => `${locationKey(problem.location)} ${problem.message}`;

describe("the spine's check", () => {
  test("reports what its first form reports, over random schemas", async () => {
    const seen = { accepted: 0, refused: 0, unnamed: 0, skipped: 0 };
    const kinds = new Map<string, number>(KINDS.map((kind) => [kind, 0]));
    await fc.assert(
      fc.asyncProperty(randomSchemas, async (schema) => {
        const set = await setOf(schema);
        if (set === null) {
          seen.skipped += 1;
          return;
        }
        const oracle = new OracleSpine(set);
        const expected = oracle.check().map(shown);
        const spine = new Spine(set);
        expect(spine.check().map(shown)).toEqual(expected);
        expect(spine.pairsVisited).toBe(oracle.pairsVisited);
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
});
