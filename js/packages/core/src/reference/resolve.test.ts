// The resolver's work against the store: what it lists and looks up, and what it reads of the aliases.

import { describe, expect, test } from "vitest";
import { PathClassifier } from "../config/classify.js";
import { readStoreConfiguration } from "../config/configuration.js";
import { parseRecord } from "../format/parse-record.js";
import type { Outcome } from "../issue/outcome.js";
import type { ParsedRecord } from "../record/record.js";
import { createMemoryStorage, type MemoryFile } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { openStore } from "../store/store.js";
import { type AliasTable, readAliases } from "./aliases.js";
import { ReferenceResolver } from "./resolve.js";

type Files = Readonly<Record<string, string | Uint8Array | MemoryFile>>;

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

const CONFIG = "vmd: 1\n";
const at = "2026-10-09T08:00:00Z";
const encode = (text: string) => new TextEncoder().encode(text);
const aliasFile = (...lines: object[]) => `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;

/** A backend that counts the store-wide listings, the items listings give, the listings below a path, and the reads. */
function countingBackend(files: Files) {
  const inner = createMemoryStorage({ files });
  const counts = { storeListings: 0, listedItems: 0, prefixListings: 0, stats: 0, reads: 0 };
  const backend: StorageReader = {
    list: async (query) => {
      if (query.prefix === "") counts.storeListings += 1;
      else counts.prefixListings += 1;
      const page = await inner.list(query);
      if (page.ok) counts.listedItems += page.value.items.length;
      return page;
    },
    stat: (path) => {
      counts.stats += 1;
      return inner.stat(path);
    },
    read: (path, options) => {
      counts.reads += 1;
      return inner.read(path, options);
    },
    grep: (query) => inner.grep(query),
    head: () => inner.head(),
    history: inner.history,
  };
  return { backend, counts };
}

/** A resolver over parsed records that exist in no listing beyond themselves, with `aliases`. */
function resolverOver(texts: Readonly<Record<string, string>>, aliases: AliasTable) {
  const classifier = new PathClassifier(successValue(readStoreConfiguration(encode(CONFIG))));
  const records = new Map<string, ParsedRecord>();
  for (const [path, text] of Object.entries(texts)) records.set(path, successValue(parseRecord(path, encode(text))));
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
    aliases,
  );
  return { resolver, records };
}

describe("the files a resolver resolves against", () => {
  const files: Record<string, string> = {
    ".vmd/config.yaml": 'vmd: 1\nignore: ["big/**"]\n',
    "docs/a.md":
      "# A\n\n[x](../big/0001.txt) [y](../big/none.txt) [z](b.md) [d](../big/) [w](../big/0001.txt#a) [m](missing.md)\n",
    "docs/b.md": "# B\n",
  };
  for (let n = 0; n < 2000; n++) files[`big/${String(n).padStart(4, "0")}.txt`] = "x";

  test("are the check's own listing without the ignored tree, each ignored file a reference names looked up once", async () => {
    const { backend, counts } = countingBackend(files);
    const store = successValue(await openStore(backend));
    const checked = await store.check();
    expect(checked.issues.map((issue) => `${issue.code} ${issue.message}`)).toEqual([
      expect.stringMatching(/^ref-dangling .*big\/none\.txt/),
      expect.stringMatching(/^ref-dangling .*docs\/missing\.md/),
    ]);
    expect(counts.storeListings).toBe(1);
    expect(counts.listedItems).toBeLessThan(10);
    // One stat each for big/0001.txt, named twice, and big/none.txt; none for docs/missing.md, which is not ignored.
    expect(counts.stats).toBe(2);
    // A path missing from the listing is looked up as a directory, below it, once each: big/, big/none.txt/ and
    // docs/missing.md/.
    expect(counts.prefixListings).toBe(3);
  });

  test("are listed once, without the ignored tree, for a read that asks for @refs", async () => {
    const { backend, counts } = countingBackend(files);
    const store = successValue(await openStore(backend));
    const read = successValue(await store.get("docs/a.md", { meta: ["@refs"] }));
    expect(read.meta?.["@refs"]?.map((reference) => reference.status)).toEqual(["ok", "dangling", "ok", "ok", "ok", "dangling"]);
    expect(counts.storeListings).toBe(1);
    expect(counts.listedItems).toBeLessThan(10);
  });

  test("include a directory that holds only files vmd ignores, by a dotfile or by a pattern, looked up once", async () => {
    const { backend, counts } = countingBackend({
      ".vmd/config.yaml": 'vmd: 1\nignore: ["drafts/*.tmp"]\n',
      "assets/.gitkeep": "",
      "drafts/a.tmp": "x",
      "docs/a.md": "# A\n\n[e](../assets/) [f](../assets) [g](../drafts/) [h](../drafts) [i](../assets/)\n",
    });
    const store = successValue(await openStore(backend));
    const refs = successValue(await store.references({ from: "docs/a.md" }));
    expect(refs.map((reference) => reference.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(refs[0]?.targets).toEqual([{ path: "assets", kind: "directory" }]);
    expect(counts.prefixListings).toBe(2);
    // Its near miss: a directory with nothing below it, not even an ignored file, is dangling.
    const plain = successValue(
      await openStore(createMemoryStorage({ files: { ".vmd/config.yaml": CONFIG, "docs/a.md": "# A\n\n[e](../none/)\n" } })),
    );
    const empty = successValue(await plain.references({ from: "docs/a.md" }));
    expect(empty.map((reference) => reference.status)).toEqual(["dangling"]);
  });
});

describe("the aliases a resolver reads", () => {
  const cycle = [
    { kind: "record", from: "docs/a.md", to: "docs/b.md", at },
    { kind: "record", from: "docs/b.md", to: "docs/c.md", at },
    { kind: "record", from: "docs/c.md", to: "docs/a.md", at },
  ];

  test("end a cycle of record aliases within a walk of the entries' length, the loop's own bounds failing by assertion", async () => {
    const table = successValue(readAliases(encode(aliasFile(...cycle))));
    let moves = 0;
    const bounded: AliasTable = {
      ...table,
      entries: table.entries,
      recordMove: (path) => {
        moves += 1;
        if (moves > 1000) throw new Error("the walk of a record alias chain did not end");
        return table.recordMove(path);
      },
    };
    const { resolver, records } = resolverOver({ "docs/r.md": "# R\n\n[x](a.md)\n" }, bounded);
    const [reference] = await resolver.referencesOf(records.get("docs/r.md") as ParsedRecord);
    expect(reference?.status).toBe("dangling");
    expect(moves).toBeLessThanOrEqual(cycle.length + 1);
  });

  test("end a cycle of anchor aliases within a walk of the entries' length, the loop's own bounds failing by assertion", async () => {
    const loop = [
      { kind: "anchor", record: "docs/c.md", from: "a", to: "b", at },
      { kind: "anchor", record: "docs/c.md", from: "b", to: "c", at },
      { kind: "anchor", record: "docs/c.md", from: "c", to: "a", at },
    ];
    const table = successValue(readAliases(encode(aliasFile(...loop))));
    let renames = 0;
    const bounded: AliasTable = {
      ...table,
      entries: table.entries,
      anchorRename: (paths, name) => {
        renames += 1;
        if (renames > 1000) throw new Error("the walk of an anchor alias chain did not end");
        return table.anchorRename(paths, name);
      },
    };
    const texts = { "docs/r.md": "# R\n\n[x](c.md#a)\n", "docs/c.md": "# Loop\n\n## Other\n" };
    const { resolver, records } = resolverOver(texts, bounded);
    const [reference] = await resolver.referencesOf(records.get("docs/r.md") as ParsedRecord);
    expect(reference?.status).toBe("dangling");
    expect(renames).toBeLessThanOrEqual(loop.length + 1);
  });

  test("give alias-shadowed by one lookup per record, without walking the entries", async () => {
    const lines = Array.from({ length: 200 }, (_, n) => ({ kind: "record", from: `old/${n}.md`, to: "docs/r.md", at }));
    const table = successValue(readAliases(encode(aliasFile(...lines))));
    let walked = 0;
    const counted: AliasTable = {
      ...table,
      get entries() {
        walked += 1;
        return table.entries;
      },
    };
    const texts: Record<string, string> = {};
    for (let n = 0; n < 50; n++) texts[`docs/${n}.md`] = "# R\n\n## Notes\n";
    const { resolver, records } = resolverOver(texts, counted);
    for (const [path, record] of records) await resolver.issuesOf(path, record);
    expect(walked).toBe(0);
  });
});
