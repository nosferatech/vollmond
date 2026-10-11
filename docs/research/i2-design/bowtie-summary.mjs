// Summarizes Bowtie's draft 2020-12 report for the JavaScript and TypeScript validators: tests run, wrong verdicts, errors
// and skips, over the cases of the JSON-Schema-Test-Suite that the report holds, and lists the cases each validator got wrong.
//
//   curl -o draft2020-12.json https://bowtie.report/draft2020-12.json
//   node bowtie-summary.mjs draft2020-12.json
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const head = JSON.parse(lines[0]);
console.log(`bowtie ${head.bowtie_version}, run started ${head.started}`);
const impls = Object.keys(head.implementations).filter((k) => /^(js|ts)-/.test(k));
const cases = new Map();
const stats = new Map(impls.map((k) => [k, { tests: 0, failed: 0, errored: 0, skipped: 0, failedCases: new Set() }]));
for (const line of lines.slice(1)) {
  const o = JSON.parse(line);
  if (o.case) {
    cases.set(o.seq, o.case);
    continue;
  }
  const s = stats.get(o.implementation);
  if (s === undefined) continue;
  const c = cases.get(o.seq);
  const n = c?.tests.length ?? 0;
  if (o.errored || o.caught !== undefined) {
    s.errored += n;
    s.tests += n;
    s.failedCases.add(`${c?.description} (errored)`);
    continue;
  }
  if (o.skipped) {
    s.skipped += n;
    s.tests += n;
    continue;
  }
  o.results.forEach((r, i) => {
    s.tests += 1;
    if (r.skipped) s.skipped += 1;
    else if (r.errored) {
      s.errored += 1;
      s.failedCases.add(`${c?.description} (errored)`);
    } else if (r.valid !== o.expected[i]) {
      s.failed += 1;
      s.failedCases.add(c?.description);
    }
  });
}
for (const [k, s] of stats) {
  const version = String(head.implementations[k].version);
  console.log(`${k.padEnd(32)} ${version.padEnd(8)} tests ${s.tests} wrong ${s.failed} errored ${s.errored} skipped ${s.skipped}`);
}
for (const k of ["js-ajv", "js-hyperjump", "js-json-schema", "js-schemasafe"]) {
  const s = stats.get(k);
  if (s === undefined) continue;
  console.log(`\n${k}: cases with a wrong verdict or an error`);
  for (const d of [...s.failedCases]) console.log(`  - ${d}`);
}
