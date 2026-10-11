import type { NodeIndex } from "./node-index.js";

/** The place of each node in document order, by exact path, made once per index. */
const orders = new WeakMap<NodeIndex, ReadonlyMap<string, number>>();

/**
 * Gives the place of each node of an index in document order, from 0 for the root, by exact path. Document order is the
 * pre-order of the value view: a node comes before its descendants, and siblings come in their order in the file. So a
 * Markdown record's root, whose title heading comes after its front matter, comes before its front matter's fields, as a
 * JSON record's root comes before its members.
 *
 * Costs time linear in the nodes on the first call for an index, and nothing on later calls.
 */
export function documentOrderOf(nodes: NodeIndex): ReadonlyMap<string, number> {
  let order = orders.get(nodes);
  if (order === undefined) {
    const places = new Map<string, number>();
    // By an explicit stack, the last child first, so that the walk visits the nodes in pre-order.
    const pending = [""];
    for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
      places.set(at, places.size);
      const children = nodes.children(at);
      for (let i = children.length - 1; i >= 0; i--) pending.push((children[i] as { at: string }).at);
    }
    order = places;
    orders.set(nodes, order);
  }
  return order;
}
