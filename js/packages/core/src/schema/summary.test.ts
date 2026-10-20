// `CollectionSchema.summary()`: what a collection's schema says of its records, read along the spine, for `vmd schema`.

import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore } from "../store/store.js";
import { leastTimeRatio, timeOf } from "../timing.testkit.js";
import { type CollectionSchema, spineOf } from "./collection-schema.js";
import { summarizeSchema } from "./summary.js";

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
    expect(summary.fields[2]).toMatchObject({ path: "node.child", sameAs: "node", recursive: true });
    // Recursion is shown, not cut: nothing is left out.
    expect(summary.truncated).toBe(false);
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

describe("a schema's summary, true to the schema", () => {
  test("a mixin applied at the root and at a member is no cycle", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": {
          allOf: [{ $ref: "#/$defs/base" }],
          properties: { child: { $ref: "#/$defs/base" } },
          $defs: { base: { properties: { name: { type: "string" } } } },
        },
      })
    ).summary();
    expect(summary.fields.map((field) => field.path)).toEqual(["child", "child.name", "name"]);
    expect(summary.truncated).toBe(false);
  });

  test("a schema of a few kilobytes that shares definitions gives a bounded summary, each one summarized once", async () => {
    const defs: Record<string, unknown> = {};
    for (let level = 0; level < 9; level++) {
      const next = level < 8 ? { $ref: `#/$defs/d${level + 1}` } : { type: "string" };
      defs[`d${level}`] = { type: "object", properties: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`p${i}`, next])) };
    }
    const summary = (await schemaOf({ "ticket.schema.json": { $ref: "#/$defs/d0", $defs: defs } })).summary();
    expect(summary.fields.length).toBeLessThan(100);
    expect(summary.fields.find((field) => field.path === "p1")).toMatchObject({ sameAs: "p0" });
    expect(summary.fields.find((field) => field.path === "p1")?.recursive).toBeUndefined();
  });

  test("an array of arrays gives its items' items, and an array of objects its items' members", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": {
          properties: {
            m: { type: "array", items: { type: "array", items: { properties: { cell: { type: "number" } } } } },
            rows: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } },
            pair: { type: "array", prefixItems: [{ type: "string" }] },
          },
        },
      })
    ).summary();
    expect(summary.fields.map((field) => field.path)).toEqual([
      "m",
      "m[]",
      "m[][]",
      "m[][].cell",
      "rows",
      "rows[]",
      "rows[].id",
      "pair",
      "pair[]",
    ]);
  });

  test("intersects allOf: types as the types every branch allows, enum as the values every branch allows", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": {
          properties: {
            n: { allOf: [{ type: ["number", "string"] }, { type: "integer" }, { type: "integer" }] },
            s: { allOf: [{ enum: ["a", "b", "c"] }, { enum: ["c", "b"] }] },
            k: { allOf: [{ const: "x" }, { enum: ["x", "y"] }] },
          },
        },
      })
    ).summary();
    expect(summary.fields).toEqual([
      { path: "n", types: ["integer"], required: false },
      { path: "s", types: [], required: false, enum: ["b", "c"] },
      { path: "k", types: [], required: false, enum: ["x"] },
    ]);
  });

  test("lists no member a schema forbids, and says which objects allow no other members", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": {
          additionalProperties: false,
          properties: { a: { type: "string" }, x: false, o: { type: "object", additionalProperties: false } },
        },
      })
    ).summary();
    expect(summary.fields.map((field) => field.path)).toEqual(["a", "o"]);
    expect(summary.closed).toBe(true);
    expect(summary.fields[1]).toMatchObject({ path: "o", closed: true });
  });

  test("marks what it does not show: conditional branches, patterns, other members' schemas, keyed list items", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": {
          anyOf: [{ properties: { z: { type: "string" } } }],
          properties: {
            // A schema's `then` keyword, as data: an object literal with a `then` member reads as a thenable to the linter.
            c: {
              oneOf: [{ type: "string" }, { type: "number" }],
              if: { type: "string" },
              ...JSON.parse('{"then": {"minLength": 1}}'),
            },
            p: { type: "object", patternProperties: { "^x": { type: "string" } }, additionalProperties: { type: "number" } },
            steps: { type: "array", "x-vmd-list": { type: "map", keys: ["name"], items: { build: { type: "object" } } } },
          },
        },
      })
    ).summary();
    expect(summary.notShown).toEqual(["anyOf"]);
    expect(summary.fields).toEqual([
      { path: "c", types: [], required: false, notShown: ["oneOf", "if", "then"] },
      { path: "p", types: ["object"], required: false, notShown: ["patternProperties", "additionalProperties"] },
      { path: "steps", types: ["array"], required: false, notShown: ["x-vmd-list items"] },
    ]);
  });

  test("collects member names in time linear in them, and cuts the fields at 10,000 without stepping past them", async () => {
    /** A schema of `count` members, and a run of its summary that gives its time. */
    const timed = async (count: number) => {
      const properties = Object.fromEntries(Array.from({ length: count }, (_, index) => [`f${index}`, true]));
      const value = { properties };
      const schema = await schemaOf({ "ticket.schema.json": value });
      const at = (location: { readonly pointer: string }) =>
        location.pointer === "" ? value : (properties[location.pointer.split("/").pop() as string] as boolean);
      return { schema, run: () => timeOf(() => summarizeSchema("tickets", schema.root, at)) };
    };
    const small = await timed(35_000);
    const large = await timed(70_000);
    // Twice the members, about twice the time; the quadratic collection of names gave 4.
    expect(await leastTimeRatio(small.run, large.run, 3)).toBeLessThan(3);
    const summary = large.schema.summary();
    expect(summary.fields.length).toBe(10_000);
    expect(summary.truncated).toBe(true);
    // And the members past the cut are not stepped to: nothing is built that the summary does not give.
    expect(spineOf(large.schema)?.stepsComputed).toBeLessThan(20_000);
  }, 120_000);

  test("takes the required sections from the record's own $sections, not from a member's keyed by a field", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": {
          properties: {
            x: {
              properties: {
                $sections: { type: "array", "x-vmd-list": { type: "map", keys: ["id"], required: ["zz"] } },
              },
            },
          },
        },
      })
    ).summary();
    expect(summary.sections).toEqual([]);
    expect(summary.lists.map((list) => list.path)).toEqual(["x.$sections"]);
  });

  test("marks no empty patternProperties as not shown, and marks one with a pattern", async () => {
    const summary = (
      await schemaOf({
        "ticket.schema.json": {
          properties: {
            p: { type: "object", patternProperties: {} },
            q: { type: "object", patternProperties: { "^x": { type: "string" } } },
          },
        },
      })
    ).summary();
    expect(summary.fields).toEqual([
      { path: "p", types: ["object"], required: false },
      { path: "q", types: ["object"], required: false, notShown: ["patternProperties"] },
    ]);
  });

  test("merges only fields whose members are the same, over generated schemas that share definitions", async () => {
    let wrong = 0;
    let merges = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const generated = generatedSchema(seed);
      const summary = (await schemaOf({ "ticket.schema.json": generated })).summary();
      for (const field of summary.fields) {
        if (field.sameAs === undefined || field.recursive === true) continue;
        merges += 1;
        const own = membersBelow(generated, nodesAt(generated, field.path), 3);
        const first = membersBelow(generated, nodesAt(generated, field.sameAs), 3);
        if (JSON.stringify(own) !== JSON.stringify(first)) wrong += 1;
      }
    }
    expect(merges).toBeGreaterThan(50);
    expect(wrong).toBe(0);
  }, 120_000);
});

// A generator of schemas that share definitions through `$ref` and `allOf`, with `true` schemas among them, and an oracle of
// the member paths below a field that reads the schema itself, without the spine.

type Schema = Record<string, unknown> | boolean;

/** Gives the schema of a seed: members of up to three levels, their values `$ref`s, `allOf`s, `true` or strings. */
function generatedSchema(seed: number): Record<string, unknown> {
  let state = seed;
  const random = (n: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const definitions = 5;
  const value = (depth: number): Schema => {
    const choice = random(9);
    if (choice === 0) return true;
    if (choice === 1 || choice === 2) return { $ref: `#/$defs/D${random(definitions)}` };
    if (choice === 3) return { allOf: [true, { $ref: `#/$defs/D${random(definitions)}` }] };
    if (choice === 4) return { $ref: `#/$defs/D${random(definitions)}`, title: "t" };
    if (choice === 5 && depth < 2) return { properties: members(depth + 1) };
    if (choice === 6) return { allOf: [{ $ref: "#/$defs/B" }, { $ref: `#/$defs/D${random(definitions)}` }] };
    if (choice === 7 && depth < 2) {
      return { allOf: [true, { properties: members(depth + 1) }, { $ref: `#/$defs/D${random(definitions)}` }] };
    }
    return { type: "string" };
  };
  const members = (depth: number): Record<string, Schema> => {
    const found: Record<string, Schema> = {};
    const count = 1 + random(3);
    for (let index = 0; index < count; index++) found[`m${random(4)}`] = value(depth);
    return found;
  };
  const defs: Record<string, Schema> = { B: true };
  for (let index = 0; index < definitions; index++) defs[`D${index}`] = random(4) === 0 ? true : { properties: members(1) };
  return { properties: members(0), $defs: defs };
}

/** Every schema that applies with `nodes`: themselves, and what their `allOf` and `$ref` bring, each once. */
function closure(root: Record<string, unknown>, nodes: readonly Schema[]): Schema[] {
  const found: Schema[] = [];
  const seen = new Set<Schema>();
  const pending = [...nodes];
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    if (seen.has(next)) continue;
    seen.add(next);
    found.push(next);
    if (typeof next !== "object") continue;
    if (Array.isArray(next.allOf)) pending.push(...(next.allOf as Schema[]));
    if (typeof next.$ref === "string") {
      pending.push((root.$defs as Record<string, Schema>)[next.$ref.split("/").pop() as string] as Schema);
    }
  }
  return found;
}

/** The member paths below `nodes`, to `depth` levels, sorted, those a `false` forbids left out. */
function membersBelow(root: Record<string, unknown>, nodes: readonly Schema[], depth: number): string[] {
  if (depth === 0) return [];
  const names = new Map<string, Schema[]>();
  for (const node of closure(root, nodes)) {
    if (typeof node !== "object" || typeof node.properties !== "object" || node.properties === null) continue;
    for (const [name, schema] of Object.entries(node.properties as Record<string, Schema>)) {
      names.set(name, [...(names.get(name) ?? []), schema]);
    }
  }
  const paths: string[] = [];
  for (const [name, schemas] of names) {
    if (schemas.some((schema) => schema === false)) continue;
    paths.push(name);
    for (const below of membersBelow(root, schemas, depth - 1)) paths.push(`${name}.${below}`);
  }
  return paths.sort();
}

/** The schemas at a member path, `.` between members. */
function nodesAt(root: Record<string, unknown>, path: string): Schema[] {
  let nodes: Schema[] = [root];
  for (const step of path === "" ? [] : path.split(".")) {
    nodes = closure(root, nodes).flatMap((node) =>
      typeof node === "object" && typeof node.properties === "object" && node.properties !== null && step in node.properties
        ? [(node.properties as Record<string, Schema>)[step] as Schema]
        : [],
    );
  }
  return nodes;
}
