import { describe, expect, test } from "vitest";
import { standardComparison } from "../compare.js";
import type { OperationContext } from "../operation.js";
import { parseOperation } from "./parse.js";

const context = (files: Record<string, string>): OperationContext => ({
  store: { files: new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)])) },
  comparison: standardComparison,
  signal: new AbortController().signal,
});

describe("the parse operation", () => {
  test("takes a record given as a string only", () => {
    expect(parseOperation.validate?.({ store: "s", record: "a.json" })).toBeUndefined();
    expect(parseOperation.validate?.({ store: "s", record: 1 })).toBe("input.record must be a store path");
  });

  test("gives the value view, or the structural errors by their compared members", async () => {
    const store = context({ "a.json": '{"a": 1}', "b.json": "[1]" });
    expect(await parseOperation.run({ store: "s", record: "a.json" }, store)).toEqual({ ok: true, result: { a: 1 }, issues: [] });
    expect(await parseOperation.run({ store: "s", record: "b.json" }, store)).toEqual({
      ok: false,
      issues: [{ code: "root-not-object", severity: "error", path: "b.json", at: "" }],
    });
  });

  test("crashes on a record the store does not hold, which is a mistake in the suite", async () => {
    await expect(parseOperation.run({ store: "s", record: "missing.json" }, context({}))).rejects.toThrow(
      /no record missing.json/,
    );
  });
});
