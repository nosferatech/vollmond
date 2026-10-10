// Markdown parse time and position units, for docs/design/i1-read.md (section 7).
//
//   node markdown-timing.mjs [FILE]
//
// With FILE, times that file (read only). Without it, builds a synthetic document of at least 667 KB by repeating the
// proposal, docs/draft/vollmond-proposal.md. Each timing is five runs in one process; the minimum and the median are printed.
// The figures are single runs on one machine and show orders of magnitude only.
import fs from "node:fs";
import MarkdownIt from "markdown-it";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfm } from "micromark-extension-gfm";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

let bytes;
if (process.argv[2]) {
  bytes = fs.readFileSync(process.argv[2]);
} else {
  const one = fs.readFileSync(new URL("../../draft/vollmond-proposal.md", import.meta.url), "utf8");
  let doc = "";
  while (Buffer.byteLength(doc) < 667 * 1024) doc += `${one}\n`;
  bytes = Buffer.from(doc);
}
const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
let nonAscii = 0;
for (const b of bytes) if (b > 127) nonAscii++;
console.log(`input: ${process.argv[2] ? process.argv[2].split("/").pop() : "synthetic (the proposal, repeated)"}, ${bytes.length} bytes, ${nonAscii} non-ASCII bytes`);
console.log(`node ${process.versions.node}, v8 ${process.versions.v8}`);

function time(name, f, n = 5) {
  const runs = [];
  let result;
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    result = f();
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  console.log(`${name.padEnd(44)} min ${runs[0].toFixed(0).padStart(4)} ms   median ${runs[n >> 1].toFixed(0).padStart(4)} ms`);
  return result;
}

// GFM 0.29 is tables, task list items, strikethrough and autolink literals. The `gfm()` bundle also adds footnotes.
const gfm029 = (autolinks) => ({
  extensions: [gfmTable(), gfmStrikethrough(), gfmTaskListItem(), ...(autolinks ? [gfmAutolinkLiteral()] : [])],
  mdastExtensions: [
    gfmTableFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    ...(autolinks ? [gfmAutolinkLiteralFromMarkdown()] : []),
  ],
});
time("mdast, gfm() bundle (adds footnotes)", () => fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));
const tree = time("mdast, GFM 0.29 extensions", () => fromMarkdown(text, gfm029(true)));
time("mdast, GFM 0.29 without autolink literals", () => fromMarkdown(text, gfm029(false)));
time("mdast, CommonMark only", () => fromMarkdown(text));
const md = new MarkdownIt("commonmark");
time("markdown-it, CommonMark preset", () => md.parse(text, {}));
const blocks = new MarkdownIt("commonmark");
blocks.core.ruler.disable("inline");
time("markdown-it, block rules only", () => blocks.parse(text, {}));
time("TextEncoder.encode of the whole text", () => new TextEncoder().encode(text));
console.log(`top-level blocks ${tree.children.length}, top-level headings ${tree.children.filter((n) => n.type === "heading").length}`);

// Footnotes change block structure: without them, `[^1]: target.md` is a link reference definition (a reference, §8.1).
const footnote = "[^1]: target.md\n\n## H\n";
const plain = fromMarkdown(footnote, gfm029(true)).children.map((n) => n.type);
const bundle = fromMarkdown(footnote, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }).children.map((n) => n.type);
console.log(`"[^1]: target.md": GFM 0.29 set gives ${plain.join(", ")}; gfm() bundle gives ${bundle.join(", ")}`);

// Position units: offsets and columns count UTF-16 code units, so U+1F600 counts 2.
const units = fromMarkdown("a\u{1F600}b\n\n# x\u{1F600}y <a id=\"q\"></a>\n").children[1];
console.log(
  "heading children [type, offset, column]:",
  JSON.stringify(units.children.map((c) => [c.type, c.position.start.offset, c.position.start.column])),
  "(code points would give the html node column 7, UTF-16 gives 8)",
);
