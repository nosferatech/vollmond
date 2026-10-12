import type { Reference, ReferenceTarget } from "@vollmond/core";
import type { JsonObject, JsonValue } from "../json.js";
import type { OperationAdapter } from "../operation.js";
import { openCaseStore } from "./case-store.js";
import { compared } from "./parse.js";
import { targetResult } from "./resolve.js";

/**
 * The `refs` operation: the references made from the record `record` names, or from every record of the case's store, each as
 * `{from, raw, status, targets}`, `from` with `offset` for a link, and each target as `resolve` gives one, or `{path}` for an
 * asset or a directory. The references are compared unordered, and each one's targets in order. It fails as core's
 * `Store.references` does: for a record with a structural error, with that record's errors.
 */
export const refsOperation: OperationAdapter = {
  validate: (input) =>
    input.record === undefined || typeof input.record === "string" ? undefined : "input.record must be a store path",
  run: async (input, { store }) => {
    const opened = await openCaseStore(store);
    if (!opened.ok) return { ok: false, issues: opened.issues.map(compared) };
    const record = input.record as string | undefined;
    const outcome = await opened.value.references(record === undefined ? {} : { from: record });
    return outcome.ok
      ? { ok: true, result: outcome.value.map(referenceResult), issues: [] }
      : { ok: false, issues: outcome.issues.map(compared) };
  },
  equalResults: (expected: JsonValue, actual: JsonValue, _input: JsonObject, { comparison }) =>
    Array.isArray(expected) && Array.isArray(actual) && comparison.equalUnordered(expected, actual),
};

/** A reference in the suite's shape. */
function referenceResult(reference: Reference): JsonObject {
  const { path, at, offset } = reference.from;
  return {
    from: offset === undefined ? { path, at } : { path, at, offset },
    raw: reference.raw,
    status: reference.status,
    targets: reference.targets.map(referenceTarget),
  };
}

/** A target in the suite's shape: a node's as `resolve` gives it, or an asset's or a directory's path alone. */
function referenceTarget(target: ReferenceTarget): JsonObject {
  return "kind" in target ? { path: target.path } : targetResult(target);
}
