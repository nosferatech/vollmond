// Checks the decision records in docs/decisions, a vmd store, with vmd's reader: every record reads with no issue at all, its
// id is its file name, its supersedes and superseded_by name existing records and pair up both ways, its status agrees with
// superseded_by, every link between records points at one, and no timestamp is cited as both the owner's message and the
// session's. The collection's schema is left to scripts/validate-decisions.mjs, until `vmd check` validates collections.
//
// Run it in js/ after a build:
//
//   node scripts/check-decisions.mjs [STORE]
//
// STORE defaults to ../docs/decisions. Exits with 1 and lists every problem, or prints the number of records checked.
import { resolve } from "node:path";
import { createFilesystemStorage } from "../packages/cli/dist/backend/filesystem.js";
import { openStore } from "../packages/core/dist/index.js";

const root = resolve(process.argv[2] ?? new URL("../../docs/decisions", import.meta.url).pathname);
const problems = [];
/** Records one problem, under the file it is in. */
const problem = (path, message) => problems.push(`${path}: ${message}`);

const opened = await openStore(createFilesystemStorage(root));
if (!opened.ok) fatal(opened.issues);
const store = opened.value;

const paths = [];
for (let cursor; ; ) {
  const page = await store.list({ limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
  if (!page.ok) fatal(page.issues);
  for (const entry of page.value.items) {
    if (entry.kind === "record") paths.push(entry.path);
    else problem(entry.path, "is an asset; the store holds decision records only");
  }
  if (page.value.cursor === null) break;
  cursor = page.value.cursor;
}

/** The front matter of each record that reads, by path. */
const records = new Map();
for (const path of paths) {
  const read = await store.record(path);
  if (read === null) {
    problem(path, "is listed but cannot be found");
    continue;
  }
  const issues = read.ok ? read.value.issues : read.issues;
  for (const issue of issues) problem(path, `${issue.severity} ${issue.code} at "${issue.at ?? ""}": ${issue.message}`);
  if (read.ok) records.set(path, read.value.value);
}

const RECORD_PATH = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?\.md$/;
const STATUSES = ["accepted", "superseded", "reversed"];
/** Gives a member of a value view, or an empty list when the value has no such member. */
const list = (value, member) => (Object.hasOwn(value, member) ? value[member] : []);

for (const [path, value] of records) {
  if (value.id !== path.slice(0, -".md".length)) problem(path, `its id is ${JSON.stringify(value.id)}, not its file name`);
  if (!STATUSES.includes(value.status)) problem(path, `its status is ${JSON.stringify(value.status)}`);
  for (const [member, inverse] of [
    ["supersedes", "superseded_by"],
    ["superseded_by", "supersedes"],
  ]) {
    const targets = list(value, member);
    if (!Array.isArray(targets)) {
      problem(path, `${member} is not a list`);
      continue;
    }
    for (const target of targets) {
      if (typeof target !== "string" || !RECORD_PATH.test(target)) problem(path, `${member} holds ${JSON.stringify(target)}`);
      else if (target === path) problem(path, `${member} names the record itself`);
      else if (!records.has(target)) problem(path, `${member} names ${target}, which is not a readable record`);
      else if (!list(records.get(target), inverse).includes(path))
        problem(path, `${member} names ${target}, whose ${inverse} does not name ${path}`);
    }
  }
  const superseded = list(value, "superseded_by").length > 0;
  if (superseded !== (value.status !== "accepted")) {
    problem(path, `its status is ${value.status}, but superseded_by ${superseded ? "names later decisions" : "is empty"}`);
  }
  const sources = Object.hasOwn(value, "sources") ? value.sources : {};
  const owner = new Set(list(sources, "chat"));
  for (const at of list(sources, "session")) {
    if (owner.has(at)) problem(path, `${at} is in sources.chat, the owner's messages, and in sources.session, the session's`);
  }
  for (const target of links(value)) {
    if (!records.has(target)) problem(path, `links to ${target}, which is not a readable record`);
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"} in ${root}:`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`${records.size} decision records read, with no issue, and their supersessions pair up.`);

/**
 * The records that a record's sections link to: the targets of inline links and of link reference definitions that are a
 * record's file name in this directory, written as `F1.md` or `./F1.md`, with any fragment removed. Links that leave the
 * directory, such as ../draft/vollmond-proposal.md, are not followed.
 */
function links(value) {
  const targets = new Set();
  for (const section of list(value, "$sections")) {
    // A link written inside a code span is an example, not a link.
    const body = (Object.hasOwn(section, "$body") ? section.$body : "").replace(/(`+)[^`]*?\1/g, "");
    const inline = [...body.matchAll(/\]\(<?([^)\s#>]+)/g)];
    const definitions = [...body.matchAll(/^ {0,3}(?:> ?)*\[[^\]]+\]:\s*<?([^\s#>]+)/gm)];
    for (const match of [...inline, ...definitions]) {
      const target = match[1].replace(/^\.\//, "");
      if (!target.includes("/") && !target.includes(":") && target.endsWith(".md")) targets.add(target);
    }
  }
  return targets;
}

/** Prints the issues that keep the store from opening or listing, and exits with 1. */
function fatal(issues) {
  for (const issue of issues) console.error(`${root}: ${issue.severity} ${issue.code}: ${issue.message}`);
  process.exit(1);
}
