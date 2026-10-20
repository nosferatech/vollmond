// A store over the local index: what it parses and binds when entries are there, and that its checks report what a store
// without the index reports. The counts of parses and bindings are the guard that the cache keeps hitting.

import { describe, expect, test, vi } from "vitest";
import { bindRecord as libraryBindRecord } from "../binding/binding.js";
import { parseRecord as libraryParseRecord } from "../format/parse-record.js";
import { createMemoryIndexCache, type IndexCache, type MemoryIndexCache, SNAPSHOT_KEY } from "../index/cache.js";
import { parseEntry } from "../index/entries.js";
import { readSnapshot, snapshotRows } from "../index/snapshot.js";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { gitBlobId } from "../value/digest.js";
import { openStore, type Store } from "./store.js";

vi.mock("../format/parse-record.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../format/parse-record.js")>();
  return { ...original, parseRecord: vi.fn(original.parseRecord) };
});
vi.mock("../binding/binding.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../binding/binding.js")>();
  return { ...original, bindRecord: vi.fn(original.bindRecord) };
});
const parseRecord = vi.mocked(libraryParseRecord);
const bindRecord = vi.mocked(libraryBindRecord);

type Files = Record<string, string>;

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function storeOf(files: Files, index?: IndexCache, backend?: StorageReader): Promise<Store> {
  return successValue(await openStore(backend ?? createMemoryStorage({ files }), index === undefined ? {} : { index }));
}

/** Each issue as a test compares it: every member. */
function shown(issues: readonly Issue[]): unknown[] {
  return issues.map((issue) => ({ ...issue }));
}

/** The paths parsed and bound while `run` runs. */
async function counted(run: () => Promise<unknown>): Promise<{ parsed: string[]; bound: string[] }> {
  parseRecord.mockClear();
  bindRecord.mockClear();
  await run();
  return {
    parsed: parseRecord.mock.calls.map(([path]) => path).sort(),
    bound: bindRecord.mock.calls.map(([record]) => record.path).sort(),
  };
}

const RUN_SCHEMA = JSON.stringify({
  properties: {
    doc: { type: "string", format: "uri-reference", "x-vmd-ref": { targets: ["docs/**"] } },
    steps: { type: "array", "x-vmd-list": { type: "map", keys: ["name"] } },
  },
});

/** A store of `count` records with links between them: half documents, half runs of a collection with a schema. */
function linkedStore(count: number): Files {
  const half = count / 2;
  const files: Files = {
    ".vmd/config.yaml": [
      "vmd: 1",
      "collections:",
      "  runs:",
      '    match: ["runs/*.json"]',
      "    schema: run.schema.json",
      "",
    ].join("\n"),
    ".vmd/schema/run.schema.json": RUN_SCHEMA,
  };
  for (let i = 0; i < half; i++) {
    const next = (i + 1) % half;
    files[`docs/d${i}.md`] = [
      `# Document ${i}`,
      "",
      `See [the next](d${next}.md#intro), [its run](../runs/r${i}.json#steps/build) and [nothing](missing.md).`,
      "",
      `## Intro <a id="intro"></a>`,
      "",
      `Text of ${i}, and [a derived name](#details).`,
      "",
      "## Details",
      "",
      "More.",
      "",
    ].join("\n");
    files[`runs/r${i}.json`] = JSON.stringify({
      doc: `../docs/d${i}.md#intro`,
      steps: [{ name: "build" }, { name: i % 5 === 0 ? "build" : "test" }],
    });
  }
  return files;
}

describe("a check over the local index (the guard of the cache)", () => {
  test("parses no record the second time, and after one record changes, parses and binds exactly that one", async () => {
    const files = linkedStore(50);
    const cache = createMemoryIndexCache();
    const expected = await (await storeOf(files)).check();
    const first = await counted(async () => {
      const outcome = await (await storeOf(files, cache)).check();
      expect(shown(outcome.issues)).toEqual(shown(expected.issues));
    });
    expect(first.parsed).toHaveLength(50);
    const second = await counted(async () => {
      const outcome = await (await storeOf(files, cache)).check();
      expect(outcome).toEqual(expected);
    });
    expect(second).toEqual({ parsed: [], bound: [] });
    const changed = { ...files, "runs/r3.json": JSON.stringify({ doc: "../docs/d9.md#nothing", steps: [] }) };
    const expectedChanged = await (await storeOf(changed)).check();
    const third = await counted(async () => {
      const outcome = await (await storeOf(changed, cache)).check();
      expect(outcome).toEqual(expectedChanged);
    });
    expect(third).toEqual({ parsed: ["runs/r3.json"], bound: ["runs/r3.json"] });
  });

  test("re-parses nothing when only the configuration's issues change, and the severities follow the new one", async () => {
    const files = linkedStore(10);
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const quieter = {
      ...files,
      ".vmd/config.yaml": `${files[".vmd/config.yaml"]}issues:\n  ref-derived-anchor: off\n  ref-aliased: error\n`,
    };
    const expected = await (await storeOf(quieter)).check();
    expect(expected.issues.some((issue) => issue.code === "ref-derived-anchor")).toBe(false);
    const run = await counted(async () => {
      const outcome = await (await storeOf(quieter, cache)).check();
      expect(outcome).toEqual(expected);
    });
    expect(run).toEqual({ parsed: [], bound: [] });
  });

  test("binds again, from a new parse, exactly the records of a collection whose schema changed", async () => {
    const files = linkedStore(10);
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const stricter = {
      ...files,
      ".vmd/schema/run.schema.json": JSON.stringify({ ...JSON.parse(RUN_SCHEMA), required: ["missing"] }),
    };
    const expected = await (await storeOf(stricter)).check();
    const run = await counted(async () => {
      const outcome = await (await storeOf(stricter, cache)).check();
      expect(outcome).toEqual(expected);
    });
    const runs = Object.keys(files)
      .filter((path) => path.startsWith("runs/"))
      .sort();
    expect(run).toEqual({ parsed: runs, bound: runs });
  });

  test("keys an entry by the version of the bytes it parsed, not by the version a listing gave before a change", async () => {
    const files = linkedStore(4);
    const before = files["docs/d0.md"] as string;
    const after = `${before}\nAn edit.\n`;
    const current = createMemoryStorage({ files: { ...files, "docs/d0.md": after } });
    const stale = await gitBlobId(new TextEncoder().encode(before));
    // The listing still gives the old version; the read gives the new bytes.
    const backend: StorageReader = {
      ...current,
      list: async (query) => {
        const listed = await current.list(query);
        if (!listed.ok) return listed;
        const items = listed.value.items.map((file) => (file.path === "docs/d0.md" ? { ...file, version: stale } : file));
        return { ...listed, value: { ...listed.value, items } };
      },
      stat: (path) => current.stat(path),
      read: (path, options) => current.read(path, options),
      grep: (query) => current.grep(query),
      head: () => current.head(),
    };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache, backend)).check();
    const fresh = await gitBlobId(new TextEncoder().encode(after));
    expect(cache.entries.has(`parse/${fresh}.md`)).toBe(true);
    expect(cache.entries.has(`parse/${stale}.md`)).toBe(false);
  });

  test("reads a corrupt entry as a miss: it parses again, and reports what a check without the index does", async () => {
    const files = linkedStore(4);
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const version = await gitBlobId(new TextEncoder().encode(files["docs/d0.md"] as string));
    const key = `parse/${version}.md`;
    const entry = cache.entries.get(key) as Uint8Array;
    // Claims the record has no node but its root: a forged entry cut at a row boundary, without its closing count.
    const firstLine = new TextDecoder().decode(entry).split("\n")[0] as string;
    cache.entries.set(key, new TextEncoder().encode(`${firstLine}\n`));
    const expected = await (await storeOf(files)).check();
    const run = await counted(async () => {
      const outcome = await (await storeOf(files, cache)).check();
      expect(outcome).toEqual(expected);
    });
    expect(run.parsed).toEqual(["docs/d0.md"]);
  });
});

describe("the snapshot of a full check", () => {
  /** A store whose records point at `a.md`'s nodes. */
  const config = 'vmd: 1\ncollections:\n  notes:\n    match: ["n/*.md"]\n    schema: n.json\n';
  const files: Files = {
    ".vmd/config.yaml": config,
    ".vmd/schema/n.json": "{}",
    "n/one.md": "# One\n",
    "a.md":
      '# A\n\n## Intro <a id="intro"></a>\n\n<a id="para"></a>A paragraph.\n\n### Deep <a id="deep"></a>\n\nText.\n\n## Other\n',
    "b.md": "# B\n\n[1](a.md#intro) [2](a.md#deep) [3](a.md#para) [4](a.md) [5](a.md#nothing) [6](a.md#intro)\n",
    "c.md": "# C\n\n[7](a.md#deep)\n",
  };

  test("is written by a check of the whole store, and not by a check of some records", async () => {
    const scoped = createMemoryIndexCache();
    await (await storeOf(files, scoped)).check({ records: ["b.md"] });
    expect(scoped.entries.has(SNAPSHOT_KEY)).toBe(false);
    const whole = createMemoryIndexCache();
    await (await storeOf(files, whole)).check();
    expect(whole.entries.has(SNAPSHOT_KEY)).toBe(true);
  });

  /** The refs-in counts an outline of `a.md` gives, by address, or null where it gives none. */
  async function counts(store: Store): Promise<Record<string, number | undefined> | null> {
    const outline = successValue(await store.outline("a.md"));
    const entries = [outline.node, ...outline.sections, ...outline.sections.flatMap((section) => section.blocks ?? [])];
    if (entries.every((entry) => entry.refsIn === undefined)) return null;
    return Object.fromEntries(entries.map((entry) => [entry.address, entry.refsIn]));
  }

  test("gives outline the refs-in counts while it is current: each node's references, those below it included", async () => {
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    expect(await counts(await storeOf(files, cache))).toEqual({
      // Every reference into a.md that reaches a node, the dangling #nothing left out.
      "": 6,
      // #intro, #para in its $body, #deep below it twice, and #intro again.
      "#intro": 5,
      "#para": 1,
      "#deep": 2,
      "#other": 0,
    });
  });

  test("is not current once a file, the configuration, a schema or the alias file changes, and outline gives no counts", async () => {
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const changes: Files[] = [
      { ...files, "c.md": "# C\n" },
      Object.fromEntries(Object.entries(files).filter(([path]) => path !== "c.md")),
      { ...files, "d.png": "image" },
      { ...files, ".vmd/config.yaml": `${config}uniqueness: lenient\n` },
      { ...files, ".vmd/schema/n.json": '{"type": "object"}' },
      { ...files, ".vmd/aliases.jsonl": '{"kind": "record", "from": "old.md", "to": "a.md", "at": "2026-10-09T08:00:00Z"}\n' },
    ];
    for (const changed of changes) expect(await counts(await storeOf(changed, cache))).toBeNull();
    // The near miss: the unchanged store still has them.
    expect(await counts(await storeOf(files, cache))).not.toBeNull();
  });

  test("writes the parse entry of the record an outline reads, so that a check after it does not parse it", async () => {
    const cache = createMemoryIndexCache();
    successValue(await (await storeOf(files, cache)).outline("a.md"));
    const run = await counted(async () => (await storeOf(files, cache)).check());
    expect(run.parsed).not.toContain("a.md");
    expect(run.parsed).toContain("b.md");
  });

  test("gives no counts without the index", async () => {
    expect(await counts(await storeOf(files))).toBeNull();
  });
});

describe("a listing over the local index", () => {
  const files: Files = {
    ".vmd/config.yaml": "vmd: 1\n",
    "a.md": "# A\n",
    "b.json": "{",
    "c.md": "# C\n",
    "d.json": "[",
    "e.md": "# E\n",
  };

  test("counts the unreadable records of the whole store, every page, and says so", async () => {
    const page = successValue(await (await storeOf(files, createMemoryIndexCache())).list({ limit: 2 }));
    expect(page.items.map((item) => item.path)).toEqual(["a.md", "b.json"]);
    expect(page.unreadable).toEqual({ count: 2, scope: "store" });
  });

  test("counts only the page without the index", async () => {
    const page = successValue(await (await storeOf(files)).list({ limit: 2 }));
    expect(page.unreadable).toEqual({ count: 1, scope: "page" });
  });

  test("counts the records its glob matches, on every page", async () => {
    const page = successValue(await (await storeOf(files, createMemoryIndexCache())).list({ glob: "*.json", limit: 1 }));
    expect(page.unreadable).toEqual({ count: 2, scope: "store" });
  });

  test("parses nothing the second time, the page's records included", async () => {
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).list({ limit: 2 });
    const run = await counted(async () => {
      const page = successValue(await (await storeOf(files, cache)).list({ limit: 2 }));
      expect(page.items.map((item) => item.readable)).toEqual([true, false]);
    });
    expect(run.parsed).toEqual([]);
  });

  test("reports a file the backend cannot read once, though both the page and the whole listing meet it", async () => {
    const backend = createMemoryStorage({ files: { ...files, "b.json": { content: "{}", unreadable: true } } });
    const outcome = await (await storeOf({}, createMemoryIndexCache(), backend)).list({ limit: 2 });
    const failed = outcome.issues.filter((issue) => issue.code === "storage-failed");
    expect(failed.map((issue) => issue.path)).toEqual(["b.json"]);
    expect(successValue(outcome).unreadable).toEqual({ count: 2, scope: "store" });
  });

  test("writes the entries of what it parses, so that a check after it parses nothing", async () => {
    const cache: MemoryIndexCache = createMemoryIndexCache();
    await (await storeOf(files, cache)).list({ limit: 1 });
    const run = await counted(async () => (await storeOf(files, cache)).check());
    expect(run.parsed).toEqual([]);
  });
});

// From the independent review of #153.
describe("the local index against what a store without it gives", () => {
  const TYPED: Files = {
    ".vmd/config.yaml": 'vmd: 1\ncollections:\n  refs:\n    match: ["refs/*.yaml"]\n    schema: r.schema.json\n',
    ".vmd/schema/r.schema.json": JSON.stringify({
      properties: { see: { type: "string", format: "uri-reference", "x-vmd-ref": {} } },
    }),
    "refs/a.yaml": "see: ../docs/b.md\n",
    "docs/b.md": "# B\n",
  };

  test("a typed reference's members come in the same order, so its JSON is the same", async () => {
    const expected = successValue(await (await storeOf(TYPED)).references());
    const cache = createMemoryIndexCache();
    await (await storeOf(TYPED, cache)).check();
    const warm = successValue(await (await storeOf(TYPED, cache)).references());
    expect(JSON.stringify(warm)).toBe(JSON.stringify(expected));
  });

  test("a stale listing never makes a binding entry of the listed version stand for the bytes read", async () => {
    const before = "see: ../docs/gone.md\n";
    const after = "see: ../docs/c.md\n";
    const files = { ...TYPED, "docs/c.md": "# C\n", "refs/a.yaml": before };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const stale = await gitBlobId(new TextEncoder().encode(before));
    // The binding entry of the old bytes stays; their parse entry is gone, so the store must parse what it reads.
    cache.entries.delete(`parse/${stale}.yaml`);
    const current = createMemoryStorage({ files: { ...files, "refs/a.yaml": after } });
    const backend: StorageReader = {
      ...current,
      list: async (query) => {
        const listed = await current.list(query);
        if (!listed.ok) return listed;
        const items = listed.value.items.map((file) => (file.path === "refs/a.yaml" ? { ...file, version: stale } : file));
        return { ...listed, value: { ...listed.value, items } };
      },
      stat: (path) => current.stat(path),
      read: (path, options) => current.read(path, options),
      grep: (query) => current.grep(query),
      head: () => current.head(),
    };
    const expected = await successValue(await openStore(backend)).check();
    expect(await successValue(await openStore(backend, { index: cache })).check()).toEqual(expected);
  });

  test("a well-formed parse entry whose node path disagrees with its parent and key is a miss, not a crash", async () => {
    const files = { ".vmd/config.yaml": "vmd: 1\n", "a.json": '{"a": 1}' };
    const version = await gitBlobId(new TextEncoder().encode(files["a.json"]));
    const rows = [
      { t: "parse", format: "json", readable: true },
      { t: "node", at: "", parent: null, key: null, kind: "section", range: [0, 8], depth: 0 },
      { t: "node", at: "/zzz", parent: "", key: "a", kind: "number", range: [6, 7], member: [1, 7] },
    ];
    const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n${JSON.stringify({ t: "end", rows: rows.length })}\n`;
    const cache = createMemoryIndexCache();
    cache.entries.set(`parse/${version}.json`, new TextEncoder().encode(text));
    const expected = await (await storeOf(files)).check();
    expect(await (await storeOf(files, cache)).check()).toEqual(expected);
  });

  test("a snapshot whose target has no string path is not current, not a crash", async () => {
    const files = { ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n\n## B\n", "b.md": "# B\n\n[x](a.md#b)\n" };
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const snapshot = new TextDecoder().decode(cache.entries.get(SNAPSHOT_KEY));
    const forged = snapshot.replace('"at":"/$sections/0"', '"at":5');
    expect(forged).not.toBe(snapshot);
    cache.entries.set(SNAPSHOT_KEY, new TextEncoder().encode(forged));
    const outline = successValue(await (await storeOf(files, cache)).outline("a.md"));
    expect(outline.node.refsIn).toBeUndefined();
    // A reference row dropped, the closing count left as written: cut short, so not current either.
    const lines = snapshot.split("\n");
    const firstReference = lines.findIndex((line) => line.startsWith('{"t":"ref"'));
    const shorter = lines.filter((_, index) => index !== firstReference);
    cache.entries.set(SNAPSHOT_KEY, new TextEncoder().encode(shorter.join("\n")));
    expect(successValue(await (await storeOf(files, cache)).outline("a.md")).node.refsIn).toBeUndefined();
    // The near miss: the snapshot as written gives the counts.
    cache.entries.set(SNAPSHOT_KEY, new TextEncoder().encode(snapshot));
    expect(successValue(await (await storeOf(files, cache)).outline("a.md")).node.refsIn).toBe(1);
  });

  test("reads no entry for a record the store has parsed already, so one store holds one version of it", async () => {
    const files = linkedStore(4);
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const store = await storeOf(files, cache);
    successValue(await store.outline("docs/d0.md"));
    cache.log.length = 0;
    await store.check();
    const version = await gitBlobId(new TextEncoder().encode(files["docs/d0.md"] as string));
    expect(cache.log).not.toContain(`read parse/${version}.md`);
    // The near miss: a record it has not parsed is read from its entry.
    const other = await gitBlobId(new TextEncoder().encode(files["docs/d1.md"] as string));
    expect(cache.log).toContain(`read parse/${other}.md`);
  });
});

describe("a cache's bound on its entries", () => {
  const files: Files = {
    ".vmd/config.yaml": "vmd: 1\n",
    "small.md": "# Small\n",
    "dense.json": `{"a":[${Array.from({ length: 2000 }, () => "0").join(",")}]}`,
    "b.md": "# B\n\n[s](small.md)\n",
  };

  test("leaves out the entry of a record past the bound, and writes the others", async () => {
    const cache = createMemoryIndexCache({ maxEntryBytes: 16 * 1024 });
    await (await storeOf(files, cache)).check();
    const keys = [...cache.entries.keys()];
    const dense = await gitBlobId(new TextEncoder().encode(files["dense.json"] as string));
    const small = await gitBlobId(new TextEncoder().encode(files["small.md"] as string));
    expect(keys).toContain(`parse/${small}.md`);
    expect(keys).not.toContain(`parse/${dense}.json`);
    expect([...cache.entries.values()].every((entry) => entry.length <= 16 * 1024)).toBe(true);
  });

  test("writes no entry many times its record's size, which would cost more memory to read than the parse", async () => {
    const cache = createMemoryIndexCache();
    await (await storeOf(files, cache)).check();
    const dense = await gitBlobId(new TextEncoder().encode(files["dense.json"] as string));
    expect([...cache.entries.keys()]).not.toContain(`parse/${dense}.json`);
    // The near miss: the small record's entry, under 64 KiB, is written though it is many times its record too.
    const small = await gitBlobId(new TextEncoder().encode(files["small.md"] as string));
    expect([...cache.entries.keys()]).toContain(`parse/${small}.md`);
  });

  test("reads an entry past the cache's bound as a miss, and parses the record", async () => {
    const dense = files["dense.json"] as string;
    const key = `parse/${await gitBlobId(new TextEncoder().encode(dense))}.json`;
    // An entry another writer kept, larger than this record's own bound.
    const entry = parseEntry(parseRecord("dense.json", new TextEncoder().encode(dense)), "dense.json") as Uint8Array;
    const near = createMemoryIndexCache({ maxEntryBytes: entry.length });
    near.entries.set(key, entry);
    // The near miss: at the bound, it is read, and the record is not parsed.
    expect((await counted(async () => (await storeOf(files, near)).check())).parsed).not.toContain("dense.json");
    const tight = createMemoryIndexCache({ maxEntryBytes: entry.length - 1 });
    tight.entries.set(key, entry);
    expect((await counted(async () => (await storeOf(files, tight)).check())).parsed).toContain("dense.json");
  });

  test("writes no snapshot past the bound", async () => {
    const roomy = createMemoryIndexCache();
    await (await storeOf(files, roomy)).check();
    const snapshot = roomy.entries.get(SNAPSHOT_KEY) as Uint8Array;
    const read = readSnapshot(snapshot);
    if (read === null) expect.fail("the snapshot reads");
    expect(snapshotRows(read, snapshot.length)).toEqual(snapshot);
    expect(snapshotRows(read, snapshot.length - 1)).toBeNull();
  });

  test("counts a snapshot's bytes, not its characters, against the bound", () => {
    const snapshot = { inputs: "x", files: new Map([["é".repeat(100), "v"]]), references: [] };
    const rows = snapshotRows(snapshot) as Uint8Array;
    const characters = new TextDecoder().decode(rows).length;
    expect(rows.length).toBeGreaterThan(characters + 50);
    expect(snapshotRows(snapshot, rows.length)).toEqual(rows);
    // Within the bound by its characters, past it by its bytes.
    expect(snapshotRows(snapshot, characters)).toBeNull();
  });

  test("reads a snapshot past the bound as absent", async () => {
    const roomy = createMemoryIndexCache();
    await (await storeOf(files, roomy)).check();
    const snapshot = roomy.entries.get(SNAPSHOT_KEY) as Uint8Array;
    const near = createMemoryIndexCache({ maxEntryBytes: snapshot.length });
    near.entries.set(SNAPSHOT_KEY, snapshot);
    // The near miss: at the bound, it is read.
    expect(successValue(await (await storeOf(files, near)).outline("small.md")).node.refsIn).toBe(1);
    const tight = createMemoryIndexCache({ maxEntryBytes: snapshot.length - 1 });
    tight.entries.set(SNAPSHOT_KEY, snapshot);
    expect(successValue(await (await storeOf(files, tight)).outline("small.md")).node.refsIn).toBeUndefined();
  });
});

describe("an entry holding characters outside the Basic Multilingual Plane", () => {
  test("is written whole and read back, so that a second check parses nothing", async () => {
    const files: Files = {
      ".vmd/config.yaml": "vmd: 1\n",
      // An astral character in a link's destination, its raw text and the prose: four UTF-8 bytes, two UTF-16 units.
      "a.md": "# A 😀\n\nSee [m](other-😀.md) and 𝄞 here.\n",
      "other-😀.md": "# Other\n",
    };
    const cache = createMemoryIndexCache();
    const expected = await (await storeOf(files)).check();
    await (await storeOf(files, cache)).check();
    const run = await counted(async () => {
      const outcome = await (await storeOf(files, cache)).check();
      expect(JSON.stringify(outcome)).toBe(JSON.stringify(expected));
    });
    expect(run.parsed).toEqual([]);
  });
});
