// Runs the JSON-Schema-Test-Suite's unevaluatedItems and unevaluatedProperties cases, as Bowtie's 2020-12 report holds them,
// through Ajv 8.20.0 (strict mode off, ownProperties on) and @hyperjump/json-schema 1.18.0 here, and lists every wrong verdict.
// Cases whose schemas use $dynamicRef, $id or a $ref to another document are left out and counted, since they test something
// else and would make the validators retrieve documents.
//
//   curl -o draft2020-12.json https://bowtie.report/draft2020-12.json
//   node unevaluated-cases.mjs draft2020-12.json
import { readFileSync } from "node:fs";
import * as hj from "@hyperjump/json-schema/draft-2020-12";

const m = await import("ajv/dist/2020.js");
const Ajv2020 = m.default.default ?? m.default;
const D = "https://json-schema.org/draft/2020-12/schema";

const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const cases = lines
  .slice(1)
  .map((l) => JSON.parse(l))
  .filter((o) => o.case && /unevaluated/i.test(JSON.stringify(o.case.schema)))
  .map((o) => o.case);
let tests = 0;
const wrong = { ajv: [], hyperjump: [] };
let skipped = 0;
let n = 0;
for (const c of cases) {
  const text = JSON.stringify(c.schema);
  if (/\$dynamicRef|"\$id"|"\$ref":"[^#]/.test(text)) {
    skipped++;
    continue;
  }
  let ajvValidate = null;
  try {
    ajvValidate = new Ajv2020({ strict: false, ownProperties: true }).compile(c.schema);
  } catch (e) {
    wrong.ajv.push(`${c.description}: does not compile (${e.message.slice(0, 60)})`);
  }
  const uri = `https://vmd.invalid/unevaluated/${n++}`;
  const { $id, ...schema } = c.schema;
  hj.registerSchema({ $schema: D, ...schema }, uri);
  const hjValidate = await hj.validate(uri);
  for (const t of c.tests) {
    tests++;
    if (ajvValidate !== null && ajvValidate(t.data ?? t.instance) !== t.valid) wrong.ajv.push(`${c.description}: ${t.description}`);
    if (hjValidate(t.data ?? t.instance).valid !== t.valid) wrong.hyperjump.push(`${c.description}: ${t.description}`);
  }
}
console.log(`${cases.length} cases with unevaluated*, ${skipped} left out ($dynamicRef, $id or a $ref to another document), ${tests} tests run`);
for (const [name, list] of Object.entries(wrong)) {
  console.log(`${name}: ${list.length} wrong`);
  for (const w of list) console.log(`  - ${w}`);
}
