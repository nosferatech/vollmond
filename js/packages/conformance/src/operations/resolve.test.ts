import { describe, expect, test } from "vitest";
import { standardComparison } from "../compare.js";
import type { JsonValue } from "../json.js";
import type { OperationContext } from "../operation.js";
import { metaOperation } from "./meta.js";
import { resolveOperation } from "./resolve.js";

/** The context of a case whose store holds these files, and a configuration of `vmd: 1` unless they give one. */
const context = (given: Record<string, string>): OperationContext => {
  const files: Record<string, string> = { ".vmd/config.yaml": "vmd: 1\n", ...given };
  return {
    store: { files: new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)])) },
    comparison: standardComparison,
    signal: new AbortController().signal,
  };
};

const RECORD = '# Title\n\n<a id="room"></a>Room.\n\n## Notes\n\nOne.\n\n## Notes\n\nTwo.\n';

describe("the resolve operation", () => {
  test("takes an address given as a string and `as` as singular or selector", () => {
    expect(resolveOperation.validate?.({ store: "s", address: "a.md", as: "singular" })).toBeUndefined();
    expect(resolveOperation.validate?.({ store: "s", address: "a.md", as: "selector" })).toBeUndefined();
    expect(resolveOperation.validate?.({ store: "s", address: 1, as: "singular" })).toBe("input.address must be a string");
    expect(resolveOperation.validate?.({ store: "s", address: "a.md", as: "many" })).toBe(
      'input.as must be "singular" or "selector"',
    );
  });

  test("gives the targets, a block anchor's range as [start, end]", async () => {
    const store = context({ "a.md": RECORD });
    expect(await resolveOperation.run({ store: "s", address: "a.md#room", as: "singular" }, store)).toEqual({
      ok: true,
      result: [{ path: "a.md", at: "/$body", address: "#room", range: [0, 22] }],
      issues: [],
    });
    expect(await resolveOperation.run({ store: "s", address: "a.md#notes", as: "selector" }, store)).toEqual({
      ok: true,
      result: [
        { path: "a.md", at: "/$sections/0", address: "#/$sections/0" },
        { path: "a.md", at: "/$sections/1", address: "#notes-1" },
      ],
      issues: [],
    });
  });

  test("fails with the issues by their compared members", async () => {
    const store = context({ "a.md": RECORD, "b.json": "[1]", ".vmd/config.yaml": "vmd: 1\n", "c.txt": "{}" });
    const issues = async (address: string) => {
      const outcome = await resolveOperation.run({ store: "s", address, as: "singular" }, store);
      return "issues" in outcome ? outcome.issues : outcome;
    };
    expect(await issues("a.md#notes")).toEqual([{ code: "address-ambiguous", severity: "error", path: "a.md", at: null }]);
    expect(await issues("a.md#a//b")).toEqual([{ code: "address-malformed", severity: "error", path: "a.md", at: null }]);
    expect(await issues("b.json")).toEqual([{ code: "root-not-object", severity: "error", path: "b.json", at: "" }]);
    for (const path of ["missing.md", ".vmd/config.yaml", "c.txt"]) {
      expect(await issues(path), path).toEqual([{ code: "address-not-found", severity: "error", path, at: null }]);
    }
  });

  test("compares a selector's targets in order, since a selector returns them in document order, as a singular address's", () => {
    const a = { path: "a.md", at: "/x", address: "#x" };
    const b = { path: "a.md", at: "/y", address: "#y" };
    const equal = (as: string, expected: JsonValue, actual: JsonValue) =>
      resolveOperation.equalResults?.(expected, actual, { as }, context({}));
    expect(equal("selector", [a, b], [a, b])).toBe(true);
    expect(equal("selector", [a, b], [b, a])).toBe(false);
    expect(equal("selector", [a, b], [a, a])).toBe(false);
    expect(equal("singular", [a, b], [b, a])).toBe(false);
    expect(equal("singular", [a], [a])).toBe(true);
  });
});

describe("the resolve and meta operations, over the case's configuration", () => {
  const config = 'vmd: 1\ncollections:\n  docs: {match: ["docs/*.md"], schema: missing.json}\nignore: ["drafts/**"]\n';
  const files = { ".vmd/config.yaml": config, "docs/a.md": RECORD, "drafts/b.md": RECORD, "c.md": RECORD };
  const codes = (outcome: Awaited<ReturnType<typeof resolveOperation.run>>) =>
    "issues" in outcome ? outcome.issues.map((issue) => issue.code) : outcome;

  test("refuse a record whose collection's schema cannot be used, and find none at an ignored path", async () => {
    expect(codes(await resolveOperation.run({ store: "s", address: "docs/a.md#room", as: "singular" }, context(files)))).toEqual([
      "schema-invalid",
    ]);
    expect(codes(await metaOperation.run({ store: "s", record: "docs/a.md" }, context(files)))).toEqual(["schema-invalid"]);
    expect(codes(await resolveOperation.run({ store: "s", address: "drafts/b.md", as: "singular" }, context(files)))).toEqual([
      "address-not-found",
    ]);
    expect(await resolveOperation.run({ store: "s", address: "c.md#room", as: "singular" }, context(files))).toMatchObject({
      ok: true,
    });
  });

  test("fail with the configuration's issues when it cannot be read", async () => {
    const broken = context({ ".vmd/config.yaml": "vmd: 1\nlater: true\n", "c.md": RECORD });
    expect(codes(await resolveOperation.run({ store: "s", address: "c.md", as: "singular" }, broken))).toEqual([
      "feature-unsupported",
    ]);
    expect(codes(await metaOperation.run({ store: "s", record: "c.md" }, broken))).toEqual(["feature-unsupported"]);
  });
});

describe("the meta operation", () => {
  test("takes a record given as a string only", () => {
    expect(metaOperation.validate?.({ store: "s", record: "a.md" })).toBeUndefined();
    expect(metaOperation.validate?.({ store: "s", record: 1 })).toBe("input.record must be a store path");
  });

  test("gives @key and @address of each section, the root's @key as null", async () => {
    expect(await metaOperation.run({ store: "s", record: "a.md" }, context({ "a.md": RECORD }))).toEqual({
      ok: true,
      result: {
        "": { "@key": null, "@address": "" },
        "/$sections/0": { "@key": "notes", "@address": "#/$sections/0" },
        "/$sections/1": { "@key": "notes", "@address": "#notes-1" },
      },
      issues: [],
    });
  });

  test("fails like parse for a record with a structural error", async () => {
    expect(await metaOperation.run({ store: "s", record: "b.json" }, context({ "b.json": "[1]" }))).toEqual({
      ok: false,
      issues: [{ code: "root-not-object", severity: "error", path: "b.json", at: "" }],
    });
  });

  test("crashes on a record the store does not hold, which is a mistake in the suite", async () => {
    await expect(metaOperation.run({ store: "s", record: "missing.md" }, context({}))).rejects.toThrow(/no record missing.md/);
  });
});
