// What a record's binding changes in a store's reads: keyed lists in addresses, the proof of singular addresses, canonical
// addresses and computed fields, and the issues that check and @issues report.

import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore, type Store } from "../store/store.js";

const config = (uniqueness: "strict" | "lenient") =>
  [
    "vmd: 1",
    `uniqueness: ${uniqueness}`,
    "collections:",
    "  runs:",
    '    match: ["runs/*.json"]',
    "    schema: run.schema.json",
    "  journal:",
    '    match: ["journal/*.md"]',
    "    schema: journal.schema.json",
    "  both:",
    '    match: ["runs/both.json"]',
    "",
  ].join("\n");

const RUN_SCHEMA = {
  properties: {
    benchmarks: {
      type: "array",
      "x-vmd-list": { type: "map", keys: ["name"], items: { "read-4k": { required: ["p99_us"] } } },
    },
    groups: { type: "array", "x-vmd-list": { type: "multimap", keys: ["name"] } },
  },
};
const JOURNAL_SCHEMA = {
  properties: { $sections: { items: { properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } } } } },
};

const files = (uniqueness: "strict" | "lenient" = "strict") => ({
  ".vmd/config.yaml": config(uniqueness),
  ".vmd/schema/run.schema.json": JSON.stringify(RUN_SCHEMA),
  ".vmd/schema/journal.schema.json": JSON.stringify(JOURNAL_SCHEMA),
  "runs/r1.json": JSON.stringify({
    benchmarks: [
      { name: "append-4k", p99_us: 120 },
      { name: "read-4k", p99_us: 80 },
    ],
    groups: [{ name: "g" }, { name: "g" }],
  }),
  "runs/dup.json": JSON.stringify({ benchmarks: [{ name: "a" }, { name: "a" }, { name: "read-4k" }] }),
  // Two collections claim it, so it is read without a schema.
  "runs/both.json": JSON.stringify({ benchmarks: [{ name: "a" }, { name: "a" }] }),
  "journal/w.md": "# W\n\n## Log\n\n### Entry\n\nMonday.\n\n### Entry\n\nTuesday.\n",
  "journal/one.md": "# O\n\n## Log\n\n### Entry\n\nMonday.\n",
  "loose.md": "# L\n\n## Entry\n\nOne.\n\n## Entry\n\nTwo.\n",
});

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function store(uniqueness: "strict" | "lenient" = "strict"): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files: files(uniqueness) })));
}

/** The code, record and node of each issue, with its severity. */
const shown = (outcome: Outcome<unknown>) =>
  outcome.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path} ${issue.at}`);

describe("a store's reads through bindings", () => {
  test("get reads a keyed-list item by its key, with its key and canonical address", async () => {
    const opened = await store();
    const got = successValue(await opened.get("runs/r1.json#benchmarks/read-4k/p99_us", { meta: ["@at", "@address", "@key"] }));
    expect(got).toEqual({
      value: 80,
      meta: { "@at": "/benchmarks/1/p99_us", "@address": "#benchmarks/read-4k/p99_us", "@key": "p99_us" },
    });
    const item = successValue(await opened.get("runs/r1.json#/benchmarks/0", { meta: ["@key", "@address"] }));
    expect(item.meta).toEqual({ "@key": "append-4k", "@address": "#benchmarks/append-4k" });
  });

  test("a singular address through a multimap fails before evaluation, and a selector takes every match", async () => {
    const opened = await store();
    expect(shown(await opened.get("runs/r1.json#groups/g"))).toEqual(["error address-not-singular runs/r1.json null"]);
    expect(shown(await opened.outline("journal/w.md#log/entry"))).toEqual(["error address-not-singular journal/w.md null"]);
    const selected = successValue(await opened.resolve("runs/r1.json#groups/g", "selector"));
    expect(selected.targets.map((target) => target.address)).toEqual(["#/groups/0", "#/groups/1"]);
  });

  test("outline gives canonical addresses from the binding", async () => {
    const outline = successValue(await (await store()).outline("journal/w.md"));
    expect(outline.sections.map((section) => section.address)).toEqual(["#log", "#entry", "#entry-1"]);
    // With one Entry, the path from the root would name it alone, but the multimap level keeps it from being proved so.
    const one = successValue(await (await store()).outline("journal/one.md"));
    expect(one.sections.map((section) => section.address)).toEqual(["#log", "#entry"]);
  });

  test("a record that two collections claim is read without a schema", async () => {
    const opened = await store();
    expect(successValue(await opened.resolve("runs/both.json#benchmarks/0", "singular")).targets[0]?.at).toBe("/benchmarks/0");
    const binding = await opened.binding("runs/both.json");
    expect(binding?.ok === true && binding.value.lists.has("/benchmarks")).toBe(false);
    const keyed = await opened.binding("runs/r1.json");
    expect(keyed?.ok === true && keyed.value.lists.get("/benchmarks")?.type).toBe("map");
    expect(await opened.binding("missing.json")).toBeNull();
  });

  test("@issues holds the schema's issues and the declared duplicates", async () => {
    const opened = await store("lenient");
    const got = successValue(await opened.get("runs/dup.json#/benchmarks/1", { meta: ["@issues"] }));
    expect(got.meta?.["@issues"]).toEqual([
      expect.objectContaining({ code: "duplicate-key", severity: "error", at: "/benchmarks/1" }),
    ]);
    const read = successValue(await opened.get("runs/dup.json#benchmarks/read-4k", { meta: ["@issues"] }));
    expect(read.meta?.["@issues"]).toEqual([expect.objectContaining({ code: "schema-violation", at: "/benchmarks/2" })]);
  });
});

describe("check through bindings", () => {
  test("a declared map's repeats are errors in either mode, a multimap's allowed, an undeclared level's by the mode", async () => {
    for (const uniqueness of ["strict", "lenient"] as const) {
      const checked = await (await store(uniqueness)).check();
      const severity = uniqueness === "strict" ? "error" : "warning";
      expect(shown(checked)).toEqual([
        `${severity} duplicate-key loose.md /$sections/1`,
        "error collection-conflict runs/both.json ",
        "error duplicate-key runs/dup.json /benchmarks/1",
        "error schema-violation runs/dup.json /benchmarks/2",
      ]);
    }
  });
});
