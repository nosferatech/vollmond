// The local index of a `vmd` process: the per-user cache directory of the user who runs it, for this build and runtime.

import { homedir } from "node:os";
import type { CacheSettings } from "../cli.js";
import { userCacheDirectory } from "./cache-directory.js";
import { implementationId } from "./implementation-id.js";

/**
 * Gives where this process keeps the local index: vmd's directory in the per-user cache directory, from this process's
 * environment, and whether `XDG_CACHE_HOME` set it; for the running build and the runtime's Unicode version, unless
 * `implementation` names another. Null when the build wrote no implementation id, or no directory can be found.
 */
export function processCacheSettings(
  implementation: string | null = implementationId(process.versions.unicode),
): CacheSettings | null {
  if (implementation === null) return null;
  let home: string | null;
  try {
    home = homedir();
  } catch {
    home = null;
  }
  const location = userCacheDirectory({ variables: process.env, home, platform: process.platform });
  return location === null ? null : { ...location, implementation };
}
