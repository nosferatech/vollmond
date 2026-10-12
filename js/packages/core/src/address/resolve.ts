import type { BlockAnchorEntry } from "../anchor/anchor-table.js";
import type { KeyedList, RecordBinding } from "../binding/binding.js";
import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { documentOrderOf } from "../record/document-order.js";
import { childPath } from "../record/exact-path.js";
import type { NodeInfo, SectionInfo } from "../record/node-index.js";
import type { ParsedRecord } from "../record/record.js";
import type { ByteRange } from "../text/source-text.js";
import { type AddressReading, encodeExactPath, type Fragment, formatFragment, parseAddress } from "./address.js";
import { proveSingular, unprovableStep } from "./prove.js";

/**
 * What an address is resolved in: a record bound to its collection's schema, whose keyed lists steps go through and whose
 * declarations decide what is singular, or a parsed record alone, resolved as a record without a schema is.
 */
export type ResolutionSubject = ParsedRecord | RecordBinding;

/** Gives the binding of a subject, or null for a record alone. */
export function subjectBinding(subject: ResolutionSubject): RecordBinding | null {
  return "lists" in subject ? subject : null;
}

/** Gives the parsed record of a subject. */
export function subjectRecord(subject: ResolutionSubject): ParsedRecord {
  return "lists" in subject ? subject.record : subject;
}

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
 * How a step of a semantic path matched a node: a field or a member of an object (`member`); a section member such as
 * `$title` (`section-member`); a child section by a key that is its `$anchor` (`key-explicit`) or the slug of its title
 * (`key-title`); a keyed list's item by its key (`list-key`); an array item by its index (`index`); or, for the first step, an
 * explicit, a derived or a block anchor. A step that matches one node in several ways has each.
 */
export type StepMatch =
  | "member"
  | "section-member"
  | "key-explicit"
  | "key-title"
  | "list-key"
  | "index"
  | "anchor-explicit"
  | "anchor-derived"
  | "anchor-block";

// Deviation from the I2 design, recorded in issue #24: the steps of an exact path are not reported yet; their first use, the
// refusal of positional steps under `anchors: explicit`, comes with typed references.
/** The targets of an address, and how each step of a semantic path matched. */
export interface StepResolution {
  readonly targets: readonly Target[];
  /**
   * For a semantic path used as a singular address, how each step matched the one node it matched, a list per step; empty for
   * an exact path, the root, and a selector.
   */
  readonly steps: readonly (readonly StepMatch[])[];
}

/**
 * How an address is used: as a singular address, which must name exactly one node, as a reference or a write target does; or
 * as a selector, which names every node it matches.
 */
export type AddressUse = "singular" | "selector";

/**
 * Resolves a fragment in a record: an exact path to the node of that JSON Pointer, and a semantic path step by step. A step
 * matches, in a section, a member (a field or a section member) of that name and each child section with that key; in an
 * object, the member of that name; in `$sections`, each section with that key, never an index; in an array the binding
 * makes a keyed list, each item with that key, never an index; in another array, the item at a decimal index without leading
 * zeros. The first step also matches every anchor of that name, of any kind; a block anchor is a range of its `$body` and no
 * later step goes into it. A node that a step matches several ways is one match.
 *
 * As a selector, the result is every match, possibly none, in document order: the pre-order of the value view, a block anchor
 * after the `$body` that holds it. As a singular address it is exactly one target. In a bound record it is first proved
 * singular from the schema, and fails with `address-not-singular` when a step could cross a level declared `multimap`. It
 * fails with `address-ambiguous` when a step matches several nodes, even when a later step would leave one: evaluation stops
 * there, and the candidates are that step's matches, in document order. It fails with `address-not-found` when nothing
 * matches. Issues have the record's path and no node.
 */
export function resolveAddress(
  subject: ResolutionSubject,
  fragment: Fragment | null,
  use: AddressUse,
): Outcome<readonly Target[]> {
  const resolved = resolveAddressSteps(subject, fragment, use);
  return resolved.ok ? succeed(resolved.value.targets) : resolved;
}

/** Resolves a fragment in a record as {@link resolveAddress} does, and also gives how each step matched. */
export function resolveAddressSteps(
  subject: ResolutionSubject,
  fragment: Fragment | null,
  use: AddressUse,
): Outcome<StepResolution> {
  const binding = subjectBinding(subject);
  if (use === "singular" && binding !== null) {
    const proof = proveSingular(binding, fragment);
    if (!proof.ok) return fail(proof.issues);
  }
  const record = subjectRecord(subject);
  const resolver = resolverOf(subject);
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
  const targets = Object.freeze(evaluated.matches.map((match) => resolver.target(match)));
  const steps = use === "singular" && fragment?.kind === "semantic" ? evaluated.ways : [];
  return succeed(Object.freeze({ targets, steps: Object.freeze(steps) }));
}

/**
 * Gives the canonical address of the node at an exact path, as a fragment with its `#`: `""` for the root, and otherwise the
 * first of these that, used as a singular address, resolves to that node: its explicit anchor; the semantic path from its
 * nearest ancestor with an explicit anchor, the root never counting, or else from the root; its derived anchor; and last its
 * exact path, which always does. A form with an empty step is skipped. The address is percent-encoded. In a bound record a
 * form must also be proved singular, and an item of a keyed list is named by its key.
 *
 * Throws a `RangeError` when the record has no node at `at`.
 */
export function canonicalAddress(subject: ResolutionSubject, at: string): string {
  const resolver = resolverOf(subject);
  const node = subjectRecord(subject).nodes.node(at);
  if (node === undefined) throw new RangeError(`no node at ${JSON.stringify(at)}`);
  return resolver.canonical(node);
}

/**
 * Gives the canonical address of a block anchor of the record: its name, when that resolves as a singular address to this
 * block, and otherwise the canonical address of the `$body` that holds it.
 *
 * Throws a `RangeError` for an entry that is not one of the entries of the record's anchor table.
 */
export function blockAnchorAddress(subject: ResolutionSubject, entry: BlockAnchorEntry): string {
  if (!subjectRecord(subject).anchors.named(entry.name).includes(entry)) {
    throw new RangeError(`the block anchor ${JSON.stringify(entry.name)} is not an entry of the record's anchor table`);
  }
  return resolverOf(subject).canonical(entry);
}

/**
 * Reads the record at a store path: its parse outcome, or its binding to its collection's schema, or null when the store holds
 * no record there.
 */
export type RecordLookup = (path: string) => Promise<Outcome<ResolutionSubject> | null>;

/** What an address resolved to in a store: the record it names, as the lookup read it, and the targets in it. */
export interface StoreResolution {
  readonly record: ParsedRecord;
  /** The record's binding, when the lookup gave one. */
  readonly binding?: RecordBinding;
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
  if (!resolved.ok) return fail(resolved.issues);
  const binding = subjectBinding(loaded.value);
  return succeed(
    Object.freeze({
      record: subjectRecord(loaded.value),
      ...(binding === null ? {} : { binding }),
      targets: resolved.value,
    }),
  );
}

/** What a step can match: a node of the value view, or a block anchor. */
type Match = NodeInfo | BlockAnchorEntry;

/** What evaluating a fragment found: its matches, or, for a singular address, the matches of the step that had several. */
interface Evaluation {
  readonly matches: readonly Match[];
  readonly ambiguous: boolean;
  /** How many steps of a semantic path were evaluated, from 1; 0 for an exact path or the root. */
  readonly steps: number;
  /** For each step of a semantic path, from the first, that matched one node, how it matched; up to the first that did not. */
  readonly ways: readonly (readonly StepMatch[])[];
}

/** A node or a block anchor that a step matched, and how. */
interface StepFind {
  readonly match: Match;
  readonly way: StepMatch;
}

/**
 * Groups what a step found by match, in the order of each match's first find, with each way once. The index and the anchor
 * table give one object per node and per entry, so a node that a key and an anchor both name is one match.
 */
function grouped(finds: readonly StepFind[]): Map<Match, StepMatch[]> {
  const byMatch = new Map<Match, StepMatch[]>();
  for (const { match, way } of finds) {
    const ways = byMatch.get(match);
    if (ways === undefined) {
      byMatch.set(match, [way]);
    } else if (!ways.includes(way)) {
      ways.push(way);
    }
  }
  return byMatch;
}

const resolvers = new WeakMap<ResolutionSubject, RecordResolver>();

/** Gives the resolver of a record or a binding, made once for each. */
function resolverOf(subject: ResolutionSubject): RecordResolver {
  let resolver = resolvers.get(subject);
  if (resolver === undefined) {
    resolver = new RecordResolver(subjectRecord(subject), subjectBinding(subject));
    resolvers.set(subject, resolver);
  }
  return resolver;
}

/**
 * Resolution over one record, with the maps it builds as it goes: each section's child sections by key, and the canonical
 * address of each match. A record is immutable, so they never go stale.
 */
class RecordResolver {
  readonly #record: ParsedRecord;
  readonly #binding: RecordBinding | null;
  readonly #root: NodeInfo;
  readonly #childSections = new Map<string, ReadonlyMap<string, readonly SectionInfo[]>>();
  readonly #canonical = new Map<Match, string>();

  constructor(record: ParsedRecord, binding: RecordBinding | null) {
    this.#record = record;
    this.#binding = binding;
    this.#root = record.nodes.node("") as NodeInfo;
  }

  /** The keyed list a schema declares at an array, which a step goes through by key; undefined for any other array. */
  #declaredList(at: string): KeyedList | undefined {
    const list = this.#binding?.lists.get(at);
    return list === undefined || list.type === "undeclared" ? undefined : list;
  }

  /** Evaluates a fragment; a singular evaluation stops at the first step that matches several nodes. */
  evaluate(fragment: Fragment | null, singular: boolean): Evaluation {
    if (fragment === null) return { matches: [this.#root], ambiguous: false, steps: 0, ways: [] };
    if (fragment.kind === "exact") {
      const at = fragment.tokens.reduce<string>((parent, token) => childPath(parent, token), "");
      const node = this.#record.nodes.node(at);
      return { matches: node === undefined ? [] : [node], ambiguous: false, steps: 0, ways: [] };
    }
    const [first, ...rest] = fragment.steps;
    let found = this.#inDocumentOrder(grouped(this.#firstStep(first as string)));
    const ways: (readonly StepMatch[])[] = [];
    let steps = 1;
    for (const step of rest) {
      if (singular && found.size > 1) break;
      if (found.size === 1) ways.push([...found.values()][0] as StepMatch[]);
      const next = grouped([...found.keys()].flatMap((match) => (match.kind === "block" ? [] : this.#step(match, step))));
      // One match's results can come after a later match's, when the later one is its descendant.
      found = this.#inDocumentOrder(next);
      steps++;
    }
    if (found.size === 1 && ways.length === steps - 1) ways.push([...found.values()][0] as StepMatch[]);
    return { matches: [...found.keys()], ambiguous: singular && found.size > 1, steps, ways };
  }

  /**
   * Sorts matches into document order, by the place of their node, or of the `$body` that holds a block anchor. The sort is
   * stable, and the blocks of one `$body` come from the anchor table, in its order, which is theirs in the file; no step
   * matches both a `$body` and one of its blocks, since a block's name is an anchor and `$body` is not.
   */
  #inDocumentOrder(found: Map<Match, StepMatch[]>): Map<Match, StepMatch[]> {
    if (found.size < 2) return found;
    const order = documentOrderOf(this.#record.nodes);
    const place = ([match]: [Match, StepMatch[]]) => order.get(match.at) as number;
    return new Map([...found].sort((a, b) => place(a) - place(b)));
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

  // Deviation from the I2 design, recorded in issue #23: the proof applies to every form of a canonical address, the explicit
  // anchor included, since a form must be singular as an address and a first step is not provable through a root whose
  // sections are declared multimap.
  /** Whether `steps`, as a singular address, are proved singular and resolve to `match` and nothing else. */
  #namesOnly(steps: readonly string[], match: Match): boolean {
    const fragment: Fragment = { kind: "semantic", steps };
    if (this.#binding !== null && unprovableStep(this.#binding, fragment) !== null) return false;
    const evaluated = this.evaluate(fragment, true);
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
        // An item of a keyed list is named by its key; one without a key keeps its index, which no step matches there.
        const key = typeof current.key === "number" ? this.#declaredList(current.parent as string)?.keyOf(current.key) : null;
        steps.push(key ?? String(current.key));
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
  #firstStep(step: string): StepFind[] {
    const nodes = this.#record.nodes;
    const anchored = this.#record.anchors
      .named(step)
      .map(
        (entry): StepFind =>
          entry.kind === "block"
            ? { match: entry, way: "anchor-block" }
            : { match: nodes.node(entry.at) as NodeInfo, way: entry.kind === "explicit" ? "anchor-explicit" : "anchor-derived" },
      );
    return [...this.#step(this.#root, step), ...anchored];
  }

  /** The nodes that a step other than the first matches from a node, and how. */
  #step(node: NodeInfo, step: string): StepFind[] {
    const nodes = this.#record.nodes;
    switch (node.kind) {
      case "section": {
        const member = nodes.node(childPath(node.at, step));
        const sections = this.#keyedSections(node, step);
        if (member === undefined) return sections;
        return [{ match: member, way: step.startsWith("$") ? "section-member" : "member" }, ...sections];
      }
      case "array": {
        const holder = node.parent === null ? undefined : nodes.node(node.parent);
        if (node.key === "$sections" && holder?.kind === "section") return this.#keyedSections(holder, step);
        const list = this.#declaredList(node.at);
        if (list !== undefined) {
          return list
            .indexesOf(step)
            .map((index): StepFind => ({ match: nodes.node(childPath(node.at, index)) as NodeInfo, way: "list-key" }));
        }
        // The index names an item by its index in decimal without leading zeros, so a step names an item exactly when it is
        // RFC 6901's array index: `01`, `-`, `1e0` and a number too large to be exact name none.
        const item = nodes.node(childPath(node.at, step));
        return item === undefined ? [] : [{ match: item, way: "index" }];
      }
      case "object": {
        const member = nodes.node(childPath(node.at, step));
        return member === undefined ? [] : [{ match: member, way: "member" }];
      }
      default:
        return [];
    }
  }

  /** The child sections of a section whose key is `step`, each by its `$anchor` or by its title's slug. */
  #keyedSections(section: NodeInfo, step: string): StepFind[] {
    return (this.#sectionsByKey(section).get(step) ?? []).map((child) => ({
      match: child,
      way: this.#record.nodes.node(childPath(child.at, "$anchor")) === undefined ? "key-title" : "key-explicit",
    }));
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
