// The cold cost of each validator in a fresh process: import, compile one schema of 200 properties, validate one record.
// What a cold `vmd check` pays once.
//
//   node validator-cold.mjs ajv|jsl|hyperjump
import { performance } from "node:perf_hooks";

const which = process.argv[2];
const big = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: {} };
for (let i = 0; i < 200; i++) big.properties[`f${i}`] = { type: "string", enum: ["a", "b", "c"], maxLength: 10 };
const record = Object.create(null);
for (const k of Object.keys(big.properties)) record[k] = "a";

const t0 = performance.now();
let validate;
if (which === "ajv") {
  const m = await import("ajv/dist/2020.js");
  const Ajv2020 = m.default.default ?? m.default;
  var t1 = performance.now();
  validate = new Ajv2020({ allErrors: true, strict: false }).compile(big);
} else if (which === "jsl") {
  const jsl = await import("json-schema-library");
  var t1 = performance.now();
  const node = jsl.compileSchema(big);
  validate = (d) => node.validate(d).valid;
} else {
  const hj = await import("@hyperjump/json-schema/draft-2020-12");
  var t1 = performance.now();
  hj.registerSchema(big, "https://vmd.invalid/big");
  validate = await hj.validate("https://vmd.invalid/big");
}
const t2 = performance.now();
const ok = validate(record);
const t3 = performance.now();
console.log(`${which}: import ${(t1 - t0).toFixed(1)} ms, compile ${(t2 - t1).toFixed(1)} ms, first validation ${(t3 - t2).toFixed(1)} ms (${JSON.stringify(ok?.valid ?? ok)})`);
