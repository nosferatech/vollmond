// How mdast-util-from-markdown (2.1.0, micromark 4.0.3, the four GFM 0.29 extensions core uses) gives the references of
// §8.1, and whether a handler that keeps each destination's source range changes the tree.
//
//   node markdown-link-probes.mjs
//
// Every line prints what the library did. Nothing here is a vmd rule; the design says what core does about each.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

function keepRange(token) {
  const data = this.resume();
  const node = this.stack[this.stack.length - 1];
  node.url = data;
  node.data = { ...(node.data ?? {}), destination: [token.start.offset, token.end.offset] };
}
const { transforms = [], ...autolinkFromMarkdown } = gfmAutolinkLiteralFromMarkdown();
const micromarkExtensions = [gfmTable(), gfmStrikethrough(), gfmTaskListItem(), gfmAutolinkLiteral()];
const mdast = [gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown(), gfmTaskListItemFromMarkdown(), autolinkFromMarkdown];
function tree(text, ranges) {
  const mdastExtensions = ranges ? [...mdast, { exit: { resourceDestinationString: keepRange, definitionDestinationString: keepRange } }] : mdast;
  let t = fromMarkdown(text, { extensions: micromarkExtensions, mdastExtensions });
  for (const transform of transforms) t = transform(t) ?? t;
  return t;
}
function references(t, text) {
  const out = [];
  const pending = [t];
  while (pending.length > 0) {
    const node = pending.pop();
    if (["link", "definition", "image", "linkReference", "imageReference"].includes(node.type)) {
      const r = node.data?.destination;
      out.push({
        type: node.type,
        url: node.url,
        identifier: node.identifier,
        start: node.position.start.offset,
        raw: r === undefined ? undefined : text.slice(r[0], r[1]),
      });
    }
    if (node.children) for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
  }
  return out;
}
const strip = (t) => JSON.stringify(t, (k, v) => (k === "position" || k === "data" ? undefined : v));

const inputs = [
  ["plain", "See [a](../x.md#b)."],
  ["percent-encoded", "[a](x%20y.md)"],
  ["entity in destination", "[a](x&amp;y.md)"],
  ["angle brackets", "[a](<x y.md>)"],
  ["backslash escape", "[a](x\\_y.md)"],
  ["with a title", '[a](x.md "Title")'],
  ["nested brackets in text", "[a [b] c](x.md)"],
  ["empty text", "[](x.md)"],
  ["image", "![alt](img.png)"],
  ["definition and its use", "[a][r]\n\n[r]: target.md#frag"],
  ["unused definition", "[r]: target.md"],
  ["footnote-like definition", "[^1]: target.md"],
  ["in a heading", "## See [a](x.md)"],
  ["in a table cell", "| a |\n| - |\n| [b](x.md) |"],
  ["in a code span", "`[a](x.md)`"],
  ["in an HTML comment", "<!-- [a](x.md) -->"],
  ["in an inline HTML comment", "text <!-- [a](x.md) --> more"],
  ["autolink with a scheme", "<https://example.com/a>"],
  ["angle brackets without a scheme", "<x.md>"],
  ["autolink literal", "see www.example.com and https://example.com/b"],
  ["raw HTML anchor", '<a href="x.md">x</a>'],
  ["link in a block quote", "> [a](x.md)"],
  ["link in a list item", "- [a](x.md)"],
];
for (const [label, text] of inputs) {
  const withRanges = tree(text, true);
  const without = tree(text, false);
  const same = strip(withRanges) === strip(without);
  console.log(`${label.padEnd(34)} ${JSON.stringify(references(withRanges, text))}${same ? "" : "  TREE DIFFERS"}`);
}
