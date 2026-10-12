import { definitionLabelsIn } from "../format/markdown/library.js";
import type { Value, ValueObject } from "../value/value.js";

/** The labels of each record value given to {@link definitionLabelsOfRecord}, found once per value. */
const labelsByRecord = new WeakMap<ValueObject, readonly string[]>();

/**
 * Finds the labels of the link reference definitions in the `$body` of every section of a JSON or YAML record's value, as
 * {@link definitionLabelsIn} gives them: the labels that are in scope in each `$title` and each `$body` of the record, as
 * they are in its Markdown form, one document. They come in that document's order, each section's `$body` before its
 * `$sections`, so that where two definitions share a label, the one that CommonMark takes, the first, comes first. A
 * `$body` whose containers nest too deep has none.
 *
 * The labels are found on the first call for a value and kept for the next, as the same array, so that the shape check,
 * the section keys and the references of a record collect them once and share the identifiers that the parses of its
 * prose make of them. A record's value is not changed after it is parsed.
 */
export function definitionLabelsOfRecord(root: ValueObject): readonly string[] {
  const known = labelsByRecord.get(root);
  if (known !== undefined) return known;
  const labels: string[] = [];
  const pending: Value[] = [root];
  for (let section = pending.pop(); section !== undefined; section = pending.pop()) {
    if (!isObject(section)) continue;
    if (typeof section.$body === "string") for (const label of definitionLabelsIn(section.$body)) labels.push(label);
    // The last item first, so that the walk visits the sections in document order; one by one, since a record may have
    // more sections than a call takes arguments.
    if (Array.isArray(section.$sections)) {
      for (let i = section.$sections.length - 1; i >= 0; i--) pending.push(section.$sections[i] as Value);
    }
  }
  labelsByRecord.set(root, labels);
  return labels;
}

function isObject(value: Value): value is ValueObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
