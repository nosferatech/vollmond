import type { Html, Nodes } from "mdast";
import { type ClassToken, classTokens, type HtmlAttribute, readClosingTagName, readOpenTag } from "./html-tag.js";

/** A piece of inline raw HTML, one tag or comment, with its place in the file's text. */
export interface InlineHtml {
  readonly node: Html;
  /** Its first and last index into the file's text, `[start, end)`. */
  readonly start: number;
  readonly end: number;
}

/**
 * An anchor element: an `<a>` element with an `id` or a `class` attribute. A valid one is an open tag with no attributes but
 * one `id` and one `class`, immediately followed by its closing tag `</a>`, so that it has no content.
 */
export interface AnchorElement {
  /** From the open tag's `<` to the end of its closing tag, or of the open tag alone when no closing tag follows it. */
  readonly start: number;
  readonly end: number;
  /** The `id` attribute: its value as written, and the index of the value's first character; null without one. */
  readonly id: { readonly name: string; readonly start: number } | null;
  /** Whether the element has a `class` attribute, even an empty one. */
  readonly hasClass: boolean;
  /** The tokens of the `class` attribute, in source order with repeats, at indexes into the file's text. */
  readonly tokens: readonly ClassToken[];
  /** Why the element is not a valid anchor element, or null for a valid one. */
  readonly problem: string | null;
  /** How many of the inline HTML pieces it is made of: 2 with its closing tag, and 1 for an open tag alone. */
  readonly pieces: number;
}

/**
 * Collects the inline raw HTML in `nodes` and their descendants, in document order, without recursion. `shift` is the index
 * into the file's text of the tree's offset 0.
 */
export function inlineHtmlOf(nodes: readonly Nodes[], shift: number): InlineHtml[] {
  const found: InlineHtml[] = [];
  const pending: Nodes[] = [...nodes].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === "html") {
      found.push({ node, start: shift + startOf(node), end: shift + endOf(node) });
    } else if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i] as Nodes);
    }
  }
  return found;
}

/**
 * Reads the anchor element that starts with `pieces[index]`, from the file's `text`, or returns null when that piece is not
 * the open tag of an `<a>` element with an `id` or a `class`. Tag and attribute names are compared without ASCII case, as HTML
 * compares them.
 */
export function anchorElementAt(text: string, pieces: readonly InlineHtml[], index: number): AnchorElement | null {
  const piece = pieces[index];
  if (piece === undefined) return null;
  const tag = readOpenTag(text, piece.start);
  if (tag?.name !== "a") return null;
  const ids = tag.attributes.filter((attribute) => attribute.name === "id");
  const classes = tag.attributes.filter((attribute) => attribute.name === "class");
  if (ids.length === 0 && classes.length === 0) return null;

  const next = pieces[index + 1];
  const closed = next !== undefined && next.start === piece.end && readClosingTagName(next.node.value) === "a";
  const id = ids[0] as HtmlAttribute | undefined;
  const others = tag.attributes.filter((attribute) => attribute.name !== "id" && attribute.name !== "class");
  let problem: string | null = null;
  if (!closed) {
    problem = "an anchor element has no content: </a> must follow its open tag directly";
  } else if (others.length > 0) {
    problem = `an anchor element has no attributes besides id and class, and this one has ${others[0]?.name}`;
  } else if (ids.length > 1 || classes.length > 1) {
    problem = "an anchor element has one id attribute and one class attribute at most";
  } else if (tag.selfClosing) {
    problem = "an anchor element is written <a ...></a>, not as a self-closing tag";
  }
  return {
    start: piece.start,
    end: closed ? (next as InlineHtml).end : piece.end,
    id: id === undefined ? null : { name: id.value, start: id.valueStart },
    hasClass: classes.length > 0,
    tokens: classes[0] === undefined ? [] : classTokens(classes[0]),
    problem,
    pieces: closed ? 2 : 1,
  };
}

/**
 * Finds the open tags of `<a>` elements with an `id` attribute in raw HTML, a piece of inline HTML or an HTML block, from
 * `start` to `end` of the file's `text`, and returns the index of each, in order.
 */
export function anchorTagsWithIdIn(text: string, start: number, end: number): number[] {
  const html = text.slice(start, end);
  const found: number[] = [];
  for (const match of html.matchAll(/<a(?=[ \t\r\n/>])/gi)) {
    const tag = readOpenTag(html, match.index);
    if (tag?.attributes.some((attribute) => attribute.name === "id")) found.push(start + match.index);
  }
  return found;
}

/** The offset of a node's start in its tree's text. */
export function startOf(node: Nodes): number {
  return node.position?.start.offset ?? 0;
}

/** The offset of a node's end in its tree's text. */
export function endOf(node: Nodes): number {
  return node.position?.end.offset ?? 0;
}
