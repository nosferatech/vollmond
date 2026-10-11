/**
 * Builds the exact path of a child node: its parent's exact path (`""` for the root), `/`, and the reference token of its
 * key as JSON Pointer (RFC 6901) writes it, with `~` written `~0` and `/` written `~1`. An array index is written in decimal.
 */
export function childPath(parent: string, key: string | number): string {
  const token = typeof key === "number" ? String(key) : key.replaceAll("~", "~0").replaceAll("/", "~1");
  return `${parent}/${token}`;
}
