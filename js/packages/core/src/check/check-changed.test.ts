// `Store.check({changed})`: the records whose issues an incremental check reports, the changed records and those that cite a
// changed path, found from the snapshot of the last full check where a record is as it was then, and from the record itself
// otherwise.

import { describe, expect, test } from "vitest";
import { createMemoryIndexCache, type IndexCache } from "../index/cache.js";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore, type Store } from "../store/store.js";
import { gitBlobId } from "../value/digest.js";
import type { CheckSummary } from "./check.js";

type Files = Record<string, string>;

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function storeOf(files: Files, index?: IndexCache): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files }), index === undefined ? {} : { index }));
}

/** The paths and codes of a check's issues, in order. */
function reported(outcome: Outcome<CheckSummary>): string[] {
  return outcome.issues.map((issue: Issue) => `${issue.path} ${issue.code}`);
}

/**
 * The configuration, and a record that no test changes or cites, with a dangling link of its own: a check of what changed
 * never reports it, and a check of the whole store does.
 */
const CONFIG = { ".vmd/config.yaml": "vmd: 1\n", "z.md": "# Z\n\n[z](nowhere.md)\n" };

describe("a check of what changed", () => {
  test("reports a reference that was dangling at the last full check and whose named path has changed since", async () => {
    // At the snapshot, x.md has no #a, so a.md's link has no target to tell that it cites x.md.
    const before = { ...CONFIG, "a.md": "# A\n\n[x](x.md#a)\n", "x.md": "# X\n" };
    const cache = createMemoryIndexCache();
    await (await storeOf(before, cache)).check();
    // Now x.md has two sections that #a matches, and a.md, unchanged, holds an ambiguous reference.
    const after = { ...before, "x.md": "# X\n\n## A\n\none\n\n## A\n\ntwo\n" };
    cache.log.length = 0;
    const outcome = await (await storeOf(after, cache)).check({ changed: ["x.md"] });
    expect(reported(outcome)).toEqual(["a.md ref-ambiguous", "x.md duplicate-key"]);
    expect(successValue(outcome).records).toBe(2);
    // The snapshot answered for the records unchanged since it: the bystander was not read to find what it cites.
    const bystander = await gitBlobId(new TextEncoder().encode(CONFIG["z.md"]));
    expect(cache.log).toContain("read snapshot");
    expect(cache.log).not.toContain(`read parse/${bystander}.md`);
  });

  test("selects the records whose references reach a changed path, from the snapshot, and the changed records", async () => {
    const files = {
      ...CONFIG,
      "a.md": "# A\n\n## Intro\n\nText.\n",
      "b.md": "# B\n\n[1](a.md#intro)\n",
      "c.md": "# C\n\n[2](d.md#gone)\n",
      "d.md": "# D\n",
    };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const changed = { ...files, "a.md": "# A\n\n## Introduction\n\nText.\n" };
    const outcome = await (await storeOf(changed, cache)).check({ changed: ["a.md"] });
    expect(reported(outcome)).toEqual(["b.md ref-dangling"]);
    // c.md's dangling link is not about a.md, and c.md has not changed: not reported.
    expect(successValue(outcome).records).toBe(2);
  });

  test("after a move, reports the reference to the old path as dangling, with a snapshot and without one", async () => {
    const files = { ...CONFIG, "a.md": "# A\n", "c.md": "# C\n\n[a](a.md)\n" };
    const { "a.md": moved, ...rest } = files;
    const after = { ...rest, "b.md": moved };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    for (const index of [cache, undefined]) {
      const outcome = await (await storeOf(after, index)).check({ changed: ["a.md", "b.md"] });
      expect(reported(outcome)).toEqual(["c.md ref-dangling"]);
      expect(successValue(outcome).records).toBe(2);
    }
  });

  test("does not trust the snapshot's rows for a record that changed since it, which may cite the path now", async () => {
    const files = { ...CONFIG, "a.md": "# A\n", "c.md": "# C\n" };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    // c.md gains a link to a.md#nothing after the snapshot, and is not among the paths changed since the revision compared.
    const after = { ...files, "a.md": "# A\n\nMore.\n", "c.md": "# C\n\n[a](a.md#nothing)\n" };
    const outcome = await (await storeOf(after, cache)).check({ changed: ["a.md"] });
    expect(reported(outcome)).toEqual(["c.md ref-dangling"]);
    expect(successValue(outcome).records).toBe(2);
  });

  test("finds a record added since the snapshot, which the snapshot has no rows for", async () => {
    const files = { ...CONFIG, "a.md": "# A\n" };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const after = { ...files, "a.md": "# A\n\nMore.\n", "new.md": "# N\n\n[a](a.md#nothing)\n" };
    const outcome = await (await storeOf(after, cache)).check({ changed: ["a.md"] });
    expect(reported(outcome)).toEqual(["new.md ref-dangling"]);
    expect(successValue(outcome).records).toBe(2);
  });

  test("checks the whole store when a path that an alias names changes, since any route through an alias may", async () => {
    const alias = `${JSON.stringify({ kind: "record", from: "old.md", to: "new.md", at: "2026-10-09T08:00:00Z" })}\n`;
    const files = {
      ...CONFIG,
      ".vmd/aliases.jsonl": alias,
      "new.md": "# New\n\n## Intro\n",
      "c.md": "# C\n\n[x](old.md#intro)\n",
      "d.md": "# D\n",
    };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const after = { ...files, "new.md": "# New\n\n## Other\n" };
    const outcome = await (await storeOf(after, cache)).check({ changed: ["new.md"] });
    expect(reported(outcome)).toEqual(["c.md ref-dangling", "z.md ref-dangling"]);
    expect(successValue(outcome).records).toBe(4);
    // The near miss: a change to a path no alias names checks what it reaches only.
    const other = { ...files, "d.md": "# D\n\nMore.\n" };
    expect(successValue(await (await storeOf(other, cache)).check({ changed: ["d.md"] })).records).toBe(1);
  });

  test("selects a record that links to a directory below which a path changed", async () => {
    const files = { ...CONFIG, "docs/a.md": "# A\n", "c.md": "# C\n\n[docs](docs/)\n" };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const { "docs/a.md": _gone, ...after } = files;
    const outcome = await (await storeOf(after, cache)).check({ changed: ["docs/a.md"] });
    expect(reported(outcome)).toEqual(["c.md ref-dangling"]);
    expect(successValue(outcome).records).toBe(1);
  });

  test("ignores a snapshot made with another configuration, and finds the citing records from the records", async () => {
    // Without a schema, c.json's owner is a plain string; with the schema below, a typed reference to a.md.
    const files = { ...CONFIG, "a.md": "# A\n", "c.json": '{"owner": "a.md"}\n' };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const typed = {
      ...files,
      ".vmd/config.yaml": "vmd: 1\ncollections:\n  cards:\n    match: ['*.json']\n    schema: card.schema.json\n",
      ".vmd/schema/card.schema.json": JSON.stringify({
        type: "object",
        properties: { owner: { type: "string", format: "uri-reference", "x-vmd-ref": {} } },
      }),
    };
    const { "a.md": _gone, ...after } = typed;
    const outcome = await (await storeOf(after, cache)).check({ changed: ["a.md"] });
    expect(reported(outcome)).toEqual(["c.json ref-dangling"]);
    expect(successValue(outcome).records).toBe(1);
  });

  test("checks the whole store, and keeps its snapshot, when the alias file changed", async () => {
    const files = { ...CONFIG, "a.md": "# A\n\n[x](x.md)\n", "b.md": "# B\n\n[y](y.md)\n" };
    const cache = createMemoryIndexCache();
    const outcome = await (await storeOf(files, cache)).check({ changed: [".vmd/aliases.jsonl"] });
    expect(reported(outcome)).toEqual(["a.md ref-dangling", "b.md ref-dangling", "z.md ref-dangling"]);
    expect(successValue(outcome).records).toBe(3);
    expect(cache.log).toContain("write snapshot");
  });

  test("writes no snapshot for a part of the store, and the near miss: a full check does", async () => {
    const files = { ...CONFIG, "a.md": "# A\n" };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check({ changed: ["a.md"] });
    expect(cache.log).not.toContain("write snapshot");
    await (await storeOf(files, cache)).check();
    expect(cache.log).toContain("write snapshot");
  });

  test("refuses records and changed together", async () => {
    const store = await storeOf({ ...CONFIG, "a.md": "# A\n" });
    await expect(store.check({ records: ["a.md"], changed: ["a.md"] })).rejects.toThrow(RangeError);
  });
});

const at = "2026-10-09T08:00:00Z";
/** An alias file's line for an entry. */
const line = (entry: object) => `${JSON.stringify({ ...entry, at })}\n`;

describe("a check of what changed, against a full check (the review's cases)", () => {
  test("leaves out the path issues of unchanged paths that involve no changed one", async () => {
    const files = { ...CONFIG, "bad name.md": "# B\n", "a.md": "# A\n" };
    const outcome = await (await storeOf(files)).check({ changed: ["a.md"] });
    expect(reported(outcome)).toEqual([]);
    // The near miss: the full check reports it.
    expect(reported(await (await storeOf(files)).check())).toContain("bad name.md path-invalid");
  });

  test("a new path whose case conflicts with an unchanged record's", async () => {
    const before = { ".vmd/config.yaml": "vmd: 1\n", "notes.md": "# N\n" };
    const after = { ...before, "Notes.md": "# M\n" };
    const full = await (await storeOf(after)).check();
    const inc = await (await storeOf(after)).check({ changed: ["Notes.md"] });
    expect(reported(inc)).toEqual(reported(full));
  });

  test("an added asset whose path breaks the path rules", async () => {
    const before = { ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" };
    const after = { ...before, "img/bad name.png": "x" };
    const full = await (await storeOf(after)).check();
    const inc = await (await storeOf(after)).check({ changed: ["img/bad name.png"] });
    expect(reported(inc)).toEqual(reported(full));
  });

  test("a file created at an old path whose anchor aliases a reference went through", async () => {
    const aliases =
      line({ kind: "record", from: "old.md", to: "new.md" }) + line({ kind: "anchor", record: "old.md", from: "a", to: "b" });
    const before = {
      ".vmd/config.yaml": "vmd: 1\n",
      ".vmd/aliases.jsonl": aliases,
      "new.md": "# New\n\n## B\n",
      "r.md": "# R\n\n[x](new.md#a)\n",
    };
    const after = { ...before, "old.md": "# Old again\n" };
    // The new file changes what the reference reaches, so a check that misses it reports the old result.
    const fullBefore = await (await storeOf(before)).check();
    expect(reported(fullBefore)).not.toEqual(reported(await (await storeOf(after)).check()));
    for (const cache of [undefined, createMemoryIndexCache()]) {
      if (cache !== undefined) await (await storeOf(before, cache)).check();
      const full = await (await storeOf(after)).check();
      const inc = await (await storeOf(after, cache)).check({ changed: ["old.md"] });
      expect(reported(inc)).toEqual(reported(full));
    }
  });

  test("a stale snapshot whose target was the old path, then the old path removed before REV", async () => {
    const aliases = line({ kind: "record", from: "old.md", to: "new.md" });
    const s0 = {
      ".vmd/config.yaml": "vmd: 1\n",
      ".vmd/aliases.jsonl": aliases,
      "old.md": "# Old\n\n## X\n",
      "new.md": "# New\n\n## X\n",
      "r.md": "# R\n\n[x](old.md#x)\n",
    };
    const cache = createMemoryIndexCache();
    await (await storeOf(s0, cache)).check();
    const { "old.md": _gone, ...rev } = s0;
    const now = { ...rev, "new.md": "# New\n\n## Y\n" };
    const full = await (await storeOf(now)).check();
    const inc = await (await storeOf(now, cache)).check({ changed: ["new.md"] });
    expect(reported(inc)).toEqual(reported(full));
  });

  test("a file created midway along a record alias chain, with a current snapshot", async () => {
    const aliases =
      line({ kind: "record", from: "old.md", to: "mid.md" }) + line({ kind: "record", from: "mid.md", to: "new.md" });
    const before = {
      ".vmd/config.yaml": "vmd: 1\n",
      ".vmd/aliases.jsonl": aliases,
      "new.md": "# New\n\n## X\n",
      "r.md": "# R\n\n[x](old.md#x)\n",
    };
    const after = { ...before, "mid.md": "# Mid\n" };
    for (const cache of [undefined, createMemoryIndexCache()]) {
      if (cache !== undefined) await (await storeOf(before, cache)).check();
      const full = await (await storeOf(after)).check();
      const inc = await (await storeOf(after, cache)).check({ changed: ["mid.md"] });
      expect(reported(inc)).toEqual(reported(full));
    }
  });
});
