import type { BlockAnchorEntry } from "../anchor/anchor-table.js";
import type { Value } from "../value/value.js";
import type { NodeInfo } from "./node-index.js";
import type { ParsedRecord } from "./record.js";

/**
 * Gives the value of the node at an exact path of a parsed record, a part of its value view, walking down from the root by
 * the keys of the node's ancestors.
 *
 * Throws a `RangeError` when the record has no node at `at`.
 */
export function valueAt(record: ParsedRecord, at: string): Value {
  const keys: (string | number)[] = [];
  let node: NodeInfo | undefined = record.nodes.node(at);
  if (node === undefined) throw new RangeError(`no node at ${JSON.stringify(at)}`);
  for (; node !== undefined && node.key !== null; node = node.parent === null ? undefined : record.nodes.node(node.parent)) {
    keys.push(node.key);
  }
  let value: Value = record.value;
  for (const key of keys.reverse()) {
    value = (value as Readonly<Record<string | number, Value>>)[key] as Value;
  }
  return value;
}

/**
 * Gives the text of a block anchor of a parsed record: its range of the `$body`'s value, which counts the UTF-8 bytes of the
 * value, whose line breaks are `\n`.
 *
 * Throws a `RangeError` when the record has no `$body` at the entry's path.
 */
export function blockText(record: ParsedRecord, entry: BlockAnchorEntry): string {
  const body = valueAt(record, entry.at);
  if (typeof body !== "string") throw new RangeError(`the node at ${JSON.stringify(entry.at)} is not a $body`);
  const bytes = new TextEncoder().encode(body);
  return new TextDecoder().decode(bytes.subarray(entry.range.start, entry.range.end));
}
