// References in a store: what each resolves to, its status and its issues, the aliases, and the warnings.

import { describe, expect, test } from "vitest";
import type { Issue } from "../issue/issue.js";
import { makeIssue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { fail, succeed } from "../issue/outcome.js";
import { createMemoryStorage, type MemoryFile } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { openStore, type Store } from "../store/store.js";
import type { Reference } from "./reference.js";

type Files = Readonly<Record<string, string | Uint8Array | MemoryFile>>;

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

const GUIDE = [
  "# Guide",
  "",
  "## Install",
  "",
  '- <a id="step"></a>First step.',
  "",
  '## What was done <a id="done"></a>',
  "",
  "## Notes",
  "",
  "### Notes",
  "",
  "## Usage",
  "",
  "### Notes",
  "",
].join("\n");

const BASE: Files = {
  ".vmd/config.yaml": 'vmd: 1\ncollections:\n  refused:\n    match: ["refused/*.md"]\n    schema: missing.schema.json\n',
  "docs/guide.md": GUIDE,
  "docs/twin.md": "# Twin\n\n## Notes\n\n## Notes\n",
  "docs/img/logo.png": new Uint8Array([0x89, 0x50]),
  "docs/.hidden.md": "# Hidden\n",
  "data/broken.json": '{"a": 1, "a": 2}',
  "data/ok.json": '{"a": {"b": 1}, "$sections": [{"$title": "Notes"}, {"$title": "Done", "$anchor": "done"}]}',
  "refused/r.md": "# R\n\n## Part\n",
};

async function storeOf(files: Files): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files: { ...BASE, ...files } })));
}

/** The references of `docs/r.md` holding `text`, as `raw status`, with each target and each issue's code. */
async function refsOf(text: string, files: Files = {}, path = "docs/r.md"): Promise<Reference[]> {
  const store = await storeOf({ ...files, [path]: text });
  return [...successValue(await store.references({ from: path }))];
}

/** The one reference of a record holding `[x](target)`. */
async function one(target: string, files: Files = {}): Promise<Reference> {
  const refs = await refsOf(`# R\n\n[x](${target})\n`, files);
  expect(refs).toHaveLength(1);
  return refs[0] as Reference;
}

const codes = (reference: Reference) => reference.issues.map((issue: Issue) => `${issue.code} ${issue.severity}`);

describe("a reference's status and targets", () => {
  test("ok: a record's root, a node, a block anchor, the citing record's own node", async () => {
    expect(await one("guide.md")).toMatchObject({
      status: "ok",
      targets: [{ path: "docs/guide.md", at: "", address: "" }],
      issues: [],
    });
    expect(await one("guide.md#done")).toMatchObject({
      status: "ok",
      targets: [{ path: "docs/guide.md", at: "/$sections/1", address: "#done" }],
      issues: [],
    });
    expect((await one("guide.md#step")).targets).toEqual([
      { path: "docs/guide.md", at: "/$sections/0/$body", address: "#step", range: { start: 0, end: 30 } },
    ]);
    expect((await one("/data/ok.json#/a/b")).targets).toEqual([{ path: "data/ok.json", at: "/a/b", address: "#a/b" }]);
    expect((await refsOf("# R\n\n## Here\n\n[x](#here)\n"))[0]).toMatchObject({
      status: "ok",
      targets: [{ path: "docs/r.md", at: "/$sections/0", address: "#here" }],
    });
  });

  test("ok: an asset, an ignored file and a directory exist by their paths, and their fragment is not looked at", async () => {
    expect(await one("img/logo.png#anything")).toMatchObject({
      status: "ok",
      targets: [{ path: "docs/img/logo.png", kind: "asset" }],
    });
    expect((await one(".hidden.md#nothing")).targets).toEqual([{ path: "docs/.hidden.md", kind: "asset" }]);
    expect((await one("img/")).targets).toEqual([{ path: "docs/img", kind: "directory" }]);
    expect((await one("img")).targets).toEqual([{ path: "docs/img", kind: "directory" }]);
    expect((await one("../")).targets).toEqual([{ path: "", kind: "directory" }]);
  });

  test("dangling: nothing at the path, no node in the record, a fragment that is not an address, a path that does not decode", async () => {
    for (const target of [
      "gone.md",
      "gone/",
      "guide.md/",
      "guide.md#nothing",
      "guide.md#a%20%zz",
      "caf%E9.md",
      "guide.md#/x~2",
    ]) {
      const reference = await one(target);
      expect(reference.status, target).toBe("dangling");
      expect(reference.targets, target).toEqual([]);
      expect(codes(reference), target).toEqual(["ref-dangling error"]);
    }
    expect((await one("guide.md#nothing")).issues[0]?.message).toMatch(/matches no node/);
    expect((await one("caf%E9.md")).issues[0]?.message).toMatch(/does not decode/);
    expect((await one("guide.md#a%20%zz")).issues[0]?.message).toMatch(/is not an address/);
  });

  test("ambiguous: a singular reference whose step matches several nodes, with them as its targets", async () => {
    const reference = await one("twin.md#notes");
    expect(reference.status).toBe("ambiguous");
    expect(reference.targets).toEqual([
      { path: "docs/twin.md", at: "/$sections/0", address: "#/$sections/0" },
      { path: "docs/twin.md", at: "/$sections/1", address: "#notes-1" },
    ]);
    expect(codes(reference)).toEqual(["ref-ambiguous error"]);
    expect(reference.issues[0]?.candidates).toEqual(reference.targets);
    // Its near miss: the second's derived anchor names it alone.
    expect((await one("twin.md#notes-1")).status).toBe("ok");
  });

  test("unreadable: a fragment into a record with a structural error, or of a collection whose schema cannot be used", async () => {
    for (const target of ["/data/broken.json#a", "/refused/r.md#part"]) {
      const reference = await one(target);
      expect(reference, target).toMatchObject({ status: "unreadable", targets: [] });
      expect(codes(reference), target).toEqual(["ref-target-unreadable warning"]);
    }
    // Its near misses: the record itself, with no fragment or `#` alone, names a file that exists.
    for (const target of ["/data/broken.json", "/data/broken.json#", "/refused/r.md"]) {
      const reference = await one(target);
      expect(reference, target).toMatchObject({ status: "ok", issues: [] });
      expect(reference.targets, target).toEqual([
        { path: target.slice(1, target.indexOf("#") < 0 ? undefined : -1), at: "", address: "" },
      ]);
    }
  });

  test("leaves out references that leave the store: a scheme, an authority, a path above the root", async () => {
    const refs = await refsOf("# R\n\n[a](https://x.y/a.md) [b](//host/b.md) [c](../../c.md) [d](mailto:a@b.c) [e](guide.md)\n");
    expect(refs.map((reference) => reference.raw)).toEqual(["guide.md"]);
  });

  test("locates each issue at the reference: the $body or $title that holds a link, with its offset, or the $ref object", async () => {
    const refs = await refsOf("# R [t](gone.md)\n\nSee [b](gone.md).\n", { "data/x.yaml": "" });
    expect(refs.map((reference) => reference.issues[0])).toMatchObject([
      { code: "ref-dangling", path: "docs/r.md", at: "/$title", offset: 2, position: { line: 1, col: 9 } },
      { code: "ref-dangling", path: "docs/r.md", at: "/$body", offset: 4, position: { line: 3, col: 9 } },
    ]);
    const object = await refsOf('{"a": [{"$ref": "gone.md#x"}]}', {}, "docs/o.json");
    expect(object[0]).toMatchObject({ form: "ref-object", at: "/a/0", raw: "gone.md#x", status: "dangling" });
    expect(object[0]?.issues[0]).toMatchObject({ code: "ref-dangling", path: "docs/o.json", at: "/a/0" });
    expect(object[0]?.issues[0]).not.toHaveProperty("offset");
  });
});

describe("references in JSON and YAML", () => {
  test("are the $ref objects in field values, wherever they stand, and the links of $body and $title strings", async () => {
    const yaml = [
      "$schema: {$ref: not-looked-into.md}",
      "parent: {$ref: guide.md#done}",
      "list:",
      "  - {$ref: '../data/ok.json'}",
      '  - nested: {$ref: "img/"}',
      "notref: {$ref: guide.md, other: 1}",
      "$title: Notes on [the guide](guide.md)",
      "$body: |",
      "  First line.",
      "  See ![logo](img/logo.png) and [r][d].",
      "",
      "  [d]: guide.md#install",
      "$sections:",
      "  - $title: Part",
      "    field: {$ref: twin.md}",
      "",
    ].join("\n");
    const store = await storeOf({ "docs/y.yaml": yaml });
    // `notref` is a $ref object with another member, a structural error, so the record has no references to give.
    expect((await store.references({ from: "docs/y.yaml" })).ok).toBe(false);
    const valid = yaml.replace("notref: {$ref: guide.md, other: 1}\n", "");
    const refs = [...successValue(await (await storeOf({ "docs/y.yaml": valid })).references({ from: "docs/y.yaml" }))];
    const body = "First line.\nSee ![logo](img/logo.png) and [r][d].\n\n[d]: guide.md#install\n";
    expect(refs.map(({ form, at, offset, raw, status }) => ({ form, at, offset, raw, status }))).toEqual([
      { form: "ref-object", at: "/parent", offset: undefined, raw: "guide.md#done", status: "ok" },
      { form: "ref-object", at: "/list/0", offset: undefined, raw: "../data/ok.json", status: "ok" },
      { form: "ref-object", at: "/list/1/nested", offset: undefined, raw: "img/", status: "ok" },
      { form: "link", at: "/$title", offset: 9, raw: "guide.md", status: "ok" },
      { form: "image", at: "/$body", offset: body.indexOf("!"), raw: "img/logo.png", status: "ok" },
      { form: "definition", at: "/$body", offset: body.indexOf("[d]:"), raw: "guide.md#install", status: "ok" },
      { form: "ref-object", at: "/$sections/0/field", offset: undefined, raw: "twin.md", status: "ok" },
    ]);
    // A $ref string written plainly in the file has its range there; one in quotes has the range inside them.
    const [parent, quoted] = refs;
    const bytes = new TextEncoder().encode(valid);
    const slice = (range?: { start: number; end: number }) =>
      range === undefined ? undefined : new TextDecoder().decode(bytes.subarray(range.start, range.end));
    expect(slice(parent?.destination)).toBe("guide.md#done");
    expect(slice(quoted?.destination)).toBe("../data/ok.json");
    expect(refs[3]).not.toHaveProperty("destination");
  });

  test("give a link's offset in a JSON $body in UTF-8 bytes of the string, escapes read", async () => {
    const refs = await refsOf('{"$body": "\\u00dcber [x](gone.md)", "$title": "\\u00e9 [t](guide.md)"}', {}, "docs/j.json");
    expect(refs.map(({ at, offset, raw }) => ({ at, offset, raw }))).toEqual([
      { at: "/$body", offset: 6, raw: "gone.md" },
      { at: "/$title", offset: 3, raw: "guide.md" },
    ]);
  });

  test("give a link's offset in a $body that starts with U+FEFF, which the value holds", async () => {
    const refs = await refsOf('{"$body": "\\ufeff[x](gone.md)"}', {}, "docs/j.json");
    expect(refs.map(({ offset }) => offset)).toEqual([3]);
  });

  test("give the references in a node and below it, not those of a node whose path only starts like it", async () => {
    const sections = Array.from({ length: 11 }, (_, n) => `{"$title": "S${n}", "f": {"g": {"$ref": "r${n}.md"}}}`);
    const store = await storeOf({ "docs/s.json": `{"$sections": [${sections.join(", ")}]}` });
    const raws = async (from: string) => successValue(await store.references({ from })).map((reference) => reference.raw);
    expect(await raws("docs/s.json#/$sections/1")).toEqual(["r1.md"]);
    expect(await raws("docs/s.json#/$sections/10/f/g")).toEqual(["r10.md"]);
    expect(await raws("docs/s.json#/$sections/10/f")).toEqual(["r10.md"]);
  });

  test("give a $title's links across its lines, which a heading's inline content joins", async () => {
    const refs = await refsOf('{"$title": "One\\n[t](guide.md)"}', {}, "docs/j.json");
    expect(refs.map(({ offset, raw }) => ({ offset, raw }))).toEqual([{ offset: 4, raw: "guide.md" }]);
  });
});

describe("aliases", () => {
  const alias = (...lines: object[]) => ({ ".vmd/aliases.jsonl": `${lines.map((line) => JSON.stringify(line)).join("\n")}\n` });
  const at = "2026-10-09T08:00:00Z";

  test("resolve a reference to a moved record, through a chain, as aliased with ref-aliased", async () => {
    const files = alias(
      { kind: "record", from: "docs/old.md", to: "docs/older.md", at },
      { kind: "record", from: "docs/older.md", to: "docs/guide.md", at },
    );
    const reference = await one("old.md#done", files);
    expect(reference).toMatchObject({
      status: "aliased",
      targets: [{ path: "docs/guide.md", at: "/$sections/1", address: "#done" }],
    });
    expect(codes(reference)).toEqual(["ref-aliased warning"]);
    // Its near miss: a path that exists is never resolved through an alias.
    const live = await one("twin.md", alias({ kind: "record", from: "docs/twin.md", to: "docs/guide.md", at }));
    expect(live).toMatchObject({ status: "ok", targets: [{ path: "docs/twin.md" }] });
  });

  test("resolve a renamed anchor's first step in the record found, the other steps kept", async () => {
    const files = alias({ kind: "anchor", record: "data/ok.json", from: "old", to: "a", at });
    const reference = await one("/data/ok.json#old/b", files);
    expect(reference).toMatchObject({ status: "aliased", targets: [{ path: "data/ok.json", at: "/a/b" }] });
    // Both kinds: the record moved, and the anchor was renamed in the record it moved to.
    const both = alias(
      { kind: "record", from: "data/was.json", to: "data/ok.json", at },
      { kind: "anchor", record: "data/ok.json", from: "old", to: "a", at },
    );
    expect((await one("/data/was.json#old/b", both)).status).toBe("aliased");
    // Its near miss: an alias of another record does not apply.
    const other = alias({ kind: "anchor", record: "docs/guide.md", from: "old", to: "a", at });
    expect((await one("/data/ok.json#old/b", other)).status).toBe("dangling");
  });

  // A cycle of record aliases is tested on the resolver, whose alias table can stop a walk that does not end.
  test("leave a reference dangling when the aliases lead nowhere, and take the last of two", async () => {
    const nowhere = alias({ kind: "record", from: "docs/old.md", to: "docs/gone.md", at });
    const dangling = await one("old.md", nowhere);
    expect(codes(dangling)).toEqual(["ref-dangling error"]);
    // The issue says what the reference names, not where its alias leads.
    expect(dangling.issues[0]?.message).toMatch(/no file docs\/old\.md$/);
    const twice = alias(
      { kind: "record", from: "docs/old.md", to: "docs/twin.md", at },
      { kind: "record", from: "docs/old.md", to: "docs/guide.md", at },
    );
    expect((await one("old.md", twice)).targets).toEqual([{ path: "docs/guide.md", at: "", address: "" }]);
  });

  test("warn with alias-shadowed about a live record path or anchor that an alias has as its old name", async () => {
    const files = alias(
      { kind: "record", from: "docs/twin.md", to: "docs/guide.md", at },
      { kind: "anchor", record: "docs/guide.md", from: "step", to: "done", at },
      { kind: "anchor", record: "docs/guide.md", from: "gone", to: "done", at },
    );
    const store = await storeOf(files);
    const shadowed = (await store.check()).issues.filter((issue) => issue.code === "alias-shadowed");
    expect(shadowed.map(({ path, at: node, severity, offset }) => ({ path, at: node, severity, offset }))).toEqual([
      { path: "docs/guide.md", at: "/$sections/0/$body", severity: "warning", offset: 0 },
      { path: "docs/twin.md", at: "", severity: "warning", offset: undefined },
    ]);
  });

  test("warn once about a node whose explicit and derived anchors both have an alias's old name", async () => {
    const files = alias({ kind: "anchor", record: "docs/k.md", from: "kept", to: "other", at });
    const store = await storeOf({ ...files, "docs/k.md": '# K\n\n## Kept <a id="kept"></a>\n' });
    const shadowed = (await store.check()).issues.filter((issue) => issue.code === "alias-shadowed");
    expect(shadowed.map((issue) => `${issue.path} ${issue.at}`)).toEqual(["docs/k.md /$sections/0"]);
  });
});

describe("the alias file", () => {
  const at = "2026-10-09T08:00:00Z";
  const valid = `{"kind": "record", "from": "a.md", "to": "b.md", "at": "${at}"}`;

  test("stops check and the reads that resolve references when it is not JSON Lines of alias entries", async () => {
    const invalid = [
      "not json",
      "[1]",
      `${valid}\n\n${valid}`,
      `{"kind": "record", "from": "a.md", "to": "b.md"}`,
      `{"kind": "record", "from": "a.md", "to": "b.md", "at": "${at}", "extra": 1}`,
      `{"kind": "record", "from": "a.md", "from": "c.md", "to": "b.md", "at": "${at}"}`,
      `{"kind": "move", "from": "a.md", "to": "b.md", "at": "${at}"}`,
      `{"kind": "record", "from": "../a.md", "to": "b.md", "at": "${at}"}`,
      `{"kind": "record", "from": "a.md", "to": 1, "at": "${at}"}`,
      `{"kind": "anchor", "record": "a.md", "from": "has space", "to": "b", "at": "${at}"}`,
      `{"kind": "anchor", "from": "a", "to": "b", "at": "${at}"}`,
    ];
    for (const content of invalid) {
      const store = await storeOf({ ".vmd/aliases.jsonl": content, "docs/r.md": "# R\n" });
      const checked = await store.check();
      expect(checked.ok, content).toBe(false);
      expect(
        checked.issues.map((issue) => `${issue.code} ${issue.path} ${issue.at}`),
        content,
      ).toEqual(["alias-file-invalid null null"]);
      expect((await store.references()).ok, content).toBe(false);
    }
    expect((await (await storeOf({ ".vmd/aliases.jsonl": "x\n" })).check()).issues[0]?.message).toMatch(/line 1 /);
    expect((await (await storeOf({ ".vmd/aliases.jsonl": `${valid}\nx` })).check()).issues[0]?.message).toMatch(/line 2 /);
    expect((await (await storeOf({ ".vmd/aliases.jsonl": `${valid}\n\n` })).check()).issues[0]?.message).toMatch(
      /line 2 is empty/,
    );
  });

  test("reads LF and CRLF lines, with or without a final line break, and an empty file", async () => {
    const anchor = `{"kind": "anchor", "record": "a.md", "from": "x", "to": "y-1", "at": "${at}"}`;
    for (const content of ["", `${valid}`, `${valid}\n`, `${valid}\r\n${anchor}\r\n`, `${anchor}\n${valid}`]) {
      const checked = await (await storeOf({ ".vmd/aliases.jsonl": content })).check();
      expect(checked.ok, JSON.stringify(content)).toBe(true);
    }
  });
});

describe("the warnings of references through titles", () => {
  test("ref-derived-anchor: a first step that matched only through a title, a derived anchor or a title's key", async () => {
    expect(codes(await one("guide.md#install"))).toEqual(["ref-derived-anchor warning"]);
    expect(codes(await one("guide.md#what-was-done"))).toEqual(["ref-derived-anchor warning"]);
    expect(codes(await one("guide.md#usage"))).toEqual(["ref-derived-anchor warning"]);
    expect(codes(await one("/data/ok.json#notes"))).toEqual(["ref-derived-anchor warning"]);
    // Its near misses: an explicit anchor, a block anchor, a key from $anchor, a field, an exact path, a later step only.
    for (const target of ["guide.md#done", "guide.md#step", "/data/ok.json#done", "/data/ok.json#a/b", "guide.md#/$sections/0"]) {
      expect(codes(await one(target)), target).toEqual([]);
    }
    expect(codes(await one("guide.md#done/$title"))).toEqual([]);
  });

  test("ref-derived-repeat: through a title whose slug another heading of the record has, suffixed or not", async () => {
    for (const target of ["guide.md#notes", "guide.md#notes-1", "guide.md#notes-2", "twin.md#notes-1"]) {
      expect(codes(await one(target)), target).toEqual(["ref-derived-repeat warning"]);
    }
    const json = '{"$sections": [{"$title": "Notes"}, {"$title": "Other", "$sections": [{"$title": "Notes"}]}]}';
    expect(codes(await one("/data/j.json#notes", { "data/j.json": json }))).toEqual(["ref-derived-repeat warning"]);
    // Its near miss: a slug that only starts like another.
    expect(codes(await one("guide.md#usage"))).toEqual(["ref-derived-anchor warning"]);
  });

  test("warn about an aliased reference through a title too", async () => {
    const files = { ".vmd/aliases.jsonl": `{"kind": "record", "from": "docs/old.md", "to": "docs/guide.md", "at": "x"}\n` };
    expect(codes(await one("old.md#install", files))).toEqual(["ref-aliased warning", "ref-derived-anchor warning"]);
  });
});

describe("Store.references", () => {
  test("gives every readable record's references without from, leaving out records that cannot be read", async () => {
    const store = await storeOf({
      "docs/a.md": "# A\n\n[x](b.md)\n",
      "docs/b.md": "# B [y](a.md)\n",
      "docs/c.md": "---\na: [\n---\n",
    });
    const refs = successValue(await store.references());
    expect(refs.map((reference) => `${reference.from.path} ${reference.raw}`)).toEqual(["docs/a.md b.md", "docs/b.md a.md"]);
  });

  test("gives the references in a node and below it, or in a block, and fails as resolving the address does", async () => {
    const store = await storeOf({
      "docs/n.md": '# N [t](a.md)\n\n<a id="p"></a>[x](a.md)\n\n[y](b.md)\n\n## S\n\n[z](c.md)\n',
    });
    const raws = async (from: string) => successValue(await store.references({ from })).map((reference) => reference.raw);
    expect(await raws("docs/n.md")).toEqual(["a.md", "a.md", "b.md", "c.md"]);
    expect(await raws("docs/n.md#s")).toEqual(["c.md"]);
    expect(await raws("docs/n.md#p")).toEqual(["a.md"]);
    expect(await raws("docs/n.md#/$body")).toEqual(["a.md", "b.md"]);
    expect((await store.references({ from: "docs/broken.md" })).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
    expect((await store.references({ from: "data/broken.json" })).issues.map((issue) => issue.code)).toEqual([
      "duplicate-member",
    ]);
    expect((await store.references({ from: "refused/r.md" })).issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
  });
});

describe("the store's files, for references", () => {
  test("are listed page by page", async () => {
    const files: Record<string, string> = {};
    for (let n = 0; n < 1001; n++) files[`many/${String(n).padStart(4, "0")}.txt`] = "x";
    expect((await one("../many/1000.txt", files)).status).toBe("ok");
  });

  test("include a file the backend listed but could not read, which exists, though it cannot be resolved below its root", async () => {
    const LOCKED = makeIssue({ code: "storage-failed", path: "docs/locked.md", at: null, message: "permission denied" });
    const inner = createMemoryStorage({ files: { ...BASE, "docs/r.md": "# R\n\n[a](locked.md) [b](locked.md#x)\n" } });
    const backend: StorageReader = {
      ...inner,
      list: async (query) => {
        const page = await inner.list(query);
        if (!page.ok) return page;
        return succeed(page.value, [...page.issues, LOCKED]);
      },
      read: async (path, options) => (path === "docs/locked.md" ? fail([LOCKED]) : inner.read(path, options)),
      stat: (path) => inner.stat(path),
      grep: (query) => inner.grep(query),
      head: () => inner.head(),
    };
    const store = successValue(await openStore(backend));
    const refs = successValue(await store.references({ from: "docs/r.md" }));
    expect(refs.map((reference) => reference.status)).toEqual(["ok", "unreadable"]);
  });
});

describe("Store.check and references", () => {
  test("reports each record's reference issues in scope, resolving into every record of the store", async () => {
    const store = await storeOf({
      "docs/a.md": "# A\n\n[x](gone.md) [y](guide.md#done)\n",
      "docs/b.md": "# B\n\n[z](gone.md)\n",
    });
    const scoped = (await store.check({ records: ["docs/a.md"] })).issues.filter((issue) => issue.code.startsWith("ref-"));
    expect(scoped.map((issue) => `${issue.code} ${issue.path} ${issue.at} ${issue.offset}`)).toEqual([
      "ref-dangling docs/a.md /$body 0",
    ]);
    // A record of a collection whose schema cannot be used is checked for its references too, as for everything else.
    const refused = await storeOf({ "refused/s.md": "# S\n\n[x](gone.md)\n" });
    const issues = (await refused.check({ records: ["refused/s.md"] })).issues;
    expect(issues.map((issue) => issue.code)).toEqual(["schema-invalid", "ref-dangling"]);
  });

  test("applies the configuration's severities to reference warnings", async () => {
    const config = "vmd: 1\nissues:\n  ref-derived-anchor: error\n  ref-target-unreadable: off\n";
    const store = await storeOf({
      ".vmd/config.yaml": config,
      "docs/a.md": "# A\n\n[x](guide.md#install) [y](../data/broken.json#a)\n",
    });
    const issues = (await store.check({ records: ["docs/a.md"] })).issues;
    expect(issues.map((issue) => `${issue.code} ${issue.severity}`)).toEqual(["ref-derived-anchor error"]);
  });
});

describe("the prose of a JSON or YAML record", () => {
  test("reads a $title's [a][b](c.md) as a use of the definition of b in a $body, as a Markdown heading does", async () => {
    const store = await storeOf({
      "docs/t.json": JSON.stringify({ $title: "[a][b](c.md)", $body: "Text.\n\n[b]: d.md\n" }),
      "docs/t.md": "# [a][b](c.md)\n\nText.\n\n[b]: d.md\n",
      "docs/d.md": "# D\n",
    });
    const raws = async (from: string) =>
      successValue(await store.references({ from })).map((reference) => `${reference.form} ${reference.raw}`);
    expect(await raws("docs/t.md")).toEqual(["definition d.md"]);
    expect(await raws("docs/t.json")).toEqual(["definition d.md"]);
  });

  // TODO(#24): the Markdown limits apply to a data $body, which makes it a syntax-error (card Z1, recorded in Draft v0.13);
  // until the code follows, such a $body gives no references and no issue, which this test pins.
  test("gives no references, and raises nothing yet, for a $body beyond the Markdown parser's limits", async () => {
    const deep = `${"> ".repeat(300)}[x](gone.md)`;
    const store = await storeOf({ "docs/d.json": JSON.stringify({ $body: deep }) });
    expect(successValue(await store.references({ from: "docs/d.json" }))).toEqual([]);
    expect((await store.check({ records: ["docs/d.json"] })).issues).toEqual([]);
  });
});

describe("alias chains and shadowed names", () => {
  const alias = (...lines: object[]) => ({ ".vmd/aliases.jsonl": `${lines.map((line) => JSON.stringify(line)).join("\n")}\n` });
  const at = "2026-10-09T08:00:00Z";

  test("stop a record alias chain at its first live path", async () => {
    const files = alias(
      { kind: "record", from: "docs/a.md", to: "docs/b.md", at },
      { kind: "record", from: "docs/b.md", to: "docs/c.md", at },
    );
    const reference = await one("a.md", { ...files, "docs/b.md": "# B\n", "docs/c.md": "# C\n" });
    expect(reference).toMatchObject({ status: "aliased", targets: [{ path: "docs/b.md", at: "", address: "" }] });
  });

  test("warn alias-shadowed about a derived anchor alone, as a title added again has", async () => {
    const store = await storeOf({
      ...alias({ kind: "anchor", record: "docs/r.md", from: "notes", to: "remarks", at }),
      "docs/r.md": "# R\n\n## Notes\n\n## Remarks\n",
    });
    const shadowed = (await store.check({ records: ["docs/r.md"] })).issues.filter((issue) => issue.code === "alias-shadowed");
    expect(shadowed.map((issue) => `${issue.path} ${issue.at}`)).toEqual(["docs/r.md /$sections/0"]);
  });
});

describe("the title-derived warnings", () => {
  test("look at the first step, not the last", async () => {
    const refs = await refsOf("# A\n\n[a](g.md#plain/$title) [b](g.md#done/sub)\n", {
      "docs/g.md": '# G\n\n## Plain\n\n## Done <a id="done"></a>\n\n### Sub\n',
    });
    expect(refs.map(codes)).toEqual([["ref-derived-anchor warning"], []]);
  });
});

describe("files the backend cannot read", () => {
  const LOCKED = (path: string) => makeIssue({ code: "storage-failed", path, at: null, message: `${path}: permission denied` });
  const CONFIG = "vmd: 1\n";

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

  test("are there when check lists them: a reference below the root of one is unreadable", async () => {
    const files = {
      ".vmd/config.yaml": CONFIG,
      "docs/a.md": "# A\n\n[x](locked.md#part)\n",
      "docs/locked.md": "# L\n\n## Part\n",
    };
    const store = successValue(await openStore(lockedBackend(files, ["docs/locked.md"])));
    const issues = (await store.check({ records: ["docs/a.md"] })).issues;
    expect(issues.map((issue) => issue.code)).toEqual(["ref-target-unreadable"]);
  });

  test("are there when ignored and looked up", async () => {
    const files = {
      ".vmd/config.yaml": 'vmd: 1\nignore: ["big/**"]\n',
      "docs/a.md": "# A\n\n[x](../big/locked.txt)\n",
      "big/locked.txt": "x",
    };
    const store = successValue(await openStore(lockedBackend(files, ["big/locked.txt"])));
    const [reference] = successValue(await store.references({ from: "docs/a.md" }));
    expect(reference?.status).toBe("ok");
  });

  test("stop check with the backend's issue when one is the alias file", async () => {
    const files = { ".vmd/config.yaml": CONFIG, ".vmd/aliases.jsonl": "", "docs/a.md": "# A\n" };
    const checked = await successValue(await openStore(lockedBackend(files, [".vmd/aliases.jsonl"]))).check();
    expect(checked.ok).toBe(false);
    expect(checked.issues.map((issue) => issue.code)).toEqual(["storage-failed"]);
  });
});
