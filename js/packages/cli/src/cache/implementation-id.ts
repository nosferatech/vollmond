// The id the local index keys entries by: of the build of core, which the build writes, and of the runtime's Unicode data,
// which derived anchors depend on through the runtime's normalization.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Deviation from the I2 design, recorded in issue #25: the id covers the runtime's Unicode version beside the build's, which
// the design's id, a hash of core's sources, leaves out.
/**
 * Gives the implementation id of the running vmd: the SHA-256 of core's build id, as `npm run build` writes it, and of the
 * runtime's Unicode version, so that two runtimes whose normalization may differ never share entries. Null when the build
 * wrote no id, as when core runs from its sources: the cache is then not used.
 */
export function implementationId(unicodeVersion: string | undefined): string | null {
  let build: unknown;
  try {
    const require = createRequire(import.meta.url);
    build = JSON.parse(readFileSync(require.resolve("@vollmond/core/implementation-id.json"), "utf8"));
  } catch {
    return null;
  }
  const id = (build as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) return null;
  return implementationIdOf(id, unicodeVersion);
}

/** Gives the implementation id of a build of core on a runtime with this Unicode version. */
export function implementationIdOf(build: string, unicodeVersion: string | undefined): string {
  return createHash("sha256")
    .update(`${build}\0unicode ${unicodeVersion ?? "unknown"}`)
    .digest("hex");
}
