// What @hyperjump/json-schema 1.18.0's BASIC output reports for the keywords whose errors docs/design/i2-validate.md must fold
// before they become issues (section 3.5): contains, minContains, maxContains, propertyNames, and anyOf, oneOf and not; and
// what registering one schema URI twice does (section 3.1).
//
//   node hyperjump-output.mjs
import * as hj from "@hyperjump/json-schema/draft-2020-12";
import { BASIC } from "@hyperjump/json-schema/experimental";

const D = "https://json-schema.org/draft/2020-12/schema";
const cases = [
  ["contains, no item matches", { type: "array", contains: { const: 3 } }, [1, 2]],
  ["contains, one of three matches (valid)", { type: "array", contains: { const: 3 } }, [1, 2, 3]],
  ["maxContains 1, two items match", { type: "array", contains: { const: 3 }, maxContains: 1 }, [3, 1, 3]],
  ["minContains 2, one item matches", { type: "array", contains: { const: 3 }, minContains: 2 }, [3, 1]],
  ["propertyNames pattern, one name fails", { type: "object", propertyNames: { pattern: "^[a-z]+$" } }, { abc: 1, "A-B": 2 }],
  ["propertyNames maxLength, one name fails", { type: "object", propertyNames: { maxLength: 2 } }, { ab: 1, abc: 2 }],
  ["anyOf, both branches fail", { anyOf: [{ type: "string" }, { minimum: 10 }] }, 5],
  ["not, the subschema passes", { not: { type: "number" } }, 5],
  ["if/then, then fails", { if: { minimum: 0 }, then: { maximum: 10 } }, 20],
];
let n = 0;
for (const [label, schema, instance] of cases) {
  const uri = `https://vmd.invalid/output/${n++}`;
  hj.registerSchema({ $schema: D, ...schema }, uri);
  const out = await hj.validate(uri, instance, BASIC);
  const errors = (out.errors ?? []).map((e) => `${e.instanceLocation} ${e.keyword.split("/").pop()} (${e.absoluteKeywordLocation.replace(uri, "")})`);
  console.log(`${label.padEnd(42)} valid ${String(out.valid).padEnd(5)} ${JSON.stringify(errors)}`);
}

// Registering a URI a second time, as a second store with the same configuration in one process would.
hj.registerSchema({ $schema: D, type: "string" }, "https://vmd.invalid/twice");
try {
  hj.registerSchema({ $schema: D, type: "number" }, "https://vmd.invalid/twice");
  console.log("registerSchema twice: accepted");
} catch (e) {
  console.log(`registerSchema twice: throws ${e.constructor.name}: ${e.message}`);
}
hj.unregisterSchema("https://vmd.invalid/twice");
hj.registerSchema({ $schema: D, type: "number" }, "https://vmd.invalid/twice");
const v = await hj.validate("https://vmd.invalid/twice", 5);
console.log(`after unregisterSchema, registering again: accepted, and 5 is valid: ${v.valid}`);
