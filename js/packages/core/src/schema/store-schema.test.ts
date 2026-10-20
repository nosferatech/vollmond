// What a collection's schema changes in a store's reads and checks: violations in check, and readers refusing the records of
// a collection whose schema cannot be used, whichever of the two codes it got.

import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore, type Store } from "../store/store.js";

const CONFIG = [
  "vmd: 1",
  "collections:",
  "  tickets:",
  '    match: ["tickets/*.json"]',
  "    schema: ticket.schema.json",
  "  invalid:",
  '    match: ["invalid/*.json"]',
  "    schema: invalid.schema.json",
  "  newer:",
  '    match: ["newer/*.json"]',
  "    schema: newer.schema.yaml",
  "  both:",
  '    match: ["both/*.json", "tickets/both.json"]',
  "",
].join("\n");

const FILES = {
  ".vmd/config.yaml": CONFIG,
  ".vmd/schema/ticket.schema.json": '{"required": ["status"], "properties": {"status": {"enum": ["Open", "Closed"]}}}',
  ".vmd/schema/invalid.schema.json": '{"properties": {"l": {"oneOf": [{"x-vmd-list": {"type": "map", "keys": ["k"]}}]}}}',
  ".vmd/schema/newer.schema.yaml": "properties:\n  a: { x-vmd-future: true }\n",
  "tickets/open.json": '{"status": "Open"}',
  "tickets/wrong.json": '{"status": "Nope"}',
  "tickets/both.json": '{"status": 5}',
  "invalid/a.json": '{"l": [1]}',
  "newer/a.json": '{"a": 1}',
  "loose.json": '{"status": "Nope"}',
};

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function store(): Promise<Store> {
  return successValue(await openStore(createMemoryStorage({ files: FILES })));
}

describe("check with collection schemas", () => {
  test("reports each record's violations, a schema that cannot be used once, and validates no record of no collection", async () => {
    const checked = await (await store()).check();
    expect(checked.ok).toBe(true);
    expect(checked.issues.map((issue) => [issue.code, issue.path, issue.at])).toEqual([
      ["schema-invalid", null, null],
      ["feature-unsupported", null, null],
      ["collection-conflict", "tickets/both.json", ""],
      ["schema-violation", "tickets/wrong.json", "/status"],
    ]);
    expect(checked.ok && checked.value).toMatchObject({ records: 6, unreadable: 0 });
  });

  test("with records, validates only those", async () => {
    const checked = await (await store()).check({ records: ["tickets/open.json"] });
    expect(checked.issues).toEqual([]);
  });
});

describe("readers and a schema that cannot be used", () => {
  test("get refuses a record of a collection whose schema is off the spine, with schema-invalid", async () => {
    const read = await (await store()).get("invalid/a.json");
    expect(read.ok).toBe(false);
    expect(read.issues.map((issue) => issue.code)).toEqual(["schema-invalid"]);
    expect(read.issues[0]?.message).toContain("reached through oneOf");
  });

  test("get refuses a record of a collection whose schema has an unknown x-vmd-* keyword, with feature-unsupported", async () => {
    const read = await (await store()).get("newer/a.json");
    expect(read.issues.map((issue) => issue.code)).toEqual(["feature-unsupported"]);
  });

  test("get reads a record of a collection whose schema can be used, valid or not", async () => {
    const read = await (await store()).get("tickets/wrong.json#status");
    expect(successValue(read).value).toBe("Nope");
  });

  test("ls counts the refused records as unreadable, and reports each schema's issue once", async () => {
    const page = successValue(await (await store()).list({ limit: 100 }));
    expect(page.unreadable.count).toBe(2);
    const listed = await (await store()).list({ limit: 100 });
    expect(listed.issues.map((issue) => issue.code).sort()).toEqual(["feature-unsupported", "schema-invalid"]);
  });
});
