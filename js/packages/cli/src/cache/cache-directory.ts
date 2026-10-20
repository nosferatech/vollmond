// Where the local index lives: the per-user cache directory, outside every store, and never inside the store being read.

import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

/** What the per-user cache directory is found from: the environment's variables, the user's home and the platform. */
export interface CacheEnvironment {
  readonly variables: Readonly<Record<string, string | undefined>>;
  /** The user's home directory, or null when it is not known. */
  readonly home: string | null;
  /** The platform, as `process.platform` names it. */
  readonly platform: string;
}

// Deviation from the I2 design, recorded in issue #25: an absolute XDG_CACHE_HOME is used on every platform, macOS
// included, where the design names ~/Library/Caches; it is what a user who sets it asks for, and what tests and CI set.
/** vmd's directory in the per-user cache directory, and whether `XDG_CACHE_HOME` set it or it is the platform's default. */
export interface CacheLocation {
  readonly directory: string;
  /** True for a directory `XDG_CACHE_HOME` set, which may be anywhere; false for the default in the user's home. */
  readonly explicit: boolean;
}

/**
 * Gives vmd's directory in the per-user cache directory: `vmd` in `XDG_CACHE_HOME` when that is an absolute path, on every
 * platform; otherwise `~/Library/Caches/vmd` on macOS and `~/.cache/vmd` elsewhere, as the XDG Base Directory Specification
 * gives its default. A relative `XDG_CACHE_HOME` is ignored, as that specification says. Null without a home to put it in.
 */
export function userCacheDirectory(environment: CacheEnvironment): CacheLocation | null {
  const xdg = environment.variables.XDG_CACHE_HOME;
  if (xdg !== undefined && xdg !== "" && isAbsolute(xdg)) return { directory: join(xdg, "vmd"), explicit: true };
  if (environment.home === null || environment.home === "" || !isAbsolute(environment.home)) return null;
  const directory =
    environment.platform === "darwin"
      ? join(environment.home, "Library", "Caches", "vmd")
      : join(environment.home, ".cache", "vmd");
  return { directory, explicit: false };
}

// Recorded in issue #25: the design's rule that the cache is never in the store, enforced where a setting such as
// XDG_CACHE_HOME would put it there, as the project owner decided on card AT.
/**
 * Whether a cache directory may serve a store. Its symbolic links resolved, it never may at the store root or below it. One
 * that `XDG_CACHE_HOME` set (`explicit`) may not either at or below any git working tree that encloses the store, each
 * directory from the store root up to the filesystem's root that has a `.git` entry, a submodule's and the repository's
 * that holds it alike: a cache there could be committed and read back as someone else's claims about the store's files. The
 * default directory in the user's home is used even inside a working tree, such as a home kept in git for its dotfiles,
 * since the home is the user's own and never a checkout that others commit to. A part of the directory that does not exist
 * yet is taken as written below its nearest existing ancestor. Reads no git.
 */
export async function cacheMayServe(cacheDirectory: string, storeRoot: string, explicit: boolean): Promise<boolean> {
  const cache = await realPathOfMaybeMissing(cacheDirectory);
  const root = await realpath(storeRoot);
  const enclosing = explicit ? [root, ...(await workingTreesOf(root))] : [root];
  return !enclosing.some(
    (directory) => cache === directory || cache.startsWith(directory.endsWith(sep) ? directory : `${directory}${sep}`),
  );
}

/** The real path of a path whose last parts may not exist: its nearest existing ancestor's real path, with the rest below. */
async function realPathOfMaybeMissing(path: string): Promise<string> {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** Every directory from `root` up to the filesystem's root that has a `.git` entry, a directory or a file, nearest first. */
async function workingTreesOf(root: string): Promise<string[]> {
  const trees: string[] = [];
  for (let directory = root; ; ) {
    try {
      await lstat(join(directory, ".git"));
      trees.push(directory);
    } catch {
      // No .git here.
    }
    const parent = dirname(directory);
    if (parent === directory) return trees;
    directory = parent;
  }
}
