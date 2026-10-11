import type { Target } from "@vollmond/core";
import type { JsonObject, JsonValue } from "../json.js";
import type { OperationAdapter } from "../operation.js";
import { openCaseStore } from "./case-store.js";
import { compared } from "./parse.js";

/**
 * The `resolve` operation: the targets of an address in the case's store, opened through core's `openStore` with the case's
 * configuration, each as `{path, at, address}` with `range` as `[start, end]` for a block anchor; or the issues that make it
 * fail, those of the configuration among them. A selector's targets are compared in order, since a selector returns its
 * matches in document order.
 */
export const resolveOperation: OperationAdapter = {
  validate: (input) => {
    if (typeof input.address !== "string") return "input.address must be a string";
    if (input.as !== "singular" && input.as !== "selector") return 'input.as must be "singular" or "selector"';
    return undefined;
  },
  run: async (input, { store }) => {
    const opened = await openCaseStore(store);
    if (!opened.ok) return { ok: false, issues: opened.issues.map(compared) };
    const outcome = await opened.value.resolve(input.address as string, input.as as "singular" | "selector");
    return outcome.ok
      ? { ok: true, result: outcome.value.targets.map(targetResult), issues: [] }
      : { ok: false, issues: outcome.issues.map(compared) };
  },
  equalResults: (expected: JsonValue, actual: JsonValue, _input: JsonObject, { comparison }) =>
    comparison.equal(expected, actual),
};

/** A target in the suite's shape. */
export function targetResult(target: Target): JsonObject {
  const { path, at, address, range } = target;
  return range === undefined ? { path, at, address } : { path, at, address, range: [range.start, range.end] };
}
