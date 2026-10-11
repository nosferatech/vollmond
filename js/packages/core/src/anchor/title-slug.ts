import { visibleTextOf } from "../format/markdown/heading.js";
import { parseMarkdownTree } from "../format/markdown/library.js";
import { slugOf } from "./slug.js";

// TODO(#14): two readings wait for the project owner. A title holding a line break: the ATX heading of the rule ends at the
// line, while a Markdown setext heading with the same `$title` slugs every line. A title nested too deep for the parser: the
// rule has no limit, and plain text is the reading meanwhile.
/**
 * Computes the slug of a JSON or YAML section's `$title`, which is Markdown source: the slug of the visible text of the ATX
 * heading `## ` followed by the title, so that a section has the same key in every format. So emphasis delimiters, a link's
 * URL, images, HTML tags and comments, and an anchor element give no text, character references are decoded, and a closing
 * `#` sequence and white space at either end are not content.
 *
 * The heading ends at the title's first line break, so the text after one gives nothing. A title whose inline containers nest
 * deeper than the Markdown parser reads is slugged as plain text.
 *
 * Throws an `Error` only on a bug: when `## ` and the title do not parse as a heading.
 */
export function titleSlugOf(title: string): string {
  const tree = parseMarkdownTree(`## ${title}`);
  if (!tree.ok) return slugOf(title);
  const heading = tree.root.children[0];
  // `## ` starts an ATX heading whatever follows it, so the first block is always the heading.
  if (heading?.type !== "heading") throw new Error("`## ` and a title did not parse as a heading");
  return slugOf(visibleTextOf(heading.children));
}
