// References between schemas and identifiers in a schema's data: core resolves every reference itself, and nothing that is
// not a schema object reaches the validator as one.

import { describe, expect, test } from "vitest";
import { unusable, usable, violationsAt } from "./schema.testkit.js";

const file = (schema: unknown) => ({ "s.json": JSON.stringify(schema) });

describe("identifiers in a position that is not a schema", () => {
  // Review of #97, B1: the validator records anchors on every object, data included, so a hidden one became a $dynamicRef's
  // target, which led it to fetch.
  test.each([
    ["an unknown keyword", { "x-foo": { $dynamicAnchor: "m", $ref: "https://example.com/evil.json" } }],
    ["const", { properties: { b: { const: { $dynamicAnchor: "m", $ref: "https://example.com/evil.json" } } } }],
    ["default", { properties: { b: { default: { $anchor: "m", $ref: "file:///etc/passwd" } } } }],
    ["an unknown keyword, with a type", { "x-foo": { $dynamicAnchor: "m", type: "integer" } }],
  ])("an anchor hidden in %s is schema-invalid", async (_where, hidden) => {
    const schema = { $defs: { d: { $dynamicAnchor: "m", type: "string" } }, properties: { a: { $dynamicRef: "#m" } }, ...hidden };
    const issue = await unusable(file(schema));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toMatch(/\$(dynamicAnchor|anchor) stands in .*, which is not a schema/);
  });

  // Review of #97, S7: the validator strips $id and anchors from data, so a const that holds one never matches.
  test.each(["$id", "$anchor", "$dynamicAnchor", "$schema"])(
    "a const, enum, default or examples holding %s is schema-invalid",
    async (member) => {
      for (const keyword of ["const", "default"]) {
        expect((await unusable(file({ properties: { a: { [keyword]: { [member]: "x", b: 1 } } } }))).message).toMatch(
          `${member} stands in`,
        );
      }
      expect((await unusable(file({ properties: { a: { enum: [{ deep: [{ [member]: "x" }] }] } } }))).code).toBe(
        "schema-invalid",
      );
      expect((await unusable(file({ properties: { a: { examples: [{ [member]: "x" }] } } }))).code).toBe("schema-invalid");
    },
  );

  test("data that holds a $ref object, $comment or $defs is valid, and compared as written", async () => {
    const schema = await usable({
      properties: { a: { const: { $ref: "tickets/1.md" } }, b: { enum: [{ $comment: "x", $defs: {} }] } },
    });
    expect(violationsAt(schema, '{"a": {"$ref": "tickets/1.md"}, "b": {"$comment": "x", "$defs": {}}}')).toEqual([]);
    expect(violationsAt(schema, '{"a": {"$ref": "tickets/2.md"}, "b": {}}')).toEqual(["/a", "/b"]);
  });

  // Review of #97's recheck, optional d: the validator reads an identifier only when its value is a string.
  test("an identifier member whose value is not a string is data, and compared as written", async () => {
    const schema = await usable({
      dependentRequired: { $anchor: ["$tags"] },
      properties: { a: { const: { $id: ["x"], $schema: { y: 1 } } } },
    });
    expect(violationsAt(schema, '{"a": {"$id": ["x"], "$schema": {"y": 1}}}')).toEqual([]);
    expect(violationsAt(schema, '{"$anchor": "x", "$tags": [], "a": {"$id": 6}}')).toEqual(["/a"]);
  });

  test("a property named $id, $anchor or $schema is a name, not an identifier", async () => {
    await usable({ properties: { $id: true, $anchor: true, $schema: true }, required: ["$id"] });
  });

  test("$schema in a subschema is schema-invalid, at its place, and at a file's root it is not", async () => {
    const issue = await unusable({ "s.json": '{"properties": {"a": {"$schema": "http://json-schema.org/draft-07/schema#"}}}' });
    expect(issue.message).toContain("s.json:1:23: $schema stands only at the root of a schema file");
  });
});

describe("reference targets", () => {
  // Review of #97, S4: a $ref into an unknown keyword reached a value that the meta-schema never checked.
  test.each([
    ["an unknown keyword", { "x-defs": { bad: { type: 5 } }, properties: { a: { $ref: "#/x-defs/bad" } } }],
    ["a const", { $defs: { c: { const: { type: "string" } } }, properties: { a: { $ref: "#/$defs/c/const" } } }],
    ["examples", { properties: { a: { examples: [{ type: "integer" }] }, b: { $ref: "#/properties/a/examples/0" } } }],
    ["the map of properties", { properties: { a: { $ref: "#/properties" } } }],
  ])("a $ref into %s, which is not a schema, is schema-invalid", async (_where, schema) => {
    const issue = await unusable(file(schema));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain("which is not a schema");
  });

  test("a $ref into $defs, a per-key schema of x-vmd-list and another file's subschema is valid", async () => {
    await usable(
      {
        properties: {
          l: { type: "array", "x-vmd-list": { type: "map", keys: ["k"], items: { a: { type: "object" } } } },
          b: { $ref: "#/properties/l/x-vmd-list/items/a" },
          c: { $ref: "o.json#/properties/x" },
        },
      },
      { "o.json": '{"properties": {"x": {"type": "string"}}}' },
    );
  });

  // Review of #97, B2: the two references of one schema object shared one entry, so the $ref's file was never read.
  test("a $ref and a $dynamicRef in one schema object both apply", async () => {
    const schema = await usable(
      { $defs: { x: { $dynamicAnchor: "x", type: "string" } }, properties: { a: { $ref: "o.json", $dynamicRef: "#x" } } },
      { "o.json": '{"type": "integer"}' },
    );
    expect(violationsAt(schema, '{"a": "s"}')).toEqual(["/a"]);
    expect(violationsAt(schema, '{"a": 5}')).toEqual(["/a"]);
    expect(violationsAt(schema, '{"a": 5.5}')).toEqual(["/a"]);
  });

  test("a $dynamicRef follows the dynamic scope among the anchors core knows", async () => {
    // The tree's nodes are extended through the root's $dynamicAnchor, as 2020-12's own example does.
    const schema = await usable(
      { $ref: "tree.json", $dynamicAnchor: "node", properties: { n: { type: "number" } } },
      { "tree.json": '{"$dynamicAnchor": "node", "properties": {"kids": {"items": {"$dynamicRef": "#node"}}}}' },
    );
    expect(violationsAt(schema, '{"kids": [{"n": "x"}]}')).toEqual(["/kids/0/n"]);
  });
});
