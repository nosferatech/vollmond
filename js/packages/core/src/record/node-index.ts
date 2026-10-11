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

/** A node of a parsed record's value view, with its place in the tree and in the file. */
export interface NodeInfo {
  /** The node's exact path, a JSON Pointer; `""` for the root. */
  readonly at: string;
  /** The parent's exact path; null for the root. */
  readonly parent: string | null;
  /** The member name or array index under which the parent holds the node; null for the root. */
  readonly key: string | number | null;
  readonly kind: NodeKind;
  /** The node's bytes in the file: what a read of the node in source form returns. */
  readonly range: ByteRange;
  /** For an object member that has a key in the file: from the key's first byte to the value's last. */
  readonly memberRange?: ByteRange;
}

/** A section node: the root, or an object item of a section's `$sections`. */
export interface SectionInfo extends NodeInfo {
  readonly kind: "section";
  /** 0 for the root, and one more than its parent section's for every other section. */
  readonly depth: number;
  /** The heading of a Markdown section, or of a Markdown root with a title heading; null otherwise. */
  readonly heading: HeadingInfo | null;
}

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

interface MutableSection {
  at: string;
  parent: string | null;
  key: string | number | null;
  kind: "section";
  range: ByteRange;
  memberRange?: ByteRange;
  depth: number;
  heading: HeadingInit | null;
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
  readonly #nodes = new Map<string, NodeInfo | MutableSection>();
  readonly #children = new Map<string, NodeInfo[]>();
  readonly #sections: MutableSection[] = [];
  #built = false;

  /** Starts an index with its root section, whose range is the whole file. */
  constructor(root: { readonly range: ByteRange; readonly heading?: HeadingInit }) {
    checkRange(root.range);
    if (root.heading !== undefined) checkRange(root.heading.range);
    const section: MutableSection = {
      at: "",
      parent: null,
      key: null,
      kind: "section",
      range: root.range,
      depth: 0,
      heading: root.heading ?? null,
    };
    this.#nodes.set("", section);
    this.#children.set("", []);
    this.#sections.push(section);
  }

  /** Adds a node under the node at `parent`, after the nodes already added there, and returns the new node's exact path. */
  add(parent: string, key: string | number, init: NodeInit): string {
    if (this.#built) throw new RangeError("the index is already built");
    const parentNode = this.#nodes.get(parent);
    if (parentNode === undefined) throw new RangeError(`no node at ${JSON.stringify(parent)} to add to`);
    const siblings = this.#children.get(parent);
    if (siblings === undefined) throw new RangeError(`the ${parentNode.kind} at ${JSON.stringify(parent)} has no children`);
    if (parentNode.kind === "array") {
      if (key !== siblings.length) throw new RangeError(`item ${String(key)} added where item ${siblings.length} is next`);
      if (init.memberRange !== undefined) throw new RangeError("an array item has no member range");
    } else if (typeof key !== "string") {
      throw new RangeError(`an object member needs a name, not ${key}`);
    }
    const at = childPath(parent, key);
    if (this.#nodes.has(at)) throw new RangeError(`a node at ${JSON.stringify(at)} exists already`);
    checkRange(init.range);
    if (init.memberRange !== undefined) checkRange(init.memberRange);
    if (init.heading !== undefined) checkRange(init.heading.range);

    const grandparent = parentNode.parent === null ? undefined : this.#nodes.get(parentNode.parent);
    const isSection =
      init.kind === "object" && parentNode.kind === "array" && parentNode.key === "$sections" && grandparent?.kind === "section";
    if (init.heading !== undefined && !isSection) throw new RangeError(`the node at ${JSON.stringify(at)} is not a section`);

    let node: { -readonly [K in keyof NodeInfo]: NodeInfo[K] } | MutableSection;
    if (isSection) {
      const section: MutableSection = {
        at,
        parent,
        key,
        kind: "section",
        range: init.range,
        depth: (grandparent as MutableSection).depth + 1,
        heading: init.heading ?? null,
      };
      this.#sections.push(section);
      node = section;
    } else {
      node = { at, parent, key, kind: init.kind, range: init.range };
    }
    if (init.memberRange !== undefined) node.memberRange = init.memberRange;
    this.#nodes.set(at, node);
    siblings.push(node);
    if (init.kind === "object" || init.kind === "array") this.#children.set(at, []);
    return at;
  }

  /**
   * Finishes the index. `derivedAnchors` maps the exact path of each section with a heading to its derived anchor; a section
   * it leaves out has none. Throws a `RangeError` for a path that is not a section with a heading.
   */
  build(derivedAnchors: ReadonlyMap<string, string> = new Map()): NodeIndex {
    if (this.#built) throw new RangeError("the index is already built");
    for (const at of derivedAnchors.keys()) {
      const node = this.#nodes.get(at);
      if (node === undefined || node.kind !== "section" || (node as MutableSection).heading === null) {
        throw new RangeError(`no section heading at ${JSON.stringify(at)} for a derived anchor`);
      }
    }
    this.#built = true;
    for (const section of this.#sections) {
      const heading = section.heading;
      const info = section as unknown as { heading: HeadingInfo | null };
      info.heading =
        heading === null ? null : Object.freeze({ ...heading, derivedAnchor: derivedAnchors.get(section.at) ?? null });
    }
    for (const node of this.#nodes.values()) Object.freeze(node);
    for (const children of this.#children.values()) Object.freeze(children);
    return new FrozenNodeIndex(this.#nodes, this.#children, Object.freeze([...this.#sections]) as readonly SectionInfo[]);
  }
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
