// The files that differ from a revision in the git working tree around a store, for `check --changed`.

import { execFile } from "node:child_process";
import { join } from "node:path";
import { fail, makeIssue, type Outcome, succeed } from "@vollmond/core";

/** The most bytes git may print for one of the lists read, 256 MiB, far more than a repository's paths take. */
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

/**
 * The environment variables that make git use another repository, index or object store than the one around the directory it
 * runs in. `--changed` asks about the repository around the store root, so they are removed.
 */
const REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
];

/**
 * Gives the absolute paths of the files that differ from `revision` in the working tree of the git repository around
 * `directory`: those git's diff names, with rename detection off so that both sides of a move are named, deleted ones
 * included, and the untracked files git does not ignore. Runs git from `PATH`, never through a shell, with the revision after
 * `--end-of-options`, so that it is never read as an option.
 *
 * Fails with `storage-failed` when git cannot be run, when `directory` is in no git working tree, and when git cannot compare
 * with the revision, each with git's own reason.
 */
export async function changedSince(directory: string, revision: string): Promise<Outcome<readonly string[]>> {
  const top = await runGit(directory, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return storageFailed(`--changed needs the store to be in a git repository: ${top.reason}`);
  const root = top.output.replace(/\n$/, "");
  const diff = await runGit(root, ["diff", "--name-only", "-z", "--no-renames", "--end-of-options", revision, "--"]);
  if (!diff.ok) return storageFailed(`git cannot compare the store with ${revision}: ${diff.reason}`);
  const untracked = await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!untracked.ok) return storageFailed(`git cannot list the untracked files: ${untracked.reason}`);
  const paths = new Set<string>();
  for (const output of [diff.output, untracked.output]) {
    for (const path of output.split("\0")) if (path !== "") paths.add(join(root, path));
  }
  return succeed([...paths]);
}

/** What one run of git gave: its output, or why it failed. */
type GitRun = { readonly ok: true; readonly output: string } | { readonly ok: false; readonly reason: string };

/** Runs git in `directory` with `args`, without the variables that would point it at another repository. */
function runGit(directory: string, args: readonly string[]): Promise<GitRun> {
  const env = { ...process.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", directory, ...args],
      { encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT, env, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, output: stdout });
          return;
        }
        const said = stderr.trim().split("\n")[0];
        const code = (error as { code?: unknown }).code;
        const reason = said !== undefined && said !== "" ? said : typeof code === "string" ? code : error.message;
        resolve({ ok: false, reason: reason.replace(/^fatal: /, "") });
      },
    );
  });
}

/** A failure with one `storage-failed` that says why. */
function storageFailed(message: string): Outcome<never> {
  return fail([makeIssue({ code: "storage-failed", path: null, at: null, message })]);
}
