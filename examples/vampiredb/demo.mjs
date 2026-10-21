#!/usr/bin/env node
// The phase I1 demonstration (implementation plan, task I1.11): `vmd outline` and `vmd get` over the store whose root is the
// `docs/` directory of a vampiredb checkout, read with this directory's `config.yaml` through `--config`, so that vampiredb is
// not modified (decision K3).
//
//   node examples/vampiredb/demo.mjs CHECKOUT [--fast] [--runs N]
//
// Build the TypeScript code first (`npm ci && npm run build` in `js/`). Every command, in a fresh process or in this one,
// keeps the local index in a new temporary cache directory (`XDG_CACHE_HOME`), so that the user's own cache is never touched;
// the script refuses to start (exit 2) when the system's temporary directory is inside CHECKOUT. The script:
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
//  5. checks vmd against the files, through a line scan that does not use vmd (ATX headings and `<a id=` elements outside
//     fenced code blocks and code spans): the counts must agree; `#ID` of each heading's element and `#SLUG` of its slug, by
//     the demo's own reading of §6.3, must give the section at that heading's line with its title; `#ID` of each other
//     element must give a block that starts with the element, at its line, whose text is in the file, or nothing when vmd
//     reports the element as anchoring nothing. Steps 3 and 4 compare vmd with itself; this step does not;
//  6. runs `vmd get` on `#ID` for each anchor element that anchors nothing (`anchor-element-ignored`), and counts the store's
//     links to it, which vmd cannot resolve;
//  7. times `vmd outline design/Minimal_Log.md`: cold, in a fresh process each run, and warm, `runCli` again in one process;
//     both with `--no-cache`, so that each run parses the record rather than reading it from the index;
//  8. checks that the store's entries (files, directories and symbolic links) are what they were before, byte for byte,
//     and that no `.vmd/` was created.
//
// It prints every failure with its record, address, issue and class, the validation issues the parse found in each record,
// the ignored anchor elements, and a summary. It exits with 1 when any check failed; the ignored elements are not failures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config, fingerprint, formatStats, js, runVmd, stats, temporaryInsideCheckout, vmdMain } from "./shared.mjs";

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
const temporaryRefusal = temporaryInsideCheckout(checkout);
if (temporaryRefusal !== null) {
  console.error(temporaryRefusal);
  process.exit(2);
}
// The local index lives in a temporary cache directory of the demonstration's own, for the fresh processes and for the
// commands run in this process alike, so that the user's cache is never read or written; it is removed at exit.
const cache = fs.mkdtempSync(path.join(os.tmpdir(), "vmd-vampiredb-demo-"));
process.env.XDG_CACHE_HOME = cache;
process.on("exit", () => fs.rmSync(cache, { recursive: true, force: true }));
const core = await import(pathToFileURL(path.join(js, "packages/core/dist/index.js")).href);
const { runCli } = await import(pathToFileURL(path.join(js, "packages/cli/dist/cli.js")).href);
const { createFilesystemStorage } = await import(pathToFileURL(path.join(js, "packages/cli/dist/backend/filesystem.js")).href);
const { configurationFileSource } = await import(pathToFileURL(path.join(js, "packages/cli/dist/configuration-file.js")).href);

/**
 * The failures, each with a class: `docs` for an anchor whose name the record gives to more than one target, which is a
 * problem of the document; `triage` for any other, to be classified by hand as a vmd bug or a gap in the specification.
 */
const failures = [];
const fail = (record, address, issue, detail, kind = "triage") => failures.push({ record, address, issue, detail, kind });

/** Runs the built `vmd` in a fresh process with the store and the configuration, and gives its output and time. */
const vmd = (args) => runVmd(store, args, { cache });

const before = fingerprint(store);
console.log(`store ${store}: ${before.entries} entries, sha256 ${before.digest}`);
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
/** Each record's text, with the headings and anchor elements the line scan found in it. */
const scanned = [];
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
  const text = new TextDecoder().decode(bytes);
  const counted = lineScan(text);
  scanned.push({ record: recordPath, text, ...counted });
  scan.headings += counted.headings.length;
  scan.anchorElements += counted.anchorElements;
  const vmdHeadings = sections.filter((section) => section.heading !== null).length;
  if (counted.headings.length !== vmdHeadings) {
    fail(recordPath, "", "line scan", `the line scan counts ${counted.headings.length} headings, vmd ${vmdHeadings}`);
  }
  // Every anchor element is an explicit or a block anchor, or raises an issue: anchor-element-ignored, or invalid.
  const vmdElements =
    record.anchors.anchors.filter((entry) => entry.kind !== "derived").length +
    record.issues.filter((issue) => issue.code.startsWith("anchor-element-")).length;
  if (counted.anchorElements !== vmdElements) {
    fail(recordPath, "", "line scan", `the line scan counts ${counted.anchorElements} <a id= elements, vmd ${vmdElements}`);
  }
}
console.log(`outline: ${records.length} records, ${outlineMs.toFixed(0)} ms in all, each in a fresh process`);

// 4. The gets.
const configuration = configurationFileSource(config, "examples/vampiredb/config.yaml", fs.readFileSync(config));
const opened = fast ? await core.openStore(createFilesystemStorage(store), { configuration }) : null;
if (opened !== null && !opened.ok) throw new Error(JSON.stringify(opened.issues));
const seen = new Map();
const getStarted = performance.now();
for (const check of checks) {
  const outcome = await get(`${check.record}${check.address}`);
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
const vmdAddresses = totals.addresses;

// 5. The same reads, checked against the files rather than against vmd: the line scan's headings and anchor elements.
const independent = { explicit: 0, derived: 0, derivedSkipped: 0, block: 0, ignored: 0 };
for (const { record, text, headings, elements } of scanned) {
  for (const [index, heading] of headings.entries()) {
    if (heading.id !== null) {
      independent.explicit += 1;
      await checkHeading(record, `#${heading.id}`, heading, index, "explicit, from the file");
    }
    if (heading.slug === null) independent.derivedSkipped += 1;
    else if (heading.slug !== "") {
      independent.derived += 1;
      await checkHeading(record, `#${heading.slug}`, heading, index, "derived, by the demo's slug");
    }
  }
  for (const element of elements) {
    const address = `#${element.id}`;
    const outcome = await get(`${record}${address}`);
    const reported = ignored.some((entry) => entry.record === record && entry.id === element.id && entry.line === element.line);
    if (!outcome.ok) {
      if (reported) independent.ignored += 1;
      else fail(record, address, "block, from the file", `line ${element.line}: get finds nothing, and vmd reports no issue`);
      continue;
    }
    if (reported) {
      fail(
        record,
        address,
        "block, from the file",
        `line ${element.line}: vmd ignores the element, but get finds ${outcome.value.meta["@at"]}`,
      );
      continue;
    }
    const { value, meta } = outcome.value;
    const problem =
      typeof value !== "string"
        ? `get gives a node, ${meta["@at"]}, not a block`
        : !value.replace(/^([-*+]|[0-9]{1,9}[.)])[ \t]+/, "").startsWith(`<a id="${element.id}"`)
          ? `the block starts ${JSON.stringify(value.slice(0, 40))}, not with its element`
          : !text.includes(value)
            ? "the block's text is not in the file"
            : meta["@source"].line !== element.line
              ? `the block is at line ${meta["@source"].line}, the element at line ${element.line}`
              : null;
    if (problem === null) independent.block += 1;
    else fail(record, address, "block, from the file", problem);
  }
}
for (const outcome of seen.values()) if (outcome.ok) totals.resolved += 1;
const getMs = performance.now() - getStarted;
console.log(`get: ${checks.length} checks, ${totals.addresses} distinct addresses, ${(getMs / 1000).toFixed(1)} s`);

/**
 * Checks that an address resolves to the section of a heading the line scan found: the section at the heading's line with
 * its title, or the root, whose title heading is the first heading of the record.
 */
async function checkHeading(record, address, heading, index, what) {
  const outcome = await get(`${record}${address}`);
  if (!outcome.ok) {
    fail(record, address, what, outcome.issues.map((i) => `${i.code}: ${i.message}`).join("; "));
    return;
  }
  const { value, meta } = outcome.value;
  const title = value !== null && typeof value === "object" ? value.$title : undefined;
  const place = meta["@at"] === "" ? (index === 0 && heading.level === 1 ? heading.line : 1) : meta["@source"].line;
  if (place !== heading.line || title !== heading.title) {
    fail(
      record,
      address,
      what,
      `line ${heading.line} ${JSON.stringify(heading.title)}: get gives line ${place} ${JSON.stringify(title)}`,
    );
  }
}

/**
 * Reads a node's value view, with its exact path, canonical address, block range and place in the file, as
 * `vmd --json get ADDRESS --value --meta at,address,range,source` gives them; each address is read once.
 */
async function get(full) {
  let outcome = seen.get(full);
  if (outcome !== undefined) return outcome;
  const meta = ["@at", "@address", "@range", "@source"];
  if (opened !== null) {
    outcome = await opened.value.get(full, { meta, reading: { raw: true } });
  } else {
    const args = ["--store", store, "--config", config, "--json", "get", full, "--value", "--meta", meta.join(",")];
    outcome = JSON.parse((await runCli(args)).stdout);
  }
  seen.set(full, outcome);
  totals.addresses += 1;
  return outcome;
}

/** Identifies the target an anchor entry names: a node by its exact path, a block by its range too. */
function targetOf(entry) {
  return entry.kind === "block" ? `${entry.at} ${entry.range.start},${entry.range.end}` : entry.at;
}

/**
 * Reads, without vmd, the ATX headings at the start of a line and the `<a id=` elements, outside fenced code blocks and
 * one-line code spans: an approximation of CommonMark (it misses setext headings, and takes headings and elements in block
 * quotes and HTML blocks too) that checks vmd from outside.
 *
 * Gives each heading's line, level, title (its text without the `#` sequences and the anchor element, trimmed), explicit
 * anchor, and derived anchor by {@link slugOf} with §6.3's repeats (null where the title holds markup the demo's slug does
 * not read); each element outside a heading, with its line and id; and the number of elements.
 */
function lineScan(text) {
  let fence = null;
  const headings = [];
  const elements = [];
  let anchorElements = 0;
  const used = new Set();
  for (const [n, line] of text.split(/\r\n|\r|\n/).entries()) {
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
    // Code spans on one line are left out: an element in one is text.
    const ids = [...line.replace(/(`+)(?:(?!\1).)+?\1/g, "").matchAll(/<a\s+id="([^"]*)"/g)].map((match) => match[1]);
    anchorElements += (line.replace(/(`+)(?:(?!\1).)+?\1/g, "").match(/<a\s+id=/g) ?? []).length;
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx === null) {
      for (const id of ids) elements.push({ line: n + 1, id });
      continue;
    }
    const content = atx[2] ?? "";
    const title = content.replace(/<a\s+id="[^"]*"\s*>\s*<\/a>/, "").replace(/^[ \t]+|[ \t]+$/g, "");
    const slug = slugOf(content);
    // §6.3 step 7: the slug, or the slug followed by `-n` for the smallest n that is not yet used.
    let candidate = slug ?? title;
    for (let k = 1; used.has(candidate); k++) candidate = `${slug ?? title}-${k}`;
    used.add(candidate);
    headings.push({ line: n + 1, level: atx[1].length, title, id: ids[0] ?? null, slug: slug === null ? null : candidate });
  }
  return { headings, elements, anchorElements };
}

/**
 * Gives the slug of a heading's content by §6.3 steps 1 to 6, written here apart from vmd's and with the runtime's Unicode
 * data, or null for content whose visible text it does not read: HTML other than the anchor element, character references,
 * backslash escapes, images, reference links, and `_` that may be an emphasis delimiter.
 */
function slugOf(content) {
  const withoutElement = content.replace(/<a\s+id="[^"]*"\s*>\s*<\/a>/, "");
  if (/[<\\]|&[#A-Za-z0-9]+;|!\[|\]\[|(^|[^\p{L}\p{Nd}])_|_($|[^\p{L}\p{Nd}])/u.test(withoutElement)) return null;
  // Step 1, visible text: a code span's content as it is; outside code spans, a link's text without its URL and no `*`.
  const visible = withoutElement
    .split(/(`+[^`]*`+)/)
    .map((part, i) =>
      i % 2 === 1 ? part.replace(/^`+|`+$/g, "") : part.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*/g, ""),
    )
    .join("");
  const normalized = visible.replace(/[\p{Default_Ignorable_Code_Point}\p{Cn}]/gu, "").normalize("NFC");
  const lower = [...normalized].map((c) => c.toLowerCase()).join("");
  const trimmed = lower.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  return trimmed
    .replace(/\p{White_Space}/gu, " ")
    .replace(/[^ \p{L}\p{M}\p{Nd}\p{Pc}-]/gu, "")
    .replace(/ /g, "-");
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
  const run = vmd(["--no-cache", "outline", TIMED_RECORD]);
  if (run.status !== 0) fail(TIMED_RECORD, "", "timed outline", `exit ${run.status}`);
  cold.push(run.ms);
}
const warm = [];
await runCli(["--store", store, "--config", config, "--no-cache", "outline", TIMED_RECORD]);
for (let i = 0; i < runs; i++) {
  const started = performance.now();
  await runCli(["--store", store, "--config", config, "--no-cache", "outline", TIMED_RECORD]);
  warm.push(performance.now() - started);
}
const size = fs.statSync(path.join(store, TIMED_RECORD)).size;

// 8. Nothing changed.
const after = fingerprint(store);
if (after.digest !== before.digest || after.entries !== before.entries)
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
  documents          ${records.length} (of ${before.entries} entries), ${listing.value.unreadable.count} unreadable
  sections           ${totals.sections}, of which ${totals.headings} with a heading (line scan: ${scan.headings} ATX headings)
  anchors            ${totals.explicit} explicit, ${totals.derived} derived, ${totals.block} block (line scan: ${scan.anchorElements} <a id= elements)
  validation issues  ${warnings.length} ${JSON.stringify(byCode)}
  ignored elements   ${ignored.length}, ${ignored.filter((e) => !e.found).length} not found by get, ${ignored.filter((e) => e.links > 0).length} of them linked (${ignored.reduce((n, e) => n + e.links, 0)} links)
  get                ${checks.length} checks over ${vmdAddresses} addresses from vmd's anchor table; ${totals.addresses} distinct addresses in all, ${totals.resolved} resolved
  from the files     ${independent.explicit} heading anchors, ${independent.derived} derived anchors by the demo's slug (${independent.derivedSkipped} headings skipped for markup), ${independent.block} blocks, ${independent.ignored} ignored elements not found
  failures           ${failures.length}: ${failures.filter((f) => f.kind === "docs").length} docs (a name given to several targets), ${failures.filter((f) => f.kind === "triage").length} to triage
  ls                 ${listed.ms.toFixed(0)} ms, one fresh process
  outline, all       ${outlineMs.toFixed(0)} ms for ${records.length} fresh processes
  ${TIMED_RECORD} (${size} bytes), ${runs} runs:
    cold             ${formatStats(stats(cold))} (vmd outline in a fresh process, wall clock)
    warm             ${formatStats(stats(warm))} (runCli again in one process, store opened each time)
  store unchanged    ${after.digest === before.digest ? "yes" : "NO"} (sha256 ${after.digest}), no .vmd/: ${fs.existsSync(path.join(store, ".vmd")) ? "NO" : "yes"}`);
process.exitCode = failures.length === 0 ? 0 : 1;
