// Property test 1 of the I2 design: core's native evaluation of a list keyed by a member agrees on validity with a standard
// JSON Schema validator run over the list's compilation, which §9.3 gives as the definition. The oracle is the specification's
// compilation, run by @hyperjump/json-schema directly, not by core's adapter. Core's duplicate-key stands for the failure of
// the compilation's maxContains.

import { registerSchema, type SchemaObject, validate } from "@hyperjump/json-schema/draft-2020-12";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { record, usable } from "../schema/schema.testkit.js";
import { bindRecord } from "./binding.js";

/** The keys the generated lists and data draw from. */
const KEYS = ["a", "b", "c"] as const;

/** The per-key and additional schemas a declaration draws from, over an item's `x`. */
const ITEM_SCHEMAS: readonly unknown[] = [true, false, {}, { required: ["x"] }, { properties: { x: { type: "number" } } }];

interface Declaration {
  readonly type: "map" | "multimap";
  readonly required: readonly string[];
  readonly items: Readonly<Record<string, unknown>>;
  readonly additional?: unknown;
}

const declaration: fc.Arbitrary<Declaration> = fc.record(
  {
    type: fc.constantFrom("map", "multimap"),
    required: fc.subarray([...KEYS]),
    items: fc.dictionary(fc.constantFrom(...KEYS), fc.constantFrom(...ITEM_SCHEMAS), { maxKeys: 3 }),
    additional: fc.constantFrom(true, false, ...ITEM_SCHEMAS.slice(2)),
  },
  { requiredKeys: ["type", "required", "items"] },
);

/** An item: keyed by a key of the alphabet, or without a key, or with a key that is not a string; with or without an `x`. */
const item = fc.oneof(
  { weight: 6, arbitrary: fc.record({ k: fc.constantFrom(...KEYS), x: fc.constantFrom(1, "s") }, { requiredKeys: ["k"] }) },
  { weight: 1, arbitrary: fc.record({ x: fc.constant(1) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant(5) }) },
);

/**
 * The standard compilation of §9.3 of a list keyed by `k`: the per-key schemas as `if`/`then` under `items`, a `contains` per
 * required key, `contains` with `maxContains: 1` per key under `map`, and `additional` over the keys `items` does not name.
 * Beside them, §5.6's rule that each item has a string key, which `required` and `type` state. §9.3 notes that uniqueness
 * across keys `items` does not name has no standard form; since every generated key is one of {@link KEYS}, a `maxContains`
 * per key of the alphabet states it here.
 */
function compiled(list: Declaration): SchemaObject {
  const named = Object.keys(list.items);
  const has = (key: string) => ({ properties: { k: { const: key } }, required: ["k"] });
  // JSON Schema's `if` and `then`, written as JSON text, as the other schema tests do: an object with a `then` member reads
  // as a promise to the linter.
  const conditional = (condition: unknown, consequence: unknown): unknown =>
    JSON.parse(`{"if": ${JSON.stringify(condition)}, "then": ${JSON.stringify(consequence)}}`);
  const items: unknown[] = [{ required: ["k"], properties: { k: { type: "string" } } }];
  for (const [key, schema] of Object.entries(list.items)) items.push(conditional(has(key), schema));
  const additional = list.additional ?? true;
  if (additional === false) items.push({ properties: { k: named.length === 0 ? false : { enum: named } } });
  else if (additional !== true) {
    items.push(
      conditional({ properties: { k: named.length === 0 ? true : { not: { enum: named } } }, required: ["k"] }, additional),
    );
  }
  const allOf: unknown[] = list.required.map((key) => ({ contains: has(key) }));
  if (list.type === "map") for (const key of KEYS) allOf.push({ contains: has(key), minContains: 0, maxContains: 1 });
  return { type: "array", items: { allOf: items }, ...(allOf.length === 0 ? {} : { allOf }) } as SchemaObject;
}

let registered = 0;

/** Whether the compilation accepts the list, by the validator run directly. */
async function standardVerdict(list: Declaration, data: readonly unknown[]): Promise<boolean> {
  registered += 1;
  const uri = `https://vmd.invalid/property-1/${registered}`;
  registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...compiled(list) }, uri);
  const output = await validate(uri, data as never);
  return output.valid;
}

describe("keyed lists against §9.3's compilation (property 1)", () => {
  test("core's native evaluation and the compiled schema agree on whether a list is valid", { timeout: 300_000 }, async () => {
    let invalid = 0;
    let valid = 0;
    await fc.assert(
      fc.asyncProperty(declaration, fc.array(item, { maxLength: 5 }), async (list, data) => {
        const declared = { type: list.type, keys: ["k"], required: list.required, items: list.items };
        const schema = await usable({
          properties: {
            l: {
              type: "array",
              "x-vmd-list": list.additional === undefined ? declared : { ...declared, additional: list.additional },
            },
          },
        });
        const issues = bindRecord(record(JSON.stringify({ l: data })), schema).issues;
        const native = issues.length === 0;
        expect(issues.every((issue) => issue.code === "schema-violation" || issue.code === "duplicate-key")).toBe(true);
        expect(native).toBe(await standardVerdict(list, data));
        if (native) valid += 1;
        else invalid += 1;
      }),
      { numRuns: 300 },
    );
    // Both verdicts are common, so the property compares more than one side.
    expect(valid).toBeGreaterThan(20);
    expect(invalid).toBeGreaterThan(20);
  });
});
