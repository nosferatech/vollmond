// How often a check binds each record, counted: once, whether the record is checked or a reference resolves into it.

import { describe, expect, test, vi } from "vitest";
import { bindRecord as libraryBindRecord } from "../binding/binding.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore } from "../store/store.js";

// The binding of a record to its collection's schema, counted.
vi.mock("../binding/binding.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../binding/binding.js")>();
  return { ...original, bindRecord: vi.fn(original.bindRecord) };
});
const bindRecord = vi.mocked(libraryBindRecord);

describe("Store.check", () => {
  test("binds each record once, also where references resolve into it", async () => {
    const opened = await openStore(
      createMemoryStorage({
        files: {
          ".vmd/config.yaml": [
            "vmd: 1",
            "collections:",
            "  bound:",
            '    match: ["bound/*.yaml"]',
            "    schema: bound.schema.yaml",
            "  refused:",
            '    match: ["refused/*.md"]',
            "    schema: missing.schema.yaml",
            "",
          ].join("\n"),
          ".vmd/schema/bound.schema.yaml":
            "type: object\nproperties:\n  log: {type: array, x-vmd-list: {type: map, keys: [id]}}\n",
          "bound/a.yaml": "log:\n  - {id: x, see: {$ref: b.yaml#log/y}}\n",
          "bound/b.yaml": "log:\n  - {id: y, see: {$ref: a.yaml#log/x}}\n",
          "refused/r.md": "# R\n\n[a](../bound/a.yaml#log/x)\n",
          "plain.md": "# P\n\n[a](bound/a.yaml#log/x) [b](bound/b.yaml#log/y)\n",
        },
      }),
    );
    if (!opened.ok) expect.fail(JSON.stringify(opened.issues));
    bindRecord.mockClear();
    const checked = await opened.value.check();
    expect(checked.issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual(["schema-invalid null"]);
    const bound = bindRecord.mock.calls.map(([record, schema]) => `${record.path} ${schema === null ? "none" : "schema"}`);
    // A record whose collection's schema cannot be used is checked bound to none, which readers never do.
    expect(bound.sort()).toEqual(["bound/a.yaml schema", "bound/b.yaml schema", "plain.md none", "refused/r.md none"]);
  });
});
