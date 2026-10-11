import type { OperationAdapter } from "../operation.js";

/**
 * The `compare` operation, the runner's self-test: it never reaches the implementation. Its result is whether `a` and `b` are
 * equal under the run's comparison, as unordered lists when `unordered` is `true`.
 */
export const compareOperation: OperationAdapter = {
  validate: (input) => {
    if (input.unordered !== undefined && typeof input.unordered !== "boolean") {
      return "input.unordered must be a boolean";
    }
    if (input.unordered === true && !(Array.isArray(input.a) && Array.isArray(input.b))) {
      return "input.a and input.b must be arrays when input.unordered is true";
    }
    return undefined;
  },
  run: async (input, { comparison }) => {
    const { a, b } = input;
    const result =
      input.unordered === true && Array.isArray(a) && Array.isArray(b) ? comparison.equalUnordered(a, b) : comparison.equal(a, b);
    return { ok: true, result, issues: [] };
  },
};
