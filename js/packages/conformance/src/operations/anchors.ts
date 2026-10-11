import { parseRecord } from "@vollmond/core";
import { isJsonObject, type JsonValue } from "../json.js";
import type { OperationAdapter } from "../operation.js";
import { compared } from "./parse.js";

/**
 * The `anchors` operation: the record's anchor table as `{anchors, tags}`, each anchor `{name, kind, at}` with `range` as
 * `[start, end]` for a block anchor, and each tag `{tag, at}`; or, for a record with a structural error, the failure that
 * `parse` gives. Both lists are compared without order. A record that the store does not hold is a mistake in the suite, and
 * the case crashes.
 */
export const anchorsOperation: OperationAdapter = {
  validate: (input) => (typeof input.record === "string" ? undefined : "input.record must be a store path"),
  run: async (input, { store }) => {
    const path = input.record as string;
    const bytes = store?.files.get(path);
    if (bytes === undefined) {
      throw new Error(`the store holds no record ${path}`);
    }
    const outcome = parseRecord(path, bytes);
    if (!outcome.ok) {
      return { ok: false, issues: outcome.issues.map(compared) };
    }
    const table = outcome.value.anchors;
    const anchors = table.anchors.map((entry) =>
      entry.kind === "block"
        ? { name: entry.name, kind: entry.kind, at: entry.at, range: [entry.range.start, entry.range.end] }
        : { name: entry.name, kind: entry.kind, at: entry.at },
    );
    const tags = table.tags.map(({ tag, at }) => ({ tag, at }));
    return { ok: true, result: { anchors, tags }, issues: [] };
  },
  equalResults: (expected, actual, _input, { comparison }) => {
    const lists = (value: JsonValue) =>
      isJsonObject(value) && Array.isArray(value.anchors) && Array.isArray(value.tags) && Object.keys(value).length === 2
        ? { anchors: value.anchors, tags: value.tags }
        : null;
    const wanted = lists(expected);
    const got = lists(actual);
    if (wanted === null || got === null) return comparison.equal(expected, actual);
    return comparison.equalUnordered(wanted.anchors, got.anchors) && comparison.equalUnordered(wanted.tags, got.tags);
  },
};
