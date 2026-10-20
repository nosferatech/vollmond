// `Store.references({to})`: the references into a node and below it, or naming a path, whatever their status; and each
// reference's position in its file.

import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import type { Reference } from "../reference/reference.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore, type ReadMode, type Store } from "./store.js";

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

const FILES: Record<string, string> = {
  ".vmd/config.yaml": "vmd: 1\n",
  "a.md": '# A\n\n## Intro <a id="intro"></a>\n\nText.\n\n### Deep <a id="deep"></a>\n\n- <a id="step"></a>First step.\n',
  "b.md": "# B\n\n[1](a.md#intro) [2](a.md#deep)\n\n## Later\n\n[3](a.md) [4](a.md#missing) [5](a.md#step)\n",
  "c.md": "# C\n\n[6](a.md#intro)\n",
  "d.md": "# D\n\n[7](gone.md) [8](img.png)\n",
  "img.png": "x",
};

async function storeOf(files: Record<string, string> = FILES, readMode: ReadMode = "best-effort"): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files }), { readMode }));
}

/** The raw text of each reference, in order. */
function raws(references: readonly Reference[]): string[] {
  return references.map((reference) => reference.raw);
}

describe("references into a node", () => {
  test("of a record without a fragment: every reference that names it, whatever its status", async () => {
    const store = await storeOf();
    expect(raws(successValue(await store.references({ to: "a.md" })))).toEqual([
      "a.md#intro",
      "a.md#deep",
      "a.md",
      "a.md#missing",
      "a.md#step",
      "a.md#intro",
    ]);
  });

  test("of a section: those whose target is the section or below it", async () => {
    const store = await storeOf();
    expect(raws(successValue(await store.references({ to: "a.md#intro" })))).toEqual([
      "a.md#intro",
      "a.md#deep",
      "a.md#step",
      "a.md#intro",
    ]);
    expect(raws(successValue(await store.references({ to: "a.md#deep" })))).toEqual(["a.md#deep", "a.md#step"]);
  });

  test("of a block anchor: those whose target is that block", async () => {
    const store = await storeOf();
    expect(raws(successValue(await store.references({ to: "a.md#step" })))).toEqual(["a.md#step"]);
  });

  test("of a block anchor: not those into the rest of its $body", async () => {
    const store = await storeOf({ ...FILES, "e.md": "# E\n\n[b](a.md#deep/$body)\n" });
    expect(raws(successValue(await store.references({ to: "a.md#step" })))).toEqual(["a.md#step"]);
    // The near miss: the $body itself has both.
    expect(raws(successValue(await store.references({ to: "a.md#deep/$body" })))).toEqual(["a.md#step", "a.md#deep/$body"]);
  });

  test("of a record without a fragment: also those that reach it through an alias from an old path", async () => {
    const alias = `${JSON.stringify({ kind: "record", from: "old.md", to: "a.md", at: "2026-10-09T08:00:00Z" })}\n`;
    const store = await storeOf({ ...FILES, ".vmd/aliases.jsonl": alias, "e.md": "# E\n\n[o](old.md)\n" });
    expect(raws(successValue(await store.references({ to: "a.md" })))).toContain("old.md");
    expect(raws(successValue(await store.references({ to: "old.md" })))).toEqual(["old.md"]);
  });

  test("of a path where nothing is, or an asset: those that name it", async () => {
    const store = await storeOf();
    expect(raws(successValue(await store.references({ to: "gone.md" })))).toEqual(["gone.md"]);
    expect(raws(successValue(await store.references({ to: "img.png" })))).toEqual(["img.png"]);
  });

  test("fails as resolving does for a fragment that names nothing", async () => {
    const store = await storeOf();
    const outcome = await store.references({ to: "a.md#nothing" });
    expect(outcome.ok).toBe(false);
    expect(outcome.issues[0]?.code).toBe("address-not-found");
  });

  test("in the strict read mode, lists the references into a record the mode refuses", async () => {
    const files = {
      ...FILES,
      ".vmd/config.yaml": "vmd: 1\ncollections:\n  cards:\n    match: ['cards/*.json']\n    schema: card.schema.json\n",
      ".vmd/schema/card.schema.json": JSON.stringify({ properties: { n: { type: "string" } } }),
      "cards/x.json": '{"n": 5}\n',
      "e.md": "# E\n\n[9](cards/x.json#n)\n",
    };
    const strict = await storeOf(files, "strict");
    expect(raws(successValue(await strict.references({ to: "cards/x.json#n" })))).toEqual(["cards/x.json#n"]);
  });

  test("refuses from and to together", async () => {
    const store = await storeOf();
    await expect(store.references({ from: "b.md", to: "a.md" })).rejects.toThrow(RangeError);
  });
});

describe("a reference's position", () => {
  test("is the line and column where its issues are reported, for every reference", async () => {
    const store = await storeOf();
    const references = successValue(await store.references({ from: "b.md" }));
    expect(references.map((reference) => [reference.position?.line, reference.position?.col])).toEqual([
      [3, 5],
      [3, 21],
      [7, 5],
      [7, 15],
      [7, 33],
    ]);
    const dangling = references.find((reference) => reference.status === "dangling");
    expect(dangling?.issues[0]?.position).toEqual(dangling?.position);
  });
});
