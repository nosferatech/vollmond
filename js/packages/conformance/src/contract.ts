/** The profiles an implementation can claim and a case can need, in lower case. */
export const PROFILES: readonly string[] = ["read", "validate", "query", "write", "refactor", "publish"];

/**
 * What the suite says about one operation, whichever implementation runs it: the input members it takes, and whether it
 * returns a result to compare. `fails` is whether a case may expect the operation to fail.
 */
export interface OperationContract {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly result: boolean;
  readonly fails: boolean;
}

/**
 * The operations the suite defines, by name. `serialize` and `edit` are reserved and have no inputs yet, so they are not here;
 * their cases, like those of any operation not here, run only once an adapter brings them.
 */
export const OPERATIONS: ReadonlyMap<string, OperationContract> = new Map([
  ["parse", { required: ["store", "record"], optional: ["config"], result: true, fails: true }],
  ["meta", { required: ["store", "record"], optional: ["config"], result: true, fails: true }],
  ["source_map", { required: ["store", "record"], optional: ["config"], result: true, fails: true }],
  ["anchors", { required: ["store", "record"], optional: ["config"], result: true, fails: true }],
  ["resolve", { required: ["store", "address", "as"], optional: ["config"], result: true, fails: true }],
  ["check", { required: ["store"], optional: ["records", "config"], result: false, fails: false }],
  ["refs", { required: ["store"], optional: ["record", "config"], result: true, fails: true }],
  [
    "query",
    {
      required: ["store", "query"],
      optional: ["config", "target", "fields", "sort", "limit", "per_record"],
      result: true,
      fails: true,
    },
  ],
  ["round_trip", { required: ["value", "format"], optional: [], result: false, fails: true }],
  ["compare", { required: ["a", "b"], optional: ["unordered"], result: true, fails: true }],
]);

/** Every input member that some operation takes. A member outside it is unknown, and makes its case an error. */
export const INPUT_MEMBERS: ReadonlySet<string> = new Set(
  [...OPERATIONS.values()].flatMap((operation) => [...operation.required, ...operation.optional]),
);

/** Whether an operation reads a fixture store. Every such operation also takes `config`. */
export function takesStore(operation: OperationContract): boolean {
  return operation.required.includes("store");
}
