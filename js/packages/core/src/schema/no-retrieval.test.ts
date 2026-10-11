// Core's guarantee that the validator retrieves nothing, whatever a schema holds, without the URI schemes a host may remove:
// every fetch the process makes during these loads and validations is counted, and must be none.

import { afterAll, beforeAll, expect, test } from "vitest";
import { load, record } from "./schema.testkit.js";

const fetched: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    throw new TypeError("this test allows no fetch");
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const ADVERSARIAL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "an external $ref": { "s.json": '{"properties": {"a": {"$ref": "https://example.com/evil.json"}}}' },
  "a file: $ref": { "s.json": '{"$ref": "file:///etc/passwd"}' },
  "a $dynamicAnchor hidden in an unknown keyword": {
    "s.json": JSON.stringify({
      $defs: { d: { $dynamicAnchor: "m", type: "string" } },
      properties: { a: { $dynamicRef: "#m" } },
      "x-foo": { $dynamicAnchor: "m", $ref: "https://example.com/evil.json" },
    }),
  },
  "an anchor hidden in const": {
    "s.json": JSON.stringify({
      $defs: { d: { $dynamicAnchor: "m", type: "string" } },
      properties: { a: { $dynamicRef: "#m" }, b: { const: { $dynamicAnchor: "m", $ref: "https://example.com/evil2.json" } } },
    }),
  },
  "an anchor hidden in default": {
    "s.json": JSON.stringify({
      $defs: { d: { $anchor: "m", type: "string" } },
      properties: { a: { $dynamicRef: "#m" }, b: { default: { $anchor: "m", $ref: "file:///etc/passwd" } } },
    }),
  },
  "a $ref and a $dynamicRef in one object": {
    "s.json": JSON.stringify({
      $defs: { x: { $dynamicAnchor: "x", type: "string" } },
      properties: { a: { $ref: "o.json", $dynamicRef: "#x" } },
    }),
    "o.json": '{"type": "integer"}',
  },
  "a $ref into an unknown keyword": { "s.json": '{"x-defs": {"r": {"$ref": "https://example.com/x"}}, "$ref": "#/x-defs/r"}' },
  "identifiers in const and enum": {
    "s.json":
      '{"properties": {"a": {"const": {"$id": "https://example.com/q"}}, "b": {"enum": [{"$schema": "https://example.com/m"}]}}}',
  },
  "a $schema in a subschema": { "s.json": '{"properties": {"a": {"$schema": "https://example.com/meta"}}}' },
};

test.each(Object.keys(ADVERSARIAL))("loading and validating with %s fetches nothing", async (name) => {
  const loaded = await load(ADVERSARIAL[name] as Readonly<Record<string, string>>);
  if (loaded.ok) loaded.value.validate(record('{"a": 1, "b": "s"}'));
  expect(fetched).toEqual([]);
});
