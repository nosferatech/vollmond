import type { ListItem, Nodes, Paragraph, RootContent } from "mdast";
import type { IssueCode } from "../../issue/codes.js";
import type { ByteRange, SourceText } from "../../text/source-text.js";
import { anchorElementAt, anchorTagsWithIdIn, endOf, inlineHtmlOf, startOf } from "./anchor-element.js";
import type { TextRange } from "./heading.js";
import { isBlank, isTrimmedSpace, lineEndOf, nextLineStart, withLfLineBreaks } from "./lines.js";

/** A `$body`: its value, and its span in the file's text. */
export interface Body {
  /** The span's text with its line breaks read as `\n`. */
  readonly value: string;
  /** From the body's first character in the file to its last. */
  readonly range: TextRange;
}

/**
 * Finds the `$body` in the file's `text` from `from`, a line start, to `to`: what is left after its leading blank lines (lines
 * of only spaces and tabs) and its trailing spaces, tabs and line breaks are removed, so that the first line keeps its
 * indentation. Returns null when nothing is left, since an empty body is absent.
 */
export function findBody(text: string, from: number, to: number): Body | null {
  let start = from;
  while (start < to) {
    const lineEnd = Math.min(lineEndOf(text, start), to);
    if (!isBlank(text, start, lineEnd)) break;
    start = nextLineStart(text, start);
  }
  let end = to;
  while (end > start && isTrimmedSpace(text.charCodeAt(end - 1))) end -= 1;
  if (end <= start) return null;
  return { value: withLfLineBreaks(text.slice(start, end)), range: { start, end } };
}

/** A block anchor: a name for a paragraph or a list item of a `$body`. */
export interface BlockAnchor {
  readonly name: string;
  /** The exact path of the `$body` that holds the block. */
  readonly at: string;
  /** The block in the `$body`'s value, in UTF-8 bytes of the value, whose line breaks are `\n`. */
  readonly range: ByteRange;
  /** The block in the file, in UTF-8 bytes. */
  readonly fileRange: ByteRange;
}

/** A problem with an anchor element in a `$body`, which the `$body` reports. */
export interface BodyProblem {
  readonly code: IssueCode;
  readonly message: string;
  /** Where in the file's text it is. */
  readonly index: number;
  /** The same place, in UTF-8 bytes of the `$body`'s value. */
  readonly offset: number;
}

/**
 * Reads the anchor elements of a `$body`, whose top-level blocks of the record's tree are `blocks`, with offsets that plus
 * `shift` are indexes into the file's text, and whose exact path is `at`:
 *
 * - an anchor element with an `id` at the start of a paragraph among `blocks`, or of a list item outside block quotes at any
 *   depth of list nesting (the start of its first paragraph), is a block anchor;
 * - one there that has content, another attribute or a `class`, since a block carries no tags, or a second anchor element
 *   right after the first, is `anchor-element-invalid`;
 * - every other `<a>` open tag with an `id` in the body, in a paragraph, a block quote, a later paragraph of a list item or
 *   an HTML block, is plain HTML and anchors nothing, and gets an `anchor-element-ignored`.
 *
 * Each walk keeps its own stack, so the nesting of lists costs no recursion.
 */
export function readBlockAnchors(
  source: SourceText,
  blocks: readonly RootContent[],
  shift: number,
  body: Body,
  at: string,
): { readonly anchors: BlockAnchor[]; readonly problems: BodyProblem[] } {
  const text = source.text;
  const offsets = new BodyOffsets(source, body.range);
  const anchors: BlockAnchor[] = [];
  const problems: BodyProblem[] = [];
  const raise = (code: IssueCode, message: string, index: number) => {
    problems.push({ code, message, index, offset: offsets.valueOffset(index) });
  };
  const ignoredIn = (nodes: readonly Nodes[]) => {
    for (const piece of inlineHtmlOf(nodes, shift)) {
      for (const index of anchorTagsWithIdIn(text, piece.start, piece.end)) {
        raise(
          "anchor-element-ignored",
          "this <a id> is not at the start of a paragraph or a list item, and anchors nothing",
          index,
        );
      }
    }
  };
  /** Reads the anchor element at the start of a paragraph, which ends the block at `blockEnd`. */
  const blockStart = (paragraph: Paragraph, blockStartIndex: number, blockEnd: number) => {
    const pieces = inlineHtmlOf(paragraph.children, shift);
    const element = paragraph.children[0] === pieces[0]?.node ? anchorElementAt(text, pieces, 0) : null;
    let rest = 0;
    if (element !== null) {
      rest = element.pieces;
      if (element.problem !== null) {
        raise("anchor-element-invalid", element.problem, element.start);
      } else if (element.hasClass || element.id === null) {
        raise("anchor-element-invalid", "a block anchor carries no tags: its element has an id and no class", element.start);
      } else {
        const range = { start: offsets.valueOffset(blockStartIndex), end: offsets.valueOffset(blockEnd) };
        const fileRange = { start: source.byteOffset(blockStartIndex), end: source.byteOffset(blockEnd) };
        anchors.push({ name: element.id.name, at, range, fileRange });
      }
      const second = pieces[rest]?.start === element.end ? anchorElementAt(text, pieces, rest) : null;
      if (second !== null) {
        raise("anchor-element-invalid", "a block has one anchor element, since it has one name", second.start);
        rest += second.pieces;
      }
    }
    for (const piece of pieces.slice(rest)) ignoredIn([piece.node]);
  };

  for (const block of blocks) {
    if (block.type === "paragraph") {
      const start = shift + startOf(block);
      let end = shift + endOf(block);
      while (end > start && (text.charCodeAt(end - 1) === 0x20 || text.charCodeAt(end - 1) === 0x09)) end -= 1;
      blockStart(block, start, end);
    } else if (block.type === "list") {
      // List items to read and other blocks to scan, the next one last, so that both come in document order.
      const pending: (ListItem | Nodes)[] = [...block.children].reverse();
      for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        if (next.type !== "listItem") {
          ignoredIn([next]);
          continue;
        }
        const start = shift + startOf(next);
        const end = Math.min(shift + endOf(next), body.range.end);
        const [first, ...others] = next.children;
        const later = first?.type === "paragraph" ? others : next.children;
        if (first?.type === "paragraph") blockStart(first, start, end);
        const inOrder = later.flatMap((child): (ListItem | Nodes)[] => (child.type === "list" ? child.children : [child]));
        for (let i = inOrder.length - 1; i >= 0; i--) pending.push(inOrder[i] as ListItem | Nodes);
      }
    } else {
      ignoredIn([block]);
    }
  }
  return { anchors, problems };
}

/** Converts indexes into the file's text inside a `$body`'s span to UTF-8 byte offsets into its value. */
class BodyOffsets {
  readonly #source: SourceText;
  readonly #start: number;
  /** The index of the CR of each CRLF in the span, which the value reads as one `\n`, in order. */
  readonly #crlf: number[] = [];

  constructor(source: SourceText, range: TextRange) {
    this.#source = source;
    this.#start = range.start;
    const text = source.text;
    for (let i = text.indexOf("\r", range.start); i >= 0 && i < range.end; i = text.indexOf("\r", i + 1)) {
      if (text.charCodeAt(i + 1) === 0x0a) this.#crlf.push(i);
    }
  }

  /** The byte offset into the value of the place at `index` of the file's text, a place in the span. */
  valueOffset(index: number): number {
    let low = 0;
    let high = this.#crlf.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#crlf[middle] as number) < index) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return this.#source.byteOffset(index) - this.#source.byteOffset(this.#start) - low;
  }
}
