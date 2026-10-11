import { type AnchorEntry, anchorTableOf, type BlockAnchorEntry, type TagEntry } from "../anchor/anchor-table.js";
import { isAnchorName } from "../anchor/slug.js";
import { titleSlugOf } from "../anchor/title-slug.js";
import type { BlockAnchor } from "../format/markdown/body.js";
import { definitionLabelsIn } from "../format/markdown/library.js";
import type { IssueCode } from "../issue/codes.js";
import { type Issue, makeIssue, repeatedNodes } from "../issue/issue.js";
import type { Value, ValueObject } from "../value/value.js";
import { documentOrderOf } from "./document-order.js";
import { childPath } from "./exact-path.js";
import type { NodeInfo } from "./node-index.js";
import type { ParsedRecord } from "./record.js";

/** What a Markdown record adds to its value and index for the names of its nodes. */
export interface MarkdownNames {
  /** The slug of each heading, by the exact path of its section, `""` for the title heading. */
  readonly headingSlugs: ReadonlyMap<string, string>;
  /** The block anchors of every `$body`, in document order. */
  readonly blockAnchors: readonly BlockAnchor[];
}

/** A parsed record before its names are read. */
export type UnnamedRecord = Omit<ParsedRecord, "anchors" | "sectionKeys">;

// Deviation from the I1 design, recorded in issue #14: explicit anchors and tags are read from the value view for every
// format, and ordered by the index's document order, so no Markdown heading carries its anchor beside its visible text.
/**
 * Completes a parsed record with its names: its anchor table, its section keys, and the validation issues they raise, added
 * after the record's own issues.
 *
 * - **Anchors.** An explicit anchor is the `$anchor` of a section or of any object in a field's value; the root's `$schema` is
 *   stored data and is not looked into. A Markdown heading's derived anchor is the one its section's heading has in the index,
 *   and its block anchors are those of `markdown`. Every anchor is in one namespace.
 * - **Tags** are the `$tags` of the same objects, each once per node.
 * - **Section keys.** A section's key is its `$anchor`, or else its slug: a Markdown heading's slug, from `markdown`, or for a
 *   JSON or YAML section the slug of its `$title` read as a heading's inline content, with the link reference definitions of
 *   every section's `$body` in scope.
 * - **`anchor-invalid`**, an error, at the node, for each anchor and each occurrence of a tag that is not a valid name, so a
 *   tag repeated in a `$tags` array is reported at each place; for a block anchor, at the `$body` that holds it, with the
 *   block's offset in it.
 * - **`duplicate-anchor`**, an error, for each node, block anchors included, that an anchor names after an earlier node in
 *   document order has the same anchor, once per node however many of its anchors repeat.
 * - **`duplicate-key`**, an error, for each node of a section's namespace, its fields and its child sections, whose name or key
 *   an earlier node of that namespace in document order has.
 *
 * Document order is the pre-order of the value view: a node comes before its descendants, so the root comes before its
 * front matter, and siblings come in their order in the file. A block anchor comes where its `$body` does, and the blocks of
 * one `$body` in their order. Severities are the defaults; the uniqueness mode is not applied here.
 *
 * Throws an `Error` when the value has a node the index lacks, which is a bug in the parser.
 */
export function nameRecord(record: UnnamedRecord, markdown?: MarkdownNames): ParsedRecord {
  const names = new RecordNames(record, markdown);
  const { anchors, tags } = names.anchorsAndTags();
  const sectionKeys = names.sectionKeys();
  // The walks keep their own stacks, so their issues are put in the file's order here; a stable sort keeps the order of
  // issues at one place.
  const issues = names.issues.sort((a, b) => (a.position?.offset ?? 0) - (b.position?.offset ?? 0));
  return {
    ...record,
    anchors: anchorTableOf(anchors, tags),
    sectionKeys: frozenMapOf(sectionKeys),
    issues: [...record.issues, ...issues],
  };
}

/** An anchor with its place in document order. */
interface PlacedAnchor {
  readonly entry: AnchorEntry;
  /** The place in document order of the node it names, or of the `$body` that holds its block. */
  readonly order: number;
}

/** A tag with the place of its node in document order. */
interface PlacedTag {
  readonly entry: TagEntry;
  readonly order: number;
}

/** The walk of one record's value and index that finds its names and the issues they raise. */
class RecordNames {
  readonly issues: Issue[] = [];
  readonly #record: UnnamedRecord;
  readonly #markdown: MarkdownNames | undefined;
  #labels: readonly string[] | null = null;

  constructor(record: UnnamedRecord, markdown: MarkdownNames | undefined) {
    this.#record = record;
    this.#markdown = markdown;
  }

  /** Finds every anchor and tag, in document order, and raises `anchor-invalid` and `duplicate-anchor`. */
  anchorsAndTags(): { anchors: AnchorEntry[]; tags: TagEntry[] } {
    const anchors: PlacedAnchor[] = [];
    const tags: PlacedTag[] = [];
    const label = (object: ValueObject, at: string) => {
      const order = this.#order(at);
      const anchor = object.$anchor;
      if (typeof anchor === "string") {
        anchors.push({ entry: { name: anchor, kind: "explicit", at }, order });
        if (!isAnchorName(anchor)) {
          this.#raise("anchor-invalid", at, `the anchor ${JSON.stringify(anchor)} is not a name`, childPath(at, "$anchor"));
        }
      }
      const tagList = object.$tags;
      if (Array.isArray(tagList)) {
        const seen = new Set<string>();
        tagList.forEach((tag: Value, index: number) => {
          if (typeof tag !== "string") return;
          if (!seen.has(tag)) tags.push({ entry: { tag, at }, order });
          seen.add(tag);
          if (!isAnchorName(tag)) {
            const tagAt = childPath(childPath(at, "$tags"), index);
            this.#raise("anchor-invalid", at, `the tag ${JSON.stringify(tag)} is not a name`, tagAt);
          }
        });
      }
    };

    // Sections and field values, by an explicit stack: nesting is bounded per parse unit, not per record.
    const pending: { readonly value: Value; readonly at: string; readonly section: boolean }[] = [
      { value: this.#record.value, at: "", section: true },
    ];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const { value, at, section } = next;
      if (Array.isArray(value)) {
        value.forEach((item: Value, index: number) => {
          pending.push({ value: item, at: childPath(at, index), section: false });
        });
        continue;
      }
      if (!isObject(value)) continue;
      label(value, at);
      for (const [name, member] of Object.entries(value)) {
        if (name === "$anchor" || name === "$tags") continue;
        if (section && name === "$sections" && Array.isArray(member)) {
          const sectionsAt = childPath(at, name);
          member.forEach((item: Value, index: number) => {
            pending.push({ value: item, at: childPath(sectionsAt, index), section: true });
          });
        } else if (!section || !name.startsWith("$")) {
          pending.push({ value: member, at: childPath(at, name), section: false });
        }
      }
    }

    for (const section of this.#record.nodes.sections()) {
      const derived = section.heading?.derivedAnchor ?? null;
      if (derived !== null) {
        anchors.push({ entry: { name: derived, kind: "derived", at: section.at }, order: this.#order(section.at) });
      }
    }
    for (const block of this.#markdown?.blockAnchors ?? []) {
      const entry: BlockAnchorEntry = { ...block, kind: "block" };
      anchors.push({ entry, order: this.#order(block.at) });
      if (!isAnchorName(block.name)) {
        const message = `the block anchor ${JSON.stringify(block.name)} is not a name`;
        this.#raiseAtBlock("anchor-invalid", block, message);
      }
    }

    // A stable sort keeps a heading's explicit anchor before its derived one, a node's tags in its order, and the block
    // anchors of one `$body` in the order the parser found them, which is theirs in the file.
    anchors.sort((a, b) => a.order - b.order);
    tags.sort((a, b) => a.order - b.order);
    this.#duplicateAnchors(anchors.map((placed) => placed.entry));
    return { anchors: anchors.map((placed) => placed.entry), tags: tags.map((placed) => placed.entry) };
  }

  /** Gives every section but the root its key, and raises `duplicate-key` in each section's namespace. */
  sectionKeys(): Map<string, string> {
    const keys = new Map<string, string>();
    const pending: { readonly section: ValueObject; readonly at: string }[] = [{ section: this.#record.value, at: "" }];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const { section, at } = next;
      const namespace: { name: string; node: string; offset: number }[] = [];
      for (const name of Object.keys(section)) {
        if (name.startsWith("$")) continue;
        const memberAt = childPath(at, name);
        const node = this.#node(memberAt);
        namespace.push({ name, node: memberAt, offset: (node.memberRange ?? node.range).start });
      }
      const children = section.$sections;
      if (Array.isArray(children)) {
        const sectionsAt = childPath(at, "$sections");
        children.forEach((child: Value, index: number) => {
          if (!isObject(child)) return;
          const childAt = childPath(sectionsAt, index);
          const key = this.#keyOf(child, childAt);
          keys.set(childAt, key);
          namespace.push({ name: key, node: childAt, offset: this.#node(childAt).range.start });
          pending.push({ section: child, at: childAt });
        });
      }
      namespace.sort((a, b) => a.offset - b.offset);
      const firstNodeOf = new Map<string, string>();
      for (const { name, node } of namespace) if (!firstNodeOf.has(name)) firstNodeOf.set(name, node);
      const byNode = new Map(namespace.map((entry) => [entry.node, entry.name]));
      for (const node of repeatedNodes(namespace)) {
        const name = byNode.get(node) as string;
        const message = `the key ${JSON.stringify(name)} is also the name or key of ${firstNodeOf.get(name)} in the same section`;
        this.#raise("duplicate-key", node, message, node);
      }
    }
    return keys;
  }

  /** The key of a section other than the root: its `$anchor`, or else its slug. */
  #keyOf(section: ValueObject, at: string): string {
    if (typeof section.$anchor === "string") return section.$anchor;
    if (this.#markdown !== undefined) {
      const slug = this.#markdown.headingSlugs.get(at);
      if (slug === undefined) throw new Error(`no heading slug for the section at ${JSON.stringify(at)}`);
      return slug;
    }
    const title = typeof section.$title === "string" ? section.$title : "";
    // Only a link reference has a label to look up, and it holds a `[`.
    return titleSlugOf(title, title.includes("[") ? this.#definitionLabels() : []);
  }

  /** The labels of the link reference definitions in every section's `$body`, found on the first call. */
  #definitionLabels(): readonly string[] {
    if (this.#labels === null) {
      const labels: string[] = [];
      const pending: Value[] = [this.#record.value];
      for (let section = pending.pop(); section !== undefined; section = pending.pop()) {
        if (!isObject(section)) continue;
        if (typeof section.$body === "string") labels.push(...definitionLabelsIn(section.$body));
        if (Array.isArray(section.$sections)) pending.push(...section.$sections);
      }
      this.#labels = labels;
    }
    return this.#labels;
  }

  /** The place of the node at `at` in document order. */
  #order(at: string): number {
    const order = documentOrderOf(this.#record.nodes).get(at);
    if (order === undefined) throw new Error(`the value has a node at ${JSON.stringify(at)} that the index lacks`);
    return order;
  }

  /** Raises one `duplicate-anchor` for each node that an anchor names after an earlier node with that anchor. */
  #duplicateAnchors(anchors: readonly AnchorEntry[]): void {
    // A block anchor is its own node, although it shares the exact path of its `$body`, so its entry is its identity.
    const identity = (entry: AnchorEntry): AnchorEntry | string => (entry.kind === "block" ? entry : entry.at);
    const firstOf = new Map<string, AnchorEntry>();
    for (const entry of anchors) if (!firstOf.has(entry.name)) firstOf.set(entry.name, entry);
    const occurrences = anchors.map((entry) => ({ name: entry.name, node: identity(entry) }));
    for (const node of repeatedNodes(occurrences)) {
      const own = anchors.filter((entry) => identity(entry) === node);
      const repeat = own.find((entry) => identity(firstOf.get(entry.name) as AnchorEntry) !== node) as AnchorEntry;
      const earlier = firstOf.get(repeat.name) as AnchorEntry;
      const message = `the anchor ${JSON.stringify(repeat.name)} also names an earlier node, at ${JSON.stringify(earlier.at)}`;
      if (typeof node === "string") {
        this.#raise("duplicate-anchor", node, message, node);
      } else {
        this.#raiseAtBlock("duplicate-anchor", node as BlockAnchorEntry, message);
      }
    }
  }

  /** The offset in the file from which the node at `at` is ordered: its heading's start, or its range's. */
  #orderOffset(at: string): number {
    const node = this.#node(at);
    return node.kind === "section" && node.heading !== null ? node.heading.range.start : node.range.start;
  }

  #node(at: string): NodeInfo {
    const node = this.#record.nodes.node(at);
    if (node === undefined) throw new Error(`the value has a node at ${JSON.stringify(at)} that the index lacks`);
    return node;
  }

  /** Raises an issue at `at`, positioned at the node `placeAt`: its member's start, or its heading's, or its range's. */
  #raise(code: IssueCode, at: string, message: string, placeAt: string): void {
    const node = this.#node(placeAt);
    const offset = node.memberRange?.start ?? this.#orderOffset(placeAt);
    const { path, source } = this.#record;
    this.issues.push(makeIssue({ code, path, at, message, position: source.position(offset) }));
  }

  /** Raises an issue on a block anchor: at the `$body` that holds it, positioned at the block, with its offset in the body. */
  #raiseAtBlock(code: IssueCode, block: BlockAnchor, message: string): void {
    const { path, source } = this.#record;
    const position = source.position(block.fileRange.start);
    this.issues.push(makeIssue({ code, path, at: block.at, message, position, offset: block.range.start }));
  }
}

/** The maps that {@link frozenMapOf} has made, which refuse every change. */
const FROZEN_MAPS = new WeakSet<Map<unknown, unknown>>();

/** A map that throws a `TypeError` on `set`, `delete` and `clear` once built, so that a record's keys stay as parsed. */
class FrozenMap<Key, Item> extends Map<Key, Item> {
  override set(key: Key, item: Item): this {
    if (FROZEN_MAPS.has(this)) throw new TypeError("the map is frozen");
    return super.set(key, item);
  }

  override delete(_key: Key): boolean {
    throw new TypeError("the map is frozen");
  }

  override clear(): void {
    throw new TypeError("the map is frozen");
  }
}

/** Copies a map into one that refuses every change, and freezes the object too. */
function frozenMapOf<Key, Item>(map: ReadonlyMap<Key, Item>): ReadonlyMap<Key, Item> {
  const frozen = new FrozenMap(map);
  FROZEN_MAPS.add(frozen);
  return Object.freeze(frozen);
}

function isObject(value: Value): value is ValueObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
