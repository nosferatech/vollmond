// `vmd schema [COLLECTION] [--all]`: the collections, or one collection's schema in one screen.

import { chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type CliEnvironment, runCli } from "../cli.js";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";

const CONFIG = [
  "vmd: 1",
  "collections:",
  "  tickets:",
  '    match: ["tickets/*.md"]',
  "    schema: ticket.schema.json",
  "  notes:",
  '    match: ["notes/*.md", "notes/*.json"]',
  "",
].join("\n");

const TICKET = {
  type: "object",
  required: ["status", "owner"],
  properties: {
    status: { type: "string", enum: ["open", "doing", "done"], "x-vmd-ordered": "asc", "x-vmd-summary": true },
    owner: { type: "string", format: "uri-reference", "x-vmd-ref": { targets: ["people/**"] } },
    due: { type: "string", format: "date" },
    $sections: { type: "array", "x-vmd-list": { type: "map", keys: ["@key"], required: ["context", "done"] } },
  },
};

function store(schema: unknown = TICKET): string {
  return writeFiles(temporaryDirectory(), {
    ".vmd/config.yaml": CONFIG,
    ".vmd/schema/ticket.schema.json": JSON.stringify(schema),
    "tickets/1.md": "# One\n",
    "tickets/2.md": "# Two\n",
    "notes/a.md": "# A\n",
    "loose.md": "# L\n",
  });
}

function env(root: string): Partial<CliEnvironment> {
  return { cwd: root, unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }) };
}

async function vmd(root: string, ...args: string[]) {
  const result = await runCli(args, env(root));
  return { ...result, stdout: String(result.stdout) };
}

describe("schema without a name", () => {
  test("lists each collection, in the order of their names, with its globs, its schema file and its records", async () => {
    expect(await vmd(store(), "schema")).toEqual({
      stdout:
        "notes    notes/*.md, notes/*.json  (no schema)         1 record\n" +
        "tickets  tickets/*.md              ticket.schema.json  2 records\n" +
        "1 record in no collection\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("loads no schema, so an invalid one does not fail it", async () => {
    const result = await vmd(store({ type: 5 }), "schema");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("gives the collections as data under --json", async () => {
    const outcome = JSON.parse((await vmd(store(), "--json", "schema")).stdout);
    expect(outcome.value).toEqual({
      collections: [
        { name: "notes", match: ["notes/*.md", "notes/*.json"], records: 1 },
        { name: "tickets", match: ["tickets/*.md"], schema: "ticket.schema.json", records: 2 },
      ],
      unclaimed: 1,
      conflicted: 0,
    });
  });
});

describe("schema COLLECTION", () => {
  test("prints the fields, the keyed lists and the required sections in one screen", async () => {
    const result = await vmd(store(), "schema", "tickets");
    expect(result.stdout).toBe(
      "tickets  ticket.schema.json  2 records\n" +
        "fields\n" +
        "  status  string  required  enum open < doing < done  summary\n" +
        "  owner   string  required  uri-reference  ref to people/**\n" +
        "  due     string            date\n" +
        "keyed lists\n" +
        "  $sections  map by @key  required context, done\n" +
        "required sections\n" +
        "  context, done\n",
    );
    expect(result.exitCode).toBe(0);
  });

  test("cuts at 40 lines unless --all, and says how many it left out", async () => {
    const properties = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`f${index}`, { type: "string" }]));
    const root = store({ type: "object", properties });
    const cut = await vmd(root, "schema", "tickets");
    const lines = cut.stdout.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(41);
    expect(lines.at(-1)).toBe("… 22 more lines (--all)");
    const all = await vmd(root, "schema", "tickets", "--all");
    expect(all.stdout).toContain("  f59  string\n");
    expect(all.stdout).not.toContain("more lines");
  });

  test("gives the summary as data under --json", async () => {
    const outcome = JSON.parse((await vmd(store(), "--json", "schema", "tickets")).stdout);
    expect(outcome.value.collection).toBe("tickets");
    expect(outcome.value.fields[0]).toMatchObject({ path: "status", enum: ["open", "doing", "done"] });
    expect(outcome.value.sections).toEqual(["context", "done"]);
  });

  test("says that a collection without a schema has none", async () => {
    expect((await vmd(store(), "schema", "notes")).stdout).toBe("notes  (no schema)  1 record\n");
  });

  test("fails with the schema's issue, exit 1, for a schema that cannot be used", async () => {
    const result = await vmd(store({ type: 5 }), "schema", "tickets");
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^error schema-invalid: /);
    expect(result.exitCode).toBe(1);
  });

  test("fails with address-not-found for a name the configuration does not have, and names those it has", async () => {
    const result = await vmd(store(), "schema", "tickts");
    expect(result.stderr).toMatch(/^error address-not-found: the configuration has no collection named tickts\n/);
    expect(result.stderr).toContain("hint the collections are notes, tickets\n");
    expect(result.exitCode).toBe(1);
  });
});

describe("schema's text, every declaration it writes", () => {
  test("writes descending values, many-valued and explicit references, keyed lists' keys and closed objects", async () => {
    const root = store({
      type: "object",
      additionalProperties: false,
      anyOf: [{ required: ["level"] }],
      properties: {
        level: { enum: ["high", "low"], "x-vmd-ordered": "desc" },
        links: { type: "string", format: "uri-reference", "x-vmd-ref": { cardinality: "many", anchors: "explicit" } },
        meta: { type: "object", additionalProperties: false, properties: { a: { type: "string" } } },
        copy: { $ref: "#/properties/meta" },
        steps: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" } } },
          "x-vmd-list": { type: "map", keys: ["name"], items: { build: { type: "object" } }, additional: false },
        },
      },
    });
    expect((await vmd(root, "schema", "tickets")).stdout).toBe(
      "tickets  ticket.schema.json  2 records\n" +
        "record  no members but these  not shown: anyOf\n" +
        "fields\n" +
        "  level                   enum high > low\n" +
        "  links         string    uri-reference  refs, explicit anchors\n" +
        "  meta          object    no other members\n" +
        "  meta.a        string\n" +
        "  copy          object    no other members  members as meta\n" +
        "  steps         array     not shown: x-vmd-list items\n" +
        "  steps[]       object\n" +
        "  steps[].name  string\n" +
        "keyed lists\n" +
        "  steps  map by name  items build  no other keys\n",
    );
  });

  test("says that a recursive schema is recursive, and that a summary cut short is cut", async () => {
    const recursive = store({ type: "object", properties: { node: { $ref: "#" } } });
    expect((await vmd(recursive, "schema", "tickets")).stdout).toContain("  node  object    recursive, members as the record\n");
    let deep: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 10; level++) deep = { type: "object", properties: { m: deep } };
    expect((await vmd(store(deep), "schema", "tickets")).stdout).toContain(
      "(cut: the schema goes deeper than eight levels, or past 10,000 fields)\n",
    );
  });

  test("counts the records of every page of the listing, those the backend cannot read included", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 1001; index++) files[`tickets/${index}.md`] = "# T\n";
    const root = writeFiles(store(), files);
    chmodSync(join(root, "tickets", "1.md"), 0o000);
    try {
      expect((await vmd(root, "schema")).stdout).toContain(
        "tickets  tickets/*.md              ticket.schema.json  1,001 records\n",
      );
    } finally {
      chmodSync(join(root, "tickets", "1.md"), 0o644);
    }
  });

  test("counts apart the records no collection claims and those several do, and writes neither line for none", async () => {
    const both = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": 'vmd: 1\ncollections:\n  a:\n    match: ["*.md"]\n  b:\n    match: ["x*.md"]\n',
      "x1.md": "# X\n",
      "y.md": "# Y\n",
    });
    expect((await vmd(both, "schema")).stdout).toBe(
      "a  *.md   (no schema)  1 record\nb  x*.md  (no schema)  0 records\n1 record claimed by several collections, so by none\n",
    );
    const none = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": 'vmd: 1\ncollections:\n  a:\n    match: ["*.md"]\n',
      "y.md": "# Y\n",
    });
    expect((await vmd(none, "schema")).stdout).toBe("a  *.md  (no schema)  1 record\n");
  });

  test("refuses --all without a collection", async () => {
    const result = await vmd(store(), "schema", "--all");
    expect(result.stderr).toMatch(/^error usage-invalid: --all prints a collection's whole summary/);
    expect(result.exitCode).toBe(2);
  });
});
