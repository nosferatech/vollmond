import { type Issue, parseRecord } from "@vollmond/core";
import type { ComparedIssue, OperationAdapter } from "../operation.js";

/**
 * The `parse` operation: the record's value view, through core's `parseRecord`, or the structural errors that make it fail.
 * A record that the store does not hold is a mistake in the suite, and the case crashes.
 */
export const parseOperation: OperationAdapter = {
  validate: (input) => (typeof input.record === "string" ? undefined : "input.record must be a store path"),
  run: async (input, { store }) => {
    const path = input.record as string;
    const bytes = store?.files.get(path);
    if (bytes === undefined) {
      throw new Error(`the store holds no record ${path}`);
    }
    const outcome = parseRecord(path, bytes);
    return outcome.ok
      ? { ok: true, result: outcome.value.value, issues: outcome.issues.map(compared) }
      : { ok: false, issues: outcome.issues.map(compared) };
  },
};

/** The members of an issue that the suite compares. */
function compared({ code, severity, path, at }: Issue): ComparedIssue {
  return { code, severity, path, at };
}
