import type { Comparison } from "./compare.js";
import type { JsonObject, JsonValue } from "./json.js";

/**
 * An issue as the suite compares it: the four members that are stable across implementations. `path` is the store path of
 * the record the issue is about, or `null`, and `at` the exact path of its node, or `null`.
 */
export interface ComparedIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly path: string | null;
  readonly at: string | null;
}

/**
 * What an operation gave, mapped to the suite's shape. An operation that succeeded may have a `result` and may report issues,
 * and one that failed reports the issues that made it fail. Only the implementation's normal error channel may produce a
 * failure; anything it throws is a crash. The runner compares only the four members of `ComparedIssue`, so an issue may carry
 * others, such as a message. A `mismatch` is an outcome the operation itself found wrong, as a round trip that reads back
 * another value, and is a `fail` whatever the case expects, with `mismatch` as its detail.
 */
export type OperationOutcome =
  | { readonly ok: true; readonly result?: JsonValue; readonly issues: readonly ComparedIssue[] }
  | { readonly ok: false; readonly issues: readonly ComparedIssue[] }
  | { readonly mismatch: string };

/** A fixture store as the runner read it, for an operation to hand to its implementation. */
export interface FixtureStore {
  /**
   * Every file of the store by store path, `.vmd/` included, with the bytes checked in. Each case gets its own copy, so an
   * implementation that changes the bytes affects no other case.
   */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The bytes of the configuration file that the case names, which replaces `.vmd/config.yaml`; absent when it names none. */
  readonly config?: Uint8Array;
}

/** What the runner gives an operation besides the case's input. */
export interface OperationContext {
  /** The case's store, for an operation that takes one. The runner has checked it against its versions manifest. */
  readonly store?: FixtureStore;
  /** The comparison of the run, for an operation that compares values, as `compare` does or a list without order needs. */
  readonly comparison: Comparison;
  /** Aborted when the operation has run out of time and its outcome no longer counts, so that it can stop its work. */
  readonly signal: AbortSignal;
}

/**
 * How the runner performs one operation of the suite: by calling the implementation's library, or by itself for `compare`.
 * Adding an operation to the runner is adding an adapter to the registry, and removing its skip entry from the declaration.
 */
export interface OperationAdapter {
  /**
   * Checks the values of the case's input members, which the runner has checked only by name. Returns why the case is
   * malformed, which makes it an `error`, or `undefined`. A throw makes the case an `error` too.
   */
  readonly validate?: (input: JsonObject) => string | undefined;
  /**
   * Performs the operation on a validated input. A rejected promise, or one that does not settle within the runner's time
   * limit, is a crash, and the case's verdict is `fail`.
   */
  readonly run: (input: JsonObject, context: OperationContext) => Promise<OperationOutcome>;
  /**
   * Whether the expected result equals the one the operation gave for `input`. Defaults to the comparison's `equal`; an
   * operation whose result holds lists compared without order overrides it, as `resolve` does for a selector. A throw is a
   * crash.
   */
  readonly equalResults?: (expected: JsonValue, actual: JsonValue, input: JsonObject, context: OperationContext) => boolean;
}

/** The operations a runner performs, by the names the suite gives them. */
export type OperationRegistry = ReadonlyMap<string, OperationAdapter>;
