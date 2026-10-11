import { visibleTextOf } from "../format/markdown/heading.js";
import { parseInlineContent } from "../format/markdown/library.js";
import { slugOf } from "./slug.js";

// TODO(#14): one reading waits for the project owner. A title nested too deep for the parser: the rule has no limit, and plain
// text is the reading meanwhile.
/**
 * Computes the slug of a JSON or YAML section's `$title`, which is Markdown source: the slug of its visible text read as a
 * heading's inline content, so that a section has the same key in every format. So emphasis delimiters, a link's URL,
 * images, HTML tags and comments, and an anchor element give no text, and character references are decoded. A line break is
 * a soft break, which slugs as white space, as the lines of a setext heading do; a blank line counts two. No closing `#`
 * sequence is stripped, and nothing in the title starts a block. `labels` are the labels of the record's link reference
 * definitions, as written, so that a reference to one of them gives its text alone.
 *
 * A title whose inline containers nest deeper than the Markdown parser reads is slugged as plain text.
 */
export function titleSlugOf(title: string, labels: readonly string[]): string {
  const content = parseInlineContent(title, labels);
  return slugOf(content === null ? title : visibleTextOf(content));
}
