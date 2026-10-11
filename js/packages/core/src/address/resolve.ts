import type { BlockAnchorEntry } from "../anchor/anchor-table.js";
import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import type { NodeInfo, SectionInfo } from "../record/node-index.js";
import type { ParsedRecord } from "../record/record.js";
import type { ByteRange } from "../text/source-text.js";
import { type AddressReading, encodeExactPath, type Fragment, formatFragment, parseAddress } from "./address.js";

// Deviation from the I1 design, recorded in issue #15: `at` and `address` are required, since every target that resolution
// gives is a node or a block anchor of a record. The targets of references that are assets or directories, which have a path
// alone, come with references.
/** What an address resolves to: a node of a record, or a block anchor, which is a range of a `$body`. */
export interface Target {
  /** The store path of the record. */
  readonly path: string;
  /** The exact path of the node; for a block anchor, of the `$body` that holds it. */
  readonly at: string;
  /** The node's canonical address, as a fragment with its `#`, or `""` for the root. */
  readonly address: string;
  /** For a block anchor, its block in the `$body`'s value, in UTF-8 bytes. */
  readonly range?: ByteRange;
}

/**
 * How an address is used: as a singular address, which must name exactly one node, as a reference or a write target does; or
 * as a selector, which names every node it matches.
 */
export type AddressUse = "singular" | "selector";

// Deviation from the specification, recorded in issue #15: `address-not-singular`, the proof before evaluation that a singular
// address crosses only levels whose keys are unique, needs schemas, whose `multimap` levels are the only ones it can reject.
// Until schemas come, a singular address is only evaluated, so a duplicate it meets is `address-ambiguous`.
/**
 * Resolves a fragment in a record: an exact path to the node of that JSON Pointer, and a semantic path step by step. A step
 * matches, in a section, a member (a field or a section member) of that name and each child section with that key; in an
 * object, the member of that name; in `$sections`, each section with that key, never an index; in another array, the item at
 * a decimal index without leading zeros. The first step also matches every anchor of that name, of any kind; a block anchor
 * is a range of its `$body` and no later step goes into it. A node that a step matches several ways is one match.
 *
 * As a selector, the result is every match, possibly none. As a singular address it is exactly one target, and the outcome
 * fails with `address-ambiguous` when a step matches several nodes, even when a later step would leave one: evaluation stops
 * there, and the candidates are that step's matches. It fails with `address-not-found` when nothing matches. Issues have the
 * record's path and no node.
 */
export function resolveAddress(record: ParsedRecord, fragment: Fragment | null, use: AddressUse): Outcome<readonly Target[]> {
  const resolver = resolverOf(record);
  const evaluated = resolver.evaluate(fragment, use === "singular");
  const shown = `${record.path}${formatFragment(fragment)}`;
  if (evaluated.ambiguous) {
    const candidates = evaluated.matches.map((match) => resolver.target(match));
    const steps = fragment?.kind === "semantic" ? fragment.steps : [];
    const step = steps[evaluated.steps - 1] as string;
    return fail([
      makeIssue({
        code: "address-ambiguous",
        path: record.path,
        at: null,
        message: `${shown}: its step ${evaluated.steps}, ${JSON.stringify(step)}, matches ${candidates.length} nodes`,
        hint:
          evaluated.steps === steps.length
            ? "use the address of the candidate you mean, or give it an explicit anchor"
            : "the candidates are what that step matches; address the one you mean, or give it an explicit anchor",
        candidates,
      }),
    ]);
  }
  if (use === "singular" && evaluated.matches.length === 0) {
    return fail([makeIssue({ code: "address-not-found", path: record.path, at: null, message: `${shown} matches no node` })]);
  }
  return succeed(Object.freeze(evaluated.matches.map((match) => resolver.target(match))));
}

/**
 * Gives the canonical address of the node at an exact path, as a fragment with its `#`: `""` for the root, and otherwise the
 * first of these that, used as a singular address, resolves to that node: its explicit anchor; the semantic path from its
 * nearest ancestor with an explicit anchor, the root never counting, or else from the root; its derived anchor; and last its
 * exact path, which always does. A form with an empty step is skipped. The address is percent-encoded.
 *
 * Throws a `RangeError` when the record has no node at `at`.
 */
export function canonicalAddress(record: ParsedRecord, at: string): string {
  const resolver = resolverOf(record);
  const node = record.nodes.node(at);
  if (node === undefined) throw new RangeError(`no node at ${JSON.stringify(at)}`);
  return resolver.canonical(node);
}

/**
 * Gives the canonical address of a block anchor of the record: its name, when that resolves as a singular address to this
 * block, and otherwise the canonical address of the `$body` that holds it.
 *
 * Throws a `RangeError` for an entry that is not one of the entries of the record's anchor table.
 */
export function blockAnchorAddress(record: ParsedRecord, entry: BlockAnchorEntry): string {
  if (!record.anchors.named(entry.name).includes(entry)) {
    throw new RangeError(`the block anchor ${JSON.stringify(entry.name)} is not an entry of the record's anchor table`);
  }
  return resolverOf(record).canonical(entry);
}

/** Reads the record at a store path: its parse outcome, or null when the store holds no record there. */
export type RecordLookup = (path: string) => Promise<Outcome<ParsedRecord> | null>;

/** What an address resolved to in a store: the record it names, as the lookup read it, and the targets in it. */
export interface StoreResolution {
  readonly record: ParsedRecord;
  readonly targets: readonly Target[];
}

/**
 * Resolves an address in the record it names, which `lookup` reads, as {@link resolveAddress} does. Fails with
 * `address-malformed` for an address that does not read, before any lookup; with `address-not-found` for a record the store
 * does not hold, as a singular address and as a selector; and with the lookup's issues when it fails, such as a record's
 * structural errors, whatever the fragment. On success it gives the record the lookup read with the targets, so that a caller
 * reads their values and computed fields without a second lookup.
 */
export async function resolveStoreAddress(
  lookup: RecordLookup,
  address: string,
  use: AddressUse,
  reading?: AddressReading,
): Promise<Outcome<StoreResolution>> {
  const parsed = parseAddress(address, reading);
  if (!parsed.ok) return fail(parsed.issues);
  const { record, fragment } = parsed.value;
  const loaded = await lookup(record);
  if (loaded === null) {
    return fail([
      makeIssue({ code: "address-not-found", path: record, at: null, message: `the store holds no record ${record}` }),
    ]);
  }
  if (!loaded.ok) return fail(loaded.issues);
  const resolved = resolveAddress(loaded.value, fragment, use);
  return resolved.ok ? succeed(Object.freeze({ record: loaded.value, targets: resolved.value })) : fail(resolved.issues);
}

/** What a step can match: a node of the value view, or a block anchor. */
type Match = NodeInfo | BlockAnchorEntry;

/** What evaluating a fragment found: its matches, or, for a singular address, the matches of the step that had several. */
interface Evaluation {
  readonly matches: readonly Match[];
  readonly ambiguous: boolean;
  /** How many steps of a semantic path were evaluated, from 1; 0 for an exact path or the root. */
  readonly steps: number;
}

/**
 * Keeps the first of each match, in order. The index and the anchor table give one object per node and per entry, so a node
 * that a key and an anchor both name is one match.
 */
function distinct(matches: readonly Match[]): Match[] {
  return [...new Set(matches)];
}

const resolvers = new WeakMap<ParsedRecord, RecordResolver>();

/** Gives the resolver of a record, made once per record. */
function resolverOf(record: ParsedRecord): RecordResolver {
  let resolver = resolvers.get(record);
  if (resolver === undefined) {
    resolver = new RecordResolver(record);
    resolvers.set(record, resolver);
  }
  return resolver;
}

/**
 * Resolution over one record, with the maps it builds as it goes: each section's child sections by key, and the canonical
 * address of each match. A record is immutable, so they never go stale.
 */
class RecordResolver {
  readonly #record: ParsedRecord;
  readonly #root: NodeInfo;
  readonly #childSections = new Map<string, ReadonlyMap<string, readonly SectionInfo[]>>();
  readonly #canonical = new Map<Match, string>();

  constructor(record: ParsedRecord) {
    this.#record = record;
    this.#root = record.nodes.node("") as NodeInfo;
  }

  /** Evaluates a fragment; a singular evaluation stops at the first step that matches several nodes. */
  evaluate(fragment: Fragment | null, singular: boolean): Evaluation {
    if (fragment === null) return { matches: [this.#root], ambiguous: false, steps: 0 };
    if (fragment.kind === "exact") {
      const at = fragment.tokens.reduce<string>((parent, token) => childPath(parent, token), "");
      const node = this.#record.nodes.node(at);
      return { matches: node === undefined ? [] : [node], ambiguous: false, steps: 0 };
    }
    const [first, ...rest] = fragment.steps;
    let matches: Match[] = distinct(this.#firstStep(first as string));
    let steps = 1;
    for (const step of rest) {
      if (singular && matches.length > 1) break;
      matches = distinct(matches.flatMap((match) => (match.kind === "block" ? [] : this.#step(match, step))));
      steps++;
    }
    return { matches, ambiguous: singular && matches.length > 1, steps };
  }

  /** Gives a match as a target. */
  target(match: Match): Target {
    const address = this.canonical(match);
    return match.kind === "block"
      ? Object.freeze({ path: this.#record.path, at: match.at, address, range: match.range })
      : Object.freeze({ path: this.#record.path, at: match.at, address });
  }

  /** Gives the canonical address of a match. */
  canonical(match: Match): string {
    let address = this.#canonical.get(match);
    if (address === undefined) {
      address = this.#canonicalOf(match);
      this.#canonical.set(match, address);
    }
    return address;
  }

  #canonicalOf(match: Match): string {
    if (match.kind === "block") {
      if (this.#namesOnly([match.name], match)) return formatFragment({ kind: "semantic", steps: [match.name] });
      return this.canonical(this.#record.nodes.node(match.at) as NodeInfo);
    }
    if (match.at === "") return "";
    const anchors = this.#record.anchors.of(match.at);
    const forms = [
      anchors.find((anchor) => anchor.kind === "explicit")?.name,
      this.#pathFromAnchoredAncestor(match),
      anchors.find((anchor) => anchor.kind === "derived")?.name,
    ];
    for (const form of forms) {
      if (form === undefined) continue;
      const steps = typeof form === "string" ? [form] : form;
      if (steps.length > 0 && !steps.includes("") && this.#namesOnly(steps, match)) {
        return formatFragment({ kind: "semantic", steps });
      }
    }
    return `#${encodeExactPath(match.at)}`;
  }

  /** Whether `steps`, as a singular address, resolve to `match` and nothing else. */
  #namesOnly(steps: readonly string[], match: Match): boolean {
    const evaluated = this.evaluate({ kind: "semantic", steps }, true);
    return !evaluated.ambiguous && evaluated.matches.length === 1 && evaluated.matches[0] === match;
  }

  /** The semantic path to a node from its nearest ancestor with an explicit anchor, which it starts with, or from the root. */
  #pathFromAnchoredAncestor(node: NodeInfo): readonly string[] {
    const nodes = this.#record.nodes;
    const steps: string[] = [];
    let current = node;
    for (;;) {
      let up: NodeInfo;
      if (current.kind === "section") {
        steps.push(this.#record.sectionKeys.get(current.at) as string);
        up = nodes.node(nodes.node(current.parent as string)?.parent as string) as NodeInfo;
      } else {
        steps.push(String(current.key));
        up = nodes.node(current.parent as string) as NodeInfo;
      }
      if (up.at === "") break;
      const anchor = this.#record.anchors.of(up.at).find((entry) => entry.kind === "explicit");
      if (anchor !== undefined) {
        steps.push(anchor.name);
        break;
      }
      current = up;
    }
    return steps.reverse();
  }

  /** The matches of a first step: those of a step from the root, and every anchor of that name. */
  #firstStep(step: string): Match[] {
    const nodes = this.#record.nodes;
    const anchored = this.#record.anchors
      .named(step)
      .map((entry): Match => (entry.kind === "block" ? entry : (nodes.node(entry.at) as NodeInfo)));
    return [...this.#step(this.#root, step), ...anchored];
  }

  /** The nodes that a step other than the first matches from a node. */
  #step(node: NodeInfo, step: string): NodeInfo[] {
    const nodes = this.#record.nodes;
    switch (node.kind) {
      case "section": {
        const member = nodes.node(childPath(node.at, step));
        const sections = this.#sectionsByKey(node).get(step) ?? [];
        return member === undefined ? [...sections] : [member, ...sections];
      }
      case "array": {
        const holder = node.parent === null ? undefined : nodes.node(node.parent);
        if (node.key === "$sections" && holder?.kind === "section") return [...(this.#sectionsByKey(holder).get(step) ?? [])];
        // The index names an item by its index in decimal without leading zeros, so a step names an item exactly when it is
        // RFC 6901's array index: `01`, `-`, `1e0` and a number too large to be exact name none.
        const item = nodes.node(childPath(node.at, step));
        return item === undefined ? [] : [item];
      }
      case "object": {
        const member = nodes.node(childPath(node.at, step));
        return member === undefined ? [] : [member];
      }
      default:
        return [];
    }
  }

  /** The child sections of a section, by key, each key's in document order. */
  #sectionsByKey(section: NodeInfo): ReadonlyMap<string, readonly SectionInfo[]> {
    let byKey = this.#childSections.get(section.at);
    if (byKey === undefined) {
      const map = new Map<string, SectionInfo[]>();
      for (const child of this.#record.nodes.children(childPath(section.at, "$sections"))) {
        if (child.kind !== "section") continue;
        const key = this.#record.sectionKeys.get(child.at) as string;
        const list = map.get(key);
        if (list === undefined) map.set(key, [child]);
        else list.push(child);
      }
      byKey = map;
      this.#childSections.set(section.at, byKey);
    }
    return byKey;
  }
}
