import { CAT_COMMAND } from "./cat.js";
import type { Command } from "./command.js";
import { GET_COMMAND } from "./get.js";
import { GREP_COMMAND } from "./grep.js";
import { LS_COMMAND } from "./ls.js";
import { OUTLINE_COMMAND } from "./outline.js";

/** The commands `vmd` offers, in the order its help lists them. */
export const BUILT_IN_COMMANDS: readonly Command[] = Object.freeze([
  LS_COMMAND,
  CAT_COMMAND,
  GREP_COMMAND,
  OUTLINE_COMMAND,
  GET_COMMAND,
]);
