// `vmd check [PATHS.. | --changed REV] [-n N | --all]`: validates the store, or some of its records, and prints the issues
// found, capped, then a summary.

import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  type CheckSummary,
  fail,
  type Issue,
  makeIssue,
  type Outcome,
  parseAddress,
  type Store,
  succeed,
} from "@vollmond/core";
import { changedSince } from "../backend/git-changes.js";
import { DEFAULT_ISSUE_LIMIT, type IssueDetails, type IssueDetailsSource } from "../output/issues.js";
import { readLimit, shellWord } from "../output/paging.js";
import { formatCount } from "../output/sizes.js";
import type { StoreLocation } from "../store-discovery.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { storeIssueDetails } from "./options.js";

/** How many paths a page of the listing that expands a glob holds. */
const GLOB_PAGE = 1000;

// Deviation from the I2 design, recorded in issue #26: `--json` prints the library's summary as it is, so its members are camel
// case, `fromIndex` where the design writes `from_index`, and it adds `parsed`, which `vmd index` prints.
/**
 * Checks every record of the store, or the records PATHS name, each a store path or a glob matched as `ls` matches one, and
 * prints the issues found on stdout, in the order of their paths and positions, with the severities the configuration gives
 * them: at most 20, `-n N` of them, or every one with `--all`, then the counts per code when some were not printed, then a
 * summary line. References still resolve into the whole store. `--quiet` keeps the warnings, which are the result. Exit code
 * 4 when an issue is an error.
 *
 * A PATH that is not a store path, such as `./a.md`, fails with `address-malformed`, as `get` says of it. A PATH or glob that
 * matches no record fails the check with `address-not-found`, naming each one, and for a path that is a directory, with or
 * without its slash, with the glob that checks the records below it (reading R23 of the I2 design, for the project owner to confirm).
 * `--changed REV` checks what changed since a git revision instead: the records that differ from REV in the working tree,
 * untracked ones included, and every record that cites a path that differs, deleted or moved ones included (see `Store.check`'s
 * `changed`). A change to the configuration in use, to a file of its `schema/` directory or to the alias file makes it a check
 * of the whole store. Only the git repository around the store root is asked, so a configuration in another repository is not
 * compared with REV. It fails with `storage-failed` outside a git repository and for a revision git does not know; a REV that
 * starts with `-` is refused, so that git never reads it as an option, and so is `--changed` with PATHS.
 *
 * `--fix` is refused: it comes with phase I5's rewrites.
 */
export const CHECK_COMMAND: Command = {
  name: "check",
  usage: "[PATHS.. | --changed REV] [-n N | --all]",
  summary: "validate the store, or some records, and print the issues found",
  options: {
    limit: { type: "string", short: "n" },
    all: { type: "boolean" },
    changed: { type: "string" },
    fix: { type: "boolean" },
  },
  help:
    "  PATHS          the records to check, by store path or glob, as ls matches one; every record by default.\n" +
    "                 Their references still resolve into the whole store\n" +
    "  --changed REV  the records that differ from the git revision REV, and those that cite a path that does;\n" +
    "                 the whole store when the configuration, a schema or the alias file differs\n" +
    "  -n N           print at most N issues, 20 by default; every issue is counted\n" +
    "  --all          print every issue\n",
  readsStore: true,
  readsIndex: true,
  issueOutput: "result",
  prepare: ({ positionals, options }) => {
    if (options.fix === true) return usagePlan("check --fix is not offered yet: it comes with the rewrites of phase I5");
    if (options.all === true && options.limit !== undefined) return usagePlan("-n and --all cannot be given together");
    const limit = readLimit(options.limit as string | undefined, DEFAULT_ISSUE_LIMIT);
    if (!limit.ok) return usagePlan(limit.message);
    const issueLimit = options.all === true ? null : limit.limit;
    const revision = options.changed as string | undefined;
    if (revision !== undefined) {
      if (positionals.length > 0) return usagePlan("PATHS and --changed cannot be given together");
      if (revision === "" || revision.startsWith("-")) {
        return usagePlan(`--changed takes a revision, such as HEAD or main, not ${JSON.stringify(revision)}`);
      }
    }
    return {
      kind: "run",
      run: async (opened) => {
        const { store, index } = opened as OpenedStore;
        let checked: Outcome<CheckSummary>;
        if (revision !== undefined) {
          checked = await checkChanged(opened as OpenedStore, revision);
        } else if (positionals.length === 0) {
          checked = await store.check();
        } else {
          const records = await recordsNamed(store, positionals);
          checked = records.ok ? await store.check({ records: records.value }) : fail(records.issues);
        }
        const details = await checkIssueDetails(store, checked.issues, issueLimit);
        return outcomeOutput(checked, () => "", details, {
          issueLimit,
          trailer: (summary) => formatCheckSummary(summary, checked.issues, index !== null),
        });
      },
    };
  },
};

/**
 * Checks what changed since a revision: the whole store when the configuration in use or a file of its schema directory
 * changed, and otherwise the changed store paths, through `Store.check`'s `changed`.
 */
async function checkChanged(opened: OpenedStore, revision: string): Promise<Outcome<CheckSummary>> {
  const { store, location } = opened;
  const changed = await changedSince(location.root, revision);
  if (!changed.ok) return fail(changed.issues);
  const root = await realpath(location.root);
  const configuration = await configurationPaths(location);
  const below = (path: string, directory: string) => {
    const inside = relative(directory, path);
    return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  };
  const paths: string[] = [];
  for (const path of changed.value) {
    if (path === configuration.file || below(path, configuration.schemas)) return store.check();
    if (below(path, root)) paths.push(relative(root, path).split(sep).join("/"));
  }
  return store.check({ changed: paths });
}

/** The configuration file in use and its schema directory, as real paths, git's paths being real. */
async function configurationPaths(location: StoreLocation): Promise<{ readonly file: string; readonly schemas: string }> {
  const file = await realpath(location.configurationFile).catch(() => location.configurationFile);
  return { file, schemas: join(dirname(file), "schema") };
}

/**
 * Gives the store paths of the records the arguments name, each once, in their order: a path names a record of the store, a
 * glob every record it matches. Fails with one `address-not-found` that names every argument that matches no record, with a
 * hint for the first that names a directory.
 */
async function recordsNamed(store: Store, args: readonly string[]): Promise<Outcome<readonly string[]>> {
  const records = new Set<string>();
  const unmatched: string[] = [];
  for (const arg of args) {
    // A path that is not a store path is malformed, as `get` says of it; a directory may be written with its slash.
    if (!arg.includes("*") && !arg.endsWith("/")) {
      const parsed = parseAddress(arg);
      if (!parsed.ok) return fail(parsed.issues);
    }
    const found = arg.includes("*") ? await recordsMatching(store, arg) : await recordAt(store, arg);
    if (!found.ok) return fail(found.issues);
    if (found.value.length === 0) unmatched.push(arg);
    for (const path of found.value) records.add(path);
  }
  if (unmatched.length === 0) return succeed([...records]);
  let hint: string | undefined;
  for (const arg of unmatched) {
    if (arg.includes("*")) continue;
    const directory = arg.endsWith("/") ? arg.slice(0, -1) : arg;
    const below = await store.backend.list({ prefix: "", glob: `${directory}/**`, limit: 1 });
    if (below.ok && below.value.items.length > 0) {
      hint = `${arg} is a directory: vmd check ${shellWord(`${directory}/**`)} checks the records below it`;
      break;
    }
  }
  return fail([
    makeIssue({
      code: "address-not-found",
      path: null,
      at: null,
      message: `no record matches ${unmatched.join(", ")}`,
      ...(hint === undefined ? {} : { hint }),
    }),
  ]);
}

/** Gives the path when the store holds a record there, which the backend can see; none otherwise. */
async function recordAt(store: Store, path: string): Promise<Outcome<readonly string[]>> {
  if (store.classify(path).kind !== "record") return { ok: true, value: [], issues: [] };
  const stat = await store.backend.stat(path);
  if (stat.ok) return { ok: true, value: [path], issues: [] };
  // A record the backend cannot read is still there, and the check reports why.
  return { ok: true, value: stat.issues.every((issue) => issue.code === "address-not-found") ? [] : [path], issues: [] };
}

/** Gives the records a glob matches, every page of the listing; fails as the backend's `list` does. */
async function recordsMatching(store: Store, glob: string): Promise<Outcome<readonly string[]>> {
  const found: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await store.backend.list({ prefix: "", glob, limit: GLOB_PAGE, ...(cursor === null ? {} : { cursor }) });
    if (!page.ok) return fail(page.issues);
    for (const file of page.value.items) if (store.classify(file.path).kind === "record") found.push(file.path);
    for (const issue of page.issues) {
      if (issue.code === "storage-failed" && issue.path !== null && store.classify(issue.path).kind === "record") {
        found.push(issue.path);
      }
    }
    cursor = page.value.cursor;
  } while (cursor !== null);
  return { ok: true, value: found, issues: [] };
}

/**
 * Gives the details of the issues to print, the first `limit` of them or all for null: the semantic path of each one's node,
 * read through the store as the check read the record, and an ambiguity's candidates as other commands give them.
 */
async function checkIssueDetails(store: Store, issues: readonly Issue[], limit: number | null): Promise<IssueDetailsSource> {
  const semantic = new Map<Issue, string>();
  for (const issue of limit === null ? issues : issues.slice(0, limit)) {
    if (issue.path === null || issue.at === null || issue.at === "") continue;
    const address = await store.nodeAddress(issue.path, issue.at);
    if (address !== undefined) semantic.set(issue, address);
  }
  const candidates = storeIssueDetails(store);
  return (issue): IssueDetails | undefined => {
    const address = semantic.get(issue);
    const notes = candidates(issue);
    if (address === undefined) return notes;
    return { ...notes, semantic: address };
  };
}

/**
 * Writes the summary line: `37 records (35 from the index), 1,965 references: 40 errors, 17 warnings`, the part in
 * parentheses only for a store over the local index.
 */
function formatCheckSummary(summary: CheckSummary, issues: readonly Issue[], overIndex: boolean): string {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const fromIndex = overIndex ? ` (${formatCount(summary.fromIndex)} from the index)` : "";
  return (
    `${counted(summary.records, "record")}${fromIndex}, ${counted(summary.references, "reference")}: ` +
    `${counted(errors, "error")}, ${counted(warnings, "warning")}\n`
  );
}

/** Writes a count with its noun, singular for one. */
export function counted(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}
