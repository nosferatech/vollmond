/**
 * The comparison of values that the runner uses for results and issues, and that the `compare` operation exposes to the
 * suite's self-test. A runner run takes one, so that a test can break it on purpose and watch the self-test fail.
 */
export interface Comparison {
  /**
   * Whether two JSON values are equal. Values of different JSON types never are. Numbers are equal when they are the same
   * double, `-0` and `0` included; strings when they hold the same code points, without normalization; arrays when their items
   * are equal in order; objects when they have the same member names, in any order, and equal values for each.
   */
  readonly equal: (a: unknown, b: unknown) => boolean;
  /** Whether two arrays are equal as unordered lists: their items can be paired one to one, each pair equal. */
  readonly equalUnordered: (a: readonly unknown[], b: readonly unknown[]) => boolean;
}

/** The comparison the suite defines. */
export const standardComparison: Comparison = { equal: equalValues, equalUnordered: equalUnorderedLists };

/** Whether two JSON values are equal, as `Comparison.equal` defines it. A value that is not JSON equals nothing. */
function equalValues(a: unknown, b: unknown): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  switch (typeof a) {
    case "boolean":
    case "number":
    case "string":
      // `===` never equates values of two types, holds for `-0` and `0`, and compares strings by UTF-16 code units, which
      // agrees with comparing code points.
      return a === b;
    case "object": {
      if (typeof b !== "object") {
        return false;
      }
      if (Array.isArray(a) || Array.isArray(b)) {
        return (
          Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => equalValues(item, b[index]))
        );
      }
      const names = Object.keys(a);
      return (
        names.length === Object.keys(b).length &&
        names.every(
          (name) =>
            Object.hasOwn(b, name) && equalValues((a as Record<string, unknown>)[name], (b as Record<string, unknown>)[name]),
        )
      );
    }
    default:
      return false;
  }
}

/**
 * Whether two arrays are equal as unordered lists. Equality of values is an equivalence relation, so pairing each item of `a`
 * with the first unpaired equal item of `b` finds a pairing whenever one exists.
 */
function equalUnorderedLists(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const unpaired = [...b];
  for (const item of a) {
    const index = unpaired.findIndex((candidate) => equalValues(item, candidate));
    if (index < 0) {
      return false;
    }
    unpaired.splice(index, 1);
  }
  return true;
}
