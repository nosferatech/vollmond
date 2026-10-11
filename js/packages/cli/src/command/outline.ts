// `vmd outline ADDR [--depth N]`: the sections below a node, without their content.

import type { Outline } from "@vollmond/core";
import { formatColumns, oneLine } from "../output/lines.js";
import { MAX_LIMIT } from "../output/paging.js";
import { formatTokens } from "../output/sizes.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem, readWholeNumber, storeIssueDetails } from "./options.js";

// TODO(#25): the refs-in counts of each line need the local index.
/**
 * Outlines the node a singular address names, a record's root without a fragment: a first line with its address and its size
 * in tokens, then a line for each section below it, indented by its depth below the node, with its canonical address, its
 * title and its size. `--depth N` goes down at most N levels, every level by default. A node that is not a section has no
 * sections below it.
 */
export const OUTLINE_COMMAND: Command = {
  name: "outline",
  usage: "ADDR [--depth N]",
  summary: "list the sections below a node, with their addresses, titles and sizes",
  options: { depth: { type: "string" } },
  readsStore: true,
  prepare: ({ positionals, options }) => {
    const problem = argumentCountProblem(positionals, 1, 1, "an address");
    if (problem !== null) return usagePlan(problem);
    const depth = readWholeNumber(options.depth, "--depth", { minimum: 0, maximum: MAX_LIMIT }, undefined);
    if (!depth.ok) return usagePlan(depth.message);
    const address = positionals[0] as string;
    return {
      kind: "run",
      run: async (opened) => {
        const { store } = opened as OpenedStore;
        const outline = await store.outline(address, {
          reading: { raw: true },
          ...(depth.value === undefined ? {} : { depth: depth.value }),
        });
        return outcomeOutput(outline, formatOutline, storeIssueDetails(store));
      },
    };
  },
};

/** Writes an outline: the node's line, then one line per section. */
function formatOutline(outline: Outline): string {
  const { node } = outline;
  const head = `${oneLine(`${outline.path}${node.address}`)}  ${formatTokens(node.size)}\n`;
  const rows = outline.sections.map((entry) => ({
    cells: [entry.address, entry.title ?? "", formatTokens(entry.size)],
    depth: (entry.depth as number) - (node.depth as number),
  }));
  return head + formatColumns(rows);
}
