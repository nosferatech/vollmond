#!/usr/bin/env node
// The phase I1 demonstration (implementation plan, task I1.11): `vmd outline` and `vmd get` over the store whose root is the
// `docs/` directory of a vampiredb checkout, read with this directory's `config.yaml` through `--config`, so that vampiredb is
// not modified (decision K3).
//
//   node examples/vampiredb/demo.mjs CHECKOUT [--fast] [--runs N]
//
// Build the TypeScript code first (`npm ci && npm run build` in `js/`). The script:
//
//  1. lists the store with `vmd --json ls`, in a fresh process, and checks that every record is readable;
//  2. runs `vmd --json outline PATH` for every record, each in a fresh process;
//  3. enumerates every section, and every explicit, derived and block anchor, from `parseRecord` and the record's anchor
//     table, and checks that the outline lists every section at the canonical address `core` gives it;
//  4. runs `vmd get ADDRESS --meta at,address,range` on each section's canonical address, on each block anchor's canonical
//     address, and on `#NAME` for each explicit, derived and block anchor, and checks that each resolves, as a singular
//     address, to the node (or the block) it came from. By default each `get` goes through the CLI's `runCli` in this
//     process, which reads the record again for each address; `--fast` reads each record once through `openStore` over the
//     same filesystem backend, which is the operation `vmd get` runs, without the command line around it;
//  5. cross-checks the counts against a line scan of the files that does not use vmd: ATX headings and `<a id=` elements
//     outside fenced code blocks and code spans;
//  6. runs `vmd get` on `#ID` for each anchor element that anchors nothing (`anchor-element-ignored`), and counts the store's
//     links to it, which vmd cannot resolve;
//  7. times `vmd outline design/Minimal_Log.md`: cold, in a fresh process each run, and warm, `runCli` again in one process;
//  8. checks that the store's files are byte for byte what they were before, and that no `.vmd/` was created.
//
// It prints every failure with its record, address, issue and class, the validation issues the parse found in each record,
// the ignored anchor elements, and a summary. It exits with 1 when any check failed; the ignored elements are not failures.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const js = path.resolve(here, "../../js");
const vmdMain = path.join(js, "packages/cli/dist/main.js");
const config = path.join(here, "config.yaml");
const TIMED_RECORD = "design/Minimal_Log.md";

const argv = process.argv.slice(2);
const fast = argv.includes("--fast");
const runsAt = argv.indexOf("--runs");
const runs = runsAt === -1 ? 10 : Number(argv[runsAt + 1]);
const checkout = argv.find((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--runs");
if (checkout === undefined || !Number.isSafeInteger(runs) || runs < 1) {
  console.error("usage: node examples/vampiredb/demo.mjs CHECKOUT [--fast] [--runs N]");
  process.exit(2);
}
const store = path.resolve(checkout, "docs");
if (!fs.existsSync(vmdMain)) {
  console.error(`${vmdMain} is missing: run npm ci && npm run build in ${js}`);
  process.exit(2);
}
const core = await import(pathToFileURL(path.join(js, "packages/core/dist/index.js")).href);
const { runCli } = await import(pathToFileURL(path.join(js, "packages/cli/dist/cli.js")).href);
const { createFilesystemStorage } = await import(pathToFileURL(path.join(js, "packages/cli/dist/backend/filesystem.js")).href);

/**
 * The failures, each with a class: `docs` for an anchor whose name the record gives to more than one target, which is a
 * problem of the document; `triage` for any other, to be classified by hand as a vmd bug or a gap in the specification.
 */
const failures = [];
const fail = (record, address, issue, detail, kind = "triage") => failures.push({ record, address, issue, detail, kind });

/** Runs the built `vmd` in a fresh process with the store and the configuration, and gives its output and time. */
function vmd(args) {
  const started = performance.now();
  let stdout;
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [vmdMain, "--store", store, "--config", config, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stdout = error.stdout ?? "";
    status = error.status ?? 1;
  }
  return { stdout, status, ms: performance.now() - started };
}

/** A digest of every file under the store root, by path, to show that the demonstration changed nothing. */
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

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { min: sorted[0], median, max: sorted[sorted.length - 1] };
};
const ms = (s) => `min ${s.min.toFixed(0)} ms, median ${s.median.toFixed(0)} ms, max ${s.max.toFixed(0)} ms`;

const before = fingerprint();
console.log(`store ${store}: ${before.files} files, sha256 ${before.digest}`);
console.log(
  `node ${process.versions.node}, unicode ${process.versions.unicode}, ${fast ? "--fast (openStore)" : "get through runCli"}`,
);

// 1. The listing.
const listed = vmd(["--json", "ls", "--limit", "1000"]);
const listing = JSON.parse(listed.stdout);
if (!listing.ok) {
  console.error(listed.stdout);
  process.exit(1);
}
const records = listing.value.items.filter((item) => item.kind === "record");
for (const item of records) if (!item.readable) fail(item.path, "", "unreadable", "ls counts it as unreadable");
console.log(`ls: ${records.length} records, ${listing.value.unreadable.count} unreadable, ${listed.ms.toFixed(0)} ms`);

// 2 and 3. The outlines, and the nodes and anchors to resolve.
const totals = { sections: 0, headings: 0, explicit: 0, derived: 0, block: 0, addresses: 0, resolved: 0 };
const scan = { headings: 0, anchorElements: 0 };
const checks = [];
const warnings = [];
/** The anchor elements that anchor nothing (`anchor-element-ignored`), with their ids. */
const ignored = [];
let outlineMs = 0;
for (const { path: recordPath } of records) {
  const outlined = vmd(["--json", "outline", recordPath]);
  outlineMs += outlined.ms;
  const outline = JSON.parse(outlined.stdout);
  if (!outline.ok) {
    fail(recordPath, "", "outline failed", JSON.stringify(outline.issues));
    continue;
  }
  const bytes = fs.readFileSync(path.join(store, recordPath));
  const parsed = core.parseRecord(recordPath, bytes);
  if (!parsed.ok) {
    fail(recordPath, "", "parse failed", JSON.stringify(parsed.issues));
    continue;
  }
  const record = parsed.value;
  for (const issue of record.issues) {
    warnings.push({ record: recordPath, issue });
    // An anchor element that anchors nothing: what its id gives, and how often the store's links use it.
    if (issue.code !== "anchor-element-ignored" || issue.position === undefined) continue;
    const id = /^<a\s+id="([^"]*)"/.exec(new TextDecoder().decode(bytes.subarray(issue.position.offset)))?.[1];
    if (id !== undefined) ignored.push({ record: recordPath, id, line: issue.position.line });
  }
  const sections = record.nodes.sections();
  const outlineAddresses = new Map([outline.value.node, ...outline.value.sections].map((entry) => [entry.at, entry.address]));
  for (const section of sections) {
    totals.sections += 1;
    if (section.heading !== null) totals.headings += 1;
    const address = core.canonicalAddress(record, section.at);
    if (outlineAddresses.get(section.at) !== address) {
      fail(
        recordPath,
        address,
        "outline",
        `the outline gives ${JSON.stringify(outlineAddresses.get(section.at))} for ${section.at}`,
      );
    }
    if (section.at === "") continue; // the root's address is the record itself, `get` of the path alone
    checks.push({ record: recordPath, address, what: "section", at: section.at });
  }
  checks.push({ record: recordPath, address: "", what: "root", at: "" });
  for (const entry of record.anchors.anchors) {
    totals[entry.kind] += 1;
    const expected = { at: entry.at, ...(entry.kind === "block" ? { range: entry.range } : {}) };
    const name = `#${core.encodeStep(entry.name)}`;
    const duplicate = new Set(record.anchors.named(entry.name).map(targetOf)).size > 1;
    checks.push({ record: recordPath, address: name, what: `${entry.kind} anchor`, duplicate, ...expected });
    if (entry.kind === "block") {
      // A block whose name is not singular has no address of its own: its canonical address is its $body's.
      const address = core.blockAnchorAddress(record, entry);
      if (address === name) checks.push({ record: recordPath, address, what: "block canonical", duplicate, ...expected });
      else
        fail(
          recordPath,
          name,
          "block canonical",
          `no address names this block alone; its canonical address is its $body's, ${address}`,
          "docs",
        );
    }
  }
  const counted = lineScan(new TextDecoder().decode(bytes));
  scan.headings += counted.headings;
  scan.anchorElements += counted.anchorElements;
  const vmdHeadings = sections.filter((section) => section.heading !== null).length;
  if (counted.headings !== vmdHeadings) {
    console.log(`  note: ${recordPath}: the line scan counts ${counted.headings} headings, vmd ${vmdHeadings}`);
  }
  // Every anchor element is an explicit or a block anchor, or raises an issue: anchor-element-ignored, or invalid.
  const vmdElements =
    record.anchors.anchors.filter((entry) => entry.kind !== "derived").length +
    record.issues.filter((issue) => issue.code.startsWith("anchor-element-")).length;
  if (counted.anchorElements !== vmdElements) {
    console.log(`  note: ${recordPath}: the line scan counts ${counted.anchorElements} <a id= elements, vmd ${vmdElements}`);
  }
}
console.log(`outline: ${records.length} records, ${outlineMs.toFixed(0)} ms in all, each in a fresh process`);

// 4. The gets.
const opened = fast ? await core.openStore(createFilesystemStorage(store), { config: fs.readFileSync(config) }) : null;
if (opened !== null && !opened.ok) throw new Error(JSON.stringify(opened.issues));
const seen = new Map();
const getStarted = performance.now();
for (const check of checks) {
  const full = `${check.record}${check.address}`;
  let outcome = seen.get(full);
  if (outcome === undefined) {
    outcome = await get(full);
    seen.set(full, outcome);
    totals.addresses += 1;
  }
  if (!outcome.ok) {
    const issue = outcome.issues.map((i) => `${i.code}: ${i.message}`).join("; ");
    fail(check.record, check.address, check.what, issue, check.duplicate ? "docs" : "triage");
    continue;
  }
  const meta = outcome.value.meta;
  const range = check.range === undefined ? undefined : `${check.range.start},${check.range.end}`;
  const gotRange =
    meta["@range"] === undefined
      ? undefined
      : `${meta["@range"][0] ?? meta["@range"].start},${meta["@range"][1] ?? meta["@range"].end}`;
  if (meta["@at"] !== check.at || gotRange !== range) {
    fail(check.record, check.address, check.what, `resolves to ${meta["@at"]} ${gotRange ?? ""}, not ${check.at} ${range ?? ""}`);
  }
}
for (const outcome of seen.values()) if (outcome.ok) totals.resolved += 1;
const getMs = performance.now() - getStarted;
console.log(`get: ${checks.length} checks, ${totals.addresses} distinct addresses, ${(getMs / 1000).toFixed(1)} s`);

/** Reads a node with its exact path, canonical address and block range, as `vmd get --json --meta` gives them. */
async function get(full) {
  if (opened !== null) return opened.value.get(full, { meta: ["@at", "@address", "@range"], reading: { raw: true } });
  const result = await runCli(["--store", store, "--config", config, "--json", "get", full, "--meta", "at,address,range"]);
  return JSON.parse(result.stdout);
}

/** Identifies the target an anchor entry names: a node by its exact path, a block by its range too. */
function targetOf(entry) {
  return entry.kind === "block" ? `${entry.at} ${entry.range.start},${entry.range.end}` : entry.at;
}

/**
 * Counts, without vmd, the ATX headings at the start of a line and the `<a id=` elements, outside fenced code blocks and
 * one-line code spans: an approximation (it misses setext headings and counts headings in block quotes) that checks vmd's
 * counts from outside.
 */
function lineScan(text) {
  let fence = null;
  let headings = 0;
  let anchorElements = 0;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (opener !== null && opener[1][0] === fence[0] && opener[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line))
        fence = null;
      continue;
    }
    if (opener !== null) {
      fence = opener[1];
      continue;
    }
    if (/^ {0,3}#{1,6}(\s|$)/.test(line)) headings += 1;
    // Code spans on one line are left out: an element in one is text.
    anchorElements += (line.replace(/(`+)(?:(?!\1).)+?\1/g, "").match(/<a\s+id=/g) ?? []).length;
  }
  return { headings, anchorElements };
}

// 6. Ignored anchor elements: `get` should not find them, and the links that use them do not resolve.
const storeText = new Map(records.map(({ path: p }) => [p, fs.readFileSync(path.join(store, p), "utf8")]));
for (const element of ignored) {
  const outcome = await get(`${element.record}#${element.id}`);
  element.found = outcome.ok;
  element.links = 0;
  const base = path.posix.basename(element.record);
  // A link to the element: `](#id)` in its own record, `](…/Name.md#id)` anywhere (by the file's name, an approximation).
  for (const [p, text] of storeText) {
    const file = `(?:[^)\\s]*/)?${escapeRegExp(base)}`;
    const target = p === element.record ? `(?:${file})?` : file;
    element.links += (text.match(new RegExp(`\\]\\(${target}#${escapeRegExp(element.id)}\\)`, "g")) ?? []).length;
  }
}

/** Escapes a string for a regular expression. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 7. Timing.
const cold = [];
for (let i = 0; i < runs; i++) {
  const run = vmd(["outline", TIMED_RECORD]);
  if (run.status !== 0) fail(TIMED_RECORD, "", "timed outline", `exit ${run.status}`);
  cold.push(run.ms);
}
const warm = [];
await runCli(["--store", store, "--config", config, "outline", TIMED_RECORD]);
for (let i = 0; i < runs; i++) {
  const started = performance.now();
  await runCli(["--store", store, "--config", config, "outline", TIMED_RECORD]);
  warm.push(performance.now() - started);
}
const size = fs.statSync(path.join(store, TIMED_RECORD)).size;

// 8. Nothing changed.
const after = fingerprint();
if (after.digest !== before.digest || after.files !== before.files)
  fail("", "", "store changed", `${before.digest} -> ${after.digest}`);
if (fs.existsSync(path.join(store, ".vmd"))) fail("", "", "store changed", "a .vmd directory exists in the store");

// The report.
const byCode = {};
for (const { issue } of warnings) byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
console.log("\nvalidation issues found while parsing (warnings; they fail no read):");
for (const { record, issue } of warnings) {
  const where = issue.position === undefined ? "" : `:${issue.position.line}:${issue.position.col}`;
  console.log(`  ${record}${where} ${issue.code} at ${JSON.stringify(issue.at)}: ${issue.message}`);
}
console.log("\nanchor elements that anchor nothing, which `get` does not find (§6.2):");
for (const e of ignored) {
  console.log(
    `  ${e.record}:${e.line} #${e.id}: get ${e.found ? "finds a node of that name" : "finds nothing"}, ${e.links} links to it`,
  );
}
console.log("\nfailures:");
if (failures.length === 0) console.log("  none");
for (const f of failures) console.log(`  ${f.kind}: ${f.record}${f.address} [${f.issue}] ${f.detail}`);
console.log(`
summary
  documents          ${records.length} (of ${before.files} files), ${listing.value.unreadable.count} unreadable
  sections           ${totals.sections}, of which ${totals.headings} with a heading (line scan: ${scan.headings} ATX headings)
  anchors            ${totals.explicit} explicit, ${totals.derived} derived, ${totals.block} block (line scan: ${scan.anchorElements} <a id= elements)
  validation issues  ${warnings.length} ${JSON.stringify(byCode)}
  ignored elements   ${ignored.length}, ${ignored.filter((e) => !e.found).length} not found by get, ${ignored.filter((e) => e.links > 0).length} of them linked (${ignored.reduce((n, e) => n + e.links, 0)} links)
  get                ${checks.length} checks over ${totals.addresses} distinct addresses, ${totals.resolved} resolved
  failures           ${failures.length}: ${failures.filter((f) => f.kind === "docs").length} docs (a name given to several targets), ${failures.filter((f) => f.kind === "triage").length} to triage
  ls                 ${listed.ms.toFixed(0)} ms, one fresh process
  outline, all       ${outlineMs.toFixed(0)} ms for ${records.length} fresh processes
  ${TIMED_RECORD} (${size} bytes), ${runs} runs:
    cold             ${ms(stats(cold))} (vmd outline in a fresh process, wall clock)
    warm             ${ms(stats(warm))} (runCli again in one process, store opened each time)
  store unchanged    ${after.digest === before.digest ? "yes" : "NO"} (sha256 ${after.digest}), no .vmd/: ${fs.existsSync(path.join(store, ".vmd")) ? "NO" : "yes"}`);
process.exitCode = failures.length === 0 ? 0 : 1;
