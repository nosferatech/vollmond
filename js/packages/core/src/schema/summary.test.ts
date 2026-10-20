// `CollectionSchema.summary()`: what a collection's schema says of its records, read along the spine, for `vmd schema`.

import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore } from "../store/store.js";
import type { CollectionSchema } from "./collection-schema.js";

function successValue<T>(outcome: Outcome<T> | null): T {
  if (outcome === null) expect.fail("expected a schema");
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** Loads the schema of the collection `tickets` from schema files. */
async function schemaOf(files: Record<string, unknown>): Promise<CollectionSchema> {
  const schemaFiles = Object.fromEntries(
    Object.entries(files).map(([name, value]) => [`.vmd/schema/${name}`, JSON.stringify(value)]),
  );
  const store = successValue(
    await openStore(
      createMemoryStorage({
        files: {
          ".vmd/config.yaml": 'vmd: 1\ncollections:\n  tickets:\n    match: ["t/*.md"]\n    schema: ticket.schema.json\n',
          ...schemaFiles,
        },
      }),
    ),
  );
  return successValue(await store.schema(store.configuration.collections[0] as never));
}

const TICKET = {
  type: "object",
  required: ["status", "owner"],
  properties: {
    status: { type: "string", enum: ["open", "doing", "done"], "x-vmd-ordered": "asc", "x-vmd-summary": true },
    owner: { $ref: "#/$defs/person" },
    due: { type: "string", format: "date" },
    meta: { type: "object", required: ["priority"], properties: { priority: { type: ["integer", "null"] } } },
    tags: { type: "array", items: { type: "string" } },
    steps: { type: "array", "x-vmd-list": { type: "map", keys: ["name"], required: ["build"] } },
    $sections: {
      type: "array",
      "x-vmd-list": { type: "map", keys: ["@key"], required: ["context", "done"], items: { done: { type: "object" } } },
    },
  },
  $defs: {
    person: {
      type: "string",
      format: "uri-reference",
      "x-vmd-ref": { targets: ["people/**"], cardinality: "one", anchors: "explicit" },
    },
  },
};

describe("a schema's summary", () => {
  test("gives each field with its type, logical type, values, whether it is required, its reference and summary flag", async () => {
    const summary = (await schemaOf({ "ticket.schema.json": TICKET })).summary();
    expect(summary.fields).toEqual([
      { path: "status", types: ["string"], required: true, enum: ["open", "doing", "done"], ordered: "asc", summary: true },
      {
        path: "owner",
        types: ["string"],
        required: true,
        format: "uri-reference",
        ref: { targets: ["people/**"], cardinality: "one", anchors: "explicit" },
      },
      { path: "due", types: ["string"], required: false, format: "date" },
      { path: "meta", types: ["object"], required: false },
      { path: "meta.priority", types: ["integer", "null"], required: true },
      { path: "tags", types: ["array"], required: false },
      { path: "tags[]", types: ["string"], required: false },
      { path: "steps", types: ["array"], required: false },
    ]);
  });

  test("gives the keyed lists with their keys and required items, and the required sections apart", async () => {
    const summary = (await schemaOf({ "ticket.schema.json": TICKET })).summary();
    expect(summary.lists).toEqual([
      { path: "steps", type: "map", key: "name", required: ["build"], items: [], additional: true },
      { path: "$sections", type: "map", key: "@key", required: ["context", "done"], items: ["done"], additional: true },
    ]);
    expect(summary.sections).toEqual(["context", "done"]);
  });

  test("follows a $ref into another file, and stops at a schema that refers to itself", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": { type: "object", properties: { node: { $ref: "node.schema.json" } } },
        "node.schema.json": { type: "object", properties: { name: { type: "string" }, child: { $ref: "#" } } },
      })
    ).summary();
    expect(summary.fields.map((field) => field.path)).toEqual(["node", "node.name", "node.child"]);
    expect(summary.truncated).toBe(true);
  });

  test("goes down eight levels of members at most", async () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 10; level++) schema = { type: "object", properties: { m: schema } };
    const summary = (await schemaOf({ "ticket.schema.json": schema })).summary();
    expect(summary.fields.map((field) => field.path).at(-1)).toBe("m.m.m.m.m.m.m.m");
    expect(summary.truncated).toBe(true);
    // The near miss: eight levels in all are summarized whole.
    let shallow: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 8; level++) shallow = { type: "object", properties: { m: shallow } };
    expect((await schemaOf({ "ticket.schema.json": shallow })).summary().truncated).toBe(false);
  });

  test("gives a const as the one value a field may take", async () => {
    const summary = (await schemaOf({ "ticket.schema.json": { properties: { kind: { const: "ticket" } } } })).summary();
    expect(summary.fields).toEqual([{ path: "kind", types: [], required: false, enum: ["ticket"] }]);
  });

  test("gives no fields for a schema that names none", async () => {
    const summary = (await schemaOf({ "ticket.schema.json": {} })).summary();
    expect(summary).toEqual({ collection: "tickets", fields: [], lists: [], sections: [], truncated: false });
  });
});
