// The local index's entries: a record's parse and its binding, written as rows without values and restored without parsing.

import { describe, expect, test, vi } from "vitest";
import { bindRecord, type RecordBinding } from "../binding/binding.js";
import { parseRecord } from "../format/parse-record.js";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { isDeclaredDuplicate } from "../issue/severity.js";
import type { NodeInfo } from "../record/node-index.js";
import { isParsedRecord, isRestoredRecord, type ParsedRecord, type RecordStructure } from "../record/record.js";
import { occurrencesOf } from "../reference/extract.js";
import { sectionTitleSlugs } from "../reference/resolve.js";
import { usable } from "../schema/schema.testkit.js";
import { bindingEntry, parseEntry, restoreBinding, restoreStructure } from "./entries.js";

const encoder = new TextEncoder();

/** Parses a record file given as text. */
function parsed(path: string, text: string): Outcome<ParsedRecord> {
  return parseRecord(path, encoder.encode(text));
}

/** Parses a record that must parse. */
function readable(path: string, text: string): ParsedRecord {
  const outcome = parsed(path, text);
  if (!outcome.ok) expect.fail(`expected ${path} to parse, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** Gives an entry that the index can keep. */
function kept(rows: Uint8Array | null): Uint8Array {
  if (rows === null) expect.fail("expected an entry the index can keep");
  return rows;
}

/** Restores a structure that must restore and be readable. */
function restored(rows: Uint8Array | null, path: string): RecordStructure {
  const outcome = restoreStructure(kept(rows), path);
  if (outcome === null) expect.fail("expected the entry to restore");
  if (!outcome.ok) expect.fail(`expected a readable record, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** Every node of an index, in pre-order. */
function allNodes(record: RecordStructure): NodeInfo[] {
  const nodes: NodeInfo[] = [];
  const pending = [record.nodes.node("") as NodeInfo];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    nodes.push(node);
    pending.push(...[...record.nodes.children(node.at)].reverse());
  }
  return nodes;
}

/** An issue as a test compares it: its members, and whether it is marked as a declared duplicate. */
function shown(issue: Issue): unknown {
  return { ...issue, declared: isDeclaredDuplicate(issue) };
}

/**
 * Everything resolution and checks read of a structure, as plain data: its nodes, sections, anchors, tags, section keys,
 * issues, references, title slugs, and the position of each place a reference's issue is put.
 */
function readOf(subject: RecordStructure | RecordBinding): unknown {
  const record = "lists" in subject ? subject.record : subject;
  const occurrences = occurrencesOf(subject);
  return {
    path: record.path,
    format: record.format,
    nodes: allNodes(record),
    sections: record.nodes.sections().map((section) => section.at),
    anchors: record.anchors.anchors,
    named: record.anchors.anchors.map((entry) => record.anchors.named(entry.name).length),
    of: allNodes(record).map((node) => record.anchors.of(node.at)),
    tags: record.anchors.tags,
    // A map read by path alone, whose order nothing reads.
    sectionKeys: [...record.sectionKeys].sort(([a], [b]) => (a < b ? -1 : 1)),
    issues: record.issues.map(shown),
    occurrences,
    titleSlugs: record.format === "md" ? [] : [...sectionTitleSlugs(record)],
  };
}

const MARKDOWN = [
  "---",
  "status: open",
  "owner: [anna]",
  "---",
  '# Design <a id="top"></a>',
  "",
  "See [the plan](plan.md#steps), [a ref][r] and ![a figure](fig.png).",
  "",
  "[r]: other.md#x",
  "",
  '## Steps <a id="steps" class="decision urgent"></a>',
  "",
  '<a id="first"></a>The first step, with [a link](#top) in it.',
  "",
  '- <a id="item"></a>An item of the list, see [steps](#steps).',
  "",
  "## Notes",
  "",
  "Some notes: é and 𝄞 before [a link](#notes-1).",
  "",
  "## Notes",
  "",
  "### Deeper",
  "",
  "Text.",
  "",
].join("\n");

const JSON_RECORD = JSON.stringify(
  {
    title: "A run",
    see: { $ref: "other.md#x" },
    items: [{ name: "a", link: "a.md" }, { name: "b" }],
    $sections: [
      { $title: "First [link](x.md)", $body: "Body with [one](y.md#z).\n\n[d]: d.md\n", $anchor: "first" },
      { $title: "Second", $body: "Ünïcode [and a link][d].", $sections: [{ $title: "Nested", $body: "" }] },
      { $title: "Second", $body: "A repeat." },
    ],
  },
  null,
  2,
);

const YAML_RECORD = [
  "title: A ticket",
  "parent: {$ref: 'epic.md#scope'}",
  "$sections:",
  "  - $title: Scope",
  "    $body: |",
  "      See [the epic](epic.md).",
  "  - $title: Done",
  "    $anchor: done",
  "    $body: Nothing yet.",
  "",
].join("\n");

const RECORDS: readonly (readonly [string, string])[] = [
  ["docs/design.md", MARKDOWN],
  ["runs/r.json", JSON_RECORD],
  ["tickets/t.yaml", YAML_RECORD],
  // A duplicate key and a duplicate anchor, validation issues of the parse.
  ["dup.md", '# D\n\n## A <a id="x"></a>\n\n## B <a id="x"></a>\n\n## A\n'],
  ["crlf.md", "﻿# Title\r\n\r\nA [link](a.md).\r\n\r\n## Part\r\n\r\nText.\r\n"],
];

describe("a parse entry", () => {
  test.each(RECORDS)("restores %s as its parse reads it, without values or source", (path, text) => {
    const record = readable(path, text);
    const structure = restored(parseEntry(parsed(path, text)), path);
    expect(isParsedRecord(structure)).toBe(false);
    expect(readOf(structure)).toEqual(readOf(record));
  });

  test("holds no path: the same bytes under two paths give the same rows, and each restores under its own", () => {
    const text = MARKDOWN;
    const here = kept(parseEntry(parsed("a/one.md", text)));
    const there = kept(parseEntry(parsed("b/two.md", text)));
    expect(new TextDecoder().decode(there)).toBe(new TextDecoder().decode(here));
    expect(readOf(restored(here, "b/two.md"))).toEqual(readOf(readable("b/two.md", text)));
    expect(new TextDecoder().decode(here)).not.toContain("one.md");
  });

  test.each([
    ["broken.json", '{"a": 1,'],
    ["broken.md", "# T\n\n```yaml data\na: 1\n"],
    ["notutf8.md", "\u0000"],
  ])("restores the structural errors of an unreadable record, %s, under its path", (path, text) => {
    const bytes = path === "notutf8.md" ? new Uint8Array([0x23, 0x20, 0xff, 0x0a]) : encoder.encode(text);
    const outcome = parseRecord(path, bytes);
    expect(outcome.ok).toBe(false);
    const back = restoreStructure(kept(parseEntry(outcome)), path);
    expect(back).toEqual(outcome);
  });

  test("keeps the positions of the places each reference's issue is put, outside ASCII too", () => {
    const record = readable("docs/design.md", MARKDOWN);
    const structure = restored(parseEntry(parsed("docs/design.md", MARKDOWN)), "docs/design.md");
    if (!isRestoredRecord(structure)) expect.fail("expected a restored record");
    const facts = structure.facts;
    const occurrences = occurrencesOf(record);
    expect(occurrences.length).toBeGreaterThan(5);
    for (const occurrence of occurrences) {
      const offset = occurrence.destination?.start ?? (record.nodes.node(occurrence.at) as NodeInfo).range.start;
      expect(facts.positions.get(offset)).toEqual(record.source.position(offset));
    }
  });

  test("is a miss, never a different record, when truncated at any length or given a row it does not know", () => {
    const path = "docs/design.md";
    const rows = kept(parseEntry(parsed(path, MARKDOWN)));
    // The near miss: the whole entry restores.
    expect(restoreStructure(rows, path)).not.toBeNull();
    for (let length = 0; length < rows.length; length++) {
      expect(restoreStructure(rows.subarray(0, length), path)).toBeNull();
    }
    const text = new TextDecoder().decode(rows);
    const lines = text.split("\n").filter((line) => line !== "");
    for (let index = 0; index < lines.length; index++) {
      const dropped = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n");
      expect(restoreStructure(encoder.encode(`${dropped}\n`), path)).toBeNull();
    }
    expect(restoreStructure(encoder.encode(text.replace('"t":"node"', '"t":"nodes"')), path)).toBeNull();
    expect(restoreStructure(encoder.encode(text.replace('"kind":"section"', '"kind":"chapter"')), path)).toBeNull();
    expect(restoreStructure(encoder.encode(`${text}{"t":"node"}\n`), path)).toBeNull();
  });
});

const RUN_SCHEMA = {
  properties: {
    // A per-key schema, so that an item's shape depends on its key.
    items: {
      type: "array",
      "x-vmd-list": { type: "map", keys: ["name"], items: { b: { properties: { link: LINK() } } } },
      items: { properties: { link: LINK() } },
    },
    groups: { type: "array", "x-vmd-list": { type: "multimap", keys: ["name"] } },
    see: { type: "object", "x-vmd-ref": { targets: ["**/*.md"] } },
    lead: LINK(),
    count: { type: "integer" },
  },
};

function LINK(): unknown {
  return { type: "string", format: "uri-reference", "x-vmd-ref": { anchors: "explicit" } };
}

const BOUND_RECORDS: readonly (readonly [string, string])[] = [
  [
    "runs/a.json",
    JSON.stringify(
      {
        lead: "plan.md#steps",
        see: { $ref: "other.md#x" },
        items: [
          { name: "a", link: "a.md" },
          { name: "b", link: "b.md#é" },
          { name: "a", link: "dup.md" },
        ],
        groups: [{ name: "g" }, { name: "g" }],
        count: "not a number",
      },
      null,
      2,
    ),
  ],
  ["runs/b.yaml", "lead: 'q.md'\nitems:\n  - name: x\n    link: \"x.md\"\ncount: 3\n"],
];

describe("a binding entry", () => {
  test.each(BOUND_RECORDS)("restores %s's binding over its restored structure as it was computed", async (path, text) => {
    const schema = await usable(RUN_SCHEMA);
    const record = readable(path, text);
    const binding = bindRecord(record, schema);
    const structure = restored(parseEntry(parsed(path, text)), path);
    const back = restoreBinding(kept(bindingEntry(binding)), structure, schema);
    if (back === null) expect.fail("expected the binding entry to restore");
    expect(back.record).toBe(structure);
    expect([...back.lists.keys()]).toEqual([...binding.lists.keys()]);
    for (const [at, list] of binding.lists) {
      const restoredList = back.lists.get(at);
      expect(restoredList?.type).toBe(list.type);
      for (let index = 0; index < (record.nodes.children(at).length ?? 0); index++) {
        expect(restoredList?.keyOf(index)).toBe(list.keyOf(index));
      }
    }
    expect([...back.typedReferences].sort()).toEqual([...binding.typedReferences].sort());
    expect(back.issues.map(shown)).toEqual(binding.issues.map(shown));
    for (const node of allNodes(record)) {
      // The same shape objects, so the proof walks the same schema.
      expect(back.shape(node.at)).toBe(binding.shape(node.at));
      expect(back.declarationOf(node.at)).toEqual(binding.declarationOf(node.at));
    }
    expect(back.shape("/nothing")).toBeNull();
    expect(readOf(back)).toEqual(readOf(binding));
  });

  test("keeps a declared duplicate's mark, which no mode lowers", async () => {
    const schema = await usable(RUN_SCHEMA);
    const [path, text] = BOUND_RECORDS[0] as readonly [string, string];
    const binding = bindRecord(readable(path, text), schema);
    expect(binding.issues.some(isDeclaredDuplicate)).toBe(true);
    const back = restoreBinding(kept(bindingEntry(binding)), restored(parseEntry(parsed(path, text)), path), schema);
    expect(back?.issues.filter(isDeclaredDuplicate)).toHaveLength(binding.issues.filter(isDeclaredDuplicate).length);
  });

  test("is a miss when truncated at any length", async () => {
    const schema = await usable(RUN_SCHEMA);
    const [path, text] = BOUND_RECORDS[0] as readonly [string, string];
    const structure = restored(parseEntry(parsed(path, text)), path);
    const rows = kept(bindingEntry(bindRecord(readable(path, text), schema)));
    expect(restoreBinding(rows, structure, schema)).not.toBeNull();
    for (let length = 0; length < rows.length; length++) {
      expect(restoreBinding(rows.subarray(0, length), structure, schema)).toBeNull();
    }
  });
});

/** The rows of an entry, as objects, without the closing count. */
function rowsOf(entry: Uint8Array): Record<string, unknown>[] {
  const lines = new TextDecoder()
    .decode(entry)
    .split("\n")
    .filter((line) => line !== "");
  return lines.slice(0, -1).map((line) => JSON.parse(line));
}

/** Writes rows as an entry, with the closing count right, so that only the change under test is wrong. */
function entryOf(rows: readonly Record<string, unknown>[]): Uint8Array {
  const lines = rows.map((row) => JSON.stringify(row));
  return encoder.encode(`${[...lines, JSON.stringify({ t: "end", rows: rows.length })].join("\n")}\n`);
}

describe("a parse entry is a miss, never a different record, when a row is not what a parse writes", () => {
  type Change = (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  const at = (where: string) => (row: Record<string, unknown>) => row.t === "node" && row.at === where;
  const cases: readonly (readonly [string, string, string, Change])[] = [
    [
      "a node row with a member a parse does not write",
      "runs/r.json",
      JSON_RECORD,
      (rows) => rows.map((row) => (at("/see")(row) ? { ...row, extra: 1 } : row)),
    ],
    [
      "an object member that claims to be a section",
      "runs/r.json",
      JSON_RECORD,
      (rows) => rows.map((row) => (at("/see")(row) ? { ...row, kind: "section" } : row)),
    ],
    [
      "a JSON section without its title slug",
      "runs/r.json",
      JSON_RECORD,
      (rows) =>
        rows.map((row) => {
          if (!at("/$sections/0")(row)) return row;
          const { title_slug: _, ...rest } = row;
          return rest;
        }),
    ],
    [
      "a reference at no node",
      "docs/design.md",
      MARKDOWN,
      (rows) => rows.map((row) => (row.t === "ref" ? { ...row, at: "/nowhere" } : row)),
    ],
    [
      "a structural error in a readable record",
      "docs/design.md",
      MARKDOWN,
      (rows) => [
        ...rows,
        { t: "issue", code: "syntax-error", severity: "error", class: "structural", own: true, at: "", message: "x" },
      ],
    ],
    [
      "an unreadable record without its structural errors",
      "docs/design.md",
      MARKDOWN,
      () => [{ t: "parse", format: "md", readable: false }],
    ],
    [
      "an unreadable record with an issue that is not a structural error",
      "dup.md",
      RECORDS[3]?.[1] as string,
      (rows) => [{ t: "parse", format: "md", readable: false }, ...rows.filter((row) => row.t === "issue")],
    ],
  ];
  test.each(cases)("%s", (_, path, text, change) => {
    const rows = rowsOf(kept(parseEntry(parsed(path, text))));
    // The near miss: the rows as written restore.
    expect(restoreStructure(entryOf(rows), path)).not.toBeNull();
    expect(restoreStructure(entryOf(change(rows)), path)).toBeNull();
  });

  test("a closing row with a member it does not have", () => {
    const rows = rowsOf(kept(parseEntry(parsed("docs/design.md", MARKDOWN))));
    const text = new TextDecoder()
      .decode(entryOf(rows))
      .replace(/\{"t":"end","rows":(\d+)\}\n$/, '{"t":"end","rows":$1,"x":1}\n');
    expect(restoreStructure(encoder.encode(text), "docs/design.md")).toBeNull();
  });

  test("bytes that are not UTF-8 inside a row's string", () => {
    const rows = kept(parseEntry(parsed("dup.md", RECORDS[3]?.[1] as string)));
    const index = new TextDecoder().decode(rows).indexOf("message") + 'message":"'.length + 1;
    const broken = rows.slice();
    broken[index] = 0xff;
    expect(restoreStructure(rows, "dup.md")).not.toBeNull();
    expect(restoreStructure(broken, "dup.md")).toBeNull();
  });
});

describe("a binding entry is a miss when it does not fit the structure it is restored over", () => {
  type Change = (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  const cases: readonly (readonly [string, Change])[] = [
    [
      "a typed reference at a node that is not a string",
      (rows) => rows.map((row) => (row.t === "ref" && row.at === "/lead" ? { ...row, at: "/items" } : row)),
    ],
    [
      // The `$ref` object has a declaration of its own, so only the node's kind tells it from a typed string.
      "a typed reference at a node that is not a string but has a declaration",
      (rows) => rows.map((row) => (row.t === "ref" && row.at === "/lead" ? { ...row, at: "/see" } : row)),
    ],
    [
      "a keyed list with fewer keys than items",
      (rows) =>
        rows.map((row) => (row.t === "list" && row.at === "/items" ? { ...row, keys: (row.keys as unknown[]).slice(1) } : row)),
    ],
    [
      "a keyed list at a node that is not an array",
      (rows) => rows.map((row) => (row.t === "list" && row.at === "/items" ? { ...row, at: "/see" } : row)),
    ],
  ];
  test.each(cases)("%s", async (_, change) => {
    const schema = await usable(RUN_SCHEMA);
    const [path, text] = BOUND_RECORDS[0] as readonly [string, string];
    const structure = restored(parseEntry(parsed(path, text)), path);
    const rows = rowsOf(kept(bindingEntry(bindRecord(readable(path, text), schema))));
    expect(restoreBinding(entryOf(rows), structure, schema)).not.toBeNull();
    expect(restoreBinding(entryOf(change(rows)), structure, schema)).toBeNull();
  });
});

describe("an entry larger than the bound", () => {
  /** A JSON record of tiny values, whose entry is many times its size: a row per value. */
  const dense = `{"a":[${Array.from({ length: 5000 }, () => "0").join(",")}]}`;

  test("is not written, and a record with more nodes than the bound holds rows for makes no row at all", () => {
    const outcome = parsed("dense.json", dense);
    const whole = kept(parseEntry(outcome, "dense.json"));
    // About 49 times the record, a row per value.
    expect(whole.length).toBeGreaterThan(40 * dense.length);
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(parseEntry(outcome, "dense.json", 64 * 1024)).toBeNull();
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
    // The near miss: under a bound it fits, the entry is written whole, and no larger than the bound.
    expect(kept(parseEntry(outcome, "dense.json", whole.length))).toEqual(whole);
    expect(parseEntry(outcome, "dense.json", whole.length - 1)).toBeNull();
  });

  test("stops writing at the bound, where the node count alone does not refuse it", () => {
    // Long member names: each row is well over the shortest a row can be.
    const members = Array.from({ length: 2000 }, (_, i) => `"a-member-with-a-long-name-${i}": ${i}`);
    const outcome = parsed("long.json", `{${members.join(", ")}}`);
    const whole = kept(parseEntry(outcome, "long.json"));
    const limit = Math.floor(whole.length / 2);
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(parseEntry(outcome, "long.json", limit)).toBeNull();
      // About half the rows were made into text, the first ones past the bound stopping it.
      expect(stringify.mock.calls.length).toBeLessThan(1500);
      expect(stringify.mock.calls.length).toBeGreaterThan(500);
    } finally {
      stringify.mockRestore();
    }
  });

  test("of a binding is not written either", async () => {
    const schema = await usable(RUN_SCHEMA);
    const [path, text] = BOUND_RECORDS[0] as readonly [string, string];
    const binding = bindRecord(readable(path, text), schema);
    const whole = kept(bindingEntry(binding));
    expect(bindingEntry(binding, whole.length)).toEqual(whole);
    expect(bindingEntry(binding, whole.length - 1)).toBeNull();
    // And one past the bound it is read with is a miss.
    const structure = restored(parseEntry(parsed(path, text)), path);
    expect(restoreBinding(whole, structure, schema, whole.length)).not.toBeNull();
    expect(restoreBinding(whole, structure, schema, whole.length - 1)).toBeNull();
  });
});
