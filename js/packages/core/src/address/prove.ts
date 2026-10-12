import type { RecordBinding } from "../binding/binding.js";
import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
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
 * could cross a level declared `multimap`.
 */
export function proveSingular(binding: RecordBinding, fragment: Fragment | null): Outcome<null> {
  const step = unprovableStep(binding, fragment);
  if (step === null) return succeed(null);
  const steps = fragment?.kind === "semantic" ? fragment.steps : [];
  return fail([
    makeIssue({
      code: "address-not-singular",
      path: binding.record.path,
      at: null,
      message: `${binding.record.path}${formatFragment(fragment)}: its step ${step}, ${JSON.stringify(steps[step - 1])}, crosses a level its schema declares multimap, where keys may repeat, so it cannot be proved to name one node`,
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
 * The proof works from the schema's shapes, not the data, but for the first step's anchors, which it looks up in the record
 * and continues from: where an anchored node sits cannot be known from the schema alone. Each step crosses the level of every
 * place the previous step can reach, and a declaration anywhere among them decides: a section's fields and child sections,
 * whose level is its `$sections` declaration; a keyed list's items, by key at any position; an object's members; an array's
 * items by index. A level the schema leaves undeclared is unique by the strict default; lenient mode and duplicates in the
 * data are the cases §7.4 leaves to evaluation.
 *
 * Cost: a few memoized shape steps per step of the path.
 */
export function unprovableStep(binding: RecordBinding, fragment: Fragment | null): number | null {
  if (fragment === null || fragment.kind === "exact") return null;
  const root = binding.shape("");
  if (root === null) return null;
  let positions: Position[] = [{ shape: root, place: "section" }];
  for (const [index, step] of fragment.steps.entries()) {
    if (positions.some(crossesMultimap)) return index + 1;
    const next = positions.flatMap((position) => stepFrom(position, step));
    if (index === 0) {
      for (const entry of binding.record.anchors.named(step)) {
        // A block anchor is a range of a $body, and no later step goes into it.
        if (entry.kind === "block") continue;
        const shape = binding.shape(entry.at);
        const node = binding.record.nodes.node(entry.at);
        if (shape !== null && node !== undefined) next.push({ shape, place: node.kind === "section" ? "section" : "value" });
      }
    }
    positions = unique(next);
  }
  return null;
}

/** Whether a step from this place crosses a level declared `multimap`. */
function crossesMultimap(position: Position): boolean {
  return position.place === "section" ? position.shape.child({ member: "$sections" }).multimap : position.shape.multimap;
}

/** The places a step may reach from a place. */
function stepFrom(position: Position, step: string): Position[] {
  const { shape, place } = position;
  switch (place) {
    case "section":
      return [
        { shape: shape.child({ member: step }), place: step === "$sections" ? "sections" : "value" },
        { shape: shape.child({ member: "$sections" }).anyItem(step), place: "section" },
      ];
    case "sections":
      return [{ shape: shape.anyItem(step), place: "section" }];
    case "value": {
      const member: Position = { shape: shape.child({ member: step }), place: "value" };
      if (shape.list !== null) return [member, { shape: shape.anyItem(step), place: "value" }];
      // An index step, as an exact path writes it; the data says whether the node is an array.
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
