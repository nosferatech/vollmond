// `vmd ls [GLOB] [-n N] [--cursor C]`: the store's records and assets, a page at a time.

import type { StorePage } from "@vollmond/core";
import { formatColumns, oneLine } from "../output/lines.js";
import {
  DEFAULT_LIMITS,
  formatPageRemainder,
  formatUnreadableRecords,
  PAGE_OPTIONS,
  readLimit,
  shellWord,
} from "../output/paging.js";
import { formatCount, formatTokens } from "../output/sizes.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem } from "./options.js";

/**
 * Lists the store's records and assets whose paths the glob matches, every one without a glob, in UTF-8 byte order, at most
 * `-n` of them (100 by default). `.vmd/`, dotfiles and the configuration's ignored paths are left out. A line gives the path,
 * the size in bytes and in tokens, the record's collection when a record on the page has one, and says `asset` for an asset
 * and `unreadable` for a record that cannot be read: one with a structural error, or of a collection whose schema cannot be
 * used. After the page come the count of its unreadable records and, when more remain, their exact number and the cursor. A
 * glob without `*` that matches nothing but names a directory gets a line that suggests the glob with `/**`.
 */
export const LS_COMMAND: Command = {
  name: "ls",
  usage: "[GLOB] [-n N] [--cursor C]",
  summary: "list the store's records and assets, with their sizes",
  options: PAGE_OPTIONS,
  help:
    "  GLOB  the store paths to list, matched as a whole: * within a segment, ** across segments, so docs/** lists\n" +
    "        everything below docs\n" +
    "  -n N  list at most N, 100 by default; --cursor C continues after them\n",
  readsStore: true,
  prepare: ({ positionals, options }) => {
    const problem = argumentCountProblem(positionals, 0, 1, "a glob");
    if (problem !== null) return usagePlan(problem);
    const limit = readLimit(options.limit as string | undefined, DEFAULT_LIMITS.ls);
    if (!limit.ok) return usagePlan(limit.message);
    const glob = positionals[0];
    const cursor = options.cursor as string | undefined;
    return {
      kind: "run",
      run: async (opened) => {
        const { store } = opened as OpenedStore;
        const page = await store.list({
          limit: limit.limit,
          ...(glob === undefined ? {} : { glob }),
          ...(cursor === undefined ? {} : { cursor }),
        });
        // A glob without a wildcard that matches nothing may name a directory, which a glob matches only with /**.
        let below: string | null = null;
        if (page.ok && page.value.items.length === 0 && cursor === undefined && glob !== undefined && !glob.includes("*")) {
          const inside = await store.list({ glob: `${glob}/**`, limit: 1 });
          if (inside.ok && inside.value.items.length > 0) below = `${glob}/**`;
        }
        return outcomeOutput(page, (value) => formatPage(value, below));
      },
    };
  },
};

/**
 * Writes a page of the listing, one line per file, then the unreadable records and what remains; or, for an empty page whose
 * glob names a directory, the line that says to list `below` instead. The collection column is there only when a record on
 * the page is in a collection, so that a store without collections lists as before.
 */
function formatPage(page: StorePage, below: string | null): string {
  const withCollections = page.items.some((entry) => entry.collection !== undefined);
  const rows = page.items.map((entry) => {
    const note = entry.kind === "asset" ? "asset" : entry.readable === false ? "unreadable" : "";
    const collection = withCollections ? [entry.collection ?? ""] : [];
    return { cells: [entry.path, `${formatCount(entry.size)} B`, formatTokens(entry.size), ...collection, note] };
  });
  let text = formatColumns(rows) + formatUnreadableRecords(page.unreadable.count, page.unreadable.scope);
  if (page.cursor !== null)
    text += formatPageRemainder({ remaining: page.remaining.count, estimated: !page.remaining.exact, cursor: page.cursor });
  if (below !== null) {
    text += `no path matches ${oneLine(below.slice(0, -3))}, a directory: vmd ls ${shellWord(below)} lists what is below it\n`;
  }
  return text;
}
