import { createHash } from "node:crypto";

/**
 * Computes a file's git blob id, the version that `git hash-object --no-filters` prints: the lower-case hex SHA-1 of
 * `"blob " + length + "\0" + content`, with the length in decimal bytes.
 */
export function gitBlobId(content: Uint8Array): string {
  return createHash("sha1").update(`blob ${content.byteLength}\0`).update(content).digest("hex");
}
