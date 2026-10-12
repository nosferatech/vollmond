import fc from "fast-check";
import { expect, test } from "vitest";
import { resolveReferenceUri } from "./uri.js";

// Property 3 of the I2 design: resolution against WHATWG's URL, an implementation core does not write. Relative references
// are built from segments of plain characters, dot segments, escapes of a space and of `é`, and a literal `é`, with an optional
// leading `/`, query and fragment. They leave out what WHATWG reads differently from RFC 3986 on purpose: a backslash, which
// it reads as `/`; an encoded dot, which it reads as a dot segment; an encoded slash, which vmd refuses; and white space at the
// ends, which it strips.

const segment = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom("a", "b", "notes", "x.md", "y.yaml", "v-1", "x_y", "a~b", "a!b") },
  { weight: 3, arbitrary: fc.constantFrom(".", "..") },
  { weight: 1, arbitrary: fc.constantFrom("x%20y.md", "caf%C3%A9.md", "café", "", "a:b") },
);
const relativePath = fc
  .tuple(fc.boolean(), fc.array(segment, { minLength: 0, maxLength: 6 }))
  .map(([rooted, segments]) => `${rooted ? "/" : ""}${segments.join("/")}`)
  // A first segment with a colon would be a scheme; `//` would start an authority.
  .filter((path) => !/^[^/]*:/u.test(path) && !path.startsWith("//"));
const query = fc.constantFrom("", "?plain=1", "?a=b&c");
const fragment = fc.constantFrom("", "#", "#done", "#a/b", "#%C3%A9", "#/$sections/0");
const reference = fc.tuple(relativePath, query, fragment).map(([path, q, f]) => `${path}${q}${f}`);
const citingPath = fc
  .array(fc.constantFrom("docs", "design", "a", "b"), { minLength: 0, maxLength: 3 })
  .map((directories) => [...directories, "record.md"].join("/"));

/** Directories above the store root in the base URL, so that a reference that climbs out of the store stays visible. */
const ABOVE = Array.from({ length: 12 }, (_, index) => `up${index}`).join("/");

test("property 3: a reference that stays in the store resolves as WHATWG's URL resolves it; one that climbs out is outside", () => {
  fc.assert(
    fc.property(citingPath, reference, (citing, uri) => {
      const ours = resolveReferenceUri(citing, uri);
      // The store root is below the base URL's root, so a reference from the store root starts there.
      const url = new URL(uri.startsWith("/") ? `/${ABOVE}${uri}` : uri, `https://store.invalid/${ABOVE}/${citing}`);
      const root = `/${ABOVE}/`;
      // A trailing `/` of the store root itself has no segment left after it.
      const inside = `${url.pathname}/`.startsWith(root);
      if (!inside) {
        expect(ours).toEqual({ kind: "outside" });
        return;
      }
      const rest = url.pathname.slice(root.length);
      const directory = rest === "" || rest.endsWith("/");
      const path = (directory ? rest.replace(/\/$/u, "") : rest)
        .split("/")
        .map((part) => decodeURIComponent(part))
        .join("/");
      expect(ours).toEqual({
        kind: "store",
        path,
        directory,
        fragment: url.hash === "" ? (uri.endsWith("#") ? "" : null) : url.hash.slice(1),
      });
    }),
    { numRuns: 2000 },
  );
});

test("property 3: a reference with a scheme or an authority is outside the store", () => {
  const absolute = fc.tuple(fc.constantFrom("https://example.com", "mailto:a@b.c", "x:", "//host", "file://"), reference);
  fc.assert(
    fc.property(citingPath, absolute, (citing, [prefix, rest]) => {
      expect(resolveReferenceUri(citing, `${prefix}${rest.startsWith("/") ? rest : `/${rest}`}`)).toEqual({ kind: "outside" });
    }),
  );
});
