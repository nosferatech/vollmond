// `vmd outline ADDR [--depth N]`: the sections below a node, their block anchors and a data record's members, without their
// content.

import type { Outline, OutlineEntry } from "@vollmond/core";
import { type ColumnRow, formatColumns, oneLine } from "../output/lines.js";
import { MAX_LIMIT } from "../output/paging.js";
import { formatTokens } from "../output/sizes.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem, readWholeNumber, storeIssueDetails } from "./options.js";

// TODO(#25): the refs-in counts of each line need the local index.
/**
 * Outlines the node a singular address names, a record's root without a fragment: a first line with its address and its size
 * in tokens, then a line for each section below it, indented by its depth below the node, with its canonical address, its
 * title and its size. Under each section listed, and under the node, its block anchors come first, indented one level below
 * it, each with its canonical address and the size of its block; for a JSON or YAML record's root, its top-level members come
 * after its line, one level below it, so that an outline is useful for every format. `--depth N` goes down at most N levels,
 * every level by default, so it bounds block anchors and members as it bounds sections. A node that is not a section has no
 * sections below it.
 */
export const OUTLINE_COMMAND: Command = {
  name: "outline",
  usage: "ADDR [--depth N]",
  summary: "list the sections, block anchors and members below a node, with their addresses, titles and sizes",
  options: { depth: { type: "string" } },
  help:
    "  --depth N  go down at most N levels below the node, every level by default; a section's block anchors are\n" +
    "             one level below it, and a JSON or YAML record's top-level members one level below the record\n",
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

/**
 * Writes an outline: the node's line, then its block anchors and a data record's members, then one line per section, each
 * followed by its block anchors one level deeper. The title column is left out when no line has a title, as for a data
 * record without sections.
 */
function formatOutline(outline: Outline): string {
  const { node } = outline;
  const head = `${oneLine(`${outline.path}${node.address}`)}  ${formatTokens(node.size)}\n`;
  const lines: { readonly entry: OutlineEntry; readonly depth: number }[] = [
    ...(node.blocks ?? []).map((entry) => ({ entry, depth: 1 })),
    ...(outline.members ?? []).map((entry) => ({ entry, depth: 1 })),
    ...outline.sections.flatMap((section) => {
      const depth = (section.depth as number) - (node.depth as number);
      return [{ entry: section, depth }, ...(section.blocks ?? []).map((entry) => ({ entry, depth: depth + 1 }))];
    }),
  ];
  const titled = lines.some(({ entry }) => entry.title !== undefined && entry.title !== "");
  const rows = lines.map(
    ({ entry, depth }): ColumnRow => ({
      cells: [entry.address, ...(titled ? [entry.title ?? ""] : []), formatTokens(entry.size)],
      depth,
    }),
  );
  return head + formatColumns(rows);
}
