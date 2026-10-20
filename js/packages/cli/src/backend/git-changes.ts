// The files of a git revision's tree, by path and blob id, for `check --changed`, read with git's plumbing alone.

import { execFile } from "node:child_process";
import { fail, makeIssue, type Outcome, succeed } from "@vollmond/core";

/** The most bytes git may print for the tree, 1 GiB, far more than a repository's paths take. */
const MAX_GIT_OUTPUT = 1024 * 1024 * 1024;

/**
 * The environment variables that make git use another repository, index, object store or configuration than the one around
 * the directory it runs in, or run a program of its choosing. `--changed` asks about the repository around the store root, so
 * they are removed.
 */
const REMOVED_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_EXTERNAL_DIFF",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
];

/**
 * The oldest git `--changed` runs: 2.30 taught `git rev-parse` `--end-of-options` ("git rev-parse" learned the
 * "--end-of-options" to help scripts to safely take a parameter that is supposed to be a revision, git's
 * Documentation/RelNotes/2.30.0, read on 2026-10-20), which keeps the revision from being read as an option.
 */
const MINIMUM_GIT = [2, 30] as const;

/** A revision's tree: the repository's top level, and each regular file's blob id by its path from the top level. */
export interface RevisionTree {
  /** The real path of the working tree's top level, as git gives it. */
  readonly top: string;
  /** The blob id of each regular file in the revision, by its `/`-separated path from the top level. */
  readonly blobs: ReadonlyMap<string, string>;
}

// Deviation from the I2 design, recorded in issue #26: the design asks git for the working tree's changes with `git diff` and
// `git ls-files`; those run the repository's fsmonitor and clean filters, and miss ignored files and nested repositories. The
// revision's tree is compared with the store's own listing instead, whose versions are git blob ids.
/**
 * Reads the tree of `revision` in the git repository around `directory`: every regular file's blob id, symbolic links and
 * submodules left out. Runs only git's plumbing commands that read objects (`rev-parse`, `ls-tree`), from `PATH` and never
 * through a shell, with the revision after `--end-of-options` so that it is never read as an option, `core.fsmonitor` off,
 * and without the variables that would point git elsewhere; nothing in the working tree, its index or its filters is run.
 *
 * Fails with `storage-failed` when git cannot be run or is older than 2.30, when `directory` is in no git working tree, and
 * when the repository has no such revision.
 */
export async function revisionTree(directory: string, revision: string): Promise<Outcome<RevisionTree>> {
  const version = await runGit(directory, ["version"]);
  if (!version.ok) {
    if (version.missing) return storageFailed("--changed needs git, which cannot be run here: it is not on PATH");
    return storageFailed(`--changed needs git, which fails here: ${version.reason}`);
  }
  const found = /^git version (\d+)\.(\d+)\S*/.exec(version.output.trim());
  const [major, minor] = found === null ? [0, 0] : [Number(found[1]), Number(found[2])];
  if (major < MINIMUM_GIT[0] || (major === MINIMUM_GIT[0] && minor < MINIMUM_GIT[1])) {
    const shown = found === null ? JSON.stringify(version.output.trim()) : found[0].slice("git version ".length);
    return storageFailed(`--changed needs git ${MINIMUM_GIT.join(".")} or later, and this git is ${shown}`);
  }
  const top = await runGit(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return storageFailed(`--changed needs the store to be in a git repository: ${top.reason}`);
  const root = top.output.replace(/\n$/, "");
  const tree = await runGit(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{tree}`]);
  if (!tree.ok) return storageFailed(`git has no revision ${revision} in the store's repository`);
  const listed = await runGit(root, ["ls-tree", "-r", "-z", "--full-tree", "--end-of-options", tree.output.trim()]);
  if (!listed.ok) return storageFailed(`git cannot list the tree of ${revision}: ${listed.reason}`);
  const blobs = new Map<string, string>();
  for (const entry of listed.output.split("\0")) {
    // `<mode> SP <type> SP <object> TAB <path>`.
    const match = /^(\d{6}) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(entry);
    if (match === null) continue;
    const [, mode, type, object, path] = match as unknown as [string, string, string, string, string];
    if (type === "blob" && mode !== "120000") blobs.set(path, object);
  }
  return succeed({ top: root, blobs });
}

/** What one run of git gave: its output, or why it failed, and whether git is missing. */
type GitRun =
  | { readonly ok: true; readonly output: string }
  | { readonly ok: false; readonly reason: string; readonly missing: boolean };

/** Runs git in `directory` with `args`, `core.fsmonitor` off and without the variables that would point it elsewhere. */
function runGit(directory: string, args: readonly string[]): Promise<GitRun> {
  const env = { ...process.env };
  for (const name of REMOVED_VARIABLES) delete env[name];
  for (const name of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete env[name];
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", directory, "-c", "core.fsmonitor=false", ...args],
      { encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT, env, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, output: stdout });
          return;
        }
        const code = (error as { code?: unknown }).code;
        const said = stderr.trim().split("\n")[0];
        const reason = said !== undefined && said !== "" ? said : typeof code === "string" ? code : error.message;
        resolve({ ok: false, reason: reason.replace(/^fatal: /, ""), missing: code === "ENOENT" });
      },
    );
  });
}

/** A failure with one `storage-failed` that says why. */
function storageFailed(message: string): Outcome<never> {
  return fail([makeIssue({ code: "storage-failed", path: null, at: null, message })]);
}
