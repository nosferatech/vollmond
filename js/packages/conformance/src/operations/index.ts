import type { OperationRegistry } from "../operation.js";
import { anchorsOperation } from "./anchors.js";
import { checkOperation } from "./check.js";
import { compareOperation } from "./compare.js";
import { metaOperation } from "./meta.js";
import { parseOperation } from "./parse.js";
import { resolveOperation } from "./resolve.js";

/**
 * The operations this runner performs. An operation of the suite that is missing here makes its cases errors unless the
 * declaration skips them, so each one added here comes with the removal of its skip entry.
 */
export const operations: OperationRegistry = new Map([
  ["anchors", anchorsOperation],
  ["check", checkOperation],
  ["compare", compareOperation],
  ["meta", metaOperation],
  ["parse", parseOperation],
  ["resolve", resolveOperation],
]);
