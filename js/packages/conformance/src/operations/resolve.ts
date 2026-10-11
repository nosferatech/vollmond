import { parseRecord, recordFormatOf, resolveStoreAddress, type Target } from "@vollmond/core";
import type { JsonObject, JsonValue } from "../json.js";
import type { OperationAdapter } from "../operation.js";
import { compared } from "./parse.js";

/**
 * The `resolve` operation: the targets of an address in the case's store, through core's `resolveStoreAddress`, each as
 * `{path, at, address}` with `range` as `[start, end]` for a block anchor; or the issues that make it fail. A record is a file
 * of the store with a record's extension, none of whose segments starts with `.` (so not in `.vmd/`). A selector's targets are compared without order.
 */
export const resolveOperation: OperationAdapter = {
  validate: (input) => {
    if (typeof input.address !== "string") return "input.address must be a string";
    if (input.as !== "singular" && input.as !== "selector") return 'input.as must be "singular" or "selector"';
    return undefined;
  },
  run: async (input, { store }) => {
    const files = store?.files ?? new Map<string, Uint8Array>();
    const lookup = async (path: string) => {
      const bytes = files.get(path);
      if (bytes === undefined || path.split("/").some((segment) => segment.startsWith(".")) || recordFormatOf(path) === null) {
        return null;
      }
      return parseRecord(path, bytes);
    };
    const outcome = await resolveStoreAddress(lookup, input.address as string, input.as as "singular" | "selector");
    return outcome.ok
      ? { ok: true, result: outcome.value.targets.map(targetResult), issues: [] }
      : { ok: false, issues: outcome.issues.map(compared) };
  },
  equalResults: (expected: JsonValue, actual: JsonValue, input: JsonObject, { comparison }) =>
    input.as === "selector" && Array.isArray(expected) && Array.isArray(actual)
      ? comparison.equalUnordered(expected, actual)
      : comparison.equal(expected, actual),
};

/** A target in the suite's shape. */
export function targetResult(target: Target): JsonObject {
  const { path, at, address, range } = target;
  return range === undefined ? { path, at, address } : { path, at, address, range: [range.start, range.end] };
}
