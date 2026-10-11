import { execFile } from "node:child_process";
import { constants, type Dirent } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
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
 * - Paths are exact. A path names a file only when the filesystem stores it under that name, byte for byte, below the root's
 *   real path: on a filesystem that ignores case or Unicode normalization, `A.md` does not find `a.md`, and a path through a
 *   symbolic link, at any segment, finds nothing. Listings hold regular files only, by their stored names, and do not
 *   descend into symbolic links.
 * - Every path with a `.git` segment is left out of listings and finds no file.
 * - A file or a directory that cannot be read, for a permission error or any other failure but a missing path, gives
 *   `storage-failed`; a missing path, or one that names something other than a regular file (a directory, a FIFO), gives
 *   `address-not-found`.
 * - `head()` runs `git rev-parse` in the store root, and gives the commit of `HEAD`, or null outside a git working copy, in a
 *   repository without commits, for a root that does not exist, and where `git` cannot be run. There is no history.
 *
 * `root` may be relative to the working directory. It is not checked here: a root that does not exist lists no files. Its
 * real path is resolved at the first operation that finds the root, and kept.
 */
export function createFilesystemStorage(root: string): StorageReader {
  return createStorageReader(new FilesystemFileSource(resolve(root)));
}

/** A file source over a directory, with its paths joined below the directory's real path segment by segment. */
class FilesystemFileSource implements FileSource {
  readonly history = null;
  readonly #root: string;
  #realRoot: string | undefined;

  constructor(root: string) {
    this.#root = root;
  }

  async listFiles(directory: string): Promise<Outcome<readonly string[]>> {
    const located = await this.#locate(directory);
    if (located.kind === "absent") return succeed([]);
    const what = `cannot list ${directory || "the store root"}`;
    if (located.kind === "failed") return fail([storageFailed(directory === "" ? null : directory, what, located.cause)]);
    const paths: string[] = [];
    const issues: Issue[] = [];
    let entries: Dirent[];
    try {
      entries = await readdir(located.absolute, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return succeed([]);
      return fail([storageFailed(directory === "" ? null : directory, what, error)]);
    }
    await this.#walk(directory, located.absolute, entries, paths, issues);
    return succeed(paths, issues);
  }

  /**
   * Finds the absolute path of a store path, `""` for the root: absent when the root or the path does not exist, when the
   * path has a `.git` segment, or when the filesystem stores it under another name or reaches it through a symbolic link;
   * failed when the filesystem cannot tell.
   */
  async #locate(path: string): Promise<Location> {
    const segments = path === "" ? [] : path.split("/");
    if (segments.includes(".git")) return { kind: "absent" };
    if (this.#realRoot === undefined) {
      try {
        this.#realRoot = await realpath(this.#root);
      } catch (error) {
        return isMissing(error) ? { kind: "absent" } : { kind: "failed", cause: error };
      }
    }
    const absolute = join(this.#realRoot, ...segments);
    if (segments.length === 0) return { kind: "found", absolute };
    let real: string;
    try {
      // The real path holds each segment's stored name, and the target of any symbolic link on the way. The promise API asks
      // the system's realpath, as `realpath.native` does; the JavaScript `realpath` keeps the names as given.
      real = await realpath(absolute);
    } catch (error) {
      return isMissing(error) || errorCode(error) === "ELOOP" ? { kind: "absent" } : { kind: "failed", cause: error };
    }
    return real === absolute ? { kind: "found", absolute } : { kind: "absent" };
  }

  /** Adds the files among `entries`, the entries of `directory`, and those below its subdirectories, to `paths`. */
  async #walk(directory: string, absolute: string, entries: readonly Dirent[], paths: string[], issues: Issue[]): Promise<void> {
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.isFile()) {
        paths.push(path);
      } else if (entry.isDirectory()) {
        const below = join(absolute, entry.name);
        let belowEntries: Dirent[];
        try {
          belowEntries = await readdir(below, { withFileTypes: true });
        } catch (error) {
          if (!isMissing(error)) issues.push(storageFailed(path, `cannot list ${path}`, error));
          continue;
        }
        await this.#walk(path, below, belowEntries, paths, issues);
      }
    }
  }

  async readFile(path: string): Promise<Outcome<StoredFile>> {
    const located = await this.#locate(path);
    if (located.kind === "absent") return fail([notFound(path)]);
    if (located.kind === "failed") return fail([storageFailed(path, `cannot read ${path}`, located.cause)]);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      // Without following a symbolic link that replaced the file since it was located, and without waiting on a FIFO.
      handle = await open(located.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
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
    const root = await this.#locate("");
    if (root.kind === "absent") return succeed(null);
    if (root.kind === "failed") return fail([storageFailed(null, "cannot find the store root", root.cause)]);
    const repository = await this.#git(root.absolute, ["rev-parse", "--is-inside-work-tree"]);
    if (repository.kind === "unavailable") return succeed(null);
    if (repository.kind === "failed") {
      if (/not a git repository/i.test(repository.stderr)) return succeed(null);
      return fail([storageFailed(null, "cannot read the head of the git repository", repository.stderr.trim())]);
    }
    if (repository.stdout.trim() !== "true") return succeed(null);
    const commit = await this.#git(root.absolute, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    if (commit.kind === "ran") return succeed(commit.stdout.trim());
    // `--verify --quiet` exits with 1 and prints nothing when HEAD names no commit yet.
    if (commit.kind === "failed" && commit.stderr.trim() === "") return succeed(null);
    return fail([
      storageFailed(null, "cannot read the head of the git repository", commit.kind === "failed" ? commit.stderr : ""),
    ]);
  }

  /**
   * Runs git in `directory`, with the repository found from there rather than from the environment, and its messages in
   * English, which `head()` reads.
   */
  #git(directory: string, args: readonly string[]): Promise<GitRun> {
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    return new Promise((done) => {
      execFile("git", ["-C", directory, ...args], { env, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error === null) done({ kind: "ran", stdout });
        else if (errorCode(error) === "ENOENT") done({ kind: "unavailable" });
        else done({ kind: "failed", stderr });
      });
    });
  }
}

/** Where a store path is on the filesystem: found at an absolute path, absent, or unknown after an error. */
type Location =
  | { readonly kind: "found"; readonly absolute: string }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly cause: unknown };

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
