import { jcs } from "./jcs.js";
import type { Value } from "./value.js";

/**
 * Computes a node version: the SHA-256 of the UTF-8 encoding of the value's JCS text ({@link jcs}), as its first
 * 16 lower-case hexadecimal digits. Equal values have equal versions, whatever their member order, so `-0` and `0` do too.
 *
 * Uses the runtime's Web Crypto API (`crypto.subtle`), which browsers offer only in secure contexts. Rejects with a
 * `TypeError` where `jcs` throws.
 */
export async function nodeVersion(value: Value): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jcs(value)));
  return hexadecimal(digest).slice(0, 16);
}

/**
 * Computes a file version: the git blob id of `content`, the SHA-1 of `"blob " + length + "\0"` followed by the content, with
 * the length in decimal bytes, as 40 lower-case hexadecimal digits. It equals what `git hash-object --no-filters` prints for a
 * file with these bytes in a SHA-1 repository.
 *
 * Uses the runtime's Web Crypto API (`crypto.subtle`), which browsers offer only in secure contexts.
 */
export async function gitBlobId(content: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${content.length}\0`);
  const object = new Uint8Array(header.length + content.length);
  object.set(header);
  object.set(content, header.length);
  return hexadecimal(await crypto.subtle.digest("SHA-1", object));
}

function hexadecimal(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
