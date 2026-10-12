import { describe, expect, test } from "vitest";
import { standardComparison } from "../compare.js";
import type { JsonValue } from "../json.js";
import type { OperationContext } from "../operation.js";
import { refsOperation } from "./refs.js";

/** The context of a case whose store holds these files, and a configuration of `vmd: 1`. */
const context = (given: Record<string, string>): OperationContext => {
  const files: Record<string, string> = { ".vmd/config.yaml": "vmd: 1\n", ...given };
  return {
    store: { files: new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)])) },
    comparison: standardComparison,
    signal: new AbortController().signal,
  };
};

const FILES = {
  "a.md": "# A\n\n[x](b.md#notes) ![y](img.png)\n",
  "b.md": "# B\n\n## Notes\n\n## Notes\n",
  "img.png": "png",
  "c.json": '{"r": {"$ref": "a.md"}}',
};

describe("the refs operation", () => {
  test("takes a record as a store path, or none", () => {
    expect(refsOperation.validate?.({ store: "s" })).toBeUndefined();
    expect(refsOperation.validate?.({ store: "s", record: "a.md" })).toBeUndefined();
    expect(refsOperation.validate?.({ store: "s", record: 1 })).toBe("input.record must be a store path");
  });

  test("gives a record's references as {from, raw, status, targets}, an asset's target by its path alone", async () => {
    expect(await refsOperation.run({ store: "s", record: "a.md" }, context(FILES))).toEqual({
      ok: true,
      result: [
        {
          from: { path: "a.md", at: "/$body", offset: 0 },
          raw: "b.md#notes",
          status: "ambiguous",
          targets: [
            { path: "b.md", at: "/$sections/0", address: "#/$sections/0" },
            { path: "b.md", at: "/$sections/1", address: "#notes-1" },
          ],
        },
        { from: { path: "a.md", at: "/$body", offset: 16 }, raw: "img.png", status: "ok", targets: [{ path: "img.png" }] },
      ],
      issues: [],
    });
  });

  test("gives every record's references without a record, a $ref object's from without an offset", async () => {
    const outcome = await refsOperation.run({ store: "s" }, context(FILES));
    expect(outcome).toMatchObject({ ok: true, issues: [] });
    const result = "result" in outcome ? (outcome.result as { from: JsonValue }[]) : [];
    expect(result.map((reference) => reference.from)).toEqual([
      { path: "a.md", at: "/$body", offset: 0 },
      { path: "a.md", at: "/$body", offset: 16 },
      { path: "c.json", at: "/r" },
    ]);
  });

  test("fails for a record with a structural error, with its errors", async () => {
    expect(await refsOperation.run({ store: "s", record: "d.json" }, context({ ...FILES, "d.json": "[1]" }))).toEqual({
      ok: false,
      issues: [{ code: "root-not-object", severity: "error", path: "d.json", at: "" }],
    });
  });

  test("compares the references without order, and each one's targets in order", () => {
    const equal = (expected: JsonValue, actual: JsonValue) =>
      refsOperation.equalResults?.(expected, actual, {}, context({})) ?? false;
    const a = { raw: "a", targets: [{ path: "x" }, { path: "y" }] };
    const b = { raw: "b", targets: [] };
    expect(equal([a, b], [b, a])).toBe(true);
    expect(equal([a, b], [a])).toBe(false);
    expect(equal([a], [{ raw: "a", targets: [{ path: "y" }, { path: "x" }] }])).toBe(false);
  });
});
