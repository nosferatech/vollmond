import type { Heading, Nodes } from "mdast";
import type { IssueCode } from "../../issue/codes.js";
import { repeatedNodes } from "../../issue/issue.js";
import { type AnchorElement, anchorElementAt, endOf, type InlineHtml, inlineHtmlOf, startOf } from "./anchor-element.js";
import { readClosingTagName, readOpenTag } from "./html-tag.js";
import { isLineBreak, isTrimmedSpace, lineStartOf, withLfLineBreaks } from "./lines.js";

/** The inline elements a heading may hold besides its anchor element, whose text is heading text. */
const HEADING_ELEMENTS: ReadonlySet<string> = new Set(["span", "b", "i", "em", "strong", "code", "kbd", "sup", "sub"]);

/** A range of the file's text, `[start, end)`, in UTF-16 indexes. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/** A problem a heading has, which its section, or the root for the title heading, reports. */
export interface HeadingProblem {
  readonly code: IssueCode;
  readonly message: string;
  /** Where in the file's text it is. */
  readonly index: number;
}

/** A tag of a heading's `class` attribute, kept once. */
export interface HeadingTag {
  readonly name: string;
  /** The token in the file's text. */
  readonly range: TextRange;
}

/** What a heading of the record's tree gives its section: a title, an anchor, tags, and the problems found on the way. */
export interface HeadingReading {
  readonly level: number;
  /** From the start of the heading's first line to the end of its last, without the line break. */
  readonly range: TextRange;
  /** The title: the heading's inline source without the anchor element, with its lines joined by `\n`, then trimmed. */
  readonly title: string;
  /** From the title's first character in the file to its last; empty, at the content's place, for an empty title. */
  readonly titleRange: TextRange;
  /** Whether the title has several lines, as a setext heading can, which the serializer cannot write. */
  readonly multiLine: boolean;
  /** The anchor element's `id`, if any: the `$anchor`. */
  readonly anchor: string | null;
  /** The tags of the anchor element's `class` attribute, in source order, each repeat dropped: the `$tags`, when there are any. */
  readonly tags: readonly HeadingTag[];
  /** The anchor element's range, which `$anchor` and `$tags` take as theirs; null without one. */
  readonly elementRange: TextRange | null;
  /**
   * The text a reader sees in the heading, from which the slug is derived: text with references decoded and escapes resolved,
   * code spans, and the text of every inline node but images; nothing from raw HTML or comments; `\n` for a line break.
   */
  readonly visibleText: string;
  readonly problems: readonly HeadingProblem[];
}

/**
 * Reads a top-level heading of the record's tree, whose offsets plus `shift` are indexes into the file's `text`.
 *
 * - The anchor element, an `<a>` with an `id` or a `class`, may stand anywhere in the heading. One that has content or another
 *   attribute, and any anchor element after the first, is `anchor-element-invalid`.
 * - A class token repeated in it is dropped from the tags, with a `duplicate-tag` for each repeat.
 * - Raw HTML other than the anchor element and the tags of the inline elements `span`, `b`, `i`, `em`, `strong`, `code`,
 *   `kbd`, `sup` and `sub`, an HTML comment included, is one `heading-html` for the heading.
 */
export function readHeading(text: string, heading: Heading, shift: number): HeadingReading {
  const problems: HeadingProblem[] = [];
  const pieces = inlineHtmlOf(heading.children, shift);
  let element: AnchorElement | null = null;
  let otherHtmlAt: number | null = null;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i] as InlineHtml;
    const found = anchorElementAt(text, pieces, i);
    if (found !== null) {
      if (found.problem !== null) {
        problems.push({ code: "anchor-element-invalid", message: found.problem, index: found.start });
      } else if (element !== null) {
        const message = "a heading holds one anchor element, since a section has one $anchor";
        problems.push({ code: "anchor-element-invalid", message, index: found.start });
      }
      element ??= found;
      i += found.pieces - 1;
    } else if (!isHeadingElementTag(text, piece)) {
      otherHtmlAt ??= piece.start;
    }
  }
  if (otherHtmlAt !== null) {
    const message = "a heading holds no HTML besides the anchor element and span, b, i, em, strong, code, kbd, sup and sub";
    problems.push({ code: "heading-html", message, index: otherHtmlAt });
  }

  const tokens = element?.tokens ?? [];
  const repeats = new Set(repeatedNodes(tokens.map((token) => ({ name: token.name, node: token }))));
  const tags: HeadingTag[] = [];
  for (const token of tokens) {
    const range = { start: token.start, end: token.start + token.name.length };
    if (repeats.has(token)) {
      problems.push({ code: "duplicate-tag", message: `the tag ${JSON.stringify(token.name)} is repeated`, index: range.start });
    } else {
      tags.push({ name: token.name, range });
    }
  }

  const first = heading.children[0];
  const last = heading.children.at(-1);
  const end = shift + endOf(heading);
  const content =
    first === undefined || last === undefined ? { start: end, end } : { start: shift + startOf(first), end: shift + endOf(last) };
  const title = titleOf(text, content, element);
  return {
    level: heading.depth,
    range: { start: lineStartOf(text, shift + startOf(heading), shift), end },
    ...title,
    anchor: element?.id?.name ?? null,
    tags,
    elementRange: element === null ? null : { start: element.start, end: element.end },
    visibleText: visibleTextOf(heading.children),
    problems,
  };
}

/** Whether a piece of HTML is an open or closing tag of an inline element a heading may hold. */
function isHeadingElementTag(text: string, piece: InlineHtml): boolean {
  const open = readOpenTag(text, piece.start);
  const name = open !== null && open.end === piece.end ? open.name : readClosingTagName(text.slice(piece.start, piece.end));
  return name !== null && HEADING_ELEMENTS.has(name);
}

/**
 * Reads the title from the heading's content: its source without the anchor element, each line after the first without its
 * indentation, the lines joined by `\n`, then trimmed of spaces, tabs and line breaks.
 */
function titleOf(
  text: string,
  content: TextRange,
  element: AnchorElement | null,
): Pick<HeadingReading, "title" | "titleRange" | "multiLine"> {
  let title = "";
  // The index into the file's text of each character of `title`.
  const sourceAt: number[] = [];
  let i = content.start;
  while (i < content.end) {
    if (element !== null && i === element.start) {
      i = element.end;
      continue;
    }
    if (isLineBreak(text, i)) {
      title += "\n";
      sourceAt.push(i);
      i += text.startsWith("\r\n", i) ? 2 : 1;
      while (i < content.end && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09)) i += 1;
      continue;
    }
    title += text[i];
    sourceAt.push(i);
    i += 1;
  }
  let first = 0;
  let last = title.length;
  while (first < last && isTrimmedSpace(title.charCodeAt(first))) first += 1;
  while (last > first && isTrimmedSpace(title.charCodeAt(last - 1))) last -= 1;
  const trimmed = title.slice(first, last);
  const titleRange =
    first === last
      ? { start: content.start, end: content.start }
      : { start: sourceAt[first] as number, end: (sourceAt[last - 1] as number) + 1 };
  return { title: trimmed, titleRange, multiLine: trimmed.includes("\n") };
}

/**
 * Gives the text a reader sees in inline nodes, without recursion: text values, with line breaks read as `\n`; code spans;
 * the children of every other inline node but images and image references; `\n` for a hard break; nothing for raw HTML.
 */
export function visibleTextOf(nodes: readonly Nodes[]): string {
  let visible = "";
  const pending: Nodes[] = [...nodes].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    switch (node.type) {
      case "text":
        visible += withLfLineBreaks(node.value);
        break;
      case "inlineCode":
        visible += node.value;
        break;
      case "break":
        visible += "\n";
        break;
      default:
        // An image's text is its `alt`, not children, and raw HTML has none either, so neither gives visible text.
        if ("children" in node) {
          for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i] as Nodes);
        }
    }
  }
  return visible;
}
