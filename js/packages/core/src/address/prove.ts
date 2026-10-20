import type { AnchorEntry, BlockAnchorEntry } from "../anchor/anchor-table.js";
import type { RecordBinding } from "../binding/binding.js";
import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import type { SchemaShape } from "../schema/spine.js";
import { type Fragment, formatFragment } from "./address.js";

/** Where a step may stand, as the schema sees it: in a section, in a section's `$sections`, or in any other value. */
type Place = "section" | "sections" | "value";

/** A schema shape that a step may stand at, with what kind of node it is there. */
interface Position {
  readonly shape: SchemaShape;
  readonly place: Place;
}

/**
 * Proves before evaluation that a fragment, used as a singular address in a bound record, names at most one node (§7.4), as
 * {@link unprovableStep} does. Fails with `address-not-singular`, with the record's path and no node, naming the step that
 * could cross a level declared `multimap`, and, where the first step names several nodes in the record, how many and their
 * exact paths.
 */
export function proveSingular(binding: RecordBinding, fragment: Fragment | null): Outcome<null> {
  const failure = unprovable(binding, fragment);
  if (failure === null) return succeed(null);
  const steps = fragment?.kind === "semantic" ? fragment.steps : [];
  const { step, firstMatches } = failure;
  const subject = step === 1 ? "it" : `its first step, ${JSON.stringify(steps[0])},`;
  const inRecord =
    firstMatches === null
      ? ""
      : `, and ${subject} names ${firstMatches.length} nodes in the record, ${listed(firstMatches.map(shownMatch))}`;
  return fail([
    makeIssue({
      code: "address-not-singular",
      path: binding.record.path,
      at: null,
      message: `${binding.record.path}${formatFragment(fragment)}: its step ${step}, ${JSON.stringify(steps[step - 1])}, crosses a level its schema declares multimap, where keys may repeat${inRecord}, so it cannot be proved to name one node`,
      hint: "read it as a selector, or address the node by its explicit anchor, its derived anchor or its exact path",
    }),
  ]);
}

/**
 * Finds the first step of a semantic path that could cross a level whose keys the record's schema allows to repeat
 * (`x-vmd-list` with `type: multimap`), so that the path, used as a singular address, cannot be proved to name one node
 * before it is evaluated (§7.4). Gives that step's number, from 1, or null when the address is proved singular: an exact path
 * and the root always are, and so is every address in a record bound without a schema.
 *
 * The proof works from the schema's shapes first, but for the first step's anchors, which it looks up in the record and
 * continues from, since where an anchored node sits cannot be known from the schema alone. Each step crosses the level of every
 * place the previous step can reach, and a declaration anywhere among them decides: a section's fields and child sections,
 * whose level is its `$sections` declaration; a keyed list's items, by key at any position; an object's members; an array's
 * items by index. A section's step that begins with `$` names the section's own member, such as `$body` or `$sections`, and
 * crosses no level: no section key of a valid record begins with `$`. A level the schema leaves undeclared is unique by the
 * strict default; lenient mode and duplicates in the data are the cases §7.4 leaves to evaluation.
 *
 * Where the schema alone cannot prove the address, whatever step fails, the record decides its first step, by its anchors,
 * the root's member and the root's child sections together. When that step names exactly one node in the record, the steps
 * after it are proved from that node's shape alone. When it names none, the address is proved: it names no node, whatever
 * follows, and evaluation finds it not found. When it names several, or begins with `$`, which the schema already reads as the
 * root's own member, the step the schema found is the one given. So declaring a level `multimap` never makes an address
 * provable.
 *
 * Cost: a few memoized shape steps per step of the path, twice at most, and a few map lookups in the record.
 */
export function unprovableStep(binding: RecordBinding, fragment: Fragment | null): number | null {
  return unprovable(binding, fragment)?.step ?? null;
}

/** Why an address is not proved singular: the step that could cross a level declared `multimap`, and what the record showed. */
interface Unprovable {
  /** The step's number, from 1. */
  readonly step: number;
  /** What the first step names in the record, where that is several nodes; null where the record was not asked. */
  readonly firstMatches: readonly FirstStepMatch[] | null;
}

/** Gives why a fragment is not proved singular, as {@link unprovableStep} decides, or null when it is. */
function unprovable(binding: RecordBinding, fragment: Fragment | null): Unprovable | null {
  if (fragment === null || fragment.kind === "exact") return null;
  const root = binding.shape("");
  if (root === null) return null;
  const [first, ...rest] = fragment.steps as [string, ...string[]];
  const fromSchema = crossingStep(binding, [{ shape: root, place: "section" }], fragment.steps, true);
  if (fromSchema === null) return null;
  if (namesOwnMember(first)) return { step: fromSchema, firstMatches: null };
  const matches = firstStepMatches(binding, first);
  const [only] = matches;
  // A first step that names no node leaves the address naming none: not ambiguous, and not found at evaluation.
  if (only === undefined) return null;
  if (matches.length > 1) return { step: fromSchema, firstMatches: matches };
  const fromRecord = crossingStep(binding, positionsAt(binding, only), rest, false);
  return fromRecord === null ? null : { step: fromRecord + 1, firstMatches: null };
}

/**
 * Gives the number, from 1, of the first of `steps` that could cross a level declared `multimap` from `positions`, or null
 * when none does; where `fromRoot`, the first step also reaches the nodes its anchors name.
 */
function crossingStep(
  binding: RecordBinding,
  positions: readonly Position[],
  steps: readonly string[],
  fromRoot: boolean,
): number | null {
  let at = positions;
  for (const [index, step] of steps.entries()) {
    if (at.some((position) => crossesMultimap(position, step))) return index + 1;
    const next = at.flatMap((position) => stepFrom(position, step));
    if (fromRoot && index === 0) {
      for (const entry of binding.record.anchors.named(step)) next.push(...positionsAt(binding, matchOf(entry)));
    }
    at = unique(next);
  }
  return null;
}

/** What a first step names in a record: a node, by its exact path, or a block anchor. */
type FirstStepMatch = string | BlockAnchorEntry;

/** Gives what an anchor names, as a first step's match. */
function matchOf(entry: AnchorEntry): FirstStepMatch {
  return entry.kind === "block" ? entry : entry.at;
}

/** Gives a first step's match as a message shows it: a node's exact path, or a block anchor and its `$body`'s. */
function shownMatch(match: FirstStepMatch): string {
  return typeof match === "string" ? match : `the block anchor ${match.name} in ${match.at}`;
}

/** Gives items as a message lists them: `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Gives what a first step names in the record, as evaluation matches it: the root's member of that name, the root's child
 * sections with that key, and every anchor of that name, a node that several of them name once, in the order found.
 */
function firstStepMatches(binding: RecordBinding, step: string): FirstStepMatch[] {
  const { nodes, anchors } = binding.record;
  const matches = new Set<FirstStepMatch>();
  const member = childPath("", step);
  if (nodes.node(member) !== undefined) matches.add(member);
  const sections = childPath("", "$sections");
  for (const index of binding.lists.get(sections)?.indexesOf(step) ?? []) matches.add(childPath(sections, index));
  for (const entry of anchors.named(step)) matches.add(matchOf(entry));
  return [...matches];
}

/** The place a first step's match stands at, as the schema sees it; none for a block anchor, which no later step goes into. */
function positionsAt(binding: RecordBinding, match: FirstStepMatch): Position[] {
  if (typeof match !== "string") return [];
  const shape = binding.shape(match);
  const node = binding.record.nodes.node(match);
  return shape === null || node === undefined ? [] : [{ shape, place: node.kind === "section" ? "section" : "value" }];
}

/**
 * Whether a section's step names only the section's own member, such as `$body` or `$sections`: a step that begins with `$`.
 * No section key of a valid record begins with `$`, since a heading's slug drops it and an anchor begins with a letter, so such a step matches
 * no child section and crosses no level of them.
 */
function namesOwnMember(step: string): boolean {
  return step.startsWith("$");
}

/** Whether this step from this place crosses a level declared `multimap`. */
function crossesMultimap(position: Position, step: string): boolean {
  if (position.place !== "section") return position.shape.multimap;
  return !namesOwnMember(step) && position.shape.child({ member: "$sections" }).multimap;
}

/** The places a step may reach from a place. */
function stepFrom(position: Position, step: string): Position[] {
  const { shape, place } = position;
  switch (place) {
    case "section": {
      const member: Position = { shape: shape.child({ member: step }), place: step === "$sections" ? "sections" : "value" };
      if (namesOwnMember(step)) return [member];
      return [member, { shape: shape.child({ member: "$sections" }).anyItem(step), place: "section" }];
    }
    case "sections":
      return [{ shape: shape.anyItem(step), place: "section" }];
    case "value": {
      const member: Position = { shape: shape.child({ member: step }), place: "value" };
      // Where a location declares a keyed list, unequal ones included, the item may be keyed by the step at any position, or
      // reached by its index where the declarations leave it unkeyed: every position's locations, and the key's schema.
      if (shape.declaresList) return [member, { shape: shape.anyItem(step), place: "value" }];
      // Otherwise only an index step, as an exact path writes it, reaches an item: the data says whether it is an array.
      return /^(0|[1-9][0-9]*)$/.test(step) ? [member, { shape: shape.child({ item: Number(step) }), place: "value" }] : [member];
    }
  }
}

/** The positions given, each shape and place once. */
function unique(positions: readonly Position[]): Position[] {
  const seen = new Map<SchemaShape, Set<Place>>();
  return positions.filter(({ shape, place }) => {
    const places = seen.get(shape) ?? new Set<Place>();
    if (places.has(place)) return false;
    places.add(place);
    seen.set(shape, places);
    return true;
  });
}
