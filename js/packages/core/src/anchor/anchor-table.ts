import type { ByteRange } from "../text/source-text.js";

/** An anchor that names a node of the value view: one written on the node, or the one derived from its heading. */
export interface NodeAnchor {
  readonly name: string;
  readonly kind: "explicit" | "derived";
  /** The exact path of the node. */
  readonly at: string;
  /**
   * For a derived anchor, its heading's slug, which the anchor is with its repeat suffix, if any: `notes` for `notes-1`. Two
   * headings whose derived anchors share a slug renumber each other when either changes.
   */
  readonly slug?: string;
}

/** An anchor that names a paragraph or a list item of a `$body`: a range of the `$body`'s text, not a node. */
export interface BlockAnchorEntry {
  readonly name: string;
  readonly kind: "block";
  /** The exact path of the `$body` that holds the block. */
  readonly at: string;
  /** The block in the `$body`'s value, in UTF-8 bytes of the value, whose line breaks are `\n`. */
  readonly range: ByteRange;
  /** The block in the file, in UTF-8 bytes. */
  readonly fileRange: ByteRange;
}

/** An anchor of a record, of any kind. */
export type AnchorEntry = NodeAnchor | BlockAnchorEntry;

/** A tag on a node: one entry per tag and node, however often the node repeats the tag. */
export interface TagEntry {
  readonly tag: string;
  /** The exact path of the node. */
  readonly at: string;
}

/**
 * The anchors and tags of a parsed record. Explicit, derived and block anchors share one namespace, so a name may have
 * several entries: a node's explicit and derived anchor of the same name, or a duplicate anchor, which names several nodes
 * and is reported as an issue. It is immutable.
 */
export interface AnchorTable {
  /** Every anchor, in document order; a heading's explicit anchor comes before its derived anchor. */
  readonly anchors: readonly AnchorEntry[];
  /** Every tag, in document order of the nodes, and in its node's order of tags. */
  readonly tags: readonly TagEntry[];
  /** Returns the anchors with this name, compared by code point, in document order; an empty list for none. */
  named(name: string): readonly AnchorEntry[];
  /** Returns the explicit and derived anchors of the node at an exact path, in document order; an empty list for none. */
  of(at: string): readonly NodeAnchor[];
}

const NO_ENTRIES: readonly never[] = Object.freeze([]);

/** Freezes anchors and tags, given in document order, into a table. */
export function anchorTableOf(anchors: readonly AnchorEntry[], tags: readonly TagEntry[]): AnchorTable {
  const named = new Map<string, AnchorEntry[]>();
  const of = new Map<string, NodeAnchor[]>();
  const frozen = anchors.map((entry) => {
    const copy: AnchorEntry =
      entry.kind === "block"
        ? Object.freeze({ ...entry, range: Object.freeze({ ...entry.range }), fileRange: Object.freeze({ ...entry.fileRange }) })
        : Object.freeze({ ...entry });
    pushTo(named, copy.name, copy);
    if (copy.kind !== "block") pushTo(of, copy.at, copy);
    return copy;
  });
  for (const list of named.values()) Object.freeze(list);
  for (const list of of.values()) Object.freeze(list);
  const table: AnchorTable = {
    anchors: Object.freeze(frozen),
    tags: Object.freeze(tags.map((tag) => Object.freeze({ ...tag }))),
    named: (name) => named.get(name) ?? NO_ENTRIES,
    of: (at) => of.get(at) ?? NO_ENTRIES,
  };
  return Object.freeze(table);
}

function pushTo<Key, Item>(map: Map<Key, Item[]>, key: Key, item: Item): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [item]);
  } else {
    list.push(item);
  }
}
