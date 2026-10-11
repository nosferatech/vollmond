import type { Nodes, Root } from "mdast";
import { type Extension, fromMarkdown, type Options, type Transform } from "mdast-util-from-markdown";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { MAX_NESTING } from "../limits.js";

// Deviation from the I1 design, recorded in issue #13: the library is imported with the module, not on first use, since
// parsing a record is synchronous.
// The autolink literal extension finds most literals with a tree transform, which recurses into every node: it overflows
// the stack at about 5,600 nested block quotes, where the parser and the compiler, which keep their own stacks, do not. So
// the transform runs here, after the nesting check, rather than inside the parse.
const { transforms: AUTOLINK_TRANSFORMS = [], ...autolinkLiteralFromMarkdown }: Extension = gfmAutolinkLiteralFromMarkdown();

/**
 * CommonMark with exactly the extensions of GitHub Flavored Markdown 0.29: tables, strikethrough, task list items and autolink
 * literals. The bundle of all of GitHub's extensions is not used, since its footnotes are not part of GFM 0.29 and change
 * block structure: a `[^1]: target` line is a link reference definition without them.
 */
const PARSE_OPTIONS: Options = {
  extensions: [gfmTable(), gfmStrikethrough(), gfmTaskListItem(), gfmAutolinkLiteral()],
  mdastExtensions: [
    gfmTableFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    autolinkLiteralFromMarkdown,
  ],
};

/**
 * The node types that nest: block quotes and list items, whose lists add no level of their own, and the inline nodes that hold
 * other inline nodes.
 */
const NESTING_TYPES: ReadonlySet<Nodes["type"]> = new Set([
  "blockquote",
  "listItem",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
]);

// Deviation from the specification, recorded in issue #13: it bounds nesting only in data units, and the body's limit here is
// the parser's own, so that the autolink transform's recursion cannot overflow the stack.
/** The syntax tree of a Markdown text, or where it nests too deep for one. */
export type MarkdownTree =
  | { readonly ok: true; readonly root: Root }
  | {
      readonly ok: false;
      /** The index into the text of the first node nested deeper than {@link MAX_NESTING}. */
      readonly tooDeepAt: number;
    };

/**
 * Parses a Markdown text into its syntax tree, whose positions are UTF-16 indexes into `text`, with tabs counted as one
 * character, a CRLF as two, and one exception: a U+FEFF at index 0 is skipped, and the indexes count from the character after
 * it. A caller that reads U+FEFF as content passes a text that does not start with one.
 *
 * Block quotes, list items and inline nodes that hold other inline nodes nest at most {@link MAX_NESTING} deep, a node at the
 * top counting as level 1, so that every walk of the tree, the library's and vmd's, has a bounded depth. A deeper text gives
 * no tree.
 *
 * Note: the parse costs time that grows with the square of the nesting of lists, before the nesting is checked.
 */
export function parseMarkdownTree(text: string): MarkdownTree {
  let root = fromMarkdown(text, PARSE_OPTIONS);
  const tooDeepAt = nestedBeyond(root, MAX_NESTING);
  if (tooDeepAt !== null) return { ok: false, tooDeepAt };
  for (const transform of AUTOLINK_TRANSFORMS as readonly Transform[]) root = transform(root) ?? root;
  return { ok: true, root };
}

/** Finds the first node nested deeper than `limit`, without recursion, and returns its start, or null when there is none. */
function nestedBeyond(root: Root, limit: number): number | null {
  const pending: [Nodes, number][] = [[root, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [node, depth] = next;
    const level = NESTING_TYPES.has(node.type) ? depth + 1 : depth;
    if (level > limit) return node.position?.start.offset ?? 0;
    if ("children" in node) {
      for (const child of node.children) pending.push([child, level]);
    }
  }
  return null;
}
