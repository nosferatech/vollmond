// What `vmd check` would meet in vampiredb's docs: how long parsing and hashing every record takes, which Markdown references
// the documents hold, and what they resolve to with core's resolution of I1.
//
//   node vampiredb-links.mjs ~/vampiredb/docs PATH/TO/vollmond/js
//
// Reads the store's files and changes nothing. Core is imported from its build (`npm run build` in js/ first). The links are
// found with mdast-util-from-markdown and the four GFM 0.29 extensions, as core parses Markdown, plus a handler that keeps
// each destination's source range (the design's section 4.1). Nothing here is vmd's rule: the design says what I2 does.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

const [root, jsDir] = process.argv.slice(2);
const core = await import(pathToFileURL(join(jsDir, "packages/core/dist/index.js")).href);
console.log(`node ${process.versions.node}; store ${root}`);

function walkFiles(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(path, out);
    else if (entry.isFile()) out.push(relative(root, path).split(sep).join("/"));
  }
  return out;
}
const paths = walkFiles(root).sort();
const files = new Map(paths.map((p) => [p, new Uint8Array(readFileSync(join(root, p)))]));
const bytes = [...files.values()].reduce((n, b) => n + b.length, 0);
console.log(`${paths.length} files, ${bytes} bytes; ${paths.filter((p) => core.recordFormatOf(p) !== null).length} records`);

// --- A. Parsing every record, and hashing every file ---
function parseAll() {
  const parsed = new Map();
  const start = performance.now();
  for (const [p, b] of files) if (core.recordFormatOf(p) !== null) parsed.set(p, core.parseRecord(p, b));
  return { parsed, ms: performance.now() - start };
}
const first = parseAll();
const warm = [1, 2, 3].map(() => parseAll().ms);
console.log(`parse every record: first ${first.ms.toFixed(0)} ms in this process, then ${warm.map((m) => m.toFixed(0)).join(", ")} ms`);
const unreadable = [...first.parsed].filter(([, o]) => !o.ok).map(([p]) => p);
console.log(`records with a structural error: ${unreadable.length}`);
const parseIssues = {};
for (const [, o] of first.parsed) {
  for (const i of o.ok ? o.value.issues : o.issues) parseIssues[`${i.code} (${i.severity})`] = (parseIssues[`${i.code} (${i.severity})`] ?? 0) + 1;
}
console.log(`validation issues found while parsing, at their default severities: ${JSON.stringify(parseIssues)}`);
let start = performance.now();
for (const b of files.values()) await core.gitBlobId(b);
console.log(`git blob id of every file (crypto.subtle): ${(performance.now() - start).toFixed(1)} ms`);
start = performance.now();
for (const p of paths) statSync(join(root, p));
console.log(`stat of every file: ${(performance.now() - start).toFixed(1)} ms`);

// --- B. The references in the Markdown ---
// The default handlers set `url` from the destination's text; these do the same and also keep the token's source range.
function keepRange(token) {
  const data = this.resume();
  const node = this.stack[this.stack.length - 1];
  node.url = data;
  node.data = { ...(node.data ?? {}), destination: [token.start.offset, token.end.offset] };
}
const destinationRanges = { exit: { resourceDestinationString: keepRange, definitionDestinationString: keepRange } };
const { transforms = [], ...autolinkFromMarkdown } = gfmAutolinkLiteralFromMarkdown();
const options = {
  extensions: [gfmTable(), gfmStrikethrough(), gfmTaskListItem(), gfmAutolinkLiteral()],
  mdastExtensions: [gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown(), gfmTaskListItemFromMarkdown(), autolinkFromMarkdown, destinationRanges],
};
function tree(text) {
  let t = fromMarkdown(text, options);
  for (const transform of transforms) t = transform(t) ?? t;
  return t;
}
const counts = {};
const add = (k, n = 1) => {
  counts[k] = (counts[k] ?? 0) + n;
};
const refs = [];
let linkMs = 0;
for (const p of paths.filter((x) => x.endsWith(".md"))) {
  const text = new TextDecoder().decode(files.get(p));
  const t0 = performance.now();
  const root0 = tree(text);
  const pending = [root0];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.type === "link" || node.type === "definition" || node.type === "image") {
      const range = node.data?.destination;
      const raw = range === undefined ? null : text.slice(range[0], range[1]);
      refs.push({ from: p, type: node.type, url: node.url, raw, line: node.position.start.line, inHeading: node.inHeading === true });
    }
    if (node.type === "linkReference" || node.type === "imageReference") add(`${node.type} (uses a definition)`);
    if (node.children) for (const child of node.children) {
      if (node.type === "heading") child.inHeading = true;
      if (node.inHeading) child.inHeading = true;
      pending.push(child);
    }
  }
  linkMs += performance.now() - t0;
}
console.log(`\nmdast parse and walk of every Markdown record: ${linkMs.toFixed(0)} ms`);
for (const r of refs) add(r.type);
add("in a heading", refs.filter((r) => r.inHeading).length);
add("raw differs from url (escapes, entities, <...>)", refs.filter((r) => r.raw !== null && r.raw !== r.url && `<${r.url}>` !== r.raw).length);
add("written in <...>", refs.filter((r) => r.raw?.startsWith("<")).length);
add("no destination range (autolink literal or autolink)", refs.filter((r) => r.raw === null).length);

// --- C. Where each reference goes ---
const records = first.parsed;
const lookup = async (p) => {
  const o = records.get(p);
  return o === undefined ? null : o;
};
const directories = new Set(paths.flatMap((p) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
const statusCounts = {};
const examples = {};
const note = (k, r) => {
  statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  if ((examples[k] ??= []).length < 4) examples[k].push(`${r.from}:${r.line} ${r.url}`);
};
const resolveStart = performance.now();
for (const r of refs) {
  const url = r.url;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
    note("absolute URI: leaves the store", r);
    continue;
  }
  const hash = url.indexOf("#");
  const pathPart = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? null : url.slice(hash + 1);
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart.split("?")[0]);
  } catch {
    note("path not percent-decodable", r);
    continue;
  }
  const base = posix.dirname(r.from);
  const joined = decoded === "" ? r.from : decoded.startsWith("/") ? decoded.slice(1) : posix.join(base, decoded);
  const target = posix.normalize(joined).replace(/\/$/, "");
  if (target === ".." || target.startsWith("../")) {
    note("climbs above the store root: leaves the store", r);
    continue;
  }
  if (decoded.startsWith("/")) note("store-root form (leading /)", r);
  if (!files.has(target)) {
    if (directories.has(target) || target === ".") note(fragment === null ? "directory: exists" : "directory with a fragment", r);
    else note("missing file: dangling", r);
    continue;
  }
  if (core.recordFormatOf(target) === null) {
    note(fragment === null ? "asset: exists" : "asset with a fragment", r);
    continue;
  }
  if (fragment === null || fragment === "") {
    note("record, no fragment: ok", r);
    continue;
  }
  const resolved = await core.resolveStoreAddress(lookup, `${target}#${fragment}`, "singular");
  if (!resolved.ok) {
    const code = resolved.issues[0].code;
    const isRecordError = resolved.issues.every((i) => i.class === "structural");
    note(isRecordError ? "unreadable" : code === "address-ambiguous" ? "ambiguous" : `dangling (${code})`, r);
    continue;
  }
  const rec = resolved.value.record;
  const first = decodeURIComponent(fragment.split("/")[0]);
  const named = rec.anchors.named(first);
  const kind = named.some((a) => a.kind === "explicit") ? "explicit" : named.some((a) => a.kind === "block") ? "block" : named.some((a) => a.kind === "derived") ? "derived" : "member or key";
  note(`ok, first step through ${kind === "member or key" ? "a root member or section key" : `a${kind === "explicit" ? "n" : ""} ${kind} anchor`}`, r);
}
console.log(`\nresolving every reference, the records already parsed: ${(performance.now() - resolveStart).toFixed(0)} ms`);
const again = performance.now();
for (const r of refs.filter((x) => !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(x.url) && x.url.includes("#"))) {
  const [p, f] = r.url.split("#");
  const target = posix.normalize(p === "" ? r.from : posix.join(posix.dirname(r.from), decodeURIComponent(p)));
  if (records.has(target)) await core.resolveStoreAddress(lookup, `${target}#${f}`, "singular");
}
console.log(`resolving them again, the resolvers' maps built: ${(performance.now() - again).toFixed(0)} ms`);
console.log("\nreferences by kind:");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
console.log("\nreferences by target:");
for (const [k, v] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
  for (const e of examples[k]) console.log(`      e.g. ${e}`);
}
