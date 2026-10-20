import { describe, expect, test } from "vitest";
import type { Issue } from "../issue/issue.js";
import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { createMemoryStorage, type MemoryFile } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { openStore, type Store } from "../store/store.js";

type Files = Readonly<Record<string, string | Uint8Array | MemoryFile>>;

/** Returns the value of a successful outcome, and fails the test with its issues otherwise. */
function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function storeOver(backend: StorageReader): Promise<Store> {
  return successValue(await openStore(backend));
}

/** A backend over `inner` whose `list` is replaced. */
function withList(inner: StorageReader, list: StorageReader["list"]): StorageReader {
  return {
    list,
    stat: (path) => inner.stat(path),
    read: (path, options) => inner.read(path, options),
    grep: (query) => inner.grep(query),
    head: () => inner.head(),
    history: inner.history,
  };
}

async function storeOf(files: Files): Promise<Store> {
  return storeOver(createMemoryStorage({ files }));
}

/** Each issue as `code severity path at`. */
function shown(issues: readonly Issue[]): string[] {
  return issues.map((issue) => `${issue.code} ${issue.severity} ${issue.path} ${JSON.stringify(issue.at)}`);
}

/** A record with a repeated explicit anchor, a duplicate-key and a duplicate-anchor on its second section. */
const TWICE = '# T\n\n## A <a id="x"></a>\n\n## B <a id="x"></a>\n';

describe("Store.check", () => {
  test("reports each record's structural errors and validation issues, and counts the records and the unreadable", async () => {
    const store = await storeOf({
      ".vmd/config.yaml": "vmd: 1\n",
      "bad.json": "{",
      "twice.md": TWICE,
      "fine.md": "# Fine\n",
      "locked.md": { content: "# L\n", unreadable: true },
      "locked.png": { content: "x", unreadable: true },
    });
    const outcome = await store.check();
    // A record the backend cannot read counts as checked and unreadable, as ls counts it; an asset it cannot read does not.
    expect(successValue(outcome)).toEqual({ records: 4, unreadable: 2 });
    expect(shown(outcome.issues)).toEqual([
      'syntax-error error bad.json ""',
      "storage-failed error locked.md null",
      "storage-failed error locked.png null",
      'duplicate-anchor error twice.md "/$sections/1"',
      'duplicate-key error twice.md "/$sections/1"',
    ]);
    expect(successValue(await store.check({ records: ["fine.md"] }))).toEqual({ records: 1, unreadable: 0 });
    expect(successValue(await store.check({ records: ["locked.md"] }))).toEqual({ records: 1, unreadable: 1 });
  });

  test("checks the path rules over every listed path, assets with warnings, and leaves ignored paths alone", async () => {
    const store = await storeOf({
      ".vmd/config.yaml": 'vmd: 1\nignore: ["drafts/**"]\n',
      ".vmd/odd name.yaml": "x: 1\n",
      "my notes.md": "# N\n",
      "Notes.md": "# N\n",
      "notes.md": "# N\n",
      "my image.png": "x",
      "drafts/bad name.md": "{",
    });
    expect(shown((await store.check()).issues)).toEqual([
      "path-invalid warning my image.png null",
      'path-invalid error my notes.md ""',
      'path-case-conflict error notes.md ""',
    ]);
  });

  test("reports a record two collections claim, and checks it as a record of none", async () => {
    const config = [
      "vmd: 1",
      "collections:",
      '  first: {match: ["*.md"], filename: "^z"}',
      '  second: {match: ["a*.md"], schema: missing.json}',
      "",
    ].join("\n");
    const store = await storeOf({ ".vmd/config.yaml": config, "a.md": TWICE, "b.md": "# B\n" });
    expect(shown((await store.check()).issues)).toEqual(
      [
        'collection-conflict error a.md ""',
        'duplicate-anchor error a.md "/$sections/1"',
        'duplicate-key error a.md "/$sections/1"',
        'filename-mismatch error b.md ""',
        "schema-invalid error null null",
      ].sort(byPathFirstNull),
    );
  });

  test("reports a file name its collection's pattern refuses, and not one it accepts", async () => {
    const config = 'vmd: 1\ncollections:\n  tickets: {match: ["tickets/*.md"], filename: "^[0-9]{4}-"}\n';
    const store = await storeOf({ ".vmd/config.yaml": config, "tickets/0001-a.md": "# A\n", "tickets/1-b.md": "# B\n" });
    expect(shown((await store.check()).issues)).toEqual(['filename-mismatch error tickets/1-b.md ""']);
  });

  test("reports a collection's unusable schema once, and still checks its records for everything else", async () => {
    const config = 'vmd: 1\ncollections:\n  docs: {match: ["docs/*.md"], schema: doc.schema.json}\n';
    const store = await storeOf({ ".vmd/config.yaml": config, "docs/a.md": TWICE, "docs/b.md": "# B\n" });
    const outcome = await store.check();
    expect(shown(outcome.issues)).toEqual([
      "schema-invalid error null null",
      'duplicate-anchor error docs/a.md "/$sections/1"',
      'duplicate-key error docs/a.md "/$sections/1"',
    ]);
    expect(successValue(outcome)).toEqual({ records: 2, unreadable: 0 });
  });

  test("with records, reports only their issues, and a schema's issue only when one of them is in its collection", async () => {
    const config = 'vmd: 1\ncollections:\n  docs: {match: ["docs/*.md"], schema: doc.schema.json}\n';
    const store = await storeOf({
      ".vmd/config.yaml": config,
      "docs/a.md": TWICE,
      "other.md": TWICE,
      "Other.md": "# O\n",
    });
    const other = await store.check({ records: ["other.md"] });
    expect(shown(other.issues)).toEqual([
      'path-case-conflict error other.md ""',
      'duplicate-anchor error other.md "/$sections/1"',
      'duplicate-key error other.md "/$sections/1"',
    ]);
    expect(successValue(other)).toEqual({ records: 1, unreadable: 0 });
    const docs = await store.check({ records: ["docs/a.md", "missing.md", "docs"] });
    expect(shown(docs.issues).map((line) => line.split(" ")[0])).toEqual(["schema-invalid", "duplicate-anchor", "duplicate-key"]);
    expect(successValue(docs)).toEqual({ records: 1, unreadable: 0 });
    expect(successValue(await store.check({ records: [] }))).toEqual({ records: 0, unreadable: 0 });
  });

  test("reports a link into a journal whose top-level sections may repeat only where its first step names several nodes", async () => {
    const store = await storeOf({
      ".vmd/config.yaml": 'vmd: 1\ncollections:\n  journal: {match: ["journal/*.md"], schema: journal.schema.json}\n',
      ".vmd/schema/journal.schema.json": JSON.stringify({
        properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } },
      }),
      "journal/j.md": '# J\n\n## Done <a id="done"></a>\n\nFinished.\n\n## Monday\n\nOne.\n\n## Monday\n\nTwo.\n',
      "r.md": "# R\n\n[a](journal/j.md#done) [b](journal/j.md#done/$body) [c](journal/j.md#monday)\n",
    });
    const outcome = await store.check({ records: ["r.md"] });
    expect(shown(outcome.issues)).toEqual(['ref-ambiguous error r.md "/$body"']);
    expect(outcome.issues[0]?.message).toContain("#monday");
  });

  // Card AP (project owner, 2026-10-20): a first step that names no node is not ambiguous, so the link is dangling, and the
  // anchor aliases apply.
  test("follows an anchor alias into a journal whose top-level sections may repeat, and reports a name nothing has as dangling", async () => {
    const store = await storeOf({
      ".vmd/config.yaml": 'vmd: 1\ncollections:\n  journal: {match: ["journal/*.md"], schema: journal.schema.json}\n',
      ".vmd/schema/journal.schema.json": JSON.stringify({
        properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } },
      }),
      ".vmd/aliases.jsonl": `${JSON.stringify({ kind: "anchor", record: "journal/j.md", from: "done", to: "finished", at: "2026-10-20T08:00:00Z" })}\n`,
      "journal/j.md": '# J\n\n## Finished <a id="finished"></a>\n\nDone.\n\n## Monday\n\nOne.\n\n## Monday\n\nTwo.\n',
      "r.md": "# R\n\n[a](journal/j.md#done) [b](journal/j.md#tpyo) [c](journal/j.md#monday) [d](journal/j.md#done/$body)\n",
    });
    const outcome = await store.check({ records: ["r.md"] });
    expect(shown(outcome.issues)).toEqual([
      'ref-aliased warning r.md "/$body"',
      'ref-dangling error r.md "/$body"',
      'ref-ambiguous error r.md "/$body"',
      // The alias renames the first step, and the step after it is proved from the node finished names.
      'ref-aliased warning r.md "/$body"',
    ]);
    expect(outcome.issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining("#done"),
      expect.stringContaining("#tpyo"),
      expect.stringContaining("#monday"),
      expect.stringContaining("#done/$body"),
    ]);
  });

  test("gives the issues the configuration's severities: lenient uniqueness, and the issues entries", async () => {
    const config = 'vmd: 1\nuniqueness: lenient\nissues:\n  duplicate-key: "off"\n  heading-html: error\n';
    const store = await storeOf({ ".vmd/config.yaml": config, "twice.md": TWICE, "html.md": "# H\n\n## S <u>u</u>\n" });
    expect(shown((await store.check()).issues)).toEqual([
      'heading-html error html.md "/$sections/0"',
      'duplicate-anchor warning twice.md "/$sections/1"',
    ]);
  });

  test("sorts the issues by path, those without one first, then by position", async () => {
    const config = 'vmd: 1\ncollections:\n  z: {match: ["z/*.md"], schema: none.json}\n';
    const store = await storeOf({
      ".vmd/config.yaml": config,
      "b.md": '# B\n\n## X <a id="1x"></a>\n\n## Y <a id="2y"></a>\n',
      "a.md": TWICE,
      "z/z.md": "# Z\n",
    });
    const issues = (await store.check()).issues;
    expect(issues.map((issue) => issue.path)).toEqual([null, "a.md", "a.md", "b.md", "b.md"]);
    const offsets = issues.filter((issue) => issue.path === "b.md").map((issue) => issue.position?.offset as number);
    expect(offsets[0]).toBeLessThan(offsets[1] as number);
  });

  test("lists every page of the store", async () => {
    const files: Record<string, string> = { ".vmd/config.yaml": "vmd: 1\n" };
    for (let index = 0; index < 5; index++) files[`r${index}.json`] = index === 4 ? "{" : "{}";
    const inner = createMemoryStorage({ files });
    const store = await storeOver(withList(inner, (query) => inner.list({ ...query, limit: Math.min(query.limit, 2) })));
    const outcome = await store.check();
    expect(successValue(outcome)).toEqual({ records: 5, unreadable: 1 });
    expect(shown(outcome.issues)).toEqual(['syntax-error error r4.json ""']);
  });

  test("fails as the backend's listing does", async () => {
    const inner = createMemoryStorage({ files: { ".vmd/config.yaml": "vmd: 1\n" } });
    const broken = makeIssue({ code: "storage-failed", path: null, at: null, message: "the store cannot be listed" });
    const store = await storeOver(withList(inner, async () => fail([broken])));
    const outcome = await store.check();
    expect(outcome.ok).toBe(false);
    expect(outcome.issues).toEqual([broken]);
  });
});

describe("Store.check with more issues than a call takes arguments", () => {
  // Node 24 takes about 125,000 arguments in a call. The store's listing is built in memory where a store of that many files
  // would be slow to list.
  const COUNT = 150_000;
  const CONFIGURATION = { ".vmd/config.yaml": "vmd: 1\n" };

  /** Each code of `issues` with how many issues have it. */
  const counted = (issues: readonly Issue[]) => {
    const counts = new Map<string, number>();
    for (const issue of issues) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    return Object.fromEntries(counts);
  };

  test("gives the path-invalid of each of 150,000 files", async () => {
    const inner = createMemoryStorage({ files: CONFIGURATION });
    const files = Array.from({ length: COUNT }, (_, index) => ({
      path: `a b${index}.png`,
      size: 0,
      version: "",
      modified: null,
    }));
    const store = await storeOver(
      withList(inner, async (query) => {
        const start = query.cursor === undefined ? 0 : Number(query.cursor);
        const end = Math.min(start + query.limit, files.length);
        const remaining = { count: files.length - end, exact: true };
        return succeed({ items: files.slice(start, end), cursor: end === files.length ? null : String(end), remaining });
      }),
    );
    const outcome = await store.check();
    expect(successValue(outcome)).toEqual({ records: 0, unreadable: 0 });
    expect(counted(outcome.issues)).toEqual({ "path-invalid": COUNT });
  }, 60_000);

  test("gives each of 150,000 issues of one page of the listing", async () => {
    const inner = createMemoryStorage({ files: CONFIGURATION });
    const failed = Array.from({ length: COUNT }, (_, index) =>
      makeIssue({ code: "storage-failed", path: `f${index}.png`, at: null, message: "cannot read" }),
    );
    const store = await storeOver(
      withList(inner, async () => succeed({ items: [], cursor: null, remaining: { count: 0, exact: true } }, failed)),
    );
    const outcome = await store.check();
    expect(successValue(outcome)).toEqual({ records: 0, unreadable: 0 });
    expect(counted(outcome.issues)).toEqual({ "storage-failed": COUNT });
  }, 60_000);

  test("lists each of 150,000 files of one page, from a backend that passes the page's limit", async () => {
    const inner = createMemoryStorage({ files: CONFIGURATION });
    const items = Array.from({ length: COUNT }, (_, index) => ({ path: `f${index}.png`, size: 0, version: "", modified: null }));
    const store = await storeOver(
      withList(inner, async () => succeed({ items, cursor: null, remaining: { count: 0, exact: true } })),
    );
    const outcome = await store.check();
    expect(successValue(outcome)).toEqual({ records: 0, unreadable: 0 });
    expect(outcome.issues).toEqual([]);
  }, 60_000);

  test("gives the feature-unsupported of each of 150,000 $ members of a record", async () => {
    const members = Array.from({ length: COUNT }, (_, index) => `"$m${index}":0`);
    const store = await storeOf({ ...CONFIGURATION, "r.json": `{${members.join(",")}}` });
    const outcome = await store.check();
    expect(successValue(outcome)).toEqual({ records: 1, unreadable: 1 });
    expect(counted(outcome.issues)).toEqual({ "feature-unsupported": COUNT });
  }, 60_000);

  test("gives the schema-violation of each of 150,000 failing items of a record", async () => {
    const store = await storeOf({
      ".vmd/config.yaml": 'vmd: 1\ncollections:\n  things:\n    match: ["*.json"]\n    schema: s.json\n',
      ".vmd/schema/s.json": JSON.stringify({ properties: { a: { items: { type: "string" } } } }),
      "r.json": JSON.stringify({ a: Array(COUNT).fill(0) }),
    });
    const outcome = await store.check();
    expect(successValue(outcome)).toEqual({ records: 1, unreadable: 0 });
    expect(counted(outcome.issues)).toEqual({ "schema-violation": COUNT });
  }, 60_000);

  test("gives the ref-dangling of each of 150,000 dangling references of a record", async () => {
    // $ref objects in a field rather than links in a $body, which would take seconds to parse as Markdown.
    const store = await storeOf({ ...CONFIGURATION, "r.json": JSON.stringify({ a: Array(COUNT).fill({ $ref: "x.md" }) }) });
    const outcome = await store.check();
    expect(successValue(outcome)).toEqual({ records: 1, unreadable: 0 });
    expect(counted(outcome.issues)).toEqual({ "ref-dangling": COUNT });
  }, 60_000);
});

/** Orders the shown issues as `check` does for these, those without a path first. */
function byPathFirstNull(a: string, b: string): number {
  const pathOf = (line: string) => line.split(" ")[2] as string;
  if (pathOf(a) === "null") return -1;
  if (pathOf(b) === "null") return 1;
  return pathOf(a) < pathOf(b) ? -1 : pathOf(a) > pathOf(b) ? 1 : 0;
}
