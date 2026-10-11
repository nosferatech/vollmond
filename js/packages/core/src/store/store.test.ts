import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage, type MemoryFile } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { openStore, type Store } from "./store.js";

const CONFIG = "vmd: 1\n";

const GUIDE = `# Guide

Intro text.

## Install

Run it.

- <a id="step"></a>First step.
- Second step.

### Linux

Use the package.

## Use

`;

const DATA = '{"status": "open", "$sections": [{"$title": "Notes", "$body": "Some notes."}]}';

/** The files of the tests' store. */
const FILES: Readonly<Record<string, string | Uint8Array | MemoryFile>> = {
  ".vmd/config.yaml": CONFIG,
  "docs/guide.md": GUIDE,
  "data.json": DATA,
  "image.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  ".gitignore": "dist\n",
  "docs/.draft.md": "# Draft\n",
};

/** Returns the value of a successful outcome, and fails the test with its issues otherwise. */
function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** Returns the codes of a failed outcome's issues, and fails the test when it succeeded. */
function codesOf(outcome: Outcome<unknown>): string[] {
  expect(outcome.ok).toBe(false);
  return outcome.issues.map((issue) => issue.code);
}

/** A backend that counts the reads of each path. */
function countingBackend(files: Readonly<Record<string, string | Uint8Array | MemoryFile>>): {
  readonly backend: StorageReader;
  readonly reads: Map<string, number>;
} {
  const inner = createMemoryStorage({ files });
  const reads = new Map<string, number>();
  const backend: StorageReader = {
    list: (query) => inner.list(query),
    stat: (path) => inner.stat(path),
    read: (path, options) => {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      return inner.read(path, options);
    },
    grep: (query) => inner.grep(query),
    head: () => inner.head(),
    history: inner.history,
  };
  return { backend, reads };
}

async function storeOf(files = FILES): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files })));
}

describe("openStore", () => {
  test("reads the backend's .vmd/config.yaml, or the configuration it is given", async () => {
    expect((await storeOf()).configuration.vmd).toBe(1);
    const given = await openStore(createMemoryStorage({ files: { "a.md": "# A\n" } }), {
      config: new TextEncoder().encode(CONFIG),
    });
    expect(successValue(given).configuration.vmd).toBe(1);
  });

  test("fails with config-invalid without a configuration, and with the configuration's issues", async () => {
    expect(codesOf(await openStore(createMemoryStorage({ files: { "a.md": "# A\n" } })))).toEqual(["config-invalid"]);
    expect(codesOf(await openStore(createMemoryStorage({ files: { ".vmd/config.yaml": "vmd: 2\n" } })))).toEqual([
      "format-version-unsupported",
    ]);
  });

  test("fails with storage-failed when the backend cannot read the configuration", async () => {
    const files = { ".vmd/config.yaml": { content: CONFIG, unreadable: true } };
    expect(codesOf(await openStore(createMemoryStorage({ files })))).toEqual(["storage-failed"]);
  });
});

describe("Store.record", () => {
  test("gives null for an asset, an ignored path and a missing file", async () => {
    const store = await storeOf();
    expect(await store.record("image.png")).toBeNull();
    expect(await store.record("docs/.draft.md")).toBeNull();
    expect(await store.record("missing.md")).toBeNull();
  });

  test("fails with a record's structural errors, and with storage-failed for a record the backend cannot read", async () => {
    const store = await storeOf({ ...FILES, "bad.json": "{", "locked.md": { content: "# L\n", unreadable: true } });
    expect(codesOf((await store.record("bad.json")) as Outcome<unknown>)).toEqual(["syntax-error"]);
    expect(codesOf((await store.record("locked.md")) as Outcome<unknown>)).toEqual(["storage-failed"]);
  });

  test("reads each record once, however many operations need it", async () => {
    const { backend, reads } = countingBackend(FILES);
    const store = successValue(await openStore(backend));
    successValue(await store.get("docs/guide.md#install"));
    successValue(await store.outline("docs/guide.md"));
    successValue(await store.get("docs/guide.md#step", { form: "source", meta: "all" }));
    await Promise.all([store.record("data.json"), store.record("data.json")]);
    expect(reads.get("docs/guide.md")).toBe(1);
    expect(reads.get("data.json")).toBe(1);
    expect(store.recordRead("docs/guide.md")?.ok).toBe(true);
    expect(store.recordRead("never-read.md")).toBeUndefined();
  });
});

describe("Store.get", () => {
  test("gives the value view by default", async () => {
    const store = await storeOf();
    expect(successValue(await store.get("data.json#status"))).toEqual({ value: "open" });
    expect(successValue(await store.get("data.json#notes"))).toEqual({ value: { $title: "Notes", $body: "Some notes." } });
  });

  test("gives a section's source from its heading line to the next heading of its level, as bytes of the file", async () => {
    const store = await storeOf();
    const install = GUIDE.slice(GUIDE.indexOf("## Install"), GUIDE.indexOf("## Use"));
    expect(successValue(await store.get("docs/guide.md#install", { form: "source" })).value).toBe(install);
    expect(successValue(await store.get("docs/guide.md", { form: "source" })).value).toBe(GUIDE);
    expect(successValue(await store.get("data.json#status", { form: "source" })).value).toBe('"open"');
  });

  test("gives a section's $body for the body form, the empty string for none, and a block's text", async () => {
    const store = await storeOf();
    expect(successValue(await store.get("docs/guide.md#linux", { form: "body" })).value).toBe("Use the package.");
    expect(successValue(await store.get("docs/guide.md#use", { form: "body" })).value).toBe("");
    expect(successValue(await store.get("docs/guide.md#install/$body", { form: "body" })).value).toMatch(/^Run it\./);
    expect(successValue(await store.get("docs/guide.md#step", { form: "body" })).value).toBe('- <a id="step"></a>First step.');
    expect(successValue(await store.get("docs/guide.md#step")).value).toBe('- <a id="step"></a>First step.');
  });

  test("gives a block anchor's source as its block in the file", async () => {
    const store = await storeOf();
    expect(successValue(await store.get("docs/guide.md#step", { form: "source" })).value).toBe('- <a id="step"></a>First step.');
  });

  test("fails with address-not-found for the body of a node that is not a section", async () => {
    const store = await storeOf();
    expect(codesOf(await store.get("data.json#status", { form: "body" }))).toEqual(["address-not-found"]);
  });

  test("gives the requested computed fields beside the value", async () => {
    const store = await storeOf();
    const result = successValue(await store.get("docs/guide.md#install", { meta: ["@address", "@depth", "@refs"] }));
    expect(result.meta).toEqual({ "@address": "#install", "@depth": 1 });
    const all = successValue(await store.get("docs/guide.md#step", { meta: "all" }));
    expect(all.meta?.["@range"]).toBeDefined();
    expect(all.meta?.["@anchors"]).toEqual([{ name: "step", kind: "block" }]);
  });

  test("fails as resolving does: a missing record, a malformed address, an ambiguous one", async () => {
    const store = await storeOf({ ...FILES, "twin.md": "# T\n\n## Notes\n\n## Notes\n" });
    expect(codesOf(await store.get("nothing.md"))).toEqual(["address-not-found"]);
    expect(codesOf(await store.get("image.png"))).toEqual(["address-not-found"]);
    expect(codesOf(await store.get("data.json#a b"))).toEqual(["address-malformed"]);
    expect(successValue(await store.get("data.json#notes", { reading: { raw: true } })).value).toBeDefined();
    const ambiguous = await store.get("twin.md#notes");
    expect(codesOf(ambiguous)).toEqual(["address-ambiguous"]);
    expect(ambiguous.issues[0]?.candidates?.map((target) => target.at)).toEqual(["/$sections/0", "/$sections/1"]);
  });
});

describe("Store.outline", () => {
  test("lists every section below the node with its address, key, title, depth and size", async () => {
    const store = await storeOf();
    const outline = successValue(await store.outline("docs/guide.md"));
    expect(outline.path).toBe("docs/guide.md");
    expect(outline.node).toEqual({ at: "", address: "", title: "Guide", depth: 0, size: GUIDE.length });
    // A section's range holds the sections below it.
    const install = GUIDE.slice(GUIDE.indexOf("## Install"), GUIDE.indexOf("## Use")).length;
    const linux = GUIDE.slice(GUIDE.indexOf("### Linux"), GUIDE.indexOf("## Use")).length;
    expect(outline.sections).toEqual([
      { at: "/$sections/0", address: "#install", key: "install", title: "Install", depth: 1, size: install },
      { at: "/$sections/0/$sections/0", address: "#install/linux", key: "linux", title: "Linux", depth: 2, size: linux },
      { at: "/$sections/1", address: "#use", key: "use", title: "Use", depth: 1, size: "## Use\n\n".length },
    ]);
  });

  test("goes down at most `depth` levels below the node", async () => {
    const store = await storeOf();
    const titles = async (address: string, depth?: number) =>
      successValue(await store.outline(address, depth === undefined ? {} : { depth })).sections.map((entry) => entry.title);
    expect(await titles("docs/guide.md", 1)).toEqual(["Install", "Use"]);
    expect(await titles("docs/guide.md", 0)).toEqual([]);
    expect(await titles("docs/guide.md#install", 1)).toEqual(["Linux"]);
    expect(await titles("docs/guide.md#install")).toEqual(["Linux"]);
    await expect(store.outline("docs/guide.md", { depth: -1 })).rejects.toThrow(RangeError);
  });

  test("gives a node that is not a section, and a block anchor, without sections", async () => {
    const store = await storeOf();
    expect(successValue(await store.outline("data.json#status"))).toEqual({
      path: "data.json",
      node: { at: "/status", address: "#status", size: 6 },
      sections: [],
    });
    const block = successValue(await store.outline("docs/guide.md#step"));
    expect(block.node).toEqual({ at: "/$sections/0/$body", address: "#step", size: '- <a id="step"></a>First step.'.length });
  });
});

describe("Store.list", () => {
  test("lists records and assets, leaving out .vmd/ and dotfiles, which are not counted either", async () => {
    const store = await storeOf();
    const page = successValue(await store.list({ limit: 100 }));
    expect(page.items.map((entry) => [entry.path, entry.kind, entry.readable])).toEqual([
      ["data.json", "record", true],
      ["docs/guide.md", "record", true],
      ["image.png", "asset", undefined],
    ]);
    const first = successValue(await store.list({ limit: 1 }));
    expect(first.remaining).toEqual({ count: 2, exact: true });
    expect(successValue(await store.list({ glob: "docs/**", limit: 10 })).items.map((entry) => entry.path)).toEqual([
      "docs/guide.md",
    ]);
  });

  test("counts the records it could not read on the page only", async () => {
    // "b.json" is on the first page, "d.json" on the second.
    const store = await storeOf({
      ".vmd/config.yaml": CONFIG,
      "a.md": "# A\n",
      "b.json": "{",
      "c.md": "# C\n",
      "d.json": "[1]",
    });
    const listed = await store.list({ limit: 3 });
    const first = successValue(listed);
    expect(first.items.map((entry) => entry.readable)).toEqual([true, false, true]);
    expect(first.unreadable).toEqual({ count: 1, scope: "page" });
    // The structural error is counted, not reported: it is the record's.
    expect(listed.issues).toEqual([]);
    const second = successValue(await store.list({ limit: 3, cursor: first.cursor as string }));
    expect(second.unreadable).toEqual({ count: 1, scope: "page" });
  });

  test("counts a record the backend cannot read, and reports its storage-failed", async () => {
    const store = await storeOf({ ".vmd/config.yaml": CONFIG, "a.md": { content: "# A\n", unreadable: true }, "b.png": "x" });
    const outcome = await store.list({ limit: 10 });
    expect(successValue(outcome).unreadable.count).toBe(1);
    expect(outcome.issues.map((issue) => issue.code)).toEqual(["storage-failed"]);
  });
});

describe("Store.grep", () => {
  test("searches records and assets, leaving out .vmd/ and dotfiles", async () => {
    const store = await storeOf({ ...FILES, "notes.txt": "dist here\n" });
    const page = successValue(await store.grep({ pattern: "dist", mode: "literal", context: 0, limit: 10 }));
    expect(page.items.map((match) => match.path)).toEqual(["notes.txt"]);
  });
});
