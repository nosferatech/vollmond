import { describe, expect, test } from "vitest";
import { standardComparison } from "../compare.js";
import type { OperationContext } from "../operation.js";
import { checkOperation } from "./check.js";

/** The context of a case whose store holds these files, with the configuration file `config` names in `.vmd/` if any. */
const context = (files: Record<string, string>, config?: string): OperationContext => {
  const encoded = new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));
  const chosen = config === undefined ? undefined : encoded.get(`.vmd/${config}`);
  return {
    store: chosen === undefined ? { files: encoded } : { files: encoded, config: chosen },
    comparison: standardComparison,
    signal: new AbortController().signal,
  };
};

const TWICE = '# T\n\n## A <a id="x"></a>\n\n## B <a id="x"></a>\n';

describe("the check operation", () => {
  test("takes records as a list of store paths, or none", () => {
    expect(checkOperation.validate?.({ store: "s" })).toBeUndefined();
    expect(checkOperation.validate?.({ store: "s", records: ["a.md"] })).toBeUndefined();
    expect(checkOperation.validate?.({ store: "s", records: "a.md" })).toBe("input.records must be a list of store paths");
    expect(checkOperation.validate?.({ store: "s", records: [1] })).toBe("input.records must be a list of store paths");
  });

  test("gives every issue of the store, or of the records named, by their compared members", async () => {
    const store = context({ ".vmd/config.yaml": "vmd: 1\n", "a.md": TWICE, "b.json": "{" });
    const twice = [
      { code: "duplicate-anchor", severity: "error", path: "a.md", at: "/$sections/1" },
      { code: "duplicate-key", severity: "error", path: "a.md", at: "/$sections/1" },
    ];
    expect(await checkOperation.run({ store: "s" }, store)).toEqual({
      ok: true,
      issues: [...twice, { code: "syntax-error", severity: "error", path: "b.json", at: "" }],
    });
    expect(await checkOperation.run({ store: "s", records: ["a.md"] }, store)).toEqual({ ok: true, issues: twice });
  });

  test("reads the case's configuration file in place of .vmd/config.yaml, with its schemas in .vmd/schema/", async () => {
    const files = {
      ".vmd/config.yaml": "vmd: 1\n",
      ".vmd/config-lenient.yaml": 'vmd: 1\nuniqueness: lenient\ncollections:\n  all: {match: ["*.md"], schema: s.json}\n',
      ".vmd/schema/s.json": "{}",
      "a.md": TWICE,
    };
    const outcome = await checkOperation.run({ store: "s" }, context(files, "config-lenient.yaml"));
    expect(outcome).toEqual({
      ok: true,
      issues: [
        { code: "duplicate-anchor", severity: "warning", path: "a.md", at: "/$sections/1" },
        { code: "duplicate-key", severity: "warning", path: "a.md", at: "/$sections/1" },
      ],
    });
    const { ".vmd/schema/s.json": _, ...withoutSchema } = files;
    const refused = await checkOperation.run({ store: "s" }, context(withoutSchema, "config-lenient.yaml"));
    expect("issues" in refused && refused.issues.map((issue) => issue.code)).toEqual([
      "schema-invalid",
      "duplicate-anchor",
      "duplicate-key",
    ]);
  });

  test("gives a configuration's issues as the check's, without failing, since a check never fails", async () => {
    const store = context({ ".vmd/config.yaml": "vmd: 1\nfuture: true\nuniqueness: loose\n", "a.md": TWICE });
    expect(await checkOperation.run({ store: "s" }, store)).toEqual({
      ok: true,
      issues: [
        { code: "feature-unsupported", severity: "error", path: null, at: null },
        { code: "config-invalid", severity: "error", path: null, at: null },
      ],
    });
  });
});
