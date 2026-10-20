// `vmd index [--publish DIR]`: brings the local index up to date for the whole store, and evicts what the cache no longer needs.

import { type CheckSummary, succeed } from "@vollmond/core";
import { formatCount } from "../output/sizes.js";
import { counted } from "./check.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";

/** What `vmd index` did, which `--json` prints. */
export interface IndexSummary extends CheckSummary {
  /** The bytes of this build's entries and snapshots after eviction; absent without a local index. */
  readonly cacheBytes?: number;
  /** How many entries could not be written, and were left out; absent without a local index. */
  readonly failedWrites?: number;
  /** Why nothing was kept, when the store is not over a local index. */
  readonly noIndex?: string;
}

/**
 * Checks the whole store over the local index, so that an entry is written for each record parsed and the snapshot of the
 * check is kept, which `outline` reads its refs-in counts from; then runs the cache's eviction at once, whenever it last ran.
 * Prints the counts, `37 records (2 parsed, 35 from the index), 1,965 references; cache 1.4 MB`, and how many entries could
 * not be written, if any. Reports only the files that could not be read, exit code 4, and none of the store's validation
 * issues, which `check` reports. Without a usable cache it still checks, and says why nothing was kept. `--no-cache` is a
 * usage error, and so is `--publish`, which writes the portable index of phase I7.
 */
export const INDEX_COMMAND: Command = {
  name: "index",
  usage: "[--publish DIR]",
  summary: "bring the local index up to date for the whole store",
  options: { publish: { type: "string" } },
  help: "  --publish DIR  write the portable index; not offered yet, it comes with phase I7\n",
  readsStore: true,
  readsIndex: true,
  prepare: ({ positionals, options, globals }) => {
    if (positionals.length > 0) return usagePlan(`unexpected argument ${JSON.stringify(positionals[0])}`);
    if (options.publish !== undefined) {
      return usagePlan("index --publish is not offered yet: the portable index comes with phase I7");
    }
    // Reading R25 of the I2 design, for the project owner to confirm: `--no-cache` contradicts the command, while a cache that
    // cannot be used is not the user's request, so it is reported rather than taken as `--no-cache`.
    if (globals.noCache) return usagePlan("vmd index writes the local index, which --no-cache turns off");
    return {
      kind: "run",
      run: async (opened) => {
        const { store, index, noIndex } = opened as OpenedStore;
        const checked = await store.check();
        if (!checked.ok) return outcomeOutput(checked, () => "");
        // Validation does not gate the index: only a file that could not be read is the index's own issue.
        const unread = checked.issues.filter((issue) => issue.code === "storage-failed");
        let summary: IndexSummary = checked.value;
        if (index === null) {
          summary = { ...summary, noIndex: noIndex ?? "there is no local index" };
        } else {
          await index.evict();
          summary = { ...summary, cacheBytes: await index.size(), failedWrites: index.failedWrites };
        }
        return outcomeOutput(succeed(summary, unread), formatIndexSummary);
      },
    };
  },
};

/** Writes what `vmd index` did, as its text output. */
function formatIndexSummary(summary: IndexSummary): string {
  // A record the backend could not read when listing it is neither parsed nor read from the index.
  const unread = summary.records - summary.parsed - summary.fromIndex;
  const notRead = unread === 0 ? "" : `, ${formatCount(unread)} not read`;
  const counts =
    `${counted(summary.records, "record")} (${formatCount(summary.parsed)} parsed, ` +
    `${formatCount(summary.fromIndex)} from the index${notRead}), ${counted(summary.references, "reference")}`;
  if (summary.cacheBytes === undefined) return `${counts}\nno local index was kept: ${summary.noIndex}\n`;
  const failures = summary.failedWrites ?? 0;
  const failed = failures === 0 ? "" : `; ${formatCount(failures)} ${failures === 1 ? "entry" : "entries"} could not be written`;
  return `${counts}; cache ${formatBytes(summary.cacheBytes)}${failed}\n`;
}

/** Writes a size in bytes with one decimal in kB, MB or GB from a thousand bytes on: `1.4 MB`, `812 B`. */
function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  for (const [unit, suffix] of [
    [1e3, "kB"],
    [1e6, "MB"],
  ] as const) {
    if (bytes < unit * 1000) return `${(bytes / unit).toFixed(1)} ${suffix}`;
  }
  return `${(bytes / 1e9).toFixed(1)} GB`;
}
