// Typed references: the strings a collection's schema declares with x-vmd-ref, and what the declaration checks of every
// reference it applies to, a $ref object's included.

import { describe, expect, test, vi } from "vitest";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage, type MemoryFile } from "../storage/memory.js";
import { openStore, type Store } from "../store/store.js";
import { occurrencesOf } from "./extract.js";
import type { Reference } from "./reference.js";

type Files = Readonly<Record<string, string | Uint8Array | MemoryFile>>;

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** A string schema that declares a typed reference with `ref`, the value of its `x-vmd-ref`. */
const typed = (ref: string) => `{type: string, format: uri-reference, x-vmd-ref: ${ref}}`;

const TYPED_SCHEMA = [
  "type: object",
  "properties:",
  `  parent: ${typed("{}")}`,
  `  many: ${typed("{cardinality: many}")}`,
  `  strict: ${typed("{anchors: explicit}")}`,
  `  strictMany: ${typed("{cardinality: many, anchors: explicit}")}`,
  `  docs: ${typed('{targets: ["docs/**"]}')}`,
  `  people: ${typed("{targets: [people]}")}`,
  `  nothing: ${typed("{targets: []}")}`,
  `  list: {type: array, items: ${typed("{}")}}`,
  '  object: {type: object, x-vmd-ref: {targets: ["docs/**"]}}',
  `  member: {type: object, properties: {$ref: ${typed('{targets: ["docs/**"]}')}}}`,
  "  note: {type: string}",
  "patternProperties:",
  `  "^z": ${typed("{}")}`,
  `  "^zz": ${typed("{cardinality: many}")}`,
  "",
].join("\n");

const FILES: Files = {
  ".vmd/config.yaml": [
    "vmd: 1",
    "collections:",
    "  typed:",
    '    match: ["typed/**"]',
    "    schema: typed.schema.yaml",
    "  people:",
    '    match: ["people/*.yaml"]',
    "  doubled:",
    '    match: ["people/both.yaml"]',
    "  journal:",
    '    match: ["journal/*.json"]',
    "    schema: journal.schema.yaml",
    "  keyed:",
    '    match: ["keyed/*.yaml"]',
    "    schema: keyed.schema.yaml",
    "  refused:",
    '    match: ["refused/*.yaml"]',
    "    schema: missing.schema.yaml",
    "",
  ].join("\n"),
  ".vmd/schema/typed.schema.yaml": TYPED_SCHEMA,
  // A journal's top-level sections may repeat their keys.
  ".vmd/schema/journal.schema.yaml":
    'type: object\nproperties:\n  $sections: {type: array, x-vmd-list: {type: multimap, keys: ["@key"]}}\n',
  ".vmd/schema/keyed.schema.yaml": [
    "type: object",
    "properties:",
    "  runs: {type: array, x-vmd-list: {type: map, keys: [id]}}",
    "  log: {type: array, x-vmd-list: {type: multimap, keys: [id]}}",
    "",
  ].join("\n"),
  ".vmd/aliases.jsonl": [
    '{"kind": "record", "from": "docs/old.md", "to": "docs/t.md", "at": "2026-10-09T08:00:00Z"}',
    '{"kind": "anchor", "record": "docs/t.md", "from": "setup", "to": "done", "at": "2026-10-09T08:00:00Z"}',
    '{"kind": "anchor", "record": "docs/t.md", "from": "planned", "to": "done", "at": "2026-10-09T08:00:00Z"}',
    "",
  ].join("\n"),
  "docs/t.md": [
    "---",
    "status: Open",
    "links: [first, second]",
    "---",
    "",
    "# T",
    "",
    '## Shipped <a id="done"></a>',
    "",
    "Shipped.",
    "",
    "## Planned",
    "",
    "Next.",
    "",
  ].join("\n"),
  "docs/twin.md": "# Twin\n\n## Notes\n\n## Notes\n",
  "docs/img.png": new Uint8Array([0x89, 0x50]),
  "other/thing.md": "# Thing\n",
  "people/ana.yaml": "name: Ana\n",
  "people/both.yaml": "name: Both\n",
  "journal/j.json": '{"$sections": [{"$title": "Notes"}, {"$title": "Other", "$anchor": "notes"}]}',
  "journal/k.json": '{"$sections": [{"$title": "Other", "$anchor": "notes"}]}',
  "keyed/k.yaml": "runs:\n  - {id: r1, n: 1}\nlog:\n  - {id: a, n: 1}\n  - {id: a, n: 2}\n",
  "refused/r.yaml": "name: R\n",
  "plain/p.yaml": "parent: ../docs/t.md\n",
};

async function storeOf(files: Files = {}): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files: { ...FILES, ...files } })));
}

/** The references of `typed/r.yaml` holding `yaml`. */
async function refsOf(yaml: string, path = "typed/r.yaml"): Promise<Reference[]> {
  const store = await storeOf({ [path]: yaml });
  return [...successValue(await store.references({ from: path }))];
}

/** The one reference of `typed/r.yaml` holding `field: value`. */
async function one(field: string, value: string): Promise<Reference> {
  const refs = await refsOf(`${field}: ${JSON.stringify(value)}\n`);
  expect(refs, `${field}: ${value}`).toHaveLength(1);
  return refs[0] as Reference;
}

const codes = (reference: Reference) => reference.issues.map((issue: Issue) => issue.code);
const ats = (reference: Reference) => reference.targets.map((target) => ("at" in target ? target.at : target.path));

describe("typed references", () => {
  test("are the strings whose schema declares x-vmd-ref, in document order with the other references", async () => {
    const yaml = [
      "note: ../docs/t.md",
      "parent: ../docs/t.md#done",
      'list: ["../other/thing.md", "../docs/img.png"]',
      "object: {$ref: ../docs/t.md}",
      "zx: ../docs/twin.md",
      "",
    ].join("\n");
    const refs = await refsOf(yaml);
    expect(refs.map(({ form, at, raw, status }) => `${form} ${at} ${raw} ${status}`)).toEqual([
      "typed /parent ../docs/t.md#done ok",
      "typed /list/0 ../other/thing.md ok",
      "typed /list/1 ../docs/img.png ok",
      "ref-object /object ../docs/t.md ok",
      "typed /zx ../docs/twin.md ok",
    ]);
    expect(refs[0]).toMatchObject({
      uri: "../docs/t.md#done",
      declaration: { targets: null, cardinality: "one", anchors: "any" },
      from: { path: "typed/r.yaml", at: "/parent" },
      targets: [{ path: "docs/t.md", at: "/$sections/0", address: "#done" }],
    });
    expect(refs[0]).not.toHaveProperty("offset");
    // The string's bytes in the file, without its quotes.
    const bytes = new TextEncoder().encode(yaml);
    const range = refs[1]?.destination ?? expect.fail("no destination");
    expect(new TextDecoder().decode(bytes.subarray(range.start, range.end))).toBe("../other/thing.md");
    expect(refs[3]?.declaration).toEqual({ targets: ["docs/**"], cardinality: "one", anchors: "any" });
  });

  test("are no reference where the string is not a URI reference, which its schema rejects", async () => {
    const store = await storeOf({ "typed/r.yaml": 'parent: "a b"\n' });
    expect(successValue(await store.references({ from: "typed/r.yaml" }))).toEqual([]);
    const issues = (await store.check({ records: ["typed/r.yaml"] })).issues;
    expect(issues.map((issue) => `${issue.code} ${issue.at}`)).toEqual(["schema-violation /parent"]);
  });

  test("are none where unequal declarations meet at a member, and none in a record without a usable schema", async () => {
    // zzq matches both patterns, whose declarations differ; zq matches one.
    const refs = await refsOf("zzq: ../docs/t.md\nzq: ../docs/gone.md\n");
    expect(refs.map(({ at, status }) => `${at} ${status}`)).toEqual(["/zq dangling"]);
    const store = await storeOf();
    expect(successValue(await store.references({ from: "plain/p.yaml" }))).toEqual([]);
  });

  test("are found in a Markdown record's front matter", async () => {
    const refs = await refsOf("---\nparent: ../docs/gone.md\n---\n\n# R\n", "typed/r.md");
    expect(refs.map(({ form, at, status }) => `${form} ${at} ${status}`)).toEqual(["typed /parent dangling"]);
  });

  test("join every reference of the store, @refs and check", async () => {
    const store = await storeOf({ "typed/r.yaml": "parent: ../docs/gone.md\nnote: x\n" });
    const all = successValue(await store.references());
    expect(all.map((reference) => `${reference.from.path} ${reference.at}`)).toEqual(["typed/r.yaml /parent"]);
    const got = successValue(await store.get("typed/r.yaml#parent", { meta: ["@refs"] }));
    expect(got.meta?.["@refs"]).toMatchObject([{ raw: "../docs/gone.md", status: "dangling" }]);
    const issues = (await store.check({ records: ["typed/r.yaml"] })).issues;
    expect(issues.map((issue) => `${issue.code} ${issue.path} ${issue.at}`)).toEqual(["ref-dangling typed/r.yaml /parent"]);
  });
});

describe("the cost of typed references", () => {
  test("grows linearly with their count: each string's node is looked up a few times, not once per other reference", async () => {
    /** The node lookups that finding `count` typed strings takes. */
    const lookupsFor = async (count: number): Promise<number> => {
      const list = Array.from({ length: count }, (_, i) => `../docs/t${i}.md`);
      const store = await storeOf({ "typed/big.json": JSON.stringify({ list }) });
      const bound = successValue((await store.binding("typed/big.json")) ?? expect.fail("no record"));
      expect(bound.typedReferences).toHaveLength(count);
      const lookups = vi.spyOn(bound.record.nodes, "node");
      try {
        expect(occurrencesOf(bound)).toHaveLength(count);
        return lookups.mock.calls.length;
      } finally {
        lookups.mockRestore();
      }
    };
    const small = await lookupsFor(5_000);
    expect(await lookupsFor(20_000)).toBeLessThanOrEqual(4 * small + 10);
  });
});

describe("a $ref object with x-vmd-ref on its $ref member", () => {
  test("is one reference, which the member's declaration applies to", async () => {
    const refs = await refsOf("member: {$ref: ../other/thing.md}\n");
    expect(refs.map(({ form, at }) => `${form} ${at}`)).toEqual(["ref-object /member"]);
    expect(refs[0]?.declaration).toEqual({ targets: ["docs/**"], cardinality: "one", anchors: "any" });
    expect(codes(refs[0] as Reference)).toEqual(["ref-target-not-allowed"]);
    const allowed = await refsOf("member: {$ref: ../docs/t.md}\n");
    expect(codes(allowed[0] as Reference)).toEqual([]);
  });
});

describe("cardinality: many", () => {
  test("resolves its fragment as a selector: every match, none being ok, with no proof", async () => {
    const twin = await one("many", "../docs/twin.md#notes");
    expect(twin).toMatchObject({ status: "ok" });
    expect(ats(twin)).toEqual(["/$sections/0", "/$sections/1"]);
    // Both are reached only by the title, and a heading repeats the slug.
    expect(codes(twin)).toEqual(["ref-derived-repeat"]);
    const empty = await one("many", "../docs/t.md#nothing");
    expect(empty).toMatchObject({ status: "ok", targets: [], issues: [] });
    // Through a level declared multimap, where a singular reference cannot be proved to name one node.
    const log = await one("many", "../keyed/k.yaml#log/a");
    expect(log).toMatchObject({ status: "ok", issues: [] });
    expect(ats(log)).toEqual(["/log/0", "/log/1"]);
    const singular = await one("parent", "../keyed/k.yaml#log/a");
    expect(singular).toMatchObject({ status: "ambiguous", targets: [] });
  });

  test("is dangling when its record does not exist, and resolves a root, an asset and a directory as one does", async () => {
    const missing = await one("many", "../docs/missing.md#a");
    expect(missing).toMatchObject({ status: "dangling", targets: [] });
    expect(codes(missing)).toEqual(["ref-dangling"]);
    expect(ats(await one("many", "../docs/t.md"))).toEqual([""]);
    expect(ats(await one("many", "../docs/img.png#x"))).toEqual(["docs/img.png"]);
    expect(ats(await one("many", "../docs/"))).toEqual(["docs"]);
    expect((await one("many", "../refused/r.yaml#name")).status).toBe("unreadable");
  });

  test("follows the anchor aliases of a first step that reaches no name of the record", async () => {
    const renamed = await one("many", "../docs/t.md#setup");
    expect(renamed).toMatchObject({ status: "aliased", targets: [{ path: "docs/t.md", at: "/$sections/0" }] });
    expect(codes(renamed)).toEqual(["ref-aliased"]);
    // A live first step never follows an alias, whatever the later steps match.
    const live = await one("many", "../docs/t.md#planned/nothing");
    expect(live).toMatchObject({ status: "ok", targets: [], issues: [] });
    // The chain reaches a name, so the reference resolves through the alias, although the later steps then match nothing.
    const nowhere = await one("many", "../docs/t.md#setup/nothing");
    expect(nowhere).toMatchObject({ status: "aliased", targets: [] });
    expect(codes(nowhere)).toEqual(["ref-aliased"]);
    // A chain that reaches no name leaves the reference as the live store does.
    const unknown = await one("many", "../docs/t.md#unknown");
    expect(unknown).toMatchObject({ status: "ok", targets: [], issues: [] });
    // A record alias: the record part resolves only through it, whatever the fragment matches.
    const moved = await one("many", "../docs/old.md#nothing");
    expect(moved).toMatchObject({ status: "aliased", targets: [] });
    expect(codes(moved)).toEqual(["ref-aliased"]);
  });
});

describe("anchors: explicit", () => {
  test("refuses a step through a title-derived name or a position, in a semantic path or an exact path", async () => {
    for (const value of [
      "../docs/t.md#planned",
      "../docs/twin.md#notes-1",
      "../docs/t.md#links/1",
      "../docs/t.md#/links/1",
      "../docs/t.md#/$sections/1",
      "../docs/t.md#/$sections/0/$body",
    ]) {
      const reference = await one("strict", value);
      expect(reference.status, value).toBe("ok");
      expect(codes(reference), value).toContain("ref-target-not-allowed");
      expect(reference.issues.find((issue) => issue.code === "ref-target-not-allowed")).toMatchObject({
        severity: "error",
        path: "typed/r.yaml",
        at: "/strict",
      });
    }
  });

  test("allows explicit anchors, field names, section members, keyed-list keys, and a name also matched explicitly", async () => {
    for (const value of [
      "../docs/t.md#done",
      "../docs/t.md#done/$body",
      "../docs/t.md#status",
      "../docs/t.md#/status",
      "../docs/t.md#/links",
      "../keyed/k.yaml#runs/r1/n",
      "../docs/t.md",
      "../docs/img.png",
    ]) {
      const reference = await one("strict", value);
      expect(reference.status, value).toBe("ok");
      expect(codes(reference), value).toEqual([]);
    }
    expect(codes(await one("parent", "../docs/t.md#links/1"))).toEqual([]);
  });

  test("with cardinality: many, refuses a reference as soon as one target is reached only by a title or a position", async () => {
    const mixed = await one("strictMany", "../journal/j.json#notes");
    expect(ats(mixed)).toEqual(["/$sections/0", "/$sections/1"]);
    expect(codes(mixed)).toContain("ref-target-not-allowed");
    const refusal = mixed.issues.find((issue) => issue.code === "ref-target-not-allowed");
    expect(refusal?.message).toContain("#/$sections/0");
    expect(refusal?.message).not.toContain("#/$sections/1");
    const explicit = await one("strictMany", "../journal/k.json#notes");
    expect(codes(explicit)).toEqual([]);
    expect(codes(await one("many", "../journal/j.json#notes"))).not.toContain("ref-target-not-allowed");
  });
});

describe("targets", () => {
  test("allow a record, an asset or a directory whose path a glob matches, and a record of a named collection", async () => {
    expect(codes(await one("docs", "../docs/t.md#done"))).toEqual([]);
    expect(codes(await one("docs", "../docs/img.png"))).toEqual([]);
    expect(codes(await one("people", "../people/ana.yaml#name"))).toEqual([]);
  });

  test("refuse any other target, the status staying what resolution gave", async () => {
    for (const [field, value, status] of [
      ["docs", "../other/thing.md", "ok"],
      // `docs/**` matches the paths below docs/, not docs itself.
      ["docs", "../docs/", "ok"],
      ["people", "../docs/t.md", "ok"],
      // A record two collections claim belongs to neither.
      ["people", "../people/both.yaml", "ok"],
      ["nothing", "../docs/t.md", "ok"],
      ["docs", "../refused/r.yaml#name", "unreadable"],
      ["docs", "../keyed/k.yaml#log/a", "ambiguous"],
    ] as const) {
      const reference = await one(field, value);
      expect(reference.status, value).toBe(status);
      expect(codes(reference), value).toContain("ref-target-not-allowed");
    }
  });

  test("allow anything when absent: a record, a node, an asset and a directory, by any step, positions included", async () => {
    // The suite's no-targets-allows-any-target and positional-steps-allowed-by-default expect no issue; here each reference
    // is shown to be found.
    const values = [
      "../other/thing.md",
      "../people/ana.yaml#name",
      "../docs/img.png",
      "../docs/",
      "../docs/t.md#links/1",
      "../docs/t.md#/links/1",
      "../docs/t.md#/$sections/1",
    ];
    const refs = await refsOf(`list: ${JSON.stringify(values)}\n`);
    expect(refs.map(({ raw, status, issues }) => [raw, status, issues.length])).toEqual(values.map((value) => [value, "ok", 0]));
  });

  test("are not checked for a dangling reference, which has no target", async () => {
    expect(codes(await one("docs", "../other/missing.md"))).toEqual(["ref-dangling"]);
  });
});
