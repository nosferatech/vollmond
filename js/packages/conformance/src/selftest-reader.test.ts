import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { type Comparison, standardComparison } from "./compare.js";
import type { NumberReading } from "./number.js";
import { operations } from "./operations/index.js";
import { runSuite } from "./runner.js";

/** How the mocked reader reads a number: as the suite says, as its source text, or as its double with `-0` kept. */
const reading = vi.hoisted(() => ({ mode: "standard" as "standard" | "text" | "keep-negative-zero" }));

vi.mock("./number.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./number.js")>();
  return {
    ...original,
    readNumber: (source: string, value: number): NumberReading => {
      // Text that is not the number's shortest form stays text, so that a comparison sees `1.0` and `1` differ, as one of
      // decimal text would. Shortest forms stay numbers, so that `suite.json` still reads.
      if (reading.mode === "text" && source !== String(value)) {
        return { ok: true, value: source as unknown as number };
      }
      return reading.mode === "keep-negative-zero" && Object.is(value, -0)
        ? { ok: true, value }
        : original.readNumber(source, value);
    },
  };
});

afterEach(() => {
  reading.mode = "standard";
});

const REAL_SUITE = fileURLToPath(new URL("../../../../conformance/", import.meta.url));
const DECLARATION = fileURLToPath(new URL("../declaration.json", import.meta.url));

/** Returns the ids of the self-test cases that do not pass with the current reader and `comparison`. */
async function failingSelfTests(comparison: Comparison = standardComparison): Promise<string[]> {
  const result = await runSuite({
    suiteDirectory: REAL_SUITE,
    declarationFile: DECLARATION,
    operations,
    comparison,
    selection: { ids: ["selftest/"] },
  });
  if (result.exitCode === 2) {
    throw new Error(result.message);
  }
  return result.report.results.filter((item) => item.verdict !== "pass").map((item) => item.id);
}

const objectIs: Comparison = {
  ...standardComparison,
  equal: (a, b) => (typeof a === "number" && typeof b === "number" ? Object.is(a, b) : standardComparison.equal(a, b)),
};

test("the self-test passes with the reader the suite asks for", async () => {
  expect(await failingSelfTests()).toEqual([]);
});

test("the self-test fails when numbers are compared by their decimal text", async () => {
  reading.mode = "text";
  expect(await failingSelfTests()).toEqual([
    "selftest/compare/decimal-nearest-double",
    "selftest/compare/negative-zero",
    "selftest/compare/number-forms",
  ]);
});

test("the self-test fails when -0 is kept and the comparison tells it from 0", async () => {
  reading.mode = "keep-negative-zero";
  expect(await failingSelfTests()).toEqual([]);
  expect(await failingSelfTests(objectIs)).toEqual(["selftest/compare/negative-zero"]);
});
