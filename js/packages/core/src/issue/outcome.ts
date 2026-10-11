import type { Issue } from "./issue.js";

/**
 * The result of an operation that can fail in an expected way: a value with the issues found on the way, which may include
 * warnings, or a failure with the issues that explain it. Exceptions are kept for bugs.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly Issue[] }
  | { readonly ok: false; readonly issues: readonly Issue[] };

/** Creates a successful outcome. */
export function succeed<T>(value: T, issues: readonly Issue[] = []): Outcome<T> {
  return { ok: true, value, issues };
}

/**
 * Creates a failed outcome.
 *
 * Throws a `RangeError` when `issues` is empty: a failure always says why.
 */
export function fail<T = never>(issues: readonly Issue[]): Outcome<T> {
  if (issues.length === 0) throw new RangeError("a failed outcome needs at least one issue");
  return { ok: false, issues };
}
