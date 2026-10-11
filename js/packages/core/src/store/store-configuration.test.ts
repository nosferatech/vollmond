// What a store's configuration changes in its reads: ignored paths, collections, and schemas that cannot be used.

import { describe, expect, test } from "vitest";
import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { createMemoryStorage, type MemoryFile } from "../storage/memory.js";
import { type ConfigurationSource, MAX_SCHEMA_BYTES, openStore, type Store } from "./store.js";

type Files = Readonly<Record<string, string | Uint8Array | MemoryFile>>;

const CONFIG = [
  "vmd: 1",
  "collections:",
  "  tickets:",
  '    match: ["tickets/*.md"]',
  "    schema: ticket.schema.json",
  "  notes:",
  '    match: ["notes/*.md"]',
  "  broken:",
  '    match: ["broken/*.md"]',
  "    schema: missing.schema.json",
  'ignore: ["drafts/**"]',
  "",
].join("\n");

/** A store's files with that configuration and a schema for the tickets. */
const FILES: Files = {
  ".vmd/config.yaml": CONFIG,
  ".vmd/schema/ticket.schema.json": '{"type": "object"}',
  "tickets/0001.md": "# One\n",
  "notes/a.md": "# A\n",
  "broken/b.md": "# B\n",
  "broken/c.md": "# C\n",
  "drafts/d.md": "# D\n",
  "drafts/e.txt": "dist\n",
  "loose.md": "# Loose dist\n",
};

/** Returns the value of a successful outcome, and fails the test with its issues otherwise. */
function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function storeOf(files: Files = FILES): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files })));
}

describe("ignore", () => {
  test("leaves its paths out of listings and searches, which do not count them", async () => {
    const store = await storeOf();
    const page = successValue(await store.list({ limit: 100 }));
    expect(page.items.map((entry) => entry.path)).not.toContain("drafts/d.md");
    expect(page.remaining.count).toBe(0);
    const found = successValue(await store.grep({ pattern: "dist", mode: "literal", context: 0, limit: 10 }));
    expect(found.items.map((match) => match.path)).toEqual(["loose.md"]);
  });

  test("leaves no record at an ignored path", async () => {
    const store = await storeOf();
    expect(await store.record("drafts/d.md")).toBeNull();
    expect((await store.get("drafts/d.md")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
  });
});

describe("collections", () => {
  test("give each listed record its collection, and none to a record in no collection", async () => {
    const store = await storeOf();
    const page = successValue(await store.list({ limit: 100 }));
    expect(page.items.map((entry) => [entry.path, entry.collection])).toEqual([
      ["broken/b.md", "broken"],
      ["broken/c.md", "broken"],
      ["loose.md", undefined],
      ["notes/a.md", "notes"],
      ["tickets/0001.md", "tickets"],
    ]);
  });

  test("give no collection to a record that two collections claim, which is read unschematized", async () => {
    const config = [
      "vmd: 1",
      "collections:",
      '  first: {match: ["*.md"], schema: missing.schema.json}',
      '  second: {match: ["a*.md"]}',
      "",
    ].join("\n");
    const store = await storeOf({ ...FILES, ".vmd/config.yaml": config, "a.md": "# A\n" });
    expect(store.classify("a.md")).toMatchObject({ kind: "record", collections: [{ name: "first" }, { name: "second" }] });
    const page = successValue(await store.list({ glob: "a.md", limit: 1 }));
    expect(page.items[0]).toMatchObject({ path: "a.md", readable: true });
    expect(page.items[0]?.collection).toBeUndefined();
    expect(successValue(await store.get("a.md", { meta: ["@collection"] })).meta).toEqual({});
  });

  test("give @issues with the severities of the store's configuration", async () => {
    const twice = '# T\n\n## A <a id="x"></a>\n\n## B <a id="x"></a>\n';
    const severities = async (config: string) => {
      const store = await storeOf({ ".vmd/config.yaml": config, "twice.md": twice });
      const meta = successValue(await store.get("twice.md#/$sections/1", { meta: ["@issues"] })).meta;
      return meta?.["@issues"]?.map((issue) => `${issue.code} ${issue.severity}`);
    };
    expect(await severities("vmd: 1\n")).toEqual(["duplicate-anchor error", "duplicate-key error"]);
    expect(await severities('vmd: 1\nuniqueness: lenient\nissues:\n  duplicate-key: "off"\n')).toEqual([
      "duplicate-anchor warning",
    ]);
  });

  test("give @collection to a node of a record of a collection", async () => {
    const store = await storeOf();
    expect(successValue(await store.get("tickets/0001.md", { meta: ["@collection"] })).meta).toEqual({
      "@collection": "tickets",
    });
    expect(successValue(await store.get("loose.md", { meta: ["@collection"] })).meta).toEqual({});
  });
});

describe("a collection whose schema cannot be used", () => {
  test("makes every reader refuse its records with schema-invalid, and leaves the other collections alone", async () => {
    const store = await storeOf();
    const refused = (await store.record("broken/b.md")) as Outcome<unknown>;
    expect(refused.ok).toBe(false);
    expect(refused.issues.map((issue) => [issue.code, issue.path, issue.at])).toEqual([["schema-invalid", null, null]]);
    expect(refused.issues[0]?.message).toContain("missing.schema.json");
    expect((await store.get("broken/b.md#b")).issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
    expect((await store.outline("broken/c.md")).issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
    expect(successValue(await store.get("tickets/0001.md")).value).toMatchObject({ $title: "One" });
  });

  test("still gives null for a record that does not exist", async () => {
    const store = await storeOf();
    expect(await store.record("broken/none.md")).toBeNull();
  });

  test("counts its records as unreadable in a listing, which reports the schema's issue once", async () => {
    const store = await storeOf();
    const outcome = await store.list({ limit: 100 });
    const page = successValue(outcome);
    expect(page.items.filter((entry) => entry.readable === false).map((entry) => entry.path)).toEqual([
      "broken/b.md",
      "broken/c.md",
    ]);
    expect(page.unreadable.count).toBe(2);
    expect(outcome.issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
  });

  test("is one whose schema file is larger than a mebibyte, and not one of exactly a mebibyte", async () => {
    const schema = (size: number) => `{"description": "${"x".repeat(size - 19)}"}`;
    expect(schema(MAX_SCHEMA_BYTES)).toHaveLength(MAX_SCHEMA_BYTES);
    const fits = await storeOf({ ...FILES, ".vmd/schema/ticket.schema.json": schema(MAX_SCHEMA_BYTES) });
    expect((await fits.record("tickets/0001.md"))?.ok).toBe(true);
    const larger = await storeOf({ ...FILES, ".vmd/schema/ticket.schema.json": schema(MAX_SCHEMA_BYTES + 1) });
    const refused = (await larger.record("tickets/0001.md")) as Outcome<unknown>;
    expect(refused.issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
    expect(refused.issues[0]?.message).toContain("larger than");
  });

  test("is one whose schema file cannot be read, naming why", async () => {
    const store = await storeOf({ ...FILES, ".vmd/schema/ticket.schema.json": { content: "{}", unreadable: true } });
    const refused = (await store.record("tickets/0001.md")) as Outcome<unknown>;
    expect(refused.issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
    expect(refused.issues[0]?.message).toContain("cannot be read");
  });
});

describe("a configuration source", () => {
  /** A source over a configuration and schema files held here, which counts the schema reads. */
  function sourceOf(content: string, schemas: Readonly<Record<string, string>>): ConfigurationSource & { reads: string[] } {
    const reads: string[] = [];
    return {
      reads,
      content: new TextEncoder().encode(content),
      name: "elsewhere/config.yaml",
      readSchema: async (path): Promise<Outcome<Uint8Array>> => {
        reads.push(path);
        const schema = schemas[path];
        return schema === undefined
          ? fail([makeIssue({ code: "address-not-found", path: null, at: null, message: `no ${path}` })])
          : succeed(new TextEncoder().encode(schema));
      },
    };
  }

  test("replaces the store's configuration, and its schemas come from beside it, not from the store's .vmd/schema/", async () => {
    const backend = createMemoryStorage({ files: FILES });
    const config = 'vmd: 1\ncollections:\n  tickets: {match: ["tickets/*.md"], schema: ticket.schema.json}\n';
    const store = successValue(await openStore(backend, { configuration: sourceOf(config, {}) }));
    expect(store.configuration.ignore).toEqual([]);
    const refused = (await store.record("tickets/0001.md")) as Outcome<unknown>;
    expect(refused.issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
    expect(refused.issues[0]?.hint).toContain("elsewhere/config.yaml");
    const given = sourceOf(config, { "ticket.schema.json": "{}" });
    const readable = successValue(await openStore(backend, { configuration: given }));
    expect((await readable.record("tickets/0001.md"))?.ok).toBe(true);
  });

  test("reads each schema once, when a record of its collection is first read, and none when the store opens", async () => {
    const source = sourceOf('vmd: 1\ncollections:\n  tickets: {match: ["tickets/*.md"], schema: t.json}\n', { "t.json": "{}" });
    const store = successValue(await openStore(createMemoryStorage({ files: FILES }), { configuration: source }));
    expect(source.reads).toEqual([]);
    await store.record("loose.md");
    expect(source.reads).toEqual([]);
    await Promise.all([store.record("tickets/0001.md"), store.list({ limit: 100 })]);
    expect(source.reads).toEqual(["t.json"]);
  });
});
