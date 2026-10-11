import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { type Comparison, standardComparison } from "./compare.js";
import { operations } from "./operations/index.js";
import { type RunResult, runSuite } from "./runner.js";

const REAL_SUITE = fileURLToPath(new URL("../../../../conformance/", import.meta.url));
const DECLARATION = fileURLToPath(new URL("../declaration.json", import.meta.url));

/** Runs the real suite with this package's declaration, narrowed to `ids` when given. */
function runReal(comparison: Comparison = standardComparison, ids?: readonly string[]): Promise<RunResult> {
  return runSuite({ suiteDirectory: REAL_SUITE, declarationFile: DECLARATION, operations, comparison, selection: { ids } });
}

/** Returns the ids of the self-test cases that fail with a comparison. */
async function failingSelfTests(comparison: Comparison): Promise<string[]> {
  const result = await runReal(comparison, ["selftest/"]);
  if (result.exitCode === 2) {
    throw new Error(result.message);
  }
  return result.report.results.filter((item) => item.verdict !== "pass").map((item) => item.id);
}

/** Returns a comparison whose `equal` is `broken` at the top level of a pair and inside arrays and objects. */
function breakEqual(broken: (a: unknown, b: unknown, equal: (a: unknown, b: unknown) => boolean) => boolean): Comparison {
  const equal = (a: unknown, b: unknown): boolean => broken(a, b, equal);
  return { ...standardComparison, equal };
}

/** The standard comparison of two containers, but with `equal` for the items, so that a broken leaf rule applies inside them. */
function containers(a: unknown, b: unknown, equal: (a: unknown, b: unknown) => boolean): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const names = Object.keys(a);
    const bRecord = b as Record<string, unknown>;
    return (
      names.length === Object.keys(b).length &&
      names.every((name) => Object.hasOwn(b, name) && equal((a as Record<string, unknown>)[name], bRecord[name]))
    );
  }
  return standardComparison.equal(a, b);
}

describe("the real suite", () => {
  test("passes the self-test and reads every other case, skipping it with a reason", async () => {
    const result = await runReal();
    expect(result.exitCode).toBe(0);
    if (result.exitCode === 2) {
      return;
    }
    const { results, unused_skips } = result.report;
    const selfTests = results.filter((item) => item.id.startsWith("selftest/"));
    expect(selfTests.length).toBe(14);
    expect(selfTests.every((item) => item.verdict === "pass")).toBe(true);
    expect(results.filter((item) => !item.id.startsWith("selftest/") && item.verdict !== "skip")).toEqual([]);
    expect(results.length).toBeGreaterThan(1000);
    expect(unused_skips).toEqual([]);
  });
});

describe("the self-test with a comparison broken on purpose", () => {
  test("fails when booleans are compared loosely with numbers", async () => {
    // biome-ignore lint/suspicious/noDoubleEquals: the loose comparison is the bug under test.
    const looseLeaf = (a: unknown, b: unknown) => a == b;
    const loose = breakEqual((a, b, equal) =>
      typeof a === "object" || typeof b === "object" ? containers(a, b, equal) : looseLeaf(a, b),
    );
    expect(await failingSelfTests(loose)).toEqual([
      "selftest/compare/false-against-0-in-array",
      "selftest/compare/number-against-string",
      "selftest/compare/true-against-1",
    ]);
  });

  test("fails when numbers are compared with a tolerance", async () => {
    const tolerant = breakEqual((a, b, equal) =>
      typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-12 : containers(a, b, equal),
    );
    expect(await failingSelfTests(tolerant)).toEqual(["selftest/compare/decimal-next-double"]);
  });

  test("fails when strings are normalized", async () => {
    const normalizing = breakEqual((a, b, equal) =>
      typeof a === "string" && typeof b === "string" ? a.normalize("NFC") === b.normalize("NFC") : containers(a, b, equal),
    );
    expect(await failingSelfTests(normalizing)).toEqual(["selftest/compare/strings-not-normalized"]);
  });

  test("fails when members whose value is null are ignored", async () => {
    const dropNulls = (value: object) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
    const ignoringNull = breakEqual((a, b, equal) =>
      typeof a === "object" && a !== null && !Array.isArray(a) && typeof b === "object" && b !== null && !Array.isArray(b)
        ? containers(dropNulls(a), dropNulls(b), equal)
        : containers(a, b, equal),
    );
    expect(await failingSelfTests(ignoringNull)).toEqual(["selftest/compare/null-against-absent"]);
  });

  test("fails when objects are compared by their text, so that member order counts", async () => {
    const byText = breakEqual((a, b) => JSON.stringify(a) === JSON.stringify(b));
    expect(await failingSelfTests(byText)).toEqual(["selftest/compare/member-order"]);
  });

  test("fails when only the members of the first object are compared", async () => {
    const oneSided = breakEqual((a, b, equal) =>
      typeof a === "object" && a !== null && !Array.isArray(a) && typeof b === "object" && b !== null && !Array.isArray(b)
        ? Object.keys(a).every((name) => equal((a as Record<string, unknown>)[name], (b as Record<string, unknown>)[name]))
        : containers(a, b, equal),
    );
    expect(await failingSelfTests(oneSided)).toEqual(["selftest/compare/extra-member"]);
  });

  test("fails when arrays are compared without order", async () => {
    const orderless = breakEqual((a, b, equal) =>
      Array.isArray(a) && Array.isArray(b) ? standardComparison.equalUnordered(a, b) : containers(a, b, equal),
    );
    expect(await failingSelfTests(orderless)).toEqual(["selftest/compare/array-order"]);
  });

  test("fails when unordered lists are compared as sets", async () => {
    const asSets: Comparison = {
      ...standardComparison,
      equalUnordered: (a, b) =>
        a.every((item) => b.some((other) => standardComparison.equal(item, other))) &&
        b.every((item) => a.some((other) => standardComparison.equal(item, other))),
    };
    expect(await failingSelfTests(asSets)).toEqual(["selftest/compare/unordered-multiset"]);
  });

  test("does not see Object.is, which tells -0 from 0, since the runner reads -0 as 0 before comparing", async () => {
    const objectIs = breakEqual((a, b, equal) =>
      typeof a === "number" && typeof b === "number" ? Object.is(a, b) : containers(a, b, equal),
    );
    expect(await failingSelfTests(objectIs)).toEqual([]);
  });
});
