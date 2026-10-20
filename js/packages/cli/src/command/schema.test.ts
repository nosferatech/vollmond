// `vmd schema [COLLECTION] [--all]`: the collections, or one collection's schema in one screen.

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
