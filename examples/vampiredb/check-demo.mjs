#!/usr/bin/env node
// The phase I2 demonstration (implementation plan, task I2.8): `vmd check` over the store whose root is the `docs/` directory
// of a vampiredb checkout, with this directory's `config.yaml` and its `schema/`, compared with vampiredb's own checker,
// `scripts/docs.sh`. Neither vampiredb nor its ticket directory is modified.
//
//   node examples/vampiredb/check-demo.mjs CHECKOUT [--runs N]
//
// Build the TypeScript code first (`npm ci && npm run build` in `js/`). `bash`, `python3` and `git` must be on the path. The
// script:
//
//  1. makes a marker file in a temporary directory, then takes a digest of the store (every entry under `docs/`), of every
//     file `docs.sh` reads in the checkout (the files `git ls-files --cached --others --exclude-standard` lists), of the
//     checkout's HEAD, `git status` and the stat of its git index, and of the ticket directory `docs.sh` reads
//     (`TICKETS_DIR`, else `~/eternal-circle/tickets`) when it exists. Git runs with `GIT_OPTIONAL_LOCKS=0`, so that it does
//     not refresh the checkout's index;
//  2. runs `docs.sh` on the checkout in its check mode, the only mode that writes nothing but its `mktemp` files, with
//     `TMPDIR` set to a new temporary directory, and `vmd --json check --all` on the store, with the local index in a
//     temporary cache directory;
//  3. copies those files, and all of `docs/`, to a temporary directory, as a git repository of its own whose index holds
//     exactly the files listed, so that `docs.sh` reads there what it reads in the checkout. It checks that the copy is
//     faithful: `docs.sh` and `vmd` report there what they report on the checkout;
//  4. plants each fault of FAULTS in the copy on its own, runs both tools, and compares what each reports beyond what it
//     reported on the unmodified copy with what the fault declares; then puts the copy's files back as they were;
//  5. matches the two tools' link problems, for each fault: every link problem `docs.sh` reports in a file inside `docs/`
//     must be a vmd issue in the same file, whose target resolves to the same path, for a link that starts on the line
//     `docs.sh` gives; or fall in a class that says why vmd does not report it (the target leaves the store; a code
//     reference inside a fenced block, which vmd reads as code). Every broken reference vmd reports must likewise be a
//     `docs.sh` problem, or fall in a class that says why `docs.sh` does not report it. A problem in no class is a failure,
//     unless the fault declares it;
//  6. times `vmd check --all` over the unmodified store, N runs each (10 by default), each in a fresh process: cold, with an
//     empty cache each time, and warm, with a cache filled once before; and fails when the warm median is not under the
//     phase's budget of two seconds;
//  7. checks that every digest of step 1 is what it was, and that `find -newer` over the whole checkout (`.git/`, ignored
//     and untracked files included) and over the ticket directory finds nothing modified since the marker; and removes its
//     temporary directories.
//
// It prints each fault with what each tool reported, the match counts by class, the timings and a summary. It exits with 1
// when a check fails, and with 2 when it cannot start; otherwise with 0.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fingerprint, formatStats, js, runVmd, stats, temporaryInsideCheckout, vmdMain } from "./shared.mjs";

/** The phase's budget for a warm check over vampiredb's docs, in milliseconds (implementation plan, phase I2's exit). */
const WARM_BUDGET_MS = 2000;
/** The codes of the vmd issues that say a reference does not reach a single target. */
const BROKEN_CODES = new Set(["ref-dangling", "ref-ambiguous"]);
/** `docs.sh`'s anchor element: only this exact form counts for it as an anchor. */
const ANCHOR_ELEMENT = /<a id="([^"\n]+)"><\/a>/g;

/**
 * The planted faults, each applied on its own to the copy. `edits` are literal: each `find` must occur exactly once in its
 * file, and `append` adds a paragraph at the end; `create` adds a file. `docsSh` and `vmd` give the problems each tool must
 * report beyond those of the unmodified copy, as counts by kind (`docs.sh`, see `docsShKind`) or by code (vmd); a kind or
 * code not named must not appear. `classes` gives, in the same way, the classes in which step 5 places the link problems of
 * both tools, and `unexplained` the problems it can place in no class, by tool (none by default): a fault that plants a
 * disagreement no class explains declares it there. `row` names the row of the comparison table it shows. A fault with `expect: "every
 * reference"` declares no counts: `docs.sh` must report every reference it checks on the unmodified copy (the number its
 * summary line gives) as one whose anchor is missing, and nothing else, and the matching of step 5 must explain each one.
 */
const FAULTS = [
  {
    id: "1",
    name: "an anchor id renamed",
    row: "a link with #ID to a document with anchors, ID missing",
    edits: [
      {
        file: "docs/design/Lock_Ranks.md",
        find: '<a id="component-tables"></a>',
        replace: '<a id="component-tables-renamed"></a>',
      },
    ],
    // 7 links in the file and 2 in Decision_Log.md inside docs/, and 2 code-comment references in .rs files.
    docsSh: { "no-anchor": 11 },
    vmd: { "ref-dangling": 9 },
    classes: { matched: 9, "source outside docs/": 2 },
  },
  {
    id: "2",
    name: "an anchored heading deleted",
    row: "a link with #ID to a document with anchors, ID missing",
    edits: [
      {
        file: "docs/design/Lock_Ranks.md",
        find: '### 1.1 What the check cannot see <a id="what-check-cannot-see"></a>\n',
        replace: "",
      },
    ],
    // 4 links in the file and 1 in Decision_Log.md.
    docsSh: { "no-anchor": 5 },
    vmd: { "ref-dangling": 5 },
    classes: { matched: 5 },
  },
  {
    id: "3a",
    name: "a link to a missing file, with #",
    row: "a link to a missing file",
    edits: [{ file: "docs/ARCHITECTURE.md", append: "Planted: [a missing design](design/Missing_Design.md#overview)." }],
    docsSh: { "not-a-file": 1 },
    vmd: { "ref-dangling": 1 },
    classes: { matched: 1 },
  },
  {
    id: "3b",
    name: "a link to a missing file, without #",
    row: "a link to a missing file",
    edits: [{ file: "docs/ARCHITECTURE.md", append: "Planted: [a missing design](design/Missing_Design.md)." }],
    docsSh: {},
    vmd: { "ref-dangling": 1 },
    classes: { "vmd: no fragment": 1 },
  },
  {
    id: "4",
    name: "a duplicate anchor",
    row: "a duplicate anchor id",
    edits: [{ file: "docs/design/Lock_Ranks.md", append: '<a id="api"></a>A planted paragraph that reuses the id "api".' }],
    // vmd: the duplicate, and each of the 6 links to #api (1 in the file, 5 in Decision_Log.md) has two targets.
    docsSh: { duplicate: 1 },
    vmd: { "duplicate-anchor": 1, "ref-ambiguous": 6 },
    classes: { "vmd: duplicate id": 6 },
  },
  {
    id: "5",
    name: "a numbered heading without its anchor",
    row: "a numbered heading without an anchor, in a document with anchors",
    edits: [{ file: "docs/design/Lock_Ranks.md", append: "## 12. A planted heading\n\nIts text." }],
    docsSh: { "heading-no-anchor": 1 },
    vmd: { "schema-violation": 1 },
    classes: {},
  },
  {
    id: "6",
    name: "a reference link to a missing anchor",
    row: "reference links and definitions",
    edits: [
      {
        file: "docs/ARCHITECTURE.md",
        append: "Planted: [the rank tables][planted].\n\n[planted]: design/Lock_Ranks.md#no-such-anchor",
      },
    ],
    docsSh: {},
    vmd: { "ref-dangling": 1 },
    classes: { "vmd: link definition": 1 },
  },
  {
    id: "7",
    name: "a wrong shown number",
    row: "the shown number or label of a link",
    edits: [
      { file: "docs/design/Lock_Ranks.md", find: "\ncannot ([§5.4](#no-cycle)).\n", replace: "\ncannot ([§5.3](#no-cycle)).\n" },
    ],
    docsSh: { "shown-number": 1 },
    vmd: {},
    classes: {},
  },
  {
    id: "8",
    name: "a link with # to a missing id in a document without anchors",
    row: "a link to a document without anchors",
    edits: [
      {
        file: "docs/ARCHITECTURE.md",
        append: "Planted: [a missing section](guidelines/Working_Practices.md#no-such-section).",
      },
    ],
    docsSh: {},
    vmd: { "ref-dangling": 1 },
    classes: { "vmd: into a document without anchors": 1 },
  },
  {
    id: "9a",
    name: "a link with # from docs/ to a missing file outside it",
    row: "links from docs/ to outside it",
    edits: [{ file: "docs/ARCHITECTURE.md", append: "Planted: [outside](../NO_SUCH_FILE.md#overview)." }],
    docsSh: { "not-a-file": 1 },
    vmd: {},
    classes: { "leaves the store": 1 },
  },
  {
    id: "9b",
    name: "a link with # from docs/ to a missing id in a file outside it without anchors",
    row: "links from docs/ to outside it",
    edits: [{ file: "docs/ARCHITECTURE.md", append: "Planted: [outside](../README.md#no-such-section)." }],
    docsSh: {},
    vmd: {},
    classes: {},
  },
  {
    id: "10",
    name: "a header Type misspelled",
    row: "header fields: Type, Status, Implemented, Component and Scope, at most ten Components",
    edits: [
      {
        file: "docs/guidelines/Working_Practices.md",
        find: "\n| **Type** | Guideline |\n",
        replace: "\n| **Type** | Guidline |\n",
      },
    ],
    docsSh: { type: 1 },
    vmd: { "schema-violation": 1 },
    classes: {},
  },
  {
    id: "11",
    name: "an unknown Component slug",
    row: "header fields: Component slugs from docs/components.md",
    edits: [
      {
        file: "docs/design/Lock_Ranks.md",
        find: "\n| **Component** | concurrency, log-v3, sim |\n",
        replace: "\n| **Component** | concurrency, log-v3, sim, planted-slug |\n",
      },
    ],
    docsSh: { "component-unknown": 1 },
    vmd: {},
    classes: {},
  },
  {
    id: "12",
    name: "a ticket cited the old way",
    row: "ticket citations",
    edits: [{ file: "docs/ARCHITECTURE.md", append: "Planted: see ticket 0158." }],
    docsSh: { ticket: 1 },
    vmd: {},
    classes: {},
  },
  {
    id: "13a",
    name: "a file name with a space",
    row: "file names",
    edits: [{ file: "docs/design/Planted Name.md", create: plantedDocument("Planted Name") }],
    docsSh: { "file-name": 1 },
    vmd: { "path-invalid": 1 },
    classes: {},
  },
  {
    id: "13b",
    name: "a file name that starts with an underscore",
    row: "file names",
    edits: [{ file: "docs/design/_Planted.md", create: plantedDocument("Planted") }],
    docsSh: {},
    vmd: { "path-invalid": 1 },
    classes: {},
  },
  {
    id: "14",
    name: "every anchor element renamed, in every Markdown file",
    row: "every link docs.sh checks, at once",
    renameEveryAnchor: true,
    expect: "every reference",
  },
  {
    id: "15",
    name: "a link inside an HTML block, and a link with brackets in its text, to one missing id three lines apart",
    row: "links that only one tool reads as links",
    edits: [
      {
        file: "docs/design/Lock_Ranks.md",
        append: "<details>\n[hidden](#planted-missing)\n</details>\n\n[a [nested] link](#planted-missing)",
      },
    ],
    // docs.sh reads the first, which vmd reads as HTML; vmd reads the second, which docs.sh's pattern cannot read. They are
    // two disagreements, and must not be paired.
    docsSh: { "no-anchor": 1 },
    vmd: { "ref-dangling": 1 },
    classes: {},
    unexplained: { "docs.sh": 1, vmd: 1 },
  },
  {
    id: "16",
    name: "a link inside a fence of tildes",
    row: "links that only one tool reads as links",
    edits: [{ file: "docs/design/Lock_Ranks.md", append: "~~~\n[in a tilde fence](#planted-in-tilde)\n~~~" }],
    // docs.sh knows only fences of backticks; vmd reads the block as code.
    docsSh: { "no-anchor": 1 },
    vmd: {},
    classes: {},
    unexplained: { "docs.sh": 1 },
  },
  {
    id: "17",
    name: "on one line, a link with # out of docs/ and a link without # inside it, to files of the same name",
    row: "a link from docs/ with # to a file outside docs/; a link to a missing file",
    edits: [{ file: "docs/ARCHITECTURE.md", append: "Planted: [out](../Gone.md#overview) and [in](design/Gone.md)." }],
    // Two different disagreements on one line, which a match by file name alone would pair.
    docsSh: { "not-a-file": 1 },
    vmd: { "ref-dangling": 1 },
    classes: { "leaves the store": 1, "vmd: no fragment": 1 },
  },
];

/** A small document with a header both tools accept, for the faults that add a file. */
function plantedDocument(title) {
  return `# ${title}\n\n| | |\n| --- | --- |\n| **Type** | Guideline |\n| **Status** | Draft |\n| **Scope** | a document the demonstration plants |\n\nA planted document.\n`;
}

// ---- Arguments and the environment.

const argv = process.argv.slice(2);
const runsAt = argv.indexOf("--runs");
const runs = runsAt === -1 ? 10 : Number(argv[runsAt + 1]);
const positional = argv.filter((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--runs");
if (positional.length !== 1 || !Number.isSafeInteger(runs) || runs < 1) {
  console.error("usage: node examples/vampiredb/check-demo.mjs CHECKOUT [--runs N]");
  process.exit(2);
}
const checkout = path.resolve(positional[0]);
const store = path.join(checkout, "docs");
const docsSh = path.join(checkout, "scripts/docs.sh");
const startProblems = [];
if (!fs.statSync(store, { throwIfNoEntry: false })?.isDirectory())
  startProblems.push(`${store} is not a directory: CHECKOUT is a vampiredb checkout, whose docs/ is the store`);
else if (!fs.existsSync(docsSh)) startProblems.push(`${docsSh} is missing: CHECKOUT is a vampiredb checkout`);
else {
  const refusal = temporaryInsideCheckout(checkout);
  if (refusal !== null) startProblems.push(refusal);
}
if (!fs.existsSync(vmdMain)) startProblems.push(`${vmdMain} is missing: run npm ci && npm run build in ${js}`);
for (const tool of ["bash", "python3", "git"])
  if (spawnSync(tool, ["--version"], { stdio: "ignore" }).status !== 0) startProblems.push(`${tool} is not on the path`);
if (startProblems.length > 0) {
  for (const problem of startProblems) console.error(problem);
  process.exit(2);
}
const ticketsDir = process.env.TICKETS_DIR || path.join(os.homedir(), "eternal-circle/tickets");

const failures = [];
const fail = (what) => failures.push(what);

// ---- Step 1: what must not change.

/** Runs git in `cwd` without optional locks, and gives its stdout as a Buffer. */
const git = (cwd, args, input) =>
  execFileSync("git", ["-C", cwd, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });

/** The files `docs.sh` reads in a checkout: what git lists as tracked, or untracked and not ignored, that is a file. */
function listedFiles(root) {
  const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).toString("utf8");
  return [...new Set(listed.split("\0").filter((file) => file !== ""))]
    .filter((file) => fs.lstatSync(path.join(root, file), { throwIfNoEntry: false })?.isFile())
    .sort();
}

/** A digest of the checkout as `docs.sh` sees it: each listed file's path and bytes, HEAD, and `git status`. */
function checkoutDigest() {
  const hash = createHash("sha256");
  const files = listedFiles(checkout);
  for (const file of files)
    hash
      .update(`${file}\0`)
      .update(fs.readFileSync(path.join(checkout, file)))
      .update("\0");
  const head = git(checkout, ["rev-parse", "HEAD"]).toString("utf8").trim();
  const status = git(checkout, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  hash.update(head).update("\0").update(status);
  const indexPath = path.resolve(checkout, git(checkout, ["rev-parse", "--git-path", "index"]).toString("utf8").trim());
  const index = fs.statSync(indexPath, { bigint: true });
  return {
    files: files.length,
    head,
    digest: hash.digest("hex").slice(0, 16),
    index: { ino: index.ino.toString(), size: index.size.toString(), mtimeNs: index.mtimeNs.toString() },
  };
}

/**
 * Gives the entries under `root`, of any kind and at any depth, whose modification time is later than `marker`'s, through
 * `find -newer`: a file written, or an entry created or removed in a directory, since the marker was made.
 */
function newerThan(root, marker) {
  const found = spawnSync("find", [root, "-newer", marker], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (found.status !== 0) fail(`find over ${root} exited with ${found.status}: ${found.stderr.trim()}`);
  return found.stdout.split("\n").filter((line) => line !== "");
}

/** Every digest of step 1. */
function digests() {
  return {
    store: fingerprint(store),
    checkout: checkoutDigest(),
    tickets: fs.existsSync(ticketsDir) ? fingerprint(ticketsDir) : null,
  };
}

const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), "vmd-vampiredb-check-demo-marker-"));
const marker = path.join(markerDir, "started");
fs.writeFileSync(marker, "");
const before = digests();
console.log(
  `checkout ${checkout} at ${before.checkout.head}: ${before.checkout.files} files docs.sh reads, sha256 ${before.checkout.digest}`,
);
console.log(`store ${store}: ${before.store.entries} entries, sha256 ${before.store.digest}`);
console.log(
  before.tickets === null
    ? `ticket directory ${ticketsDir}: not found, so docs.sh does not check ticket ids`
    : `ticket directory ${ticketsDir}: ${before.tickets.entries} entries, sha256 ${before.tickets.digest}`,
);
console.log(
  `node ${process.versions.node}, load average ${os
    .loadavg()
    .map((n) => n.toFixed(1))
    .join(" ")}`,
);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "vmd-vampiredb-check-demo-"));
try {
  demonstrate();
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

// ---- Step 7: nothing changed.

const after = digests();
for (const what of ["store", "checkout", "tickets"]) {
  if (JSON.stringify(after[what]) !== JSON.stringify(before[what]))
    fail(`the ${what} changed: ${JSON.stringify(before[what])} -> ${JSON.stringify(after[what])}`);
}
if (fs.existsSync(path.join(store, ".vmd"))) fail("a .vmd/ exists in the store");
const modified = [...newerThan(checkout, marker), ...(fs.existsSync(ticketsDir) ? newerThan(ticketsDir, marker) : [])];
if (modified.length > 0)
  fail(
    `${modified.length} entries of the checkout or the ticket directory were modified during the run: ${modified.slice(0, 10).join(", ")}`,
  );
fs.rmSync(markerDir, { recursive: true, force: true });
const same = (what) => (JSON.stringify(after[what]) === JSON.stringify(before[what]) ? "unchanged" : "CHANGED");
console.log(
  `\nafter: store ${same("store")} (sha256 ${after.store.digest}), checkout ${same("checkout")} (sha256 ${after.checkout.digest}, with the stat of its git index), ticket directory ${same("tickets")}`,
);
console.log(
  `entries modified during the run, by find -newer over the whole checkout and the ticket directory: ${modified.length}`,
);

for (const failure of failures) console.log(`FAILED: ${failure}`);
console.log(failures.length === 0 ? "check-demo.mjs: every check passed" : `check-demo.mjs: ${failures.length} failures`);
process.exit(failures.length === 0 ? 0 : 1);

// ---- The steps between.

function demonstrate() {
  const temporary = path.join(work, "tmp");
  fs.mkdirSync(temporary);

  // Step 2: both tools on the checkout.
  const onCheckout = runDocsSh(checkout, temporary);
  console.log(`\ndocs.sh on the checkout: exit ${onCheckout.status}, ${onCheckout.ms.toFixed(0)} ms: ${onCheckout.summary}`);
  for (const notice of onCheckout.notices) console.log(`  ${notice}`);
  for (const problem of onCheckout.problems) console.log(`  ${problem}`);
  if (onCheckout.status !== 0 && onCheckout.status !== 1) return;
  const storeCache = path.join(work, "cache-store");
  const vmdOnStore = vmdCheck(store, storeCache);
  if (vmdOnStore === null) return;
  console.log(
    `vmd check on the store: exit ${vmdOnStore.status}, ${vmdOnStore.ms.toFixed(0)} ms: ${vmdOnStore.value.records} records, ${vmdOnStore.value.references} references, ${vmdOnStore.issues.length} issues`,
  );
  for (const issue of vmdOnStore.issues) console.log(`  ${issueLine(issue)}`);

  // Step 3: the copy.
  const copy = path.join(work, "copy");
  makeCopy(copy);
  const copyStore = path.join(copy, "docs");
  const copyCache = path.join(work, "cache-copy");
  const baseDocsSh = runDocsSh(copy, temporary);
  const baseVmd = vmdCheck(copyStore, copyCache);
  if (baseVmd === null) return;
  const faithful =
    baseDocsSh.status === onCheckout.status &&
    baseDocsSh.summary === onCheckout.summary &&
    JSON.stringify(baseDocsSh.problems) === JSON.stringify(onCheckout.problems) &&
    JSON.stringify(baseVmd.issues) === JSON.stringify(vmdOnStore.issues);
  console.log(
    `the copy: docs.sh "${baseDocsSh.summary}", vmd ${baseVmd.issues.length} issues: ${faithful ? "faithful" : "NOT FAITHFUL"}`,
  );
  if (!faithful) {
    fail("the copy is not faithful: docs.sh or vmd reports there something else than on the checkout");
    return;
  }
  const copyBefore = fingerprint(copy);

  // Steps 4 and 5: the faults.
  const results = [];
  for (const fault of FAULTS) results.push(plant(fault, copy, copyStore, copyCache, temporary, baseDocsSh, baseVmd));
  const copyAfter = fingerprint(copy);
  if (copyAfter.digest !== copyBefore.digest) fail("the copy is not what it was after every fault was taken out");

  console.log("\nthe faults (beyond what each tool reports on the unmodified copy):");
  for (const r of results) {
    console.log(`\n${r.fault.id}. ${r.fault.name} [${r.fault.row}]: ${r.ok ? "as declared" : "NOT AS DECLARED"}`);
    console.log(`   docs.sh: ${formatCounts(r.docsShCounts)}`);
    console.log(`   vmd:     ${formatCounts(r.vmdCounts)}`);
    console.log(`   match:   ${formatCounts(r.classes)}`);
    if (!r.ok || r.fault.renameEveryAnchor !== true) {
      for (const line of r.newDocsSh) console.log(`     docs.sh ${line}`);
      for (const issue of r.newVmd) console.log(`     vmd     ${issueLine(issue)}`);
    }
    for (const line of r.unexplained) console.log(`     UNEXPLAINED ${line}`);
    for (const line of r.gone) console.log(`     GONE ${line}`);
  }

  // Step 6: timings over the unmodified store.
  console.log(`\ntimings of vmd check --all over the store, ${runs} runs each, a fresh process each run:`);
  const cold = [];
  for (let i = 0; i < runs; i++) {
    const cache = fs.mkdtempSync(path.join(work, "cache-cold-"));
    const run = vmdCheck(store, cache);
    fs.rmSync(cache, { recursive: true, force: true });
    if (run === null) return;
    if (run.value.fromIndex !== 0) fail(`a cold run read ${run.value.fromIndex} records from an empty cache`);
    if (JSON.stringify(run.issues) !== JSON.stringify(vmdOnStore.issues)) fail("a cold run reports other issues");
    cold.push(run.ms);
  }
  const warmCache = path.join(work, "cache-warm");
  if (vmdCheck(store, warmCache) === null) return;
  const warm = [];
  for (let i = 0; i < runs; i++) {
    const run = vmdCheck(store, warmCache);
    if (run === null) return;
    if (run.value.fromIndex !== run.value.records)
      fail(`a warm run read ${run.value.fromIndex} of ${run.value.records} records from the index`);
    if (JSON.stringify(run.issues) !== JSON.stringify(vmdOnStore.issues)) fail("a warm run reports other issues");
    warm.push(run.ms);
  }
  const warmStats = stats(warm);
  console.log(`  cold (no index)        ${formatStats(stats(cold))}`);
  console.log(`  warm (from the index)  ${formatStats(warmStats)}`);
  const margin = WARM_BUDGET_MS - warmStats.median;
  console.log(
    `  budget                 warm median under ${WARM_BUDGET_MS} ms: ${margin > 0 ? `met, ${margin.toFixed(0)} ms under it (${(WARM_BUDGET_MS / warmStats.median).toFixed(1)} times faster)` : `MISSED by ${(-margin).toFixed(0)} ms`}`,
  );
  if (margin <= 0) fail(`the warm median, ${warmStats.median.toFixed(0)} ms, is not under ${WARM_BUDGET_MS} ms`);
  console.log(
    `  load average after     ${os
      .loadavg()
      .map((n) => n.toFixed(1))
      .join(" ")}`,
  );

  // The summary.
  const declared = results.filter((r) => r.ok).length;
  const total = (key) => results.reduce((n, r) => n + (r.classes[key] ?? 0), 0);
  const LINK_CLASSES = ["matched", "matched, text across lines", "derived", "leaves the store", "fenced code reference"];
  const unexplainedDocsSh = results.reduce((n, r) => n + r.unexplained.filter((u) => u.startsWith("docs.sh")).length, 0);
  const unexplainedVmd = results.reduce((n, r) => n + r.unexplained.filter((u) => u.startsWith("vmd")).length, 0);
  console.log(`\nsummary
  docs.sh on the checkout   exit ${onCheckout.status}: ${onCheckout.summary}
  vmd on the store          exit ${vmdOnStore.status}: ${vmdOnStore.issues.length} issues (${formatCounts(countBy(vmdOnStore.issues, (i) => `${i.severity} ${i.code}`))})
  faults                    ${results.length}, ${declared} as declared
  docs.sh link problems inside docs/, over all faults: ${LINK_CLASSES.reduce((n, k) => n + total(k), 0) + unexplainedDocsSh}
    vmd reports the same link, on its line              ${total("matched")}
    vmd reports it, at its destination on a later line  ${total("matched, text across lines")} (the link's text spans lines)
    vmd resolves it through a derived anchor            ${total("derived")} (with the warning ref-derived-anchor)
    the target leaves the store                         ${total("leaves the store")}
    a code reference in a fenced block                  ${total("fenced code reference")}
    in no class                                         ${unexplainedDocsSh}
  docs.sh problems in files outside docs/: ${total("source outside docs/")}
  vmd broken references docs.sh does not report: no # ${total("vmd: no fragment")}, a link definition ${total("vmd: link definition")}, into a document without anchors ${total("vmd: into a document without anchors")}, after a duplicate id ${total("vmd: duplicate id")}, in no class ${unexplainedVmd}
  in no class, by fault     ${formatCounts(
    countBy(
      results.flatMap((r) => r.unexplained.map(() => r.fault.id)),
      (id) => `in fault ${id}`,
    ),
  )}; each fault declares its own, and any other fails the run`);
}

/** Runs `docs.sh` in its check mode in `root`, and gives its exit status, summary line, problem lines, notices and time. */
function runDocsSh(root, temporary) {
  const started = performance.now();
  const run = spawnSync("bash", [path.join(root, "scripts/docs.sh")], {
    cwd: temporary,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: temporary },
    maxBuffer: 256 * 1024 * 1024,
  });
  const ms = performance.now() - started;
  const lines = run.stderr.split("\n");
  const problems = lines.filter((line) => line.startsWith("  ")).sort();
  const notices = lines.filter((line) => line.startsWith("docs.sh: notice"));
  const summary = run.stdout.trim().split("\n").at(-1) || (run.status === 1 ? `${problems.length} problems` : run.stderr.trim());
  if (run.status !== 0 && run.status !== 1) fail(`docs.sh in ${root} exited with ${run.status}: ${run.stderr.trim()}`);
  return { status: run.status, summary, problems, notices, ms };
}

/** Runs `vmd --json check --all` on `root` with the cache in `cache`, and gives its output, or null when vmd failed. */
function vmdCheck(root, cache) {
  const run = runVmd(root, ["--json", "check", "--all"], { cache });
  let output;
  try {
    output = JSON.parse(run.stdout);
  } catch {
    output = { ok: false };
  }
  if ((run.status !== 0 && run.status !== 4) || !output.ok) {
    fail(`vmd check on ${root} exited with ${run.status}: ${run.stderr || run.stdout.slice(0, 2000)}`);
    return null;
  }
  return { status: run.status, ms: run.ms, value: output.value, issues: output.issues };
}

/**
 * Copies every file `docs.sh` reads in the checkout, and all of `docs/`, to `copy`, and makes `copy` a git repository whose
 * index holds exactly the files listed, so that `git ls-files` in `docs.sh` lists there what it lists in the checkout.
 */
function makeCopy(copy) {
  const files = listedFiles(checkout);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    fs.copyFileSync(path.join(checkout, file), path.join(copy, file));
  }
  fs.cpSync(store, path.join(copy, "docs"), { recursive: true });
  execFileSync("git", ["init", "--quiet", copy], { stdio: "ignore" });
  git(copy, ["add", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"], `${files.join("\0")}\0`);
}

/** Plants one fault in the copy, runs both tools, takes the fault out again, and gives what was observed. */
function plant(fault, copy, copyStore, copyCache, temporary, baseDocsSh, baseVmd) {
  const originals = new Map();
  const result = {
    fault,
    ok: false,
    docsShCounts: {},
    vmdCounts: {},
    classes: {},
    newDocsSh: [],
    newVmd: [],
    unexplained: [],
    gone: [],
  };
  try {
    if (fault.renameEveryAnchor) {
      for (const file of fs.readdirSync(copy, { recursive: true })) {
        if (!file.endsWith(".md") || file.startsWith(".git")) continue;
        const absolute = path.join(copy, file);
        const text = fs.readFileSync(absolute, "utf8");
        const renamed = text.replace(ANCHOR_ELEMENT, (_, id) => `<a id="${id}-renamed"></a>`);
        if (renamed === text) continue;
        originals.set(absolute, text);
        fs.writeFileSync(absolute, renamed);
      }
    }
    for (const edit of fault.edits ?? []) {
      const absolute = path.join(copy, edit.file);
      if (edit.create !== undefined) {
        if (fs.existsSync(absolute)) throw new Error(`${edit.file} exists already`);
        originals.set(absolute, null);
        fs.writeFileSync(absolute, edit.create);
        continue;
      }
      if (!originals.has(absolute)) originals.set(absolute, fs.readFileSync(absolute, "utf8"));
      const current = fs.readFileSync(absolute, "utf8");
      let next;
      if (edit.append !== undefined) next = `${current}${current.endsWith("\n") ? "" : "\n"}\n${edit.append}\n`;
      else {
        const occurrences = current.split(edit.find).length - 1;
        if (occurrences !== 1) throw new Error(`${edit.file} holds the text to replace ${occurrences} times, not once`);
        next = current.replace(edit.find, edit.replace);
      }
      fs.writeFileSync(absolute, next);
    }
    const docsShRun = runDocsSh(copy, temporary);
    const vmdRun = vmdCheck(copyStore, copyCache);
    if (vmdRun === null) return result;
    const docsShDiff = difference(docsShRun.problems, baseDocsSh.problems);
    const vmdKey = (issue) => issueLine(issue);
    const vmdDiff = difference(vmdRun.issues, baseVmd.issues, vmdKey);
    result.newDocsSh = docsShDiff.added;
    result.newVmd = vmdDiff.added;
    result.gone = [...docsShDiff.removed.map((line) => `docs.sh ${line}`), ...vmdDiff.removed.map((i) => `vmd ${vmdKey(i)}`)];
    result.docsShCounts = countBy(docsShDiff.added, docsShKind);
    result.vmdCounts = countBy(vmdDiff.added, (issue) => issue.code);
    match(result, copy);
    const declared =
      fault.expect === "every reference"
        ? sameCounts(result.docsShCounts, { "no-anchor": referencesChecked(baseDocsSh.summary) })
        : sameCounts(result.docsShCounts, fault.docsSh) && sameCounts(result.vmdCounts, fault.vmd);
    const classesAsDeclared = fault.expect === "every reference" || sameCounts(result.classes, fault.classes ?? {});
    const unexplainedCounts = countBy(result.unexplained, (line) => (line.startsWith("docs.sh") ? "docs.sh" : "vmd"));
    const unexplainedAsDeclared = sameCounts(unexplainedCounts, fault.unexplained ?? {});
    result.ok = declared && classesAsDeclared && unexplainedAsDeclared && result.gone.length === 0;
    if (!result.ok) fail(`fault ${fault.id} (${fault.name}) is not as declared`);
    return result;
  } catch (error) {
    fail(`fault ${fault.id} (${fault.name}) could not be planted: ${error.message}`);
    return result;
  } finally {
    for (const [absolute, text] of originals) {
      if (text === null) fs.rmSync(absolute, { force: true });
      else fs.writeFileSync(absolute, text);
    }
  }
}

/**
 * Matches the link problems of one fault between the tools, and counts each by class in `result.classes`; a problem in no
 * class goes to `result.unexplained`.
 */
function match(result, copy) {
  const classes = result.classes;
  const count = (key) => {
    classes[key] = (classes[key] ?? 0) + 1;
  };
  // vmd's broken references, and its derived-anchor warnings, by file and line, each to be taken once.
  const vmdLinks = result.newVmd
    .filter((issue) => BROKEN_CODES.has(issue.code) || issue.code === "ref-derived-anchor")
    .map((issue) => {
      const target = vmdTarget(issue);
      const resolved = path.posix.normalize(
        target.path === "" ? `docs/${issue.path}` : path.posix.join("docs", path.posix.dirname(issue.path), target.path),
      );
      return { issue, target, resolved, taken: false };
    });
  const anchorsOf = (file) => {
    const absolute = path.join(copy, file);
    if (!fs.existsSync(absolute)) return null;
    return fs.readFileSync(absolute, "utf8").match(ANCHOR_ELEMENT) !== null;
  };
  // docs.sh gives the line of a link's `[`, and vmd the position of its destination, which is on a later line when the
  // link's text spans lines. So a vmd issue matches a docs.sh problem when they are in the same file, their targets resolve to
  // the same path (and the same fragment, where docs.sh gives one), and the link whose destination vmd reports starts on the
  // line docs.sh gives, as found in the file's bytes.
  const problems = [];
  for (const line of result.newDocsSh) {
    const problem = docsShLink(line);
    if (problem === null) continue;
    if (!problem.file.startsWith("docs/")) count("source outside docs/");
    else problems.push({ line, problem, storePath: problem.file.slice("docs/".length), done: false });
  }
  const bytesOf = new Map();
  const startLine = (v) => {
    if (v.issue.position === undefined) return null;
    const file = path.join(copy, "docs", v.issue.path);
    if (!bytesOf.has(file)) bytesOf.set(file, fs.readFileSync(file));
    return linkStartLine(bytesOf.get(file), v.issue.position.offset);
  };
  for (const p of problems) {
    const found = vmdLinks.find(
      (v) =>
        !v.taken &&
        v.issue.path === p.storePath &&
        v.resolved === docsShResolved(p.problem) &&
        (p.problem.fragment === null || v.target.fragment === p.problem.fragment) &&
        startLine(v) === p.problem.line,
    );
    if (found === undefined) continue;
    found.taken = true;
    p.done = true;
    if (found.issue.code === "ref-derived-anchor") count("derived");
    else count(found.issue.position.line === p.problem.line ? "matched" : "matched, text across lines");
  }
  for (const { line, problem, done } of problems) {
    if (done) continue;
    if (!docsShResolved(problem).startsWith("docs/")) count("leaves the store");
    else if (problem.kind === "reference" && insideFence(path.join(copy, problem.file), problem.line))
      count("fenced code reference");
    else result.unexplained.push(`docs.sh ${line}`);
  }
  const duplicates = result.newDocsSh.map((line) => /^ {2}(\S+?):\d+: duplicate anchor id "([^"]+)"/.exec(line)).filter(Boolean);
  for (const v of vmdLinks) {
    if (v.taken || v.issue.code === "ref-derived-anchor") continue;
    const target = v.target;
    const definition = lineOf(path.join(copy, "docs", v.issue.path), v.issue.position?.line);
    const targetFile = v.resolved.slice("docs/".length);
    if (target.fragment === null) count("vmd: no fragment");
    else if (/^ {0,3}\[[^\]]+\]:\s/.test(definition ?? "")) count("vmd: link definition");
    else if (anchorsOf(path.posix.join("docs", targetFile)) === false) count("vmd: into a document without anchors");
    else if (
      v.issue.code === "ref-ambiguous" &&
      duplicates.some(([, file, id]) => file === `docs/${targetFile}` && id === target.fragment)
    )
      count("vmd: duplicate id");
    else result.unexplained.push(`vmd ${issueLine(v.issue)}`);
  }
}

/**
 * Gives the path from the repository's root that one of `docs.sh`'s link problems targets. `docs.sh` gives a missing file's
 * path as the link writes it, relative to the link's file, and every other target from the root, as it resolved it (a code
 * reference is written from the root).
 */
function docsShResolved(problem) {
  return problem.kind === "link" && problem.fragment === null
    ? path.posix.normalize(path.posix.join(path.posix.dirname(problem.file), problem.targetPath))
    : path.posix.normalize(problem.targetPath);
}

/**
 * Gives the line (from 1) on which the inline link starts whose destination starts at byte `destination` of `bytes`: the
 * line of the `[` that opens the text before its `](`, found by walking back over balanced, unescaped brackets. Gives null
 * when the bytes before the destination are not `](` or `](<`, as for a link definition, or when no `[` balances.
 */
function linkStartLine(bytes, destination) {
  const at = (i) => String.fromCharCode(bytes[i]);
  let close = destination - 2;
  if (at(destination - 1) === "<") close--;
  if (close < 0 || at(close) !== "]" || at(close + 1) !== "(") return null;
  const escaped = (i) => {
    let slashes = 0;
    while (i - 1 - slashes >= 0 && at(i - 1 - slashes) === "\\") slashes++;
    return slashes % 2 === 1;
  };
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = at(i);
    if ((c !== "[" && c !== "]") || escaped(i)) continue;
    depth += c === "]" ? 1 : -1;
    if (depth === 0) {
      let line = 1;
      for (let k = 0; k < i; k++) if (bytes[k] === 0x0a) line++;
      return line;
    }
  }
  return null;
}

/**
 * Reads one of `docs.sh`'s link problems: the file and line it is in, whether it comes from a link or a code reference, the
 * target's path as `docs.sh` gives it, and its fragment, which is null when `docs.sh` reports the file missing. Gives null
 * for a problem of another kind.
 */
function docsShLink(line) {
  let m = /^ {2}(\S.*?):(\d+): (link|reference) to "([^"#]*)#([^"]*)" finds no anchor there$/.exec(line);
  if (m !== null) return { file: m[1], line: Number(m[2]), kind: m[3], targetPath: m[4], fragment: m[5] };
  m = /^ {2}(\S.*?):(\d+): (link|reference) to "([^"]*)", which is not a file$/.exec(line);
  if (m !== null) return { file: m[1], line: Number(m[2]), kind: m[3], targetPath: m[4], fragment: null };
  m = /^ {2}(\S.*?):(\d+): reference to "([^"#]*)#([^"]*)", but that document has no anchors$/.exec(line);
  if (m !== null) return { file: m[1], line: Number(m[2]), kind: "reference", targetPath: m[3], fragment: m[4] };
  return null;
}

/** The number of references `docs.sh`'s summary line says it checked, or NaN. */
function referencesChecked(summary) {
  const m = / and (\d+) references to them checked$/.exec(summary);
  return m === null ? Number.NaN : Number(m[1]);
}

/** The kind of one of `docs.sh`'s problem lines, for the counts a fault declares. */
function docsShKind(line) {
  const kinds = [
    [/finds no anchor there$/, "no-anchor"],
    [/, which is not a file$/, "not-a-file"],
    [/but that document has no anchors$/, "reference-no-anchors"],
    [/: (link|reference) shows .* but anchor /, "shown-number"],
    [/: (link|reference) quotes .* but anchor /, "label"],
    [/: link text names /, "link-text-file"],
    [/the check cannot read/, "unreadable-reference"],
    [/has no anchor \(docs\/README\.md, Citing a document\)$/, "heading-no-anchor"],
    [/: duplicate anchor id /, "duplicate"],
    [/: a ticket is cited|: a list or range of tickets|is not a ticket in /, "ticket"],
    [/: (unrecognised type|no Type row)/, "type"],
    [/: (unrecognised status|no Status row|Implemented is for a Design)/, "status"],
    [/names its Component$|components, more than/, "component"],
    [/is not defined in docs\/components\.md$/, "component-unknown"],
    [/says where it applies, in a Scope row$/, "scope"],
    [/: a file name under docs\/ uses only/, "file-name"],
    [/scripts\/next-decision-row\.sh/, "decision-log"],
  ];
  for (const [pattern, kind] of kinds) if (pattern.test(line)) return kind;
  return "other";
}

/**
 * The target of a vmd reference issue, as its message quotes it as written: the whole, its path (empty for `#…`), the path's
 * last segment (the citing file's for `#…`), and its fragment, null without a `#`.
 */
function vmdTarget(issue) {
  const m = /^("(?:[^"\\]|\\.)*")/.exec(issue.message);
  const written = m === null ? "" : JSON.parse(m[1]);
  const hash = written.indexOf("#");
  const targetPath = hash === -1 ? written : written.slice(0, hash);
  return {
    written,
    path: targetPath,
    base: path.posix.basename(targetPath === "" ? issue.path : targetPath),
    fragment: hash === -1 ? null : written.slice(hash + 1),
  };
}

/** Whether line `line` (from 1) of a Markdown file is inside a fenced block of backticks, as `docs.sh` reads fences. */
function insideFence(file, line) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let inside = false;
  for (let i = 0; i < line - 1 && i < lines.length; i++) if (/^\s*```/.test(lines[i])) inside = !inside;
  return inside && !/^\s*```/.test(lines[line - 1] ?? "");
}

/** Line `line` (from 1) of a file, or null. */
function lineOf(file, line) {
  if (line === undefined || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").split("\n")[line - 1] ?? null;
}

/** The elements of `now` beyond those of `base`, and those of `base` no longer in `now`, as multisets by `key`. */
function difference(now, base, key = (x) => x) {
  const remaining = new Map();
  for (const x of base) remaining.set(key(x), (remaining.get(key(x)) ?? 0) + 1);
  const added = [];
  for (const x of now) {
    const k = key(x);
    if ((remaining.get(k) ?? 0) > 0) remaining.set(k, remaining.get(k) - 1);
    else added.push(x);
  }
  const removed = [];
  for (const x of base) {
    const k = key(x);
    if ((remaining.get(k) ?? 0) > 0) {
      remaining.set(k, remaining.get(k) - 1);
      removed.push(x);
    }
  }
  return { added, removed };
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function sameCounts(observed, declared) {
  const keys = new Set([...Object.keys(observed), ...Object.keys(declared)]);
  return [...keys].every((k) => (observed[k] ?? 0) === (declared[k] ?? 0));
}

function formatCounts(counts) {
  const entries = Object.entries(counts).sort();
  return entries.length === 0 ? "nothing" : entries.map(([k, n]) => `${n} ${k}`).join(", ");
}

/** One vmd issue on one line: its place, severity, code and message. */
function issueLine(issue) {
  const at = issue.position == null ? "" : `:${issue.position.line}:${issue.position.col}`;
  return `${issue.path ?? ""}${at} ${issue.severity} ${issue.code}: ${issue.message}`;
}
