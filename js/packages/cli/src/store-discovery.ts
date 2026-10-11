// Finding the store: its root, the directory that holds `.vmd/config.yaml`, and the configuration file to read, which
// `--config` can take from outside the store.

import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Where a store is: its root and its configuration file. */
export interface StoreLocation {
  /** The store root, an absolute path. */
  readonly root: string;
  /** The configuration file, an absolute path: the root's `.vmd/config.yaml`, or the file `--config` names. */
  readonly configurationFile: string;
  /** The configuration file as messages name it: `.vmd/config.yaml`, or the path `--config` was given. */
  readonly configurationName: string;
  /**
   * The working directory as a store path, `""` at the root and `tickets` in its `tickets` directory, or null when the working
   * directory is outside the store.
   */
  readonly workingPrefix: string | null;
}

/** Why no store was found: a message and a hint, for the user. */
export interface StoreNotFound {
  readonly message: string;
  readonly hint: string;
}

/** What {@link discoverStore} looks from, and the options that name the store and its configuration. */
export interface StoreRequest {
  /** The working directory, an absolute path. */
  readonly cwd: string;
  /** The value of `--store`: the store root, relative to `cwd` or absolute. */
  readonly store?: string;
  /** The value of `--config`: a configuration file used in place of the store's own, relative to `cwd` or absolute. */
  readonly config?: string;
}

/** The store's configuration file, relative to its root. */
export const CONFIGURATION_PATH = ".vmd/config.yaml";

/**
 * Finds the store a command reads.
 *
 * - With `--store`, the root is that directory. Without `--config`, it must hold `.vmd/config.yaml`; with it, it need not.
 * - Otherwise the root is the nearest directory, from the working directory up to the filesystem's root, that holds
 *   `.vmd/config.yaml` as a file (a symbolic link to one counts). `--config` does not stop the search, since a store
 *   whose configuration lives elsewhere has no file to find: such a store is named with `--store`.
 * - `--config` replaces the root's configuration file, which is then not read. Its path is not checked here; reading it is.
 *
 * Fails with a message and a hint when no store is found, when `--store` names no directory, and when a directory on the way
 * cannot be read, for a permission error or another reason.
 */
export async function discoverStore(
  request: StoreRequest,
): Promise<{ readonly ok: true; readonly value: StoreLocation } | { readonly ok: false; readonly error: StoreNotFound }> {
  let root: string;
  if (request.store !== undefined) {
    root = resolve(request.cwd, request.store);
    const kind = await fileKind(root);
    if (kind.kind === "failed")
      return notFound(`cannot read --store ${request.store}: ${kind.reason}`, "check the path and its permissions");
    if (kind.kind !== "directory") {
      return notFound(`--store ${request.store} is not a directory`, "name the store root, the directory that holds .vmd/");
    }
    if (request.config === undefined) {
      const configuration = await fileKind(join(root, ".vmd", "config.yaml"));
      if (configuration.kind === "failed") {
        return notFound(
          `cannot read ${join(request.store, CONFIGURATION_PATH)}: ${configuration.reason}`,
          "check its permissions",
        );
      }
      if (configuration.kind !== "file") {
        return notFound(
          `--store ${request.store} is not a vmd store: it has no ${CONFIGURATION_PATH}`,
          `create ${CONFIGURATION_PATH} holding "vmd: 1", or name a configuration kept elsewhere with --config`,
        );
      }
    }
  } else {
    const found = await findRootUpwards(request.cwd);
    if (!found.ok) return found;
    if (found.root === null) {
      return notFound(
        `no vmd store here: neither ${request.cwd} nor a directory above it holds ${CONFIGURATION_PATH}`,
        request.config === undefined
          ? "run vmd inside a store, or name its root with --store"
          : "with --config, name the store root with --store",
      );
    }
    root = found.root;
  }
  const configurationFile =
    request.config === undefined ? join(root, ".vmd", "config.yaml") : resolve(request.cwd, request.config);
  const configurationName = request.config ?? CONFIGURATION_PATH;
  return {
    ok: true,
    value: { root, configurationFile, configurationName, workingPrefix: await workingPrefix(root, request.cwd) },
  };
}

/** A failed discovery. */
function notFound(message: string, hint: string): { readonly ok: false; readonly error: StoreNotFound } {
  return { ok: false, error: { message, hint } };
}

/** Looks for `.vmd/config.yaml` in `start` and each directory above it, and returns the first that holds it, or null. */
async function findRootUpwards(
  start: string,
): Promise<{ readonly ok: true; readonly root: string | null } | { readonly ok: false; readonly error: StoreNotFound }> {
  let directory = resolve(start);
  for (;;) {
    const candidate = join(directory, ".vmd", "config.yaml");
    const kind = await fileKind(candidate);
    if (kind.kind === "file") return { ok: true, root: directory };
    if (kind.kind === "failed")
      return notFound(`cannot read ${candidate}: ${kind.reason}`, "check its permissions, or name the store with --store");
    const parent = dirname(directory);
    if (parent === directory) return { ok: true, root: null };
    directory = parent;
  }
}

/** What a path names, following symbolic links. */
type FileKind =
  | { readonly kind: "file" | "directory" | "other" | "absent" }
  | { readonly kind: "failed"; readonly reason: string };

/** Says what `path` names: absent for a missing path or one through a file, failed when the filesystem cannot tell. */
async function fileKind(path: string): Promise<FileKind> {
  try {
    const info = await stat(path);
    return { kind: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other" };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    return { kind: "failed", reason: typeof code === "string" ? code : String(error) };
  }
}

/** Gives the working directory as a store path below `root`, or null outside it; both are compared by their real paths. */
async function workingPrefix(root: string, cwd: string): Promise<string | null> {
  let path: string;
  try {
    path = relative(await realpath(root), await realpath(cwd));
  } catch {
    return null;
  }
  if (path === "") return "";
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return null;
  return path.split(sep).join("/");
}
