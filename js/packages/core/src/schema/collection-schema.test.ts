import { describe, expect, test } from "vitest";
import { load, record, unusable, usable, violationsAt } from "./schema.testkit.js";

/** A schema file `s.json` holding `schema` as JSON. */
const file = (schema: unknown) => ({ "s.json": JSON.stringify(schema) });

describe("loading a schema: files and references", () => {
  test("a schema with $schema 2020-12, or without $schema, can be used; another $schema is schema-invalid", async () => {
    await usable({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" });
    await usable({ type: "object" });
    const issue = await unusable(file({ $schema: "http://json-schema.org/draft-07/schema#" }));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain("$schema");
  });

  test("$id is schema-invalid at the root and in a subschema, and a property named $id is not", async () => {
    expect((await unusable(file({ $id: "https://example.com/s.json" }))).code).toBe("schema-invalid");
    expect((await unusable(file({ properties: { a: { $id: "a.json" } } }))).message).toContain("$id");
    await usable({ properties: { $id: { type: "string" } }, required: ["$id"] });
  });

  test("a YAML schema with an anchor and an alias is schema-invalid, reported once, and one without them can be used", async () => {
    const issue = await unusable({ "s.yaml": "type: object\nproperties:\n  a: &s { type: string }\n  b: *s\n" }, "s.yaml");
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toMatch(/s\.yaml:3:\d+: .*s\.yaml:4:\d+: /s);
    expect((await load({ "s.yaml": "type: object\nproperties:\n  a: { type: string }\n" }, "s.yaml")).ok).toBe(true);
  });

  test("a YAML schema with a tag is schema-invalid", async () => {
    expect((await unusable({ "s.yaml": "type: !!str object\n" }, "s.yaml")).code).toBe("schema-invalid");
  });

  // Predicted bug: the record-shape code ref-malformed refuses a $ref object with other members, which a schema may have.
  test("a $ref beside other keywords, in YAML and in JSON, is valid 2020-12 and both apply", async () => {
    const yaml = "$defs:\n  s: { type: string }\nproperties:\n  a: { $ref: '#/$defs/s', minLength: 3 }\n";
    const loaded = await load({ "s.yaml": yaml }, "s.yaml");
    if (!loaded.ok) expect.fail(JSON.stringify(loaded.issues));
    expect(violationsAt(loaded.value, '{"a": "xy"}')).toEqual(["/a"]);
    expect(violationsAt(loaded.value, '{"a": 5}')).toEqual(["/a"]);
    expect(violationsAt(loaded.value, '{"a": "xyz"}')).toEqual([]);
    const json = await usable({ $defs: { s: { type: "string" } }, properties: { a: { $ref: "#/$defs/s", minLength: 3 } } });
    expect(violationsAt(json, '{"a": "xy"}')).toEqual(["/a"]);
  });

  test("a schema file with a byte order mark is read", async () => {
    const schema = await usable({}, {});
    expect(schema).toBeDefined();
    const loaded = await load({ "s.yaml": "﻿type: object\nproperties:\n  status: { enum: [Open] }\n" }, "s.yaml");
    if (!loaded.ok) expect.fail(JSON.stringify(loaded.issues));
    expect(violationsAt(loaded.value, '{"status": "Nope"}')).toEqual(["/status"]);
  });

  test("a schema file that is not a mapping, or not UTF-8, or not a .json, .yaml or .yml file, is schema-invalid", async () => {
    expect((await unusable({ "s.json": "[1]" })).code).toBe("schema-invalid");
    expect((await unusable({ "s.json": "{" })).code).toBe("schema-invalid");
    expect((await unusable({ "s.txt": "{}" }, "s.txt")).message).toContain("not a .json, .yaml or .yml file");
    expect((await load({ "s.yml": "type: object\n" }, "s.yml")).ok).toBe(true);
  });

  test("a $ref to another file of the schema directory reads it, through subdirectories and ..", async () => {
    const schema = await usable(
      { properties: { a: { $ref: "defs/common.json#/$defs/s" } } },
      { "defs/common.json": JSON.stringify({ $defs: { s: { $ref: "../more.json" } } }), "more.json": '{"type": "string"}' },
    );
    expect(violationsAt(schema, '{"a": 1}')).toEqual(["/a"]);
    expect(violationsAt(schema, '{"a": "x"}')).toEqual([]);
  });

  test("a $ref by a plain name finds the $anchor, and a $ref to a file with a space in its name finds it", async () => {
    const schema = await usable(
      {
        properties: { a: { $ref: "#prose" }, b: { $ref: "my%20defs.json" } },
        $defs: { p: { $anchor: "prose", type: "object" } },
      },
      { "my defs.json": '{"type": "string"}' },
    );
    expect(violationsAt(schema, '{"a": 1, "b": 2}')).toEqual(["/a", "/b"]);
  });

  test("a $ref to a file that does not exist, or to a place with no schema, is schema-invalid", async () => {
    expect((await unusable(file({ $ref: "missing.json" }))).message).toContain("missing.json does not exist");
    expect((await unusable(file({ $ref: "#/$defs/nothing" }))).message).toContain("has no schema");
    expect((await unusable(file({ $ref: "#nothing" }))).message).toContain("has no schema");
    expect((await unusable(file({ $ref: "#/required/0", required: ["a"] }))).message).toContain("which is not a schema");
  });

  test.each([
    ["https://example.com/s.json", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["//example.com/s.json", "authority"],
    ["/s.json", "absolute path"],
    ["../outside.json", "climbs out"],
    ["a/../../outside.json", "climbs out"],
    ["s.json?x=1", "query"],
    ["sub\\s.json", "backslash"],
    ["%zz.json", "percent-escape"],
    ["a%2Fb.json", "names no file"],
    ["%2E%2E/x.json", "names no file"],
    ["dir/", "directory"],
    ["a//b.json", "empty segment"],
    ["#/a~2b", "not a JSON Pointer"],
    ["#not a name", "neither"],
    ["#a#b", "second #"],
  ])("a $ref %j is schema-invalid: %s", async (ref, why) => {
    const issue = await unusable(file({ $ref: ref }));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain(why);
  });

  test("a $ref of the forms that stay in the directory is accepted", async () => {
    await usable({ $ref: "#" });
    await usable({ $ref: "", type: "object" });
    await usable({ properties: { a: { $ref: "./s.json#/$defs/x" } }, $defs: { x: true } });
    await usable({ properties: { a: { $ref: "#/$defs/a~1b" } }, $defs: { "a/b": true } });
    await usable({ properties: { a: { $ref: "#/$defs/%C3%A9" } }, $defs: { é: true } });
  });

  test("an anchor defined twice in one file is schema-invalid, and the same name in two files is not", async () => {
    const twice = await unusable(file({ $defs: { a: { $anchor: "x" }, b: { $anchor: "x" } } }));
    expect(twice.message).toContain("the anchor x is defined twice in s.json");
    await usable(
      { $defs: { a: { $anchor: "x" } }, properties: { b: { $ref: "o.json#x" } } },
      { "o.json": '{"$defs": {"b": {"$anchor": "x"}}}' },
    );
  });

  test("a $dynamicRef to a $dynamicAnchor validates, and a declaration it reaches is off the spine", async () => {
    const schema = await usable({
      $dynamicAnchor: "node",
      properties: { kids: { items: { $dynamicRef: "#node" } }, n: { type: "number" } },
    });
    expect(violationsAt(schema, '{"kids": [{"n": "x"}]}')).toEqual(["/kids/0/n"]);
    const issue = await unusable(
      file({
        properties: { a: { $dynamicRef: "#l" } },
        $defs: { l: { $dynamicAnchor: "l", type: "array", "x-vmd-list": { type: "map", keys: ["k"] } } },
      }),
    );
    expect(issue.message).toContain("reached through $dynamicRef");
  });

  test("a recursive schema can be used", async () => {
    const schema = await usable({ type: "object", properties: { child: { $ref: "#" }, name: { type: "string" } } });
    expect(violationsAt(schema, '{"child": {"child": {"name": 5}}}')).toEqual(["/child/child/name"]);
  });

  test("a schema that is not valid 2020-12 is schema-invalid, at its place in the file", async () => {
    const issue = await unusable({ "s.json": '{\n  "type": "strin"\n}' });
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain("s.json:2:3: /type is not valid JSON Schema 2020-12");
  });

  test("a per-key schema of x-vmd-list that is not valid 2020-12 is schema-invalid, which the meta-schema alone misses", async () => {
    const issue = await unusable(
      file({ properties: { l: { type: "array", "x-vmd-list": { type: "map", keys: ["k"], items: { a: { type: 5 } } } } } }),
    );
    expect(issue.message).toContain("/properties/l/x-vmd-list/items/a/type is not valid JSON Schema 2020-12");
    const additional = await unusable(
      file({ properties: { l: { type: "array", "x-vmd-list": { type: "map", keys: ["k"], additional: { minimum: "x" } } } } }),
    );
    expect(additional.message).toContain("/properties/l/x-vmd-list/additional/minimum is not valid JSON Schema 2020-12");
    await usable({
      properties: { l: { type: "array", "x-vmd-list": { type: "map", keys: ["k"], items: { a: { type: "object" } } } } },
    });
  });

  test("a pattern that is not an ECMA-262 regular expression is schema-invalid, through the validator's compilation", async () => {
    const issue = await unusable(file({ properties: { a: { pattern: "(" } } }));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain("the validator cannot compile it");
  });

  test("several problems are one issue, which lists each with its file and position", async () => {
    const issue = await unusable({ "s.json": '{"$id": "x", "properties": {"a": {"x-vmd-summary": 1}}}' });
    expect(issue.message).toContain("s.json:1:2: a schema has no $id");
    expect(issue.message).toContain("s.json:1:35: x-vmd-summary must be true or false");
  });

  test("a schema that is missing, too large, or cannot be read keeps the message of the configuration's reading", async () => {
    expect((await unusable({}, "s.json")).message).toBe(
      "the schema s.json of the collection things does not exist, so the collection's records cannot be read",
    );
  });
});

describe("the extension keywords", () => {
  const list = (declaration: unknown) => file({ properties: { l: { type: "array", "x-vmd-list": declaration } } });

  test("an unknown x-vmd-* keyword is feature-unsupported, naming the store's declared version, and refuses the collection", async () => {
    const issue = await unusable(file({ properties: { a: { "x-vmd-future": true } } }), "s.json", 1.2);
    expect(issue.code).toBe("feature-unsupported");
    expect(issue.class).toBe("operation");
    expect(issue.message).toContain("x-vmd-future");
    expect(issue.message).toContain("the schema may need a newer version of vmd");
    expect(issue.message).toContain("the store declares format version 1.2");
  });

  test("a property named like an x-vmd-* keyword is no keyword", async () => {
    await usable({ properties: { "x-vmd-future": { type: "string" } } });
  });

  test("an unknown x-vmd-* keyword beside another problem gives feature-unsupported, listing both", async () => {
    const issue = await unusable(file({ $id: "x", "x-vmd-future": 1 }));
    expect(issue.code).toBe("feature-unsupported");
    expect(issue.message).toContain("$id");
  });

  test.each([
    [5, "must be a mapping"],
    [{ keys: ["k"] }, "has no type"],
    [{ type: 5, keys: ["k"] }, "type must be map or multimap"],
    [{ type: "map" }, "has no keys"],
    [{ type: "map", keys: [] }, "keys must be a list of one key member"],
    [{ type: "map", keys: "k" }, "keys must be a list of one key member"],
    [{ type: "map", keys: ["a", "b"] }, "composite keys are not supported"],
    [{ type: "map", keys: ["/a/b"] }, "a JSON Pointer of one member"],
    [{ type: "map", keys: ["/a~2"] }, "a JSON Pointer of one member"],
    [{ type: "map", keys: ["k"], required: "a" }, "required must be a list of keys"],
    [{ type: "map", keys: ["k"], items: [] }, "items must be a mapping"],
    [{ type: "map", keys: ["k"], items: { a: 5 } }, 'items "a" must be a schema'],
    [{ type: "map", keys: ["k"], additional: "yes" }, "additional must be true, false or a schema"],
  ])("x-vmd-list %j is schema-invalid: %s", async (declaration, why) => {
    const issue = await unusable(list(declaration));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain(why);
  });

  test.each([
    { type: "map", keys: ["k"] },
    { type: "multimap", keys: ["/@key"], required: ["a"], items: { a: { type: "object" }, b: true }, additional: false },
    { type: "map", keys: ["/~1x"], additional: { type: "object" } },
    { type: "map", keys: [""] },
  ])("x-vmd-list %j can be used", async (declaration) => {
    await usable(JSON.parse(list(declaration)["s.json"]));
  });

  const ref = (declaration: unknown) =>
    file({ properties: { p: { type: "string", format: "uri-reference", "x-vmd-ref": declaration } } });

  test.each([
    [5, "must be a mapping"],
    [{ targets: "tickets" }, "targets must be a list"],
    [{ targets: [5] }, "targets must be a list"],
    [{ targets: ["docs//x"] }, "malformed"],
    [{ cardinality: 2 }, "cardinality must be one or many"],
    [{ anchors: true }, "anchors must be any or explicit"],
  ])("x-vmd-ref %j is schema-invalid: %s", async (declaration, why) => {
    const issue = await unusable(ref(declaration));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain(why);
  });

  test.each([{}, { targets: ["tickets", "docs/**"], cardinality: "many", anchors: "explicit" }, { targets: [] }])(
    "x-vmd-ref %j can be used",
    async (declaration) => {
      await usable(JSON.parse(ref(declaration)["s.json"]));
    },
  );

  // A member or a value that this version does not define may come from a newer minor version, as an unknown keyword may.
  test.each([
    ['x-vmd-list has the member "unique"', list({ type: "map", keys: ["k"], unique: true })],
    ['x-vmd-list type "set"', list({ type: "set", keys: ["k"] })],
    ['x-vmd-ref has the member "target"', ref({ target: ["tickets"] })],
    ['x-vmd-ref cardinality "some"', ref({ cardinality: "some" })],
    ['x-vmd-ref anchors "none"', ref({ anchors: "none" })],
  ])("%s is feature-unsupported", async (what, files) => {
    const issue = await unusable(files, "s.json", 1.2);
    expect(issue.code).toBe("feature-unsupported");
    expect(issue.class).toBe("operation");
    expect(issue.message).toContain(what);
    expect(issue.message).toContain("this version of vmd does not define");
    expect(issue.message).toContain("the schema may need a newer version of vmd");
    expect(issue.message).toContain("the store declares format version 1.2");
  });

  test("an unknown member or value beside another problem gives feature-unsupported, listing both", async () => {
    const value = await unusable(list({ type: "set", keys: "k" }));
    expect(value.code).toBe("feature-unsupported");
    expect(value.message).toContain('type "set"');
    expect(value.message).toContain("keys must be a list of one key member");
    const member = await unusable(file({ $id: "x", properties: { p: { "x-vmd-ref": { order: "asc" } } } }));
    expect(member.code).toBe("feature-unsupported");
    expect(member.message).toContain("$id");
    expect(member.message).toContain('has the member "order"');
  });

  test("x-vmd-summary must be a boolean", async () => {
    const summary = await unusable(file({ properties: { p: { "x-vmd-summary": "yes" } } }));
    expect(summary.code).toBe("schema-invalid");
    expect(summary.message).toContain("x-vmd-summary must be true or false");
    await usable({ properties: { p: { "x-vmd-summary": false }, q: { "x-vmd-summary": true } } });
  });

  test("x-vmd-ordered must be asc or desc, beside an enum", async () => {
    const ordered = await unusable(file({ properties: { p: { enum: ["a"], "x-vmd-ordered": "up" } } }));
    expect(ordered.code).toBe("schema-invalid");
    expect(ordered.message).toContain("x-vmd-ordered must be asc or desc");
    expect((await unusable(file({ properties: { p: { "x-vmd-ordered": "asc" } } }))).message).toContain("beside an enum");
    await usable({
      properties: { p: { enum: ["Low", "High"], "x-vmd-ordered": "asc" }, q: { enum: [1], "x-vmd-ordered": "desc" } },
    });
  });
});

describe("the spine", () => {
  const keyed = { type: "array", "x-vmd-list": { type: "map", keys: ["name"] } };

  // Predicted bug: a declaration under oneOf, which the proof of §7.4 could not read from the schema alone.
  test.each([
    ["oneOf", { oneOf: [{ properties: { l: keyed } }] }],
    ["anyOf", { anyOf: [{ properties: { l: keyed } }] }],
    ["then", JSON.parse(`{"if": true, "then": {"properties": {"l": ${JSON.stringify(keyed)}}}}`)],
    ["not", { not: { properties: { l: keyed } } }],
    ["dependentSchemas", { dependentSchemas: { a: { properties: { l: keyed } } } }],
    ["contains", { properties: { a: { contains: { properties: { l: keyed } } } } }],
    ["unevaluatedProperties", { unevaluatedProperties: { "x-vmd-ref": {}, format: "uri-reference" } }],
  ])("an x-vmd-list or x-vmd-ref reached only through %s is schema-invalid", async (via, schema) => {
    const issue = await unusable(file(schema));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message).toContain(`reached through ${via}`);
  });

  test("a declaration reached through a $ref under oneOf is off the spine too", async () => {
    const issue = await unusable(file({ oneOf: [{ properties: { l: { $ref: "#/$defs/l" } } }], $defs: { l: keyed } }));
    expect(issue.message).toContain("reached through oneOf");
  });

  // Predicted bug: an unreferenced $defs entry with a declaration under oneOf, which is valid since nothing applies it.
  test("a declaration in $defs that nothing references, even under oneOf, is valid", async () => {
    await usable({ $defs: { unused: { oneOf: [{ properties: { l: keyed } }] } }, type: "object" });
  });

  // Review of #97, S1: a declaration reached on the spine at one place and through a branch at another would silently not apply
  // at the second, so it is refused as one reached only off the spine is.
  test("a declaration that the spine reaches as well as a branch is schema-invalid", async () => {
    const issue = await unusable(
      file({
        properties: { a: { $ref: "#/$defs/l" } },
        oneOf: [{ properties: { b: { $ref: "#/$defs/l" } } }],
        $defs: { l: keyed },
      }),
    );
    expect(issue.message).toContain("is reached through oneOf");
  });

  test("a declaration that the spine reaches at two places is valid", async () => {
    await usable({ properties: { a: { $ref: "#/$defs/l" }, b: { items: { $ref: "#/$defs/l" } } }, $defs: { l: keyed } });
  });

  // Review of #97, O3: a $dynamicRef may land on any $dynamicAnchor of its name in the files read.
  test("a declaration at another file's $dynamicAnchor of a $dynamicRef's name is off the spine", async () => {
    const issue = await unusable({
      "s.json": JSON.stringify({
        properties: { a: { $dynamicRef: "#l" }, b: { $ref: "o.json" } },
        $defs: { l: { $dynamicAnchor: "l" } },
      }),
      "o.json": JSON.stringify({ $defs: { x: { $dynamicAnchor: "l", ...keyed } } }),
    });
    expect(issue.message).toContain("o.json");
    expect(issue.message).toContain("reached through $dynamicRef");
  });

  // Review of #97, S2: the spine's check built every set of locations a path can reach, exponential in the schema's size.
  test("the spine's check takes time polynomial in the schema, over a schema whose paths reach exponentially many sets", async () => {
    // Paths through this schema reach about 2^n distinct sets of locations, so a check that builds each set never ends at n = 40
    // (the review measured 8.9 s and 1.26 GB at n = 18); one over pairs of locations takes milliseconds. No time is asserted,
    // since a time bound fails on loaded machines first.
    const n = 40;
    const defs: Record<string, unknown> = {};
    for (let index = 1; index < n; index++) {
      defs[`q${index}`] = { properties: { a: { $ref: `#/$defs/q${index + 1}` }, b: { $ref: `#/$defs/q${index + 1}` } } };
    }
    defs[`q${n}`] = { type: "object" };
    await usable({ properties: { a: { allOf: [{ $ref: "#" }, { $ref: "#/$defs/q1" }] }, b: { $ref: "#" } }, $defs: defs });
  }, 60_000);

  // Review of #97, O1: additionalProperties and patternProperties reach a section's $sections too.
  test("a list that additionalProperties or a pattern brings to a section's $sections follows the $sections rule", async () => {
    const byName = { type: "array", "x-vmd-list": { type: "map", keys: ["name"] } };
    expect((await unusable(file({ additionalProperties: byName }))).message).toContain('$sections takes keys: ["@key"] only');
    expect((await unusable(file({ patternProperties: { "^\\$sec": byName } }))).message).toContain(
      '$sections takes keys: ["@key"] only',
    );
    await usable({ properties: { $sections: { type: "array" } }, additionalProperties: byName });
    await usable({ patternProperties: { "^data": byName } });
    // Review of #97's recheck, optional e: the message names the way out, which a YAML record's schema often needs.
    expect((await unusable(file({ additionalProperties: byName }))).message).toContain("properties: {$sections: false}");
    expect((await unusable(file({ properties: { $sections: byName } }))).message).not.toContain("properties: {$sections: false}");
    await usable({ properties: { $sections: false }, additionalProperties: byName });
  });

  test.each([
    ["properties", { properties: { l: keyed } }],
    ["patternProperties", { patternProperties: { "^l": keyed } }],
    ["additionalProperties", { properties: { d: { additionalProperties: keyed } } }],
    ["items", { properties: { a: { type: "array", items: { properties: { l: keyed } } } } }],
    ["prefixItems", { properties: { a: { type: "array", prefixItems: [{ properties: { l: keyed } }] } } }],
    ["allOf", { allOf: [{ properties: { l: keyed } }] }],
    ["$ref", { properties: { l: { $ref: "#/$defs/l" } }, $defs: { l: keyed } }],
    [
      "x-vmd-list items",
      {
        properties: {
          m: { type: "array", "x-vmd-list": { type: "map", keys: ["k"], items: { a: { properties: { l: keyed } } } } },
        },
      },
    ],
    [
      "x-vmd-list additional",
      {
        properties: {
          m: { type: "array", "x-vmd-list": { type: "map", keys: ["k"], additional: { properties: { l: keyed } } } },
        },
      },
    ],
  ])("a declaration reached through %s is on the spine", async (_via, schema) => {
    await usable(schema);
  });

  test("unequal declarations that allOf brings to one location are schema-invalid; equal ones are valid", async () => {
    const other = { type: "array", "x-vmd-list": { type: "multimap", keys: ["name"] } };
    const issue = await unusable(file({ properties: { l: { allOf: [keyed, other] } } }));
    expect(issue.message).toContain("unequal x-vmd-list declarations");
    await usable({ properties: { l: { allOf: [keyed, keyed] } } });
  });

  test("unequal declarations that a $ref beside a keyword brings are schema-invalid", async () => {
    const issue = await unusable(
      file({
        properties: { p: { $ref: "#/$defs/r", format: "uri-reference", "x-vmd-ref": { cardinality: "many" } } },
        $defs: { r: { type: "string", "x-vmd-ref": {} } },
      }),
    );
    expect(issue.message).toContain("unequal x-vmd-ref declarations");
  });

  // Issue #109, its second finding: a keyed list's item was taken only at the index past the longest prefixItems, so a key's
  // schema never met a prefixItems entry, although the item with that key can stand at that entry's index.
  describe("a keyed list's item meets the prefixItems entry of its index", () => {
    const item = (cardinality: string) => ({ type: "object", "x-vmd-ref": { cardinality } });
    const list = (entry: unknown, extra: object = {}) => ({
      type: "object",
      properties: {
        l: {
          type: "array",
          ...extra,
          "x-vmd-list": { type: "map", keys: ["name"], items: { foo: entry } },
        },
      },
    });

    test("so unequal declarations there are schema-invalid", async () => {
      const issue = await unusable(file(list(item("many"), { prefixItems: [item("one")] })));
      expect(issue.message).toContain("unequal x-vmd-ref declarations");
      expect(issue.message).toContain("s.json#/properties/l/prefixItems/0, s.json#/properties/l/x-vmd-list/items/foo");
    });

    test("at every index the prefixItems give, and in a sibling's prefixItems too", async () => {
      const second = list(item("many"), { prefixItems: [item("many"), item("one")] });
      expect((await unusable(file(second))).message).toContain("prefixItems/1, s.json#/properties/l/x-vmd-list/items/foo");
      const sibling = {
        type: "object",
        properties: { l: { allOf: [list(item("many")).properties.l, { prefixItems: [true, item("one")] }] } },
      };
      expect((await unusable(file(sibling))).message).toContain("unequal x-vmd-ref declarations");
    });

    test("and meets items past the prefixItems, or at every index without them", async () => {
      expect((await unusable(file(list(item("many"), { items: item("one") })))).message).toContain(
        "items, s.json#/properties/l/x-vmd-list/items/foo",
      );
      const past = list(item("many"), { prefixItems: [item("many")], items: item("one") });
      expect((await unusable(file(past))).message).toContain("unequal x-vmd-ref declarations");
    });

    test("and equal declarations there are valid, as are unequal ones past the prefixItems that items does not give", async () => {
      await usable(list(item("many"), { prefixItems: [item("many"), item("many")] }));
      await usable(list(item("many"), { prefixItems: [{ type: "object" }], items: { type: "object" } }));
    });

    // Issue #116: past prefixItems, items: false lets no item stand, yet the check still compared a key's schema with what
    // a sibling gives at that index, and refused the schema for a conflict no record can hold.
    describe("but not past the prefixItems where items: false lets no item stand", () => {
      /** The keyed list of `list`, with `extra`, beside a sibling whose second prefixItems entry declares "one". */
      const besideSibling = (extra: object, sibling: object = { prefixItems: [true, item("one")] }) => ({
        type: "object",
        properties: { l: { allOf: [list(item("many"), extra).properties.l, sibling] } },
      });

      test("so the schema is valid", async () => {
        await usable(besideSibling({ prefixItems: [item("many")], items: false }));
      });

      test("nor where items: false comes from what a $ref brings", async () => {
        await usable({
          ...besideSibling({ $ref: "#/$defs/pair" }),
          $defs: { pair: { prefixItems: [item("many")], items: false } },
        });
      });

      test("while the same conflict at an index the prefixItems give is schema-invalid", async () => {
        const issue = await unusable(file(besideSibling({ prefixItems: [item("many"), true], items: false })));
        expect(issue.message).toContain("unequal x-vmd-ref declarations");
        expect(issue.message).toContain("allOf/1/prefixItems/1");
      });

      test("and so is the conflict past the prefixItems where items is a schema", async () => {
        const issue = await unusable(file(besideSibling({ prefixItems: [item("many")], items: { type: "object" } })));
        expect(issue.message).toContain("allOf/1/prefixItems/1");
      });

      // Only the literal false is read: a schema that admits nothing, such as {not: {}}, is not worked out.
      test("and so is the conflict past items that admits nothing without being false", async () => {
        const issue = await unusable(file(besideSibling({ prefixItems: [item("many")], items: { not: {} } })));
        expect(issue.message).toContain("allOf/1/prefixItems/1");
      });

      // additional: false keeps out the keys the list does not name; the check at load steps only by the keys it names.
      test("and additional: false does not close a key the list names", async () => {
        const closed = list(item("many"), { prefixItems: [item("many")], items: { type: "object" } }).properties.l;
        const issue = await unusable(
          file({
            type: "object",
            properties: {
              l: {
                allOf: [
                  { ...closed, "x-vmd-list": { ...closed["x-vmd-list"], additional: false } },
                  { prefixItems: [true, item("one")] },
                ],
              },
            },
          }),
        );
        expect(issue.message).toContain("allOf/1/prefixItems/1");
      });

      // A prefixItems entry that is false lets no item stand at its index, and so at none after it either.
      test("nor past a prefixItems entry that is false, while the conflict before it is schema-invalid", async () => {
        await usable(besideSibling({ prefixItems: [item("many"), false] }));
        const issue = await unusable(file(besideSibling({ prefixItems: [item("many"), true, false] })));
        expect(issue.message).toContain("allOf/1/prefixItems/1");
      });

      // With items: false and no prefixItems the array holds no item, so nothing below its keyed list meets anything.
      test("nor in a keyed list's additional where no item stands at all, while one item lets it meet", async () => {
        const conflicting = { allOf: [item("one"), item("many")] };
        const array = (extra: object) => ({
          type: "object",
          properties: {
            l: { type: "array", ...extra, "x-vmd-list": { type: "map", keys: ["name"], additional: conflicting } },
          },
        });
        await usable(array({ items: false }));
        const issue = await unusable(file(array({ prefixItems: [true], items: false })));
        expect(issue.message).toContain("x-vmd-list/additional/allOf/0, s.json#/properties/l/x-vmd-list/additional/allOf/1");
      });
    });

    // The format check asks for format: uri-reference beside x-vmd-ref on every path; a path through a position where no
    // item can stand is no path.
    describe("and a typed reference needs its format only where an item can stand", () => {
      const bare = { "x-vmd-ref": {} };
      const keyedArray = (extra: object) => ({
        type: "object",
        properties: {
          l: { type: "array", ...extra, "x-vmd-list": { type: "map", keys: ["name"], items: { foo: bare } } },
        },
      });
      const formatAt = "x-vmd-ref stands where a path lets a string stand without format: uri-reference";

      // Issue #138: a keyed item can stand at any open index, so it has the format when every open index gives it, though a
      // different location gives it at each. The check took the format only from an items schema that applies at every index.
      describe("so a key's schema has the format where every index an item can stand at gives it", () => {
        const uri = { format: "uri-reference" };

        test("from prefixItems entries that each give it, closed by items: false", async () => {
          await usable(keyedArray({ prefixItems: [uri], items: false }));
          await usable(keyedArray({ prefixItems: [uri, uri], items: false }));
        });

        test("from two allOf branches that give it at different indexes", async () => {
          await usable(
            keyedArray({
              prefixItems: [true, true],
              items: false,
              allOf: [{ prefixItems: [uri] }, { prefixItems: [true, uri] }],
            }),
          );
        });

        test("from a definition a $ref brings, at each index or for the whole array", async () => {
          const uriRef = { $ref: "#/$defs/uri" };
          await usable({ ...keyedArray({ prefixItems: [uriRef, uriRef], items: false }), $defs: { uri } });
          await usable({ ...keyedArray({ $ref: "#/$defs/pair" }), $defs: { pair: { prefixItems: [uri, uri], items: false } } });
        });

        test("but not where one index an item can stand at lacks it", async () => {
          expect((await unusable(file(keyedArray({ prefixItems: [uri, true], items: false })))).message).toContain(formatAt);
          const sameIndex = { prefixItems: [true, true], items: false, allOf: [{ prefixItems: [uri] }, { prefixItems: [uri] }] };
          expect((await unusable(file(keyedArray(sameIndex)))).message).toContain(formatAt);
        });

        test("nor where items past the prefixItems is a schema without it", async () => {
          expect((await unusable(file(keyedArray({ prefixItems: [uri, uri], items: {} })))).message).toContain(formatAt);
        });

        test("nor where a position past the prefixItems is open", async () => {
          expect((await unusable(file(keyedArray({ prefixItems: [uri, uri] })))).message).toContain(formatAt);
        });

        // The indexes are read 32 to a word, so these cross a word's end.
        test("over many indexes, where a branch's items gives it past its prefixItems, but not with one index lacking", async () => {
          const open = (count: number) => Array.from({ length: count }, () => true);
          await usable(keyedArray({ prefixItems: Array.from({ length: 32 }, () => uri), items: false }));
          await usable(
            keyedArray({
              prefixItems: open(40),
              items: false,
              allOf: [{ prefixItems: [uri] }, { prefixItems: [true], items: uri }],
            }),
          );
          const holeAt33 = Array.from({ length: 40 }, (_, index) => (index === 33 ? true : uri));
          const issue = await unusable(
            file(keyedArray({ prefixItems: open(40), items: false, allOf: [{ prefixItems: holeAt33 }] })),
          );
          expect(issue.message).toContain(formatAt);
          const lastLacking = Array.from({ length: 32 }, (_, index) => (index === 31 ? true : uri));
          expect((await unusable(file(keyedArray({ prefixItems: lastLacking, items: false })))).message).toContain(formatAt);
        });

        // Conservative: only the item's own instance location is read index by index. A reference below a key's schema takes
        // only what applies at every index, so entries that each give the format at a member do not give it there.
        test("while a reference below a key's schema still takes only what every index shares", async () => {
          const member = { properties: { a: uri } };
          const deep = {
            type: "object",
            properties: {
              l: {
                type: "array",
                prefixItems: [member, member],
                items: false,
                "x-vmd-list": { type: "map", keys: ["name"], items: { foo: { properties: { a: bare } } } },
              },
            },
          };
          expect((await unusable(file(deep))).message).toContain(formatAt);
        });

        // What every index gives the item itself says nothing of a member below it.
        test("and a reference at a member of the key's schema needs its own format, though the item has it", async () => {
          const itemAndMember = {
            type: "object",
            properties: {
              l: {
                type: "array",
                prefixItems: [uri, uri],
                items: false,
                "x-vmd-list": { type: "map", keys: ["name"], items: { foo: { ...bare, properties: { a: bare } } } },
              },
            },
          };
          // The key's schema alone is usable under these prefixItems, so what is refused is the member's reference.
          expect((await unusable(file(itemAndMember))).message).toContain(formatAt);
        });
      });

      test("and none where no item stands at all, while one item needs it", async () => {
        await usable(keyedArray({ items: false }));
        expect((await unusable(file(keyedArray({ prefixItems: [true], items: false })))).message).toContain(formatAt);
      });

      test("and none past a prefixItems entry that is false, in prefixItems or in items", async () => {
        await usable({ type: "array", prefixItems: [false, bare] });
        await usable({ type: "array", prefixItems: [false], items: bare });
        expect((await unusable(file({ type: "array", prefixItems: [true, bare] }))).message).toContain(formatAt);
        expect((await unusable(file({ type: "array", prefixItems: [true], items: bare }))).message).toContain(formatAt);
      });
    });
  });

  test("a member named in properties that a pattern also matches gets both declarations, so unequal ones are schema-invalid", async () => {
    const issue = await unusable(
      file({ properties: { list: keyed }, patternProperties: { "^li": { "x-vmd-list": { type: "multimap", keys: ["name"] } } } }),
    );
    expect(issue.message).toContain("unequal x-vmd-list declarations");
    await usable({
      properties: { list: keyed },
      patternProperties: { "^other": { "x-vmd-list": { type: "multimap", keys: ["name"] } } },
    });
  });

  test("$sections of a section is keyed by @key only, and @key keys nothing else", async () => {
    const sections = (keys: string[]) =>
      file({ properties: { $sections: { type: "array", "x-vmd-list": { type: "map", keys } } } });
    expect((await unusable(sections(["name"]))).message).toContain('$sections takes keys: ["@key"] only');
    expect((await unusable(sections(["/@key"]))).message).toContain('$sections takes keys: ["@key"] only');
    await usable(JSON.parse(sections(["@key"])["s.json"]));
    const field = file({ properties: { l: { type: "array", "x-vmd-list": { type: "map", keys: ["@key"] } } } });
    expect((await unusable(field)).message).toContain("not a section's $sections");
  });

  test("the $sections of a section's sections is a section's too, and a $sections inside a field is not", async () => {
    const nested = {
      properties: {
        $sections: {
          type: "array",
          items: { properties: { $sections: { type: "array", "x-vmd-list": { type: "multimap", keys: ["@key"] } } } },
        },
      },
    };
    await usable(nested);
    const inField = {
      properties: { data: { properties: { $sections: { type: "array", "x-vmd-list": { type: "map", keys: ["@key"] } } } } },
    };
    expect((await unusable(file(inField))).message).toContain("not a section's $sections");
    await usable({
      properties: { data: { properties: { $sections: { type: "array", "x-vmd-list": { type: "map", keys: ["name"] } } } } },
    });
  });

  // Predicted bug: unevaluatedItems beside x-vmd-list would fail valid data, since the validator does not see the list's items.
  test("unevaluatedItems beside an x-vmd-list is schema-invalid, through allOf too; elsewhere it is valid", async () => {
    expect((await unusable(file({ properties: { l: { ...keyed, unevaluatedItems: false } } }))).message).toContain(
      "unevaluatedItems stands beside an x-vmd-list",
    );
    expect((await unusable(file({ properties: { l: { allOf: [keyed], unevaluatedItems: false } } }))).message).toContain(
      "unevaluatedItems stands beside an x-vmd-list",
    );
    await usable({ properties: { l: keyed, m: { type: "array", unevaluatedItems: false } } });
  });

  test("x-vmd-ref on a schema that allows strings needs format: uri-reference, which allOf may bring", async () => {
    const issue = await unusable(file({ properties: { p: { type: "string", "x-vmd-ref": {} } } }));
    expect(issue.message).toContain("without format: uri-reference");
    expect((await unusable(file({ properties: { p: { type: ["string", "object"], "x-vmd-ref": {} } } }))).code).toBe(
      "schema-invalid",
    );
    expect((await unusable(file({ properties: { p: { "x-vmd-ref": {} } } }))).code).toBe("schema-invalid");
    await usable({ properties: { p: { type: "string", format: "uri-reference", "x-vmd-ref": {} } } });
    await usable({ properties: { p: { allOf: [{ format: "uri-reference" }], type: "string", "x-vmd-ref": {} } } });
    await usable({ properties: { p: { type: "object", required: ["$ref"], "x-vmd-ref": {} } } });
  });

  // Review of #97's recheck, item 2: the format, or a type without strings, may come from a location that applies beside the
  // declaration on every path, not only from the declaration's own schema object.
  test.each([
    [
      "a base schema that gives the type and format, and the collection adds x-vmd-ref",
      {
        $defs: { base: { type: "object", properties: { parent: { type: "string", format: "uri-reference" } } } },
        allOf: [{ $ref: "#/$defs/base" }],
        properties: { parent: { "x-vmd-ref": { targets: ["tickets"] } } },
      },
    ],
    [
      "a sibling allOf that gives type: object",
      { allOf: [{ properties: { p: { type: "object" } } }], properties: { p: { "x-vmd-ref": {} } } },
    ],
    [
      "a sibling allOf that gives the format",
      {
        allOf: [{ properties: { p: { type: "string", "x-vmd-ref": {} } } }, { properties: { p: { format: "uri-reference" } } }],
      },
    ],
    [
      "the array's items, which every item of a keyed list gets beside its per-key schema",
      {
        properties: {
          l: {
            type: "array",
            items: { allOf: [{ format: "uri-reference" }] },
            "x-vmd-list": { type: "map", keys: ["k"], items: { x: { "x-vmd-ref": {} } }, additional: { "x-vmd-ref": {} } },
          },
        },
      },
    ],
    [
      "a pattern that matches the declaration's member",
      { properties: { p: { "x-vmd-ref": {} } }, patternProperties: { "^p$": { type: "string", format: "uri-reference" } } },
    ],
  ])("x-vmd-ref is valid when every path brings the format beside it: %s", async (_case, schema) => {
    await usable(schema);
  });

  test("x-vmd-ref is schema-invalid when one path to it lacks the format that another brings", async () => {
    const issue = await unusable(
      file({
        $defs: { r: { properties: { p: { "x-vmd-ref": {} } } } },
        properties: {
          a: { $ref: "#/$defs/r" },
          b: { allOf: [{ $ref: "#/$defs/r" }, { properties: { p: { type: "string", format: "uri-reference" } } }] },
        },
      }),
    );
    expect(issue.message).toContain("without format: uri-reference");
    // Review of #97's second recheck, item 2: an items schema gets nothing from a sibling whose prefixItems reach further,
    // since the items there are that sibling's prefixItems, not its items.
    const prefix = await unusable(
      file({
        allOf: [{ items: { type: "string", "x-vmd-ref": {} } }, { prefixItems: [{ format: "uri-reference" }], items: {} }],
      }),
    );
    expect(prefix.message).toContain("without format: uri-reference");
    // An item of a keyed list may be at an index that a sibling's prefixItems give, so that sibling's items do not count.
    const keyedPrefix = await unusable(
      file({
        properties: {
          l: {
            allOf: [
              { type: "array", "x-vmd-list": { type: "map", keys: ["k"], items: { x: { "x-vmd-ref": {} } } } },
              { prefixItems: [{}], items: { format: "uri-reference" } },
            ],
          },
        },
      }),
    );
    expect(keyedPrefix.message).toContain("without format: uri-reference");
    // Nor do they when both have prefixItems of one length: the first item gets the sibling's prefixItems entry.
    const keyedSamePrefix = await unusable(
      file({
        properties: {
          l: {
            allOf: [
              { prefixItems: [{}], "x-vmd-list": { type: "map", keys: ["k"], items: { x: { "x-vmd-ref": {} } } } },
              { prefixItems: [{}], items: { format: "uri-reference" } },
            ],
          },
        },
      }),
    );
    expect(keyedSamePrefix.message).toContain("without format: uri-reference");
    // A member that only the data names gets nothing from its parent's other members: the object's own type is not its.
    const unnamed = await unusable(file({ type: "object", additionalProperties: { "x-vmd-ref": {} } }));
    expect(unnamed.message).toContain("without format: uri-reference");
  });

  test("the root's shape gives each location's declarations, and the item of a keyed list its per-key schema", async () => {
    const schema = await usable({
      properties: {
        parent: { type: "string", format: "uri-reference", "x-vmd-ref": { targets: ["tickets"] } },
        $sections: {
          type: "array",
          items: { type: "object" },
          "x-vmd-list": {
            type: "map",
            keys: ["@key"],
            required: ["a"],
            items: { a: { $ref: "#/$defs/prose" } },
            additional: false,
          },
        },
        status: { enum: ["Low", "High"], "x-vmd-ordered": "asc", "x-vmd-summary": true },
      },
      patternProperties: { "^x-": { format: "date" } },
      $defs: { prose: { required: ["$body"] } },
    });
    const root = schema.root;
    expect(root.child({ member: "parent" }).ref).toEqual({ targets: ["tickets"], cardinality: "one", anchors: "any" });
    expect(root.child({ member: "parent" }).format).toBe("uri-reference");
    const sections = root.child({ member: "$sections" });
    expect(sections.list).toMatchObject({ type: "map", key: "@key", required: ["a"], additional: false });
    const item = sections.child({ item: 0, key: "a" });
    expect(item.locations.map((location) => location.pointer)).toEqual([
      "/properties/$sections/items",
      "/properties/$sections/x-vmd-list/items/a",
      "/$defs/prose",
    ]);
    expect(sections.child({ item: 0 }).locations.map((location) => location.pointer)).toEqual(["/properties/$sections/items"]);
    expect(root.child({ member: "status" }).ordered).toBe("asc");
    expect(root.child({ member: "status" }).summary).toBe(true);
    expect(root.child({ member: "x-day" }).format).toBe("date");
    expect(root.child({ member: "other" }).locations).toEqual([]);
  });

  test("a member that properties names or a pattern matches does not get additionalProperties, and any other member does", async () => {
    const schema = await usable({
      properties: { named: { type: "string" } },
      patternProperties: { "^p": { type: "string" } },
      additionalProperties: { type: "string", format: "uri-reference", "x-vmd-ref": {} },
    });
    expect(schema.root.child({ member: "named" }).ref).toBeNull();
    expect(schema.root.child({ member: "pattern" }).ref).toBeNull();
    expect(schema.root.child({ member: "other" }).ref).not.toBeNull();
  });

  test("two patterns that bring unequal declarations to one member name meet in the data: the shape names the conflict", async () => {
    const schema = await usable({
      patternProperties: {
        "^a": { type: "string", format: "uri-reference", "x-vmd-ref": {} },
        b$: { type: "string", format: "uri-reference", "x-vmd-ref": { cardinality: "many" } },
      },
    });
    const both = schema.root.child({ member: "ab" });
    expect(both.ref).toBeNull();
    expect(both.conflicts.map((location) => location.pointer)).toEqual(["/patternProperties/^a", "/patternProperties/b$"]);
    expect(schema.root.child({ member: "ax" }).ref).toEqual({ targets: null, cardinality: "one", anchors: "any" });
  });

  // Issue #110: the spine's check kept a problem for every unequal pair, which the issue counts but lists ten of.
  test("unequal declarations of many pairs: the issue lists the first ten by location and counts the others", async () => {
    const one = Array.from({ length: 4 }, () => ({ "x-vmd-ref": {} }));
    const many = Array.from({ length: 4 }, () => ({ "x-vmd-ref": { cardinality: "many" } }));
    const issue = await unusable(file({ type: "object", format: "uri-reference", allOf: [...one, ...many] }));
    expect(issue.code).toBe("schema-invalid");
    expect(issue.message.match(/unequal x-vmd-ref declarations/g)).toHaveLength(10);
    expect(issue.message).toContain("s.json:1:");
    expect(issue.message).toContain(
      "unequal x-vmd-ref declarations apply to one instance location, from s.json#/allOf/0, s.json#/allOf/4",
    );
    expect(issue.message).toMatch(/; and 6 more$/);
  });
});

describe("validating records", () => {
  // Predicted bug: Ajv skips a properties entry named __proto__, and gets required names that Object.prototype has wrong.
  test("a member named __proto__ is checked, in the record and in the schema's properties", async () => {
    // A literal's __proto__ sets its prototype, so the schema is written as JSON text.
    const loaded = await load({ "s.json": '{"properties": {"__proto__": {"type": "string"}}}' });
    if (!loaded.ok) expect.fail(JSON.stringify(loaded.issues));
    const schema = loaded.value;
    expect(violationsAt(schema, '{"__proto__": 5}')).toEqual(["/__proto__"]);
    expect(violationsAt(schema, '{"__proto__": "x"}')).toEqual([]);
  });

  test("required: [toString] is checked as an own member, and so is constructor", async () => {
    const schema = await usable({ required: ["toString", "constructor"] });
    expect(violationsAt(schema, "{}")).toEqual([""]);
    expect(schema.validate(record("{}"))[0]?.message).toContain("lacks the required members toString and constructor");
    expect(violationsAt(schema, '{"toString": 1, "constructor": 2}')).toEqual([]);
    const names = await usable({ properties: { toString: { type: "number" } }, additionalProperties: false });
    expect(violationsAt(names, '{"toString": "x", "valueOf": 1}')).toEqual(["/toString", "/valueOf"]);
  });

  // Predicted bug: the validator's locations are percent-encoded URI fragments, not exact paths.
  test("a member named a/b, a~b or with a space and an accent is at its exact path", async () => {
    const schema = await usable({ additionalProperties: { type: "string" } });
    expect(violationsAt(schema, '{"a/b": 1, "a~b": 2, "é x": 3, "%41": 4}')).toEqual(["/a~1b", "/a~0b", "/é x", "/%41"]);
  });

  // Predicted bug: a failing contains reports each item that does not match, though each is valid as an item.
  test("a failing contains, minContains or maxContains puts one issue on the array and none on its items", async () => {
    const contains = await usable({ properties: { a: { contains: { const: 3 } } } });
    expect(violationsAt(contains, '{"a": [1, 2]}')).toEqual(["/a"]);
    const min = await usable({ properties: { a: { contains: { const: 3 }, minContains: 2 } } });
    expect(violationsAt(min, '{"a": [3, 1]}')).toEqual(["/a"]);
    expect(min.validate(record('{"a": [3, 1]}'))[0]?.message).toContain("must have at least 2 items");
    const max = await usable({ properties: { a: { contains: { const: 3 }, maxContains: 1 } } });
    expect(violationsAt(max, '{"a": [3, 1, 3]}')).toEqual(["/a"]);
    expect(violationsAt(max, '{"a": [3, 1]}')).toEqual([]);
  });

  test("a failing contains reached through a $ref keeps its items quiet too", async () => {
    const schema = await usable({
      properties: { a: { $ref: "#/$defs/c" } },
      $defs: { c: { contains: { $ref: "#/$defs/three" } }, three: { const: 3 } },
    });
    expect(violationsAt(schema, '{"a": [1, 2]}')).toEqual(["/a"]);
  });

  // Predicted bug: hyperjump writes a member name that propertyNames refuses as #*/NAME, which is not a JSON Pointer.
  test("a member whose name propertyNames refuses has its issue at the member, saying the name fails", async () => {
    const schema = await usable({ properties: { x: { propertyNames: { maxLength: 2 } } } });
    const issues = schema.validate(record('{"x": {"ab": 1, "a/bc": 2}}'));
    expect(issues.map((issue) => issue.at)).toEqual(["/x/a~1bc"]);
    expect(issues[0]?.message).toMatch(/^its name must be at most 2 characters long/);
  });

  test("a failing anyOf, oneOf or not is one issue at the value, whatever its branches say", async () => {
    const anyOf = await usable({ properties: { a: { anyOf: [{ type: "string" }, { minimum: 10 }] } } });
    expect(violationsAt(anyOf, '{"a": 5}')).toEqual(["/a"]);
    expect(anyOf.validate(record('{"a": 5}'))[0]?.message).toMatch(/^must match at least one of the schemas of anyOf/);
    const oneOf = await usable({ properties: { a: { oneOf: [{ type: "number" }, { minimum: 0 }] } } });
    expect(violationsAt(oneOf, '{"a": 5}')).toEqual(["/a"]);
    const nested = await usable({
      properties: { l: { items: { anyOf: [{ properties: { b: { type: "string" } } }, { type: "number" }] } } },
    });
    expect(violationsAt(nested, '{"l": [{"b": 1}]}')).toEqual(["/l/0"]);
    const not = await usable({ properties: { a: { not: { type: "number" } } } });
    expect(violationsAt(not, '{"a": 5}')).toEqual(["/a"]);
  });

  test("several failures at one value are one issue, whose message lists them", async () => {
    const schema = await usable({ properties: { a: { type: "string", minimum: 3, allOf: [{ enum: ["x"] }] } } });
    const issues = schema.validate(record('{"a": 1}'));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("must be a string");
    expect(issues[0]?.message).toContain("must be at least 3");
    expect(issues[0]?.message).toContain("must be one of x");
  });

  test("a failing if-then and dependentSchemas report the value's own failures", async () => {
    // Written as JSON text, since an object with a `then` member reads as a thenable.
    const schema = await usable(
      '{"if": {"required": ["a"]}, "then": {"required": ["b"]}, "dependentSchemas": {"c": {"required": ["d"]}}}',
    );
    expect(violationsAt(schema, '{"a": 1, "c": 2}')).toEqual([""]);
    expect(violationsAt(schema, '{"a": 1, "b": 2}')).toEqual([]);
  });

  test("a member that additionalProperties: false or unevaluatedProperties: false refuses is at the member", async () => {
    const schema = await usable({ properties: { a: true }, additionalProperties: false });
    const issues = schema.validate(record('{"a": 1, "b": 2}'));
    expect(issues.map((issue) => issue.at)).toEqual(["/b"]);
    expect(issues[0]?.message).toMatch(/^is a member the schema does not allow/);
    const unevaluated = await usable({ allOf: [{ properties: { a: true } }], unevaluatedProperties: false });
    expect(violationsAt(unevaluated, '{"a": 1, "b": 2}')).toEqual(["/b"]);
  });

  test("an issue is positioned at its value in the file", async () => {
    const schema = await usable({ properties: { status: { enum: ["Open", "Closed"] } } });
    const issues = schema.validate(record('{\n  "status": "Nope"\n}', "t.json"));
    expect(issues[0]).toMatchObject({ path: "t.json", at: "/status", position: { line: 2, col: 3 } });
    expect(issues[0]?.message).toContain("must be one of Open, Closed");
  });

  test("the logical types are asserted with vmd's checks, and other formats stay annotations", async () => {
    const schema = await usable({
      properties: { d: { format: "date" }, t: { format: "time" }, i: { format: "int64" }, h: { format: "hostname" } },
    });
    expect(violationsAt(schema, '{"d": "2026-02-29", "t": "23:59:60+02:00", "i": "9223372036854775808", "h": "-"}')).toEqual([
      "/d",
      "/t",
      "/i",
    ]);
    expect(violationsAt(schema, '{"d": "2024-02-29", "t": "01:59:60+02:00", "i": "-0", "h": "-"}')).toEqual([]);
    expect(schema.validate(record('{"d": "x"}'))[0]?.message).toContain("must be a date (RFC 3339 full-date)");
  });

  test("a duration P1Y3D, which skips months, is a violation", async () => {
    const schema = await usable({ properties: { d: { items: { format: "duration" } } } });
    expect(violationsAt(schema, '{"d": ["P1Y3D", "P1Y2M3D"]}')).toEqual(["/d/0"]);
  });

  test("a Markdown record's value view is validated, sections and all", async () => {
    const schema = await usable({ required: ["status"], properties: { $sections: { items: { required: ["$body"] } } } });
    const parsed = (await import("../format/parse-record.js")).parseRecord(
      "t.md",
      new TextEncoder().encode("---\nstatus: Open\n---\n# T\n\n## A\n"),
    );
    if (!parsed.ok) expect.fail("parses");
    expect(schema.validate(parsed.value).map((issue) => issue.at)).toEqual(["/$sections/0"]);
  });
});
