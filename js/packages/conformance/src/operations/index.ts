import type { OperationRegistry } from "../operation.js";
import { compareOperation } from "./compare.js";
import { parseOperation } from "./parse.js";

/**
 * The operations this runner performs. An operation of the suite that is missing here makes its cases errors unless the
 * declaration skips them, so each one added here comes with the removal of its skip entry.
 */
export const operations: OperationRegistry = new Map([
  ["compare", compareOperation],
  ["parse", parseOperation],
]);
