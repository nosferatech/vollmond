// The findings of #99's review: the listing of ignored trees, prose past the Markdown limits, link reference definitions in
// data titles, a byte order mark in the alias file, the cost of alias-shadowed, and the cases its mutations showed missing.

import { describe, expect, test } from "vitest";
import { PathClassifier } from "../config/classify.js";
import { readStoreConfiguration } from "../config/configuration.js";
import { parseRecord } from "../format/parse-record.js";
import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import type { ParsedRecord } from "../record/record.js";
import { createMemoryStorage, type MemoryFile } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { openStore, type Store } from "../store/store.js";
import { type AliasTable, readAliases } from "./aliases.js";
import type { Reference } from "./reference.js";
import { ReferenceResolver } from "./resolve.js";
import { resolveReferenceUri } from "./uri.js";

type Files = Readonly<Record<string, string | Uint8Array | MemoryFile>>;

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

const CONFIG = "vmd: 1\n";
const at = "2026-10-09T08:00:00Z";
const aliasFile = (...lines: object[]) => `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;

async function storeOf(files: Files): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files: { ".vmd/config.yaml": CONFIG, ...files } })));
}

async function refsOf(store: Store, from: string): Promise<Reference[]> {
  return [...successValue(await store.references({ from }))];
}

const codes = (reference: Reference | undefined) => (reference?.issues ?? []).map((issue) => issue.code);

/** A backend that counts what its listings give and how often each path is read or stated. */
function countingBackend(files: Files): {
  backend: StorageReader;
  listed: () => number;
  looked: () => number;
  listings: () => number;
  stats: () => number;
} {
  const inner = createMemoryStorage({ files });
  let listed = 0;
  let looked = 0;
  let listings = 0;
  let stats = 0;
  const backend: StorageReader = {
    list: async (query) => {
      if (query.prefix === "") listings += 1;
      const page = await inner.list(query);
      if (page.ok) listed += page.value.items.length;
      return page;
    },
    stat: (path) => {
      looked += 1;
      stats += 1;
      return inner.stat(path);
    },
    read: (path, options) => {
      looked += 1;
      return inner.read(path, options);
    },
    grep: (query) => inner.grep(query),
    head: () => inner.head(),
    history: inner.history,
  };
  return { backend, listed: () => listed, looked: () => looked, listings: () => listings, stats: () => stats };
}

describe("B1: the files references are resolved against", () => {
  const files: Record<string, string> = {
    ".vmd/config.yaml": 'vmd: 1\nignore: ["big/**"]\n',
    "docs/a.md":
      "# A\n\n[x](../big/0001.txt) [y](../big/none.txt) [z](b.md) [d](../big/) [w](../big/0001.txt#a) [m](missing.md)\n",
    "docs/b.md": "# B\n",
  };
  for (let n = 0; n < 2000; n++) files[`big/${String(n).padStart(4, "0")}.txt`] = "x";

  test("are the listing without the ignored paths, an ignored target looked up on its own", async () => {
    const counted = countingBackend(files);
    const store = successValue(await openStore(counted.backend));
    const checked = await store.check();
    expect(checked.issues.map((issue) => `${issue.code} ${issue.message}`)).toEqual([
      expect.stringMatching(/^ref-dangling .*big\/none\.txt/),
      expect.stringMatching(/^ref-dangling .*docs\/missing\.md/),
    ]);
    // The check lists the store once, without the ignored tree, and looks up each ignored file a reference names once, and
    // no path that is not ignored, such as docs/missing.md.
    expect(counted.listings()).toBe(1);
    expect(counted.listed()).toBeLessThan(10);
    expect(counted.stats()).toBe(2);
    expect(counted.looked()).toBeLessThan(20);
  });

  test("are listed once for a read that asks for @refs, without the ignored tree", async () => {
    const counted = countingBackend(files);
    const store = successValue(await openStore(counted.backend));
    const read = successValue(await store.get("docs/a.md", { meta: ["@refs"] }));
    expect(read.meta?.["@refs"]?.map((reference) => reference.status)).toEqual(["ok", "dangling", "ok", "ok", "ok", "dangling"]);
    expect(counted.listed()).toBeLessThan(10);
  });
});

describe("S1: a JSON or YAML $body past the Markdown limits", () => {
  // Deviation recorded in issue #24: such a $body gives no references and no issue, which the specification leaves open.
  test("gives no references and raises nothing, today", async () => {
    const deep = `${"> ".repeat(300)}[x](gone.md)`;
    const store = await storeOf({ "docs/d.json": JSON.stringify({ $body: deep }) });
    expect(await refsOf(store, "docs/d.json")).toEqual([]);
    expect((await store.check()).issues).toEqual([]);
  });
});

describe("S2: a data $title's links, with the record's link reference definitions in scope", () => {
  test("read [a][b](c.md) as a reference to the definition of b, as a Markdown heading does", async () => {
    const store = await storeOf({
      "docs/t.json": JSON.stringify({ $title: "[a][b](c.md)", $body: "Text.\n\n[b]: d.md\n" }),
      "docs/t.md": "# [a][b](c.md)\n\nText.\n\n[b]: d.md\n",
      "docs/d.md": "# D\n",
    });
    const raws = async (from: string) => (await refsOf(store, from)).map((reference) => `${reference.form} ${reference.raw}`);
    expect(await raws("docs/t.md")).toEqual(["definition d.md"]);
    expect(await raws("docs/t.json")).toEqual(["definition d.md"]);
  });
});

describe("S3: an alias file with a byte order mark", () => {
  test("is read past the mark, as every file vmd reads", async () => {
    const line = JSON.stringify({ kind: "record", from: "docs/old.md", to: "docs/b.md", at });
    const store = await storeOf({ ".vmd/aliases.jsonl": `﻿${line}\n`, "docs/a.md": "# A\n\n[x](old.md)\n", "docs/b.md": "# B\n" });
    const [reference] = await refsOf(store, "docs/a.md");
    expect(reference?.status).toBe("aliased");
    // Its near miss: a mark anywhere else is not white space, so the file is not JSON Lines.
    expect(readAliases(new TextEncoder().encode(`${line}\n﻿${line}\n`)).ok).toBe(false);
  });
});

describe("S4: the cases the review's mutations showed missing", () => {
  test("m04: alias-shadowed for a derived anchor alone, as a re-added title has", async () => {
    const store = await storeOf({
      ".vmd/aliases.jsonl": aliasFile({ kind: "anchor", record: "docs/r.md", from: "notes", to: "remarks", at }),
      "docs/r.md": "# R\n\n## Notes\n\n## Remarks\n",
    });
    const shadowed = (await store.check()).issues.filter((issue) => issue.code === "alias-shadowed");
    expect(shadowed.map((issue) => `${issue.path} ${issue.at}`)).toEqual(["docs/r.md /$sections/0"]);
  });

  test("m06: the title-derived warnings look at the first step, not the last", async () => {
    const store = await storeOf({
      "docs/g.md": '# G\n\n## Plain\n\n## Done <a id="done"></a>\n\n### Sub\n',
      "docs/a.md": "# A\n\n[a](g.md#plain/$title) [b](g.md#done/sub)\n",
    });
    const [first, second] = await refsOf(store, "docs/a.md");
    expect(codes(first)).toEqual(["ref-derived-anchor"]);
    expect(codes(second)).toEqual([]);
  });

  test("m07: a record alias chain stops at the first live path", async () => {
    const store = await storeOf({
      ".vmd/aliases.jsonl": aliasFile(
        { kind: "record", from: "docs/a.md", to: "docs/b.md", at },
        { kind: "record", from: "docs/b.md", to: "docs/c.md", at },
      ),
      "docs/b.md": "# B\n",
      "docs/c.md": "# C\n",
      "docs/r.md": "# R\n\n[x](a.md)\n",
    });
    const [reference] = await refsOf(store, "docs/r.md");
    expect(reference).toMatchObject({ status: "aliased", targets: [{ path: "docs/b.md", at: "", address: "" }] });
  });

  test("m09: a path's escaped U+FEFF is a character of the path, not a mark the decoder drops", () => {
    expect(resolveReferenceUri("a.md", "%EF%BB%BFx.md")).toEqual({
      kind: "store",
      path: "﻿x.md",
      directory: false,
      fragment: null,
    });
  });

  test("m14: an anchor alias whose record is not a store path makes the file invalid", () => {
    const line = JSON.stringify({ kind: "anchor", record: "../a.md", from: "x", to: "y", at });
    const read = readAliases(new TextEncoder().encode(`${line}\n`));
    expect(read.ok).toBe(false);
    expect(read.issues[0]?.message).toMatch(/record that is not a store path/);
  });

  test("m01: a cycle of record aliases ends by the number of entries, as well as by the paths seen", async () => {
    const store = await storeOf({
      ".vmd/aliases.jsonl": aliasFile(
        { kind: "record", from: "docs/a.md", to: "docs/b.md", at },
        { kind: "record", from: "docs/b.md", to: "docs/c.md", at },
        { kind: "record", from: "docs/c.md", to: "docs/a.md", at },
      ),
      "docs/r.md": "# R\n\n[x](a.md)\n",
    });
    const [reference] = await refsOf(store, "docs/r.md");
    expect(reference?.status).toBe("dangling");
  });
});

describe("S5: alias-shadowed's cost", () => {
  test("is a lookup per record, without walking the alias entries", async () => {
    const lines = Array.from({ length: 200 }, (_, n) => ({ kind: "record", from: `old/${n}.md`, to: "docs/r.md", at }));
    const table = successValue(readAliases(new TextEncoder().encode(aliasFile(...lines))));
    let walked = 0;
    const counted: AliasTable = {
      ...table,
      get entries() {
        walked += 1;
        return table.entries;
      },
    };
    const configuration = successValue(readStoreConfiguration(new TextEncoder().encode(CONFIG)));
    const classifier = new PathClassifier(configuration);
    const records = new Map<string, ParsedRecord>();
    for (let n = 0; n < 50; n++) {
      const path = `docs/${n}.md`;
      records.set(path, successValue(parseRecord(path, new TextEncoder().encode("# R\n\n## Notes\n"))));
    }
    const resolver = new ReferenceResolver(
      {
        classify: (path) => classifier.classify(path),
        record: async (path) => {
          const record = records.get(path);
          return record === undefined ? null : { ok: true, value: record, issues: [] };
        },
        exists: async () => false,
      },
      [...records.keys()],
      counted,
    );
    for (const [path, record] of records) await resolver.issuesOf(path, record);
    expect(walked).toBe(0);
  });
});

describe("O3 and Q4: messages and directory targets", () => {
  test("O3: an encoded dot segment is named in the message", () => {
    const resolved = resolveReferenceUri("docs/a.md", "%2E%2E/x.md");
    expect(resolved.kind).toBe("invalid");
    expect(resolved.kind === "invalid" && resolved.message).toMatch(/%2E%2E/);
  });
});

describe("B1: what the backend cannot read", () => {
  const LOCKED = (path: string) => makeIssue({ code: "storage-failed", path, at: null, message: `${path}: permission denied` });

  /** A backend over `files` that cannot read the paths of `locked`, and lists those it would list with a storage-failed. */
  function lockedBackend(files: Files, locked: readonly string[]): StorageReader {
    const inner = createMemoryStorage({ files });
    return {
      list: async (query) => {
        const page = await inner.list(query);
        if (!page.ok) return page;
        const items = page.value.items.filter((item) => !locked.includes(item.path));
        const failed = page.value.items.filter((item) => locked.includes(item.path)).map((item) => LOCKED(item.path));
        return succeed({ ...page.value, items }, [...page.issues, ...failed]);
      },
      stat: async (path) => (locked.includes(path) ? fail([LOCKED(path)]) : inner.stat(path)),
      read: async (path, options) => (locked.includes(path) ? fail([LOCKED(path)]) : inner.read(path, options)),
      grep: (query) => inner.grep(query),
      head: () => inner.head(),
      history: inner.history,
    };
  }

  test("a file check lists but cannot read is there: unreadable below its root", async () => {
    const files = {
      ".vmd/config.yaml": CONFIG,
      "docs/a.md": "# A\n\n[x](locked.md#part)\n",
      "docs/locked.md": "# L\n\n## Part\n",
    };
    const store = successValue(await openStore(lockedBackend(files, ["docs/locked.md"])));
    const issues = (await store.check({ records: ["docs/a.md"] })).issues;
    expect(issues.map((issue) => issue.code)).toEqual(["ref-target-unreadable"]);
  });

  test("an ignored file the backend cannot read is there", async () => {
    const files = {
      ".vmd/config.yaml": 'vmd: 1\nignore: ["big/**"]\n',
      "docs/a.md": "# A\n\n[x](../big/locked.txt)\n",
      "big/locked.txt": "x",
    };
    const store = successValue(await openStore(lockedBackend(files, ["big/locked.txt"])));
    const [reference] = await refsOf(store, "docs/a.md");
    expect(reference?.status).toBe("ok");
  });

  test("an alias file the backend cannot read stops check with the backend's issue", async () => {
    const files = { ".vmd/config.yaml": CONFIG, ".vmd/aliases.jsonl": "", "docs/a.md": "# A\n" };
    const checked = await successValue(await openStore(lockedBackend(files, [".vmd/aliases.jsonl"]))).check();
    expect(checked.ok).toBe(false);
    expect(checked.issues.map((issue) => issue.code)).toEqual(["storage-failed"]);
  });
});
