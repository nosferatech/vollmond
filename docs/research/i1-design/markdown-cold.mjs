// What one `vmd outline` pays for Markdown on a cold start, for docs/design/i1-read.md (section 7): loading the parser
// modules, then one parse with the GFM 0.29 extensions, in a fresh process with nothing warmed up.
//
//   node markdown-cold.mjs FILE
//
// Run it a few times; each run is one sample.
import fs from "node:fs";

const start = performance.now();
const [{ fromMarkdown }, table, strike, task, autolink, mTable, mStrike, mTask, mAutolink] = await Promise.all([
  import("mdast-util-from-markdown"),
  import("micromark-extension-gfm-table"),
  import("micromark-extension-gfm-strikethrough"),
  import("micromark-extension-gfm-task-list-item"),
  import("micromark-extension-gfm-autolink-literal"),
  import("mdast-util-gfm-table"),
  import("mdast-util-gfm-strikethrough"),
  import("mdast-util-gfm-task-list-item"),
  import("mdast-util-gfm-autolink-literal"),
]);
const loaded = performance.now();
const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(process.argv[2]));
const read = performance.now();
fromMarkdown(text, {
  extensions: [table.gfmTable(), strike.gfmStrikethrough(), task.gfmTaskListItem(), autolink.gfmAutolinkLiteral()],
  mdastExtensions: [
    mTable.gfmTableFromMarkdown(),
    mStrike.gfmStrikethroughFromMarkdown(),
    mTask.gfmTaskListItemFromMarkdown(),
    mAutolink.gfmAutolinkLiteralFromMarkdown(),
  ],
});
const parsed = performance.now();
console.log(
  `${process.argv[2].split("/").pop()}: import ${(loaded - start).toFixed(0)} ms, read and decode ${(read - loaded).toFixed(0)} ms, ` +
    `first parse ${(parsed - read).toFixed(0)} ms`,
);
