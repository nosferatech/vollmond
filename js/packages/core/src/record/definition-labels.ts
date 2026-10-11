import { definitionLabelsIn } from "../format/markdown/library.js";
import type { Value, ValueObject } from "../value/value.js";

/**
 * Finds the labels of the link reference definitions in the `$body` of every section of a JSON or YAML record's value, as
 * written: the labels that are in scope when a section's `$title` is read as a heading's inline content. The order is not
 * specified. A `$body` beyond a resource limit has none.
 */
export function definitionLabelsOfRecord(root: ValueObject): string[] {
  const labels: string[] = [];
  const pending: Value[] = [root];
  for (let section = pending.pop(); section !== undefined; section = pending.pop()) {
    if (!isObject(section)) continue;
    if (typeof section.$body === "string") labels.push(...definitionLabelsIn(section.$body));
    if (Array.isArray(section.$sections)) pending.push(...section.$sections);
  }
  return labels;
}

function isObject(value: Value): value is ValueObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
