import { execFile } from "node:child_process";
import { constants, type Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createStorageReader,
  type FileSource,
  fail,
  type Issue,
  makeIssue,
  type Outcome,
  type StorageReader,
  type StoredFile,
  succeed,
} from "@vollmond/core";

// Deviation from the specification, recorded in issue #16: file versions are SHA-1 git blob ids in every store, a SHA-256 git
// repository included, which the specification gives the SHA-256 form; and the history operations are not provided yet, since
// no command in this phase reads them.

/**
 * Creates the read side of the storage contract over a directory of the local filesystem, the store root.
 *
 * - File versions are the git blob ids of the bytes read, in a git working copy too, never what git stores: a clean filter,
 *   such as a line-ending conversion, makes git's blob differ from the file.
 * - Listings hold regular files only. They do not follow symbolic links and leave out every entry named `.git`, and reading a
 *   path whose last segment is a symbolic link finds no file.
 * - A file or a directory that cannot be read, for a permission error or any other failure but a missing path, gives
 *   `storage-failed`; a missing path gives `address-not-found`.
 * - `head()` runs `git rev-parse` in the store root, and gives the commit of `HEAD`, or null outside a git working copy, in a
 *   repository without commits, and where `git` cannot be run. There is no history.
 *
 * `root` may be relative to the working directory. It is not checked here: a root that does not exist lists no files.
 */
export function createFilesystemStorage(root: string): StorageReader {
  return createStorageReader(new FilesystemFileSource(resolve(root)));
}

/** A file source over a directory, with its paths joined below it segment by segment. */
class FilesystemFileSource implements FileSource {
  readonly history = null;
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async listFiles(directory: string): Promise<Outcome<readonly string[]>> {
    const paths: string[] = [];
    const issues: Issue[] = [];
    let entries: Dirent[];
    try {
      entries = await readdir(this.#absolute(directory), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return succeed([]);
      return fail([storageFailed(directory === "" ? null : directory, `cannot list ${directory || "the store root"}`, error)]);
    }
    await this.#walk(directory, entries, paths, issues);
    return succeed(paths, issues);
  }

  /** Adds the files among `entries`, the entries of `directory`, and those below its subdirectories, to `paths`. */
  async #walk(directory: string, entries: readonly Dirent[], paths: string[], issues: Issue[]): Promise<void> {
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.isFile()) {
        paths.push(path);
      } else if (entry.isDirectory()) {
        let below: Dirent[];
        try {
          below = await readdir(this.#absolute(path), { withFileTypes: true });
        } catch (error) {
          if (!isMissing(error)) issues.push(storageFailed(path, `cannot list ${path}`, error));
          continue;
        }
        await this.#walk(path, below, paths, issues);
      }
    }
  }

  async readFile(path: string): Promise<Outcome<StoredFile>> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      // Without following a symbolic link at the last segment, as listings do not.
      handle = await open(this.#absolute(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if (isMissing(error) || errorCode(error) === "ELOOP") return fail([notFound(path)]);
      return fail([storageFailed(path, `cannot read ${path}`, error)]);
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) return fail([notFound(path)]);
      const bytes = new Uint8Array(await handle.readFile());
      return succeed({ bytes, modified: stats.mtime.toISOString() });
    } catch (error) {
      return fail([storageFailed(path, `cannot read ${path}`, error)]);
    } finally {
      await handle.close();
    }
  }

  async head(): Promise<Outcome<string | null>> {
    const repository = await this.#git(["rev-parse", "--is-inside-work-tree"]);
    if (repository.kind === "unavailable") return succeed(null);
    if (repository.kind === "failed") {
      if (/not a git repository/i.test(repository.stderr)) return succeed(null);
      return fail([storageFailed(null, "cannot read the head of the git repository", repository.stderr.trim())]);
    }
    if (repository.stdout.trim() !== "true") return succeed(null);
    const commit = await this.#git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    if (commit.kind === "ran") return succeed(commit.stdout.trim());
    // `--verify --quiet` exits with 1 and prints nothing when HEAD names no commit yet.
    if (commit.kind === "failed" && commit.stderr.trim() === "") return succeed(null);
    return fail([
      storageFailed(null, "cannot read the head of the git repository", commit.kind === "failed" ? commit.stderr : ""),
    ]);
  }

  /** Runs git in the store root, with the repository found from there rather than from the environment. */
  #git(args: readonly string[]): Promise<GitRun> {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    return new Promise((done) => {
      execFile("git", ["-C", this.#root, ...args], { env, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error === null) done({ kind: "ran", stdout });
        else if (errorCode(error) === "ENOENT") done({ kind: "unavailable" });
        else done({ kind: "failed", stderr });
      });
    });
  }

  #absolute(path: string): string {
    return path === "" ? this.#root : join(this.#root, ...path.split("/"));
  }
}

/** How a run of git ended: it succeeded, it exited with an error, or git could not be started. */
type GitRun =
  | { readonly kind: "ran"; readonly stdout: string }
  | { readonly kind: "failed"; readonly stderr: string }
  | { readonly kind: "unavailable" };

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Whether a filesystem error says that the path, or a directory on it, does not exist. */
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function notFound(path: string): Issue {
  return makeIssue({ code: "address-not-found", path, at: null, message: `${path} does not exist` });
}

/** Creates a `storage-failed` issue, whose message gives the error's code, such as `EACCES`, rather than its absolute path. */
function storageFailed(path: string | null, what: string, cause: unknown): Issue {
  const reason = errorCode(cause) ?? (cause instanceof Error ? cause.message : String(cause));
  return makeIssue({ code: "storage-failed", path, at: null, message: reason === "" ? what : `${what}: ${reason}` });
}
