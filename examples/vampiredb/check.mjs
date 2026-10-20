#!/usr/bin/env node
// The vampiredb trial (implementation plan, task I2.7): `vmd check` over the store whose root is the `docs/` directory of a
// vampiredb checkout, with this directory's `config.yaml` and its `schema/` through `--config`, so that vampiredb is not
// modified.
//
//   node examples/vampiredb/check.mjs CHECKOUT
//
// Build the TypeScript code first (`npm ci && npm run build` in `js/`). The script:
//
//  1. takes a digest of the store's files;
//  2. runs the built `vmd --json check --all` twice in fresh processes, with a local index in a new temporary cache directory
//     (`XDG_CACHE_HOME`), so that the first run is cold and the second warm, and the user's own cache is never touched;
//  3. prints every issue, the counts per code, and each run's time;
//  4. checks that the store's files are byte for byte what they were, and that no `.vmd/` was created.
//
// It exits with 1 when vmd fails to run the check (any exit code but 0 and 4), when the configuration or the schema cannot be
// used (`config-invalid`, `schema-invalid`, `feature-unsupported`, `storage-failed`), when the warm run reports other issues
// than the cold one, or when the store changed; otherwise with 0, whatever the documents' issues are, since those are the
// trial's result.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const js = path.resolve(here, "../../js");
const vmdMain = path.join(js, "packages/cli/dist/main.js");
const config = path.join(here, "config.yaml");
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
if (!fs.existsSync(vmdMain)) {
  console.error(`${vmdMain} is missing: run npm ci && npm run build in ${js}`);
  process.exit(2);
}

/** A digest of every file under the store root, by path, to show that the check changed nothing. */
function fingerprint() {
  const hash = createHash("sha256");
  const files = fs.readdirSync(store, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const paths = files.map((entry) => path.relative(store, path.join(entry.parentPath, entry.name))).sort();
  for (const file of paths)
    hash
      .update(`${file}\0`)
      .update(fs.readFileSync(path.join(store, file)))
      .update("\0");
  return { files: paths.length, digest: hash.digest("hex").slice(0, 16) };
}

/** Runs the built `vmd --json check --all` in a fresh process with the cache in `cache`, and gives its output and time. */
function check(cache) {
  const started = performance.now();
  let stdout;
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [vmdMain, "--store", store, "--config", config, "--json", "check", "--all"], {
      encoding: "utf8",
      env: { ...process.env, XDG_CACHE_HOME: cache },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stdout = error.stdout ?? "";
    status = error.status ?? 1;
  }
  return { stdout, status, ms: performance.now() - started };
}

const failures = [];
const before = fingerprint();
console.log(`store ${store}: ${before.files} files, sha256 ${before.digest}`);
console.log(`configuration ${path.relative(process.cwd(), config)}, node ${process.versions.node}`);

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "vmd-vampiredb-check-"));
const runs = [];
try {
  for (const name of ["cold", "warm"]) {
    const run = check(cache);
    let output;
    try {
      output = JSON.parse(run.stdout);
    } catch {
      output = { ok: false, issues: [] };
    }
    runs.push({ name, ...run, output });
    if (run.status !== 0 && run.status !== 4) failures.push(`the ${name} run exited with ${run.status}`);
    if (!output.ok) failures.push(`the ${name} run failed: ${run.stdout.slice(0, 2000)}`);
  }
} finally {
  fs.rmSync(cache, { recursive: true, force: true });
}

const [cold, warm] = runs;
const issues = cold.output.issues ?? [];
for (const issue of issues) {
  const where = issue.path == null ? "" : `${issue.path}:${issue.position?.line ?? 1}:${issue.position?.col ?? 1} `;
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

const value = cold.output.value ?? {};
console.log(
  `\n${value.records} records, ${value.unreadable} unreadable, ${value.references} references; vmd exited with ${cold.status}`,
);
for (const run of runs)
  console.log(`${run.name}: ${run.ms.toFixed(0)} ms, ${run.output.value?.fromIndex ?? 0} records from the index`);

const after = fingerprint();
if (after.digest !== before.digest || after.files !== before.files) failures.push("the store's files changed");
if (fs.existsSync(path.join(store, ".vmd"))) failures.push("a .vmd/ exists in the store");
console.log(`store after: ${after.files} files, sha256 ${after.digest}${after.digest === before.digest ? ", unchanged" : ""}`);

for (const failure of failures) console.log(`FAILED: ${failure}`);
console.log(failures.length === 0 ? "check.mjs: the trial ran" : `check.mjs: ${failures.length} failures`);
process.exit(failures.length === 0 ? 0 : 1);
