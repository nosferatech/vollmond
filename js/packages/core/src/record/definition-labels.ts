import { definitionLabelsIn } from "../format/markdown/library.js";
import type { Value, ValueObject } from "../value/value.js";

/**
 * Finds the labels of the link reference definitions in the `$body` of every section of a JSON or YAML record's value, as
 * {@link definitionLabelsIn} gives them: the labels that are in scope in each `$title` and each `$body` of the record, as
 * they are in its Markdown form, one document. They come in that document's order, each section's `$body` before its
 * `$sections`, so that where two definitions share a label, the one that CommonMark takes, the first, comes first. A
 * `$body` whose containers nest too deep has none.
 */
export function definitionLabelsOfRecord(root: ValueObject): string[] {
  const labels: string[] = [];
  const pending: Value[] = [root];
  for (let section = pending.pop(); section !== undefined; section = pending.pop()) {
    if (!isObject(section)) continue;
    if (typeof section.$body === "string") labels.push(...definitionLabelsIn(section.$body));
    // The last item first, so that the walk visits the sections in document order.
    if (Array.isArray(section.$sections)) pending.push(...[...section.$sections].reverse());
  }
  return labels;
}

function isObject(value: Value): value is ValueObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
