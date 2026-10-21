#!/usr/bin/env node
// The vampiredb trial (implementation plan, task I2.7): `vmd check` over the store whose root is the `docs/` directory of a
// vampiredb checkout, with this directory's `config.yaml` and its `schema/` through `--config`, so that vampiredb is not
// modified.
//
//   node examples/vampiredb/check.mjs CHECKOUT
//
// Build the TypeScript code first (`npm ci && npm run build` in `js/`). The script:
//
//  1. takes a digest of the store: every entry under its root, with its kind, a file's bytes and a symbolic link's target;
//  2. runs the built `vmd --json check --all` twice in fresh processes, with a local index in a new temporary cache directory
//     (`XDG_CACHE_HOME`), so that the first run is cold and the second warm, and the user's own cache is never touched. It
//     refuses to start (exit 2) when the system's temporary directory is inside CHECKOUT, since the cache would then be too;
//  3. prints every issue, the counts per code, and each run's time;
//  4. checks that the store's entries are what they were, byte for byte, and that no `.vmd/` was created.
//
// It exits with 1 when vmd fails to run the check (any exit code but 0 and 4; its stderr is printed), when the configuration or
// the schema cannot be used (`config-invalid`, `schema-invalid`, `feature-unsupported`, `storage-failed`), when the warm run
// reports other issues than the cold one or reads any record other than from the index, or when the store changed; otherwise
// with 0, whatever the documents' issues are, since those are the trial's result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, fingerprint, js, runVmd, temporaryInsideCheckout, vmdMain } from "./shared.mjs";

/** The codes that say the trial's own configuration or schema cannot be used, rather than something about a document. */
const SETUP_CODES = new Set(["config-invalid", "schema-invalid", "feature-unsupported", "storage-failed"]);

const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0].startsWith("--")) {
  console.error("usage: node examples/vampiredb/check.mjs CHECKOUT");
  process.exit(2);
}
const store = path.resolve(argv[0], "docs");
if (!fs.statSync(store, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`${store} is not a directory: CHECKOUT is a vampiredb checkout, whose docs/ is the store`);
  process.exit(2);
}
const temporaryRefusal = temporaryInsideCheckout(argv[0]);
if (temporaryRefusal !== null) {
  console.error(temporaryRefusal);
  process.exit(2);
}
if (!fs.existsSync(vmdMain)) {
  console.error(`${vmdMain} is missing: run npm ci && npm run build in ${js}`);
  process.exit(2);
}

const failures = [];
const before = fingerprint(store);
console.log(`store ${store}: ${before.entries} entries, sha256 ${before.digest}`);
console.log(`configuration ${path.relative(process.cwd(), config)}, node ${process.versions.node}`);

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "vmd-vampiredb-check-"));
const runs = [];
try {
  for (const name of ["cold", "warm"]) {
    const run = runVmd(store, ["--json", "check", "--all"], { cache });
    let output;
    try {
      output = JSON.parse(run.stdout);
    } catch {
      output = { ok: false, issues: [] };
    }
    runs.push({ name, ...run, output });
    const failed = run.status !== 0 && run.status !== 4;
    if (failed) failures.push(`the ${name} run exited with ${run.status}`);
    if (!output.ok) failures.push(`the ${name} run failed: ${run.stdout.slice(0, 2000)}`);
    if ((failed || !output.ok) && run.stderr !== "") console.log(`vmd's stderr, ${name} run:\n${run.stderr}`);
  }
} finally {
  fs.rmSync(cache, { recursive: true, force: true });
}

const [cold, warm] = runs;
const issues = cold.output.issues ?? [];
for (const issue of issues) {
  const at = issue.position == null ? "" : `:${issue.position.line}:${issue.position.col}`;
  const where = issue.path == null ? "" : `${issue.path}${at} `;
  console.log(`${where}${issue.severity} ${issue.code}: ${issue.message}${issue.at ? `\n  at ${issue.at}` : ""}`);
  if (SETUP_CODES.has(issue.code)) failures.push(`the trial's configuration or schema cannot be used: ${issue.code}`);
}
const counts = new Map();
for (const issue of issues) {
  const key = `${issue.severity} ${issue.code}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log("\nissues by code:");
for (const [code, count] of [...counts].sort()) console.log(`  ${String(count).padStart(5)}  ${code}`);
if (JSON.stringify(warm.output.issues) !== JSON.stringify(cold.output.issues))
  failures.push("the warm run reports other issues than the cold one");
if (warm.output.value?.fromIndex !== warm.output.value?.records)
  failures.push(`the warm run read ${warm.output.value?.fromIndex} of ${warm.output.value?.records} records from the index`);

const value = cold.output.value ?? {};
console.log(
  `\n${value.records} records, ${value.unreadable} unreadable, ${value.references} references; vmd exited with ${cold.status}`,
);
for (const run of runs)
  console.log(`${run.name}: ${run.ms.toFixed(0)} ms, ${run.output.value?.fromIndex ?? 0} records from the index`);

const after = fingerprint(store);
if (after.digest !== before.digest || after.entries !== before.entries) failures.push("the store changed");
if (fs.existsSync(path.join(store, ".vmd"))) failures.push("a .vmd/ exists in the store");
const unchanged = after.digest === before.digest ? ", unchanged" : "";
console.log(`store after: ${after.entries} entries, sha256 ${after.digest}${unchanged}`);

for (const failure of failures) console.log(`FAILED: ${failure}`);
console.log(failures.length === 0 ? "check.mjs: the trial ran" : `check.mjs: ${failures.length} failures`);
process.exit(failures.length === 0 ? 0 : 1);
