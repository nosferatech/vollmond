import { describe, expect, test } from "vitest";
import { standardComparison } from "../compare.js";
import type { OperationContext } from "../operation.js";
import { anchorsOperation } from "./anchors.js";

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
