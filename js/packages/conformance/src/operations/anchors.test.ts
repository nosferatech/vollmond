import { fileURLToPath } from "node:url";
import { parseRecord, recordFormatOf } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { loadCases, type SuiteCase } from "../cases.js";
import { standardComparison } from "../compare.js";
import type { ComparedIssue, OperationContext } from "../operation.js";
import { FixtureStores } from "../store.js";
import { anchorsOperation } from "./anchors.js";

const REAL_SUITE = fileURLToPath(new URL("../../../../../conformance/", import.meta.url));

const context = (files: Record<string, string>): OperationContext => ({
  store: { files: new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)])) },
  comparison: standardComparison,
  signal: new AbortController().signal,
});

describe("the anchors operation", () => {
  test("takes a record given as a string only", () => {
    expect(anchorsOperation.validate?.({ store: "s", record: "a.md" })).toBeUndefined();
    expect(anchorsOperation.validate?.({ store: "s", record: 1 })).toBe("input.record must be a store path");
  });

  test("gives the anchors, a block anchor's range as [start, end], and the tags", async () => {
    const store = context({ "a.md": '# Title<a class="t"></a>\n\n<a id="room"></a>Room.\n' });
    expect(await anchorsOperation.run({ store: "s", record: "a.md" }, store)).toEqual({
      ok: true,
      result: {
        anchors: [
          { name: "title", kind: "derived", at: "" },
          { name: "room", kind: "block", at: "/$body", range: [0, 22] },
        ],
        tags: [{ tag: "t", at: "" }],
      },
      issues: [],
    });
  });

  test("fails like parse for a record with a structural error", async () => {
    expect(await anchorsOperation.run({ store: "s", record: "b.json" }, context({ "b.json": "[1]" }))).toEqual({
      ok: false,
      issues: [{ code: "root-not-object", severity: "error", path: "b.json", at: "" }],
    });
  });

  test("crashes on a record the store does not hold, which is a mistake in the suite", async () => {
    await expect(anchorsOperation.run({ store: "s", record: "missing.md" }, context({}))).rejects.toThrow(/no record missing.md/);
  });

  test("compares both lists without order, and anything else as values", () => {
    const equal = (expected: unknown, actual: unknown) =>
      anchorsOperation.equalResults?.(expected as never, actual as never, {}, context({}));
    const a = { name: "a", kind: "derived", at: "" };
    const b = { name: "b", kind: "explicit", at: "/x" };
    expect(equal({ anchors: [a, b], tags: [] }, { anchors: [b, a], tags: [] })).toBe(true);
    expect(equal({ anchors: [a, b], tags: [] }, { anchors: [a, a], tags: [] })).toBe(false);
    expect(equal({ anchors: [], tags: [{ tag: "t", at: "" }] }, { anchors: [], tags: [] })).toBe(false);
    expect(equal({ anchors: [a], tags: [], extra: 1 }, { anchors: [a], tags: [] })).toBe(false);
    expect(equal([a], [a])).toBe(true);
  });
});

/** The codes that parsing a record raises for its names, which the suite tests through `check`. */
const NAME_CODES: ReadonlySet<string> = new Set(["anchor-invalid", "duplicate-anchor", "duplicate-key"]);

/** `check` cases whose issues of those codes need more than a record's parse, by global id. */
const BEYOND_PARSING: ReadonlyMap<string, string> = new Map([
  ["addresses/cardinality/keyed-list-duplicate-strict", "a key repeated in a list that a schema declares a keyed list"],
  ["addresses/cardinality/keyed-list-duplicate-lenient", "a key repeated in a list that a schema declares a keyed list"],
]);

// `check` needs the Validate profile, which this runner does not claim yet. Its cases are still the suite's statement of where
// the names' issues go, so each one's issues of those codes are compared here with what parsing its records raises. The
// severity is compared only under the default configuration, since applying the uniqueness mode is configuration's work.
describe("the suite's check cases, for the issues that parsing raises for names", async () => {
  const loaded = await loadCases(REAL_SUITE);
  const checks = loaded.cases
    .filter((entry) => entry.ok)
    .map((entry) => entry.case as SuiteCase)
    .filter((suiteCase) => suiteCase.operation === "check" && !BEYOND_PARSING.has(suiteCase.id));
  const stores = new FixtureStores(REAL_SUITE);

  test("the cases are found, and every case left out exists", () => {
    expect(checks.length).toBeGreaterThan(30);
    const ids = new Set(loaded.cases.filter((entry) => entry.ok).map((entry) => (entry.case as SuiteCase).id));
    for (const id of BEYOND_PARSING.keys()) expect(ids).toContain(id);
  });

  test.each(checks.map((suiteCase) => [suiteCase.id, suiteCase] as const))("%s", async (_, suiteCase) => {
    const opened = await stores.open(suiteCase.directory, suiteCase.input.store, suiteCase.input.config);
    if (!opened.ok) throw new Error(opened.detail);
    const files = opened.value.files;
    const records = Array.isArray(suiteCase.input.records)
      ? (suiteCase.input.records as string[])
      : [...files.keys()].filter((path) => !path.startsWith(".vmd/") && recordFormatOf(path) !== null);
    const withSeverity = suiteCase.input.config === undefined;
    const shown = (issue: ComparedIssue) =>
      `${issue.code} ${issue.path} ${JSON.stringify(issue.at)}${withSeverity ? ` ${issue.severity}` : ""}`;
    const raised: string[] = [];
    for (const path of records) {
      const outcome = parseRecord(path, files.get(path) as Uint8Array);
      if (outcome.ok) raised.push(...outcome.value.issues.filter((issue) => NAME_CODES.has(issue.code)).map(shown));
    }
    const expected = suiteCase.expect.issues.filter((issue) => NAME_CODES.has(issue.code)).map(shown);
    expect(raised.sort()).toEqual(expected.sort());
  });
});
