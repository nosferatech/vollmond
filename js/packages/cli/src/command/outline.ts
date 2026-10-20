// `vmd outline ADDR [--depth N]`: the sections below a node, their block anchors and a data record's members, without their
// content.

import { type Outline, type OutlineEntry, succeed } from "@vollmond/core";
import { type ColumnRow, formatColumns, oneLine } from "../output/lines.js";
import { MAX_LIMIT } from "../output/paging.js";
import { formatCount, formatTokens } from "../output/sizes.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem, rangeJson, readWholeNumber, storeIssueDetails } from "./options.js";

/**
 * Outlines the node a singular address names, a record's root without a fragment: a first line with its address and its size
 * in tokens, then a line for each section below it, indented by its depth below the node, with its canonical address, its
 * title and its size. Under each section listed, and under the node when it is a section or a `$body`, its block anchors
 * come first, indented one level below it, each with its canonical address, the size of its block and its range in the
 * `$body` (`@range [start,end]`), which tells apart blocks whose name is not unique; for a JSON or YAML record's root, its top-level members come
 * after its line, one level below it, so that an outline is useful for every format. `--depth N` goes down at most N levels,
 * every level by default, so it bounds block anchors and members as it bounds sections. A node that is not a section has no
 * sections below it. Each line ends with its refs-in count, the references into the node and below it, when the local index
 * holds a snapshot of a full check that is still current; otherwise there is no count.
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
  readsIndex: true,
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
        const details = storeIssueDetails(store);
        if (!outline.ok) return outcomeOutput(outline, () => "", details);
        // The JSON output writes ranges as [start, end], as everywhere else; the text is written from the library's outline.
        return outcomeOutput(succeed(jsonOutline(outline.value), outline.issues), () => formatOutline(outline.value), details);
      },
    };
  },
};

// TODO(#26): without a current snapshot, the outline is to say that `vmd index` gives the counts, once that command exists.
/**
 * Writes an outline: the node's line, then its block anchors and a data record's members, then one line per section, each
 * followed by its block anchors one level deeper. The title column is left out when no line has a title, as for a data
 * record without sections.
 */
function formatOutline(outline: Outline): string {
  const { node } = outline;
  const head = `${oneLine(`${outline.path}${node.address}`)}  ${formatTokens(node.size)}${rangeNote(node, "  ")}${refsInNote(node, "  ")}\n`;
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
      cells: [
        entry.address,
        ...(titled ? [entry.title ?? ""] : []),
        formatTokens(entry.size),
        rangeNote(entry, ""),
        ...(entry.refsIn === undefined ? [] : [refsInNote(entry, "")]),
      ],
      depth,
    }),
  );
  return head + formatColumns(rows);
}

/**
 * Writes a block anchor's range in its `$body`, after `before`, as `@range [start,end]`, so that two blocks whose name is not
 * unique, and whose address is then their `$body`'s, are told apart; the empty string for any other entry.
 */
function rangeNote(entry: OutlineEntry, before: string): string {
  return entry.range === undefined ? "" : `${before}@range ${JSON.stringify(rangeJson(entry.range))}`;
}

/** Writes an entry's refs-in count after `before`, as `N refs-in`; the empty string for an entry without one. */
function refsInNote(entry: OutlineEntry, before: string): string {
  return entry.refsIn === undefined ? "" : `${before}${formatCount(entry.refsIn)} refs-in`;
}

/** An outline as `--json` writes it: each block anchor's range as `[start, end]`. */
function jsonOutline(outline: Outline): unknown {
  return {
    ...outline,
    node: jsonEntry(outline.node),
    sections: outline.sections.map(jsonEntry),
    ...(outline.members === undefined ? {} : { members: outline.members.map(jsonEntry) }),
  };
}

/** An outline entry as `--json` writes it, with its range and its block anchors' as `[start, end]`. */
function jsonEntry(entry: OutlineEntry): unknown {
  return {
    ...entry,
    ...(entry.range === undefined ? {} : { range: rangeJson(entry.range) }),
    ...(entry.blocks === undefined ? {} : { blocks: entry.blocks.map(jsonEntry) }),
  };
}
