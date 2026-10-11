import { computeFields } from "@vollmond/core";
import type { JsonValue } from "../json.js";
import type { OperationAdapter } from "../operation.js";
import { openCaseStore } from "./case-store.js";
import { compared } from "./parse.js";

/**
 * The `meta` operation: `@key` and `@address` of each section of the record, by exact path, through core's `computeFields`,
 * with the root's `@key`, which the field leaves out, as `null`. The record is read from the case's store, opened through
 * core's `openStore` with the case's configuration, so a record with a structural error, or one that its collection's schema
 * makes readers refuse, fails with those issues. A record that the store does not hold is a mistake in the suite, and the case
 * crashes.
 */
export const metaOperation: OperationAdapter = {
  validate: (input) => (typeof input.record === "string" ? undefined : "input.record must be a store path"),
  run: async (input, { store }) => {
    const path = input.record as string;
    const opened = await openCaseStore(store);
    if (!opened.ok) return { ok: false, issues: opened.issues.map(compared) };
    const outcome = await opened.value.record(path);
    if (outcome === null) {
      throw new Error(`the store holds no record ${path}`);
    }
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
