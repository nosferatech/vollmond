import { computeFields, parseRecord } from "@vollmond/core";
import type { JsonValue } from "../json.js";
import type { OperationAdapter } from "../operation.js";
import { compared } from "./parse.js";

/**
 * The `meta` operation: `@key` and `@address` of each section of the record, by exact path, through core's `computeFields`,
 * with the root's `@key`, which the field leaves out, as `null`; or, for a record with a structural error, the failure that
 * `parse` gives. A record that the store does not hold is a mistake in the suite, and the case crashes.
 */
export const metaOperation: OperationAdapter = {
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
    const record = outcome.value;
    const result: Record<string, JsonValue> = {};
    for (const section of record.nodes.sections()) {
      const fields = await computeFields(record, section.at, ["@key", "@address"]);
      result[section.at] = { "@key": fields["@key"] ?? null, "@address": fields["@address"] ?? null };
    }
    return { ok: true, result, issues: [] };
  },
};
