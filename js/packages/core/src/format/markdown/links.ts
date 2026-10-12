import type { Nodes } from "mdast";
import type { CompileContext, Extension, Token } from "mdast-util-from-markdown";
import { startOf } from "./anchor-element.js";

/** A destination's place in its tree's text, `[start, end)`, which the parse keeps on the node that holds it. */
interface DestinationRange {
  readonly start: number;
  readonly end: number;
}

declare module "mdast" {
  interface LinkData {
    /** Where the destination's text is, without its angle brackets; absent for an empty destination. */
    vmdDestination?: DestinationRange;
  }
  interface ImageData {
    vmdDestination?: DestinationRange;
  }
  interface DefinitionData {
    vmdDestination?: DestinationRange;
  }
}

/**
 * Sets a link's, an image's or a definition's `url` as the library's own handler does, and keeps the range of the
 * destination's text on the node, which the library's handler drops.
 */
function keepDestination(this: CompileContext, token: Token): undefined {
  const url = this.resume();
  const node = this.stack[this.stack.length - 1];
  if (node === undefined || (node.type !== "link" && node.type !== "image" && node.type !== "definition")) {
    throw new Error(`a destination closed on a ${node?.type ?? "missing"} node`);
  }
  node.url = url;
  node.data = { ...node.data, vmdDestination: { start: token.start.offset, end: token.end.offset } };
}

/**
 * The extension that keeps each destination's range. Its handlers replace the library's for the two destination tokens, and
 * the tree is otherwise the one the library builds.
 */
export const DESTINATION_RANGES: Extension = {
  exit: { resourceDestinationString: keepDestination, definitionDestinationString: keepDestination },
};

/** A link, an image or a link reference definition found in a tree, in the tree's offsets. */
export interface MarkdownLink {
  readonly form: "link" | "image" | "definition";
  /** Where the node starts: its `[`, or `!` for an image. */
  readonly start: number;
  /** The destination as CommonMark reads it, entities and escapes decoded. */
  readonly url: string;
  /** Where the destination's text is, without its angle brackets; null for an empty destination. */
  readonly destination: DestinationRange | null;
}

/**
 * Collects the inline links, images and link reference definitions in `nodes` and their descendants, in document order,
 * without recursion. `shift` is the index into `text` of the tree's offset 0. A link that `text` does not start with `[` at
 * the node is an autolink, which has a scheme and is left out. References to a definition, `[text][label]`, are not
 * collected, since the definition is.
 */
export function collectLinks(nodes: readonly Nodes[], text: string, shift: number): MarkdownLink[] {
  const found: MarkdownLink[] = [];
  const pending: Nodes[] = [...nodes].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const isAutolink = node.type === "link" && text[shift + startOf(node)] !== "[";
    if ((node.type === "link" && !isAutolink) || node.type === "image" || node.type === "definition") {
      found.push({
        form: node.type,
        start: startOf(node),
        url: node.url,
        destination: node.data?.vmdDestination ?? null,
      });
    }
    if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i] as Nodes);
    }
  }
  return found;
}
