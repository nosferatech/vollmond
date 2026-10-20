import { CAT_COMMAND } from "./cat.js";
import { CHECK_COMMAND } from "./check.js";
import type { Command } from "./command.js";
import { GET_COMMAND } from "./get.js";
import { GREP_COMMAND } from "./grep.js";
import { INDEX_COMMAND } from "./index-command.js";
import { LS_COMMAND } from "./ls.js";
import { OUTLINE_COMMAND } from "./outline.js";
import { REFS_COMMAND } from "./refs.js";

/** The commands `vmd` offers, in the order its help lists them. */
export const BUILT_IN_COMMANDS: readonly Command[] = Object.freeze([
  LS_COMMAND,
  CAT_COMMAND,
  GREP_COMMAND,
  OUTLINE_COMMAND,
  GET_COMMAND,
  CHECK_COMMAND,
  REFS_COMMAND,
  INDEX_COMMAND,
]);
