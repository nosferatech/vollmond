/** Where a reference's URI reference leads, resolved against the citing record's path with the store as the base. */
export type UriResolution =
  /** A scheme, an authority, or a path that climbs above the store root: an ordinary link, which vmd does not track. */
  | { readonly kind: "outside" }
  /** A path inside the store that does not decode to a store path, which names nothing; `message` says why. */
  | { readonly kind: "invalid"; readonly message: string }
  | {
      readonly kind: "store";
      /** The decoded store path, without a trailing `/`; `""` for the store root. */
      readonly path: string;
      /** Whether the path names a directory: it ends in `/` or in a dot segment, or it is the store root. */
      readonly directory: boolean;
      /** The fragment as written, after `#`, percent escapes kept; `""` for `#` alone, and null without a `#`. */
      readonly fragment: string | null;
    };

/** RFC 3986's parse of a URI reference (its appendix B): scheme, authority, path, query and fragment. */
const URI_PARTS = /^(?:([^:/?#]+):)?(\/\/[^/?#]*)?([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/su;

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const UTF8 = new TextEncoder();

/**
 * Resolves a reference's URI reference against the store path of the record that cites it, as RFC 3986 resolves one against
 * a base URI whose path is `/` and the citing path:
 *
 * - a scheme or an authority puts it outside the store;
 * - an empty path is the citing record; a path that starts with `/` is taken from the store root; any other is merged with
 *   the citing record's directory;
 * - dot segments are removed, and a `..` that would climb above the store root puts the reference outside the store, where
 *   RFC 3986's algorithm would drop it silently;
 * - the path is then percent-decoded as UTF-8, segment by segment: a `%` that does not start two hexadecimal digits, escaped
 *   bytes that are not UTF-8, and a segment that decodes to hold a `/`, make it `invalid`. An encoded dot is not a dot segment;
 * - a query is ignored, and the fragment is kept as written.
 *
 * Characters that a URI does not allow, such as a space or a letter outside ASCII, are taken as themselves, as a Markdown
 * destination may hold them.
 */
export function resolveReferenceUri(citingPath: string, uri: string): UriResolution {
  // The pattern matches every string: each part is optional, and the path takes any characters but `?` and `#`.
  const [, scheme, authority, path = "", fragment] = URI_PARTS.exec(uri) as RegExpExecArray;
  if (scheme !== undefined || authority !== undefined) return { kind: "outside" };
  let merged: string;
  if (path === "") {
    merged = citingPath;
  } else if (path.startsWith("/")) {
    merged = path.slice(1);
  } else {
    merged = `${citingPath.slice(0, citingPath.lastIndexOf("/") + 1)}${path}`;
  }
  const segments: string[] = [];
  let directory = false;
  const input = merged.split("/");
  for (let index = 0; index < input.length; index++) {
    const segment = input[index] as string;
    const last = index === input.length - 1;
    directory = last && (segment === "" || segment === "." || segment === "..");
    if (segment === "..") {
      if (segments.length === 0) return { kind: "outside" };
      segments.pop();
    } else if (segment !== "." && !(last && segment === "")) {
      segments.push(segment);
    }
  }
  const decoded: string[] = [];
  for (const segment of segments) {
    const text = percentDecode(segment);
    if (text === null) return { kind: "invalid", message: `the path of ${JSON.stringify(uri)} does not decode as UTF-8` };
    if (text.includes("/")) {
      return { kind: "invalid", message: `the path of ${JSON.stringify(uri)} does not decode to a store path: it encodes a /` };
    }
    decoded.push(text);
  }
  return {
    kind: "store",
    path: decoded.join("/"),
    directory,
    fragment: fragment ?? null,
  };
}

/** Decodes the percent escapes of a segment as UTF-8, or gives null for a `%` that is not an escape or bytes that are not UTF-8. */
function percentDecode(segment: string): string | null {
  if (!segment.includes("%")) return segment;
  const bytes: number[] = [];
  for (let index = 0; index < segment.length; ) {
    if (segment[index] === "%") {
      const hex = segment.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/u.test(hex)) return null;
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    const character = String.fromCodePoint(segment.codePointAt(index) as number);
    bytes.push(...UTF8.encode(character));
    index += character.length;
  }
  try {
    return STRICT_UTF8.decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
