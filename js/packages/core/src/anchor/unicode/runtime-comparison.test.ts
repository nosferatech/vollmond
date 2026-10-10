// Compares the generated tables with the runtime's own Unicode data over every code point. JavaScript exposes the same properties
// through regular expressions (`\p{White_Space}` and the like) and the lower-case mapping through `toLowerCase`, so where the
// runtime bundles the tables' Unicode version, the two must agree everywhere; a table entry broken by hand or by a generator bug
// shows up as a mismatch.
//
// The comparison runs only where `process.versions.unicode` is the tables' version, and is skipped with a note elsewhere, so a
// contributor on another Node still passes. CI sets VMD_REQUIRE_UNICODE_COMPARISON=1, which turns the skip into a failure: raising
// the Node pin to a release with other Unicode data then fails loudly instead of silently testing nothing.

import { describe, expect, type TestContext, test } from "vitest";
import { CodePointRanges, LowerCaseMapping, UNICODE_VERSION } from "./unicode.js";
import {
  DEFAULT_IGNORABLE_CODE_POINT,
  LETTER_MARK_DIGIT_CONNECTOR,
  LOWER_CASE_EXPANSIONS,
  LOWER_CASE_RUNS,
  WHITE_SPACE,
} from "./unicode-17.0.0.generated.js";

/** The part of Node's `process` this file reads. Core sees no Node types, and the global is absent outside Node. */
interface RuntimeProcess {
  readonly versions?: { readonly unicode?: string };
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const runtimeProcess = (globalThis as { process?: RuntimeProcess }).process;
const runtimeUnicode = runtimeProcess?.versions?.unicode;
const comparisonRequired = runtimeProcess?.env?.VMD_REQUIRE_UNICODE_COMPARISON === "1";

const MAX_CODE_POINT = 0x10ffff;

/** What the comparison does on this runtime. */
type ComparisonDecision = "run" | "skip" | "fail";

/** Decides whether the comparison runs: only on the tables' Unicode version, and a skip fails where the comparison is required. */
function comparisonDecision(runtimeVersion: string | undefined, tablesVersion: string, required: boolean): ComparisonDecision {
  // `process.versions.unicode` is "17.0" where the tables say "17.0.0".
  const significant = (version: string) => version.replace(/(\.0)+$/, "");
  if (runtimeVersion !== undefined && significant(runtimeVersion) === significant(tablesVersion)) return "run";
  return required ? "fail" : "skip";
}

const decision = comparisonDecision(runtimeUnicode, UNICODE_VERSION, comparisonRequired);
const mismatchNote = `the runtime's Unicode is ${runtimeUnicode ?? "unknown"}, the tables' ${UNICODE_VERSION}`;

/** Skips or fails the current test unless the comparison can run here. */
function requireComparableRuntime(context: TestContext): void {
  if (decision === "skip") context.skip(`${mismatchNote}; comparison skipped`);
  if (decision === "fail") expect.fail(`${mismatchNote}, and VMD_REQUIRE_UNICODE_COMPARISON=1 requires the comparison`);
}

/** Returns the code points from `from` to `to` (inclusive) where the two functions disagree, at most `limit` of them. */
function disagreements<T>(
  ours: (cp: number) => T,
  runtime: (cp: number) => T,
  from = 0,
  to = MAX_CODE_POINT,
  limit = 20,
): number[] {
  const found: number[] = [];
  for (let cp = from; cp <= to && found.length < limit; cp++) {
    if (ours(cp) !== runtime(cp)) found.push(cp);
  }
  return found;
}

/** Returns a test of one code point against a regular expression that matches exactly one code point. */
function matcher(pattern: RegExp): (cp: number) => boolean {
  return (cp) => pattern.test(String.fromCodePoint(cp));
}

const runtimeWhiteSpace = matcher(/^\p{White_Space}$/u);
const runtimeDefaultIgnorable = matcher(/^\p{Default_Ignorable_Code_Point}$/u);
const runtimeLetterMarkDigitConnector = matcher(/^[\p{L}\p{M}\p{Nd}\p{Pc}]$/u);
const runtimeLowerCase = (cp: number) => String.fromCodePoint(cp).toLowerCase();

/** Returns a copy of `encoded` with each element named in `changes` (index to amount) changed by that amount. */
function broken(encoded: readonly number[], changes: Readonly<Record<number, number>>): number[] {
  return encoded.map((value, index) => value + (changes[index] ?? 0));
}

describe("the decision to compare", () => {
  test("runs on the tables' version, written either way", () => {
    expect(comparisonDecision("17.0", "17.0.0", false)).toBe("run");
    expect(comparisonDecision("17.0.0", "17.0.0", true)).toBe("run");
  });

  test("skips on another version, or outside Node", () => {
    expect(comparisonDecision("16.0", "17.0.0", false)).toBe("skip");
    expect(comparisonDecision("17.1", "17.0.0", false)).toBe("skip");
    expect(comparisonDecision(undefined, "17.0.0", false)).toBe("skip");
  });

  test("fails instead of skipping where the comparison is required", () => {
    expect(comparisonDecision("16.0", "17.0.0", true)).toBe("fail");
    expect(comparisonDecision(undefined, "17.0.0", true)).toBe("fail");
  });
});

describe(`the tables agree with the runtime's Unicode over all ${MAX_CODE_POINT + 1} code points`, () => {
  test("White_Space", async (context) => {
    requireComparableRuntime(context);
    const ours = new CodePointRanges(WHITE_SPACE);
    expect(disagreements((cp) => ours.has(cp), runtimeWhiteSpace)).toEqual([]);
    await context.annotate(`compared with the runtime's Unicode ${runtimeUnicode}`);
  });

  test("Default_Ignorable_Code_Point", async (context) => {
    requireComparableRuntime(context);
    const ours = new CodePointRanges(DEFAULT_IGNORABLE_CODE_POINT);
    expect(disagreements((cp) => ours.has(cp), runtimeDefaultIgnorable)).toEqual([]);
    await context.annotate(`compared with the runtime's Unicode ${runtimeUnicode}`);
  });

  test("general categories L, M, Nd and Pc", async (context) => {
    requireComparableRuntime(context);
    const ours = new CodePointRanges(LETTER_MARK_DIGIT_CONNECTOR);
    expect(disagreements((cp) => ours.has(cp), runtimeLetterMarkDigitConnector)).toEqual([]);
    await context.annotate(`compared with the runtime's Unicode ${runtimeUnicode}`);
  });

  test("lower case, one code point at a time", async (context) => {
    requireComparableRuntime(context);
    const ours = new LowerCaseMapping(LOWER_CASE_RUNS, LOWER_CASE_EXPANSIONS);
    expect(disagreements((cp) => ours.of(cp), runtimeLowerCase)).toEqual([]);
    await context.annotate(`compared with the runtime's Unicode ${runtimeUnicode}`);
  });
});

describe("a broken table entry is a disagreement", () => {
  test("White_Space without U+0085", (context) => {
    requireComparableRuntime(context);
    // The third range is U+0085 alone. Its gap one longer, and the next gap one shorter, moves it to U+0086 alone.
    const ours = new CodePointRanges(broken(WHITE_SPACE, { 4: 1, 6: -1 }));
    expect(disagreements((cp) => ours.has(cp), runtimeWhiteSpace, 0, 0xff)).toEqual([0x85, 0x86]);
  });

  test("Default_Ignorable_Code_Point without U+00AD", (context) => {
    requireComparableRuntime(context);
    // The first range is U+00AD alone; moved to U+00AE as above.
    const ours = new CodePointRanges(broken(DEFAULT_IGNORABLE_CODE_POINT, { 0: 1, 2: -1 }));
    expect(disagreements((cp) => ours.has(cp), runtimeDefaultIgnorable, 0, 0xff)).toEqual([0xad, 0xae]);
  });

  test("letters without Z", (context) => {
    requireComparableRuntime(context);
    // The second range is A to Z. One shorter, with the next gap one longer, drops Z alone.
    const ours = new CodePointRanges(broken(LETTER_MARK_DIGIT_CONNECTOR, { 3: -1, 4: 1 }));
    expect(disagreements((cp) => ours.has(cp), runtimeLetterMarkDigitConnector, 0, 0x7f)).toEqual([0x5a]);
  });

  test("lower case with the delta of A to Z off by one", (context) => {
    requireComparableRuntime(context);
    // The first run is A to Z by +32.
    const ours = new LowerCaseMapping(broken(LOWER_CASE_RUNS, { 3: 1 }), LOWER_CASE_EXPANSIONS);
    expect(disagreements((cp) => ours.of(cp), runtimeLowerCase, 0, 0x7f, 100)).toHaveLength(26);
  });

  test("lower case without the expansion of U+0130", (context) => {
    requireComparableRuntime(context);
    const ours = new LowerCaseMapping(LOWER_CASE_RUNS, []);
    expect(disagreements((cp) => ours.of(cp), runtimeLowerCase, 0, 0x1ff)).toEqual([0x130]);
  });
});
