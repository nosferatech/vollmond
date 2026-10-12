// Random schemas for the differential tests of the spine's check: small schemas built from every keyword the spine follows,
// with declarations, patterns, keyed lists and $ref cycles, so that both accepted and refused schemas come out.

import fc from "fast-check";
import { expect } from "vitest";
import { succeed } from "../issue/outcome.js";
import { checkExtensionKeywords } from "./keywords.js";
import { readSchemaSet, type SchemaSet } from "./schema-set.js";
import { isObject } from "./walk.js";

/** The member names the schemas list, some of which the patterns match, and `$sections`, which places a keyed list. */
const NAMES = ["a", "b", "ab", "ba", "x", "xa", "q", "$sections"];
/** The patterns of `patternProperties`, which overlap on some names and match none of others. */
const PATTERNS = ["^a", "b$", "x", "^ab$", "^z", "a", "."];
/** The keys a keyed list's `items` names. */
const KEYS = ["k1", "k2"];
/** The definitions a `$ref` may name; each is in the root's `$defs`, so references form cycles. */
const DEFINITIONS = ["d0", "d1", "d2"];
const REFS = [{}, { cardinality: "many" }, { targets: ["c"] }];

const leafFields = {
  type: fc.constantFrom<unknown>("object", "array", "string", ["string", "null"]),
  format: fc.constant("uri-reference"),
  "x-vmd-ref": fc.constantFrom(...REFS),
  unevaluatedItems: fc.constant(false),
  $ref: fc.constantFrom(...DEFINITIONS.map((name) => `#/$defs/${name}`)),
};

/** A schema object, or now and then a boolean schema, of at most a few levels. */
const schemas = fc.letrec<{ node: unknown }>((tie) => {
  const node = tie("node");
  const map = (names: readonly string[]) => fc.dictionary(fc.constantFrom(...names), node, { maxKeys: 3 });
  const list = fc.record(
    {
      type: fc.constantFrom("map", "multimap"),
      keys: fc.constantFrom(["name"], ["@key"]),
      items: fc.dictionary(fc.constantFrom(...KEYS), node, { maxKeys: 2 }),
      additional: fc.oneof(node, fc.boolean()),
    },
    { requiredKeys: ["type", "keys"] },
  );
  const branch = fc.record(
    {
      ...leafFields,
      "x-vmd-list": list,
      properties: map(NAMES),
      patternProperties: map(PATTERNS),
      additionalProperties: fc.oneof(node, fc.constant(false)),
      prefixItems: fc.array(node, { maxLength: 2 }),
      items: node,
      allOf: fc.array(node, { minLength: 1, maxLength: 3 }),
      anyOf: fc.array(node, { minLength: 1, maxLength: 1 }),
    },
    { requiredKeys: [] },
  );
  return {
    node: fc.oneof({ maxDepth: 3, depthIdentifier: "schema" }, fc.record(leafFields, { requiredKeys: [] }), fc.boolean(), branch),
  };
}).node;

/**
 * A root schema with its definitions, and an unreferenced definition that lists names, which the check still counts as
 * listed: the pairs that take members of any name meet at them.
 */
export const randomSchemas: fc.Arbitrary<unknown> = fc
  .record({
    root: schemas,
    definitions: fc.tuple(...DEFINITIONS.map(() => schemas)),
    listed: fc.subarray(NAMES),
  })
  .map(({ root, definitions, listed }) => {
    const $defs: Record<string, unknown> = {};
    DEFINITIONS.forEach((name, index) => {
      $defs[name] = definitions[index];
    });
    $defs.listed = { properties: Object.fromEntries(listed.map((name) => [name, {}])) };
    return isObject(root as never) ? { ...(root as object), $defs } : { allOf: [root], $defs };
  });

/** The schema set of a schema held in `s.json`, or null when its extension keywords are not of the form the spine needs. */
export async function setOf(schema: unknown): Promise<SchemaSet | null> {
  const text = new TextEncoder().encode(JSON.stringify(schema));
  const set = await readSchemaSet("s.json", async () => succeed(text));
  expect(set.problems).toEqual([]);
  for (const [, { location, value }] of set.schemas) {
    if (isObject(value) && checkExtensionKeywords(value, location.pointer).length > 0) return null;
  }
  return set;
}
