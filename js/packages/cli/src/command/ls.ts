// `vmd ls [GLOB] [-n N] [--cursor C]`: the store's records and assets, a page at a time.

import type { StorePage } from "@vollmond/core";
import { formatColumns } from "../output/lines.js";
import { DEFAULT_LIMITS, formatPageRemainder, formatUnreadableRecords, PAGE_OPTIONS, readLimit } from "../output/paging.js";
import { formatCount, formatTokens } from "../output/sizes.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem } from "./options.js";

// TODO(#21): the collection column comes with the configuration's collections.
/**
 * Lists the store's records and assets whose paths the glob matches, every one without a glob, in UTF-8 byte order, at most
 * `-n` of them (100 by default). `.vmd/` and dotfiles are left out. A line gives the path, the size in bytes and in tokens,
 * and says `asset` for an asset and `unreadable` for a record that has a structural error. After the page come the count of
 * its unreadable records and, when more remain, their exact number and the cursor.
 */
export const LS_COMMAND: Command = {
  name: "ls",
  usage: "[GLOB] [-n N] [--cursor C]",
  summary: "list the store's records and assets, with their sizes",
  options: PAGE_OPTIONS,
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
        return outcomeOutput(page, formatPage);
      },
    };
  },
};

/** Writes a page of the listing, one line per file, then the unreadable records and what remains. */
function formatPage(page: StorePage): string {
  const rows = page.items.map((entry) => {
    const note = entry.kind === "asset" ? "asset" : entry.readable === false ? "unreadable" : "";
    return { cells: [entry.path, `${formatCount(entry.size)} B`, formatTokens(entry.size), note] };
  });
  let text = formatColumns(rows) + formatUnreadableRecords(page.unreadable.count, page.unreadable.scope);
  if (page.cursor !== null)
    text += formatPageRemainder({ remaining: page.remaining.count, estimated: !page.remaining.exact, cursor: page.cursor });
  return text;
}
