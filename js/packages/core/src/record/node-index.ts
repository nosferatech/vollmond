import type { ByteRange } from "../text/source-text.js";
import { childPath } from "./exact-path.js";

/** The kind of a value node, as its JavaScript value has it. */
export type ValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

/** The kind of a node: a section, or a value of another kind. */
export type NodeKind = "section" | ValueKind;

/** A Markdown section's heading: its level, its byte range in the file, and its derived anchor, where it has one. */
export interface HeadingInfo {
  readonly level: number;
  readonly range: ByteRange;
  readonly derivedAnchor: string | null;
}

/** What every node of the index has: its place in the tree and in the file. */
interface NodeBase {
  /** The node's exact path, a JSON Pointer; `""` for the root. */
  readonly at: string;
  /** The parent's exact path; null for the root. */
  readonly parent: string | null;
  /** The member name or array index under which the parent holds the node; null for the root. */
  readonly key: string | number | null;
  /** The node's bytes in the file: what a read of the node in source form returns. */
  readonly range: ByteRange;
  /** For an object member that has a key in the file: from the key's first byte to the value's last. */
  readonly memberRange?: ByteRange;
}

/** A section node: the root, or an object item of a section's `$sections`. */
export interface SectionInfo extends NodeBase {
  readonly kind: "section";
  /** 0 for the root, and one more than its parent section's for every other section. */
  readonly depth: number;
  /** The heading of a Markdown section, or of a Markdown root with a title heading; null otherwise. */
  readonly heading: HeadingInfo | null;
}

/** A node that is not a section: a field, an item, or any value inside them. */
export interface ValueNodeInfo extends NodeBase {
  readonly kind: ValueKind;
}

/** A node of a parsed record's value view; `kind` tells a section from a value node. */
export type NodeInfo = SectionInfo | ValueNodeInfo;

/**
 * The nodes of a parsed record's value view: every node of the value, each with its exact path, parent, key, kind and byte
 * ranges, and the sections in document order. It is immutable.
 */
export interface NodeIndex {
  /** Returns the node at an exact path, or undefined when there is none. */
  node(at: string): NodeInfo | undefined;
  /** Returns the children of the node at `at` in source order, or an empty list for a leaf or a path with no node. */
  children(at: string): readonly NodeInfo[];
  /** Returns every section, the root first, in document order. */
  sections(): readonly SectionInfo[];
}

/** A section heading as a parser knows it before derived anchors are computed. */
export interface HeadingInit {
  readonly level: number;
  readonly range: ByteRange;
}

/** A child node as a parser adds it. */
export interface NodeInit {
  /** The value's kind. An object in a section's place becomes a section. */
  readonly kind: ValueKind;
  readonly range: ByteRange;
  /** For an object member with a key in the file, from the key's start to the value's end. */
  readonly memberRange?: ByteRange;
  /** For a Markdown section, its heading. */
  readonly heading?: HeadingInit;
}

/** A node as the builder holds it until `build`, when its derived anchor, if any, is known. */
interface NodeDraft {
  readonly at: string;
  readonly parent: string | null;
  readonly key: string | number | null;
  readonly kind: ValueKind;
  readonly range: ByteRange;
  readonly memberRange: ByteRange | undefined;
  /** For a section, its depth and heading; null for a value node. */
  readonly section: { readonly depth: number; readonly heading: HeadingInit | null } | null;
  /** The exact paths of the children, in source order; null for a scalar, which has none. */
  readonly children: string[] | null;
}

/**
 * Builds a {@link NodeIndex} in the order a parser walks the value: the root when the builder is created, and then each
 * node after its parent and after its earlier siblings, so that children keep their source order and sections their document
 * order. The builder decides which objects are sections: an object item of a `$sections` array held by a section. A
 * `$sections` member inside a field's value is data, and its items are plain objects.
 *
 * Every misuse is a bug in the parser and throws a `RangeError`, leaving the builder as it was: an unknown or scalar parent,
 * an array index out of order, a member name the parent already has (a parser that meets a duplicate member reports it and
 * adds no node for the repeat), a `memberRange` on an array item, a heading on a node that is not a section, a range that is
 * not a range, and any call after {@link NodeIndexBuilder.build}.
 */
export class NodeIndexBuilder {
  readonly #drafts = new Map<string, NodeDraft>();
  #built = false;

  /** Starts an index with its root section, whose range is the whole file. */
  constructor(root: { readonly range: ByteRange; readonly heading?: HeadingInit }) {
    checkRange(root.range);
    if (root.heading !== undefined) checkRange(root.heading.range);
    this.#drafts.set("", {
      at: "",
      parent: null,
      key: null,
      kind: "object",
      range: root.range,
      memberRange: undefined,
      section: { depth: 0, heading: root.heading ?? null },
      children: [],
    });
  }

  /** Adds a node under the node at `parent`, after the nodes already added there, and returns the new node's exact path. */
  add(parent: string, key: string | number, init: NodeInit): string {
    if (this.#built) throw new RangeError("the index is already built");
    const parentDraft = this.#drafts.get(parent);
    if (parentDraft === undefined) throw new RangeError(`no node at ${JSON.stringify(parent)} to add to`);
    const siblings = parentDraft.children;
    if (siblings === null) throw new RangeError(`the ${parentDraft.kind} at ${JSON.stringify(parent)} has no children`);
    if (parentDraft.kind === "array") {
      if (key !== siblings.length) throw new RangeError(`item ${String(key)} added where item ${siblings.length} is next`);
      if (init.memberRange !== undefined) throw new RangeError("an array item has no member range");
    } else if (typeof key !== "string") {
      throw new RangeError(`an object member needs a name, not ${key}`);
    }
    const at = childPath(parent, key);
    if (this.#drafts.has(at)) throw new RangeError(`a node at ${JSON.stringify(at)} exists already`);
    checkRange(init.range);
    if (init.memberRange !== undefined) checkRange(init.memberRange);
    if (init.heading !== undefined) checkRange(init.heading.range);

    const holder = parentDraft.parent === null ? undefined : this.#drafts.get(parentDraft.parent);
    const holderSection = parentDraft.kind === "array" && parentDraft.key === "$sections" ? holder?.section : undefined;
    const isSection = init.kind === "object" && holderSection !== undefined && holderSection !== null;
    if (init.heading !== undefined && !isSection) throw new RangeError(`the node at ${JSON.stringify(at)} is not a section`);

    this.#drafts.set(at, {
      at,
      parent,
      key,
      kind: init.kind,
      range: init.range,
      memberRange: init.memberRange,
      section: isSection ? { depth: holderSection.depth + 1, heading: init.heading ?? null } : null,
      children: init.kind === "object" || init.kind === "array" ? [] : null,
    });
    siblings.push(at);
    return at;
  }

  /**
   * Finishes the index. `derivedAnchors` maps the exact path of each section with a heading to its derived anchor; a section
   * it leaves out has none. Throws a `RangeError` for a path that is not a section with a heading.
   */
  build(derivedAnchors: ReadonlyMap<string, string> = new Map()): NodeIndex {
    if (this.#built) throw new RangeError("the index is already built");
    for (const at of derivedAnchors.keys()) {
      if (this.#drafts.get(at)?.section?.heading == null) {
        throw new RangeError(`no section heading at ${JSON.stringify(at)} for a derived anchor`);
      }
    }
    this.#built = true;
    const nodes = new Map<string, NodeInfo>();
    const sections: SectionInfo[] = [];
    for (const draft of this.#drafts.values()) {
      const node = finish(draft, derivedAnchors);
      nodes.set(draft.at, node);
      if (node.kind === "section") sections.push(node);
    }
    const children = new Map<string, readonly NodeInfo[]>();
    for (const draft of this.#drafts.values()) {
      if (draft.children !== null) {
        children.set(draft.at, Object.freeze(draft.children.map((at) => nodes.get(at)).filter((node) => node !== undefined)));
      }
    }
    return new FrozenNodeIndex(nodes, children, Object.freeze(sections));
  }
}

/** Turns a draft into the frozen node of the index. */
function finish(draft: NodeDraft, derivedAnchors: ReadonlyMap<string, string>): NodeInfo {
  const base = { at: draft.at, parent: draft.parent, key: draft.key, range: draft.range };
  const withMember = draft.memberRange === undefined ? base : { ...base, memberRange: draft.memberRange };
  if (draft.section === null) return Object.freeze({ ...withMember, kind: draft.kind });
  const heading = draft.section.heading;
  return Object.freeze({
    ...withMember,
    kind: "section" as const,
    depth: draft.section.depth,
    heading: heading === null ? null : Object.freeze({ ...heading, derivedAnchor: derivedAnchors.get(draft.at) ?? null }),
  });
}

const NO_CHILDREN: readonly NodeInfo[] = Object.freeze([]);

class FrozenNodeIndex implements NodeIndex {
  readonly #nodes: ReadonlyMap<string, NodeInfo>;
  readonly #children: ReadonlyMap<string, readonly NodeInfo[]>;
  readonly #sections: readonly SectionInfo[];

  constructor(
    nodes: ReadonlyMap<string, NodeInfo>,
    children: ReadonlyMap<string, readonly NodeInfo[]>,
    sections: readonly SectionInfo[],
  ) {
    this.#nodes = nodes;
    this.#children = children;
    this.#sections = sections;
  }

  node(at: string): NodeInfo | undefined {
    return this.#nodes.get(at);
  }

  children(at: string): readonly NodeInfo[] {
    return this.#children.get(at) ?? NO_CHILDREN;
  }

  sections(): readonly SectionInfo[] {
    return this.#sections;
  }
}

function checkRange(range: ByteRange): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start) {
    throw new RangeError(`[${range.start}, ${range.end}) is not a byte range`);
  }
}
