import { describe, expect, test } from "vitest";
import { resolveReferenceUri } from "./uri.js";

describe("resolveReferenceUri", () => {
  test("resolves a relative reference against the citing record's directory, with its fragment as written", () => {
    expect(resolveReferenceUri("docs/design/a.md", "../log.md#tail")).toEqual({
      kind: "store",
      path: "docs/log.md",
      directory: false,
      fragment: "tail",
    });
    expect(resolveReferenceUri("docs/a.md", "b.md")).toEqual({
      kind: "store",
      path: "docs/b.md",
      directory: false,
      fragment: null,
    });
    expect(resolveReferenceUri("docs/a.md", "./sub/./c.md#x/y")).toEqual({
      kind: "store",
      path: "docs/sub/c.md",
      directory: false,
      fragment: "x/y",
    });
  });

  test("resolves the store-root form from the root, and an empty path to the citing record", () => {
    expect(resolveReferenceUri("docs/a.md", "/tickets/t.md#done")).toEqual({
      kind: "store",
      path: "tickets/t.md",
      directory: false,
      fragment: "done",
    });
    expect(resolveReferenceUri("docs/a.md", "#local")).toEqual({
      kind: "store",
      path: "docs/a.md",
      directory: false,
      fragment: "local",
    });
    expect(resolveReferenceUri("docs/a.md", "")).toEqual({ kind: "store", path: "docs/a.md", directory: false, fragment: null });
    // `#` alone keeps an empty fragment, which names the root as no fragment does.
    expect(resolveReferenceUri("docs/a.md", "b.md#")).toEqual({
      kind: "store",
      path: "docs/b.md",
      directory: false,
      fragment: "",
    });
  });

  test("names a directory by a path that ends in /, or in a dot segment, and the store root by an empty one", () => {
    expect(resolveReferenceUri("refs/any.yaml", "../docs/")).toEqual({
      kind: "store",
      path: "docs",
      directory: true,
      fragment: null,
    });
    expect(resolveReferenceUri("refs/any.yaml", "../docs/x/..")).toEqual({
      kind: "store",
      path: "docs",
      directory: true,
      fragment: null,
    });
    expect(resolveReferenceUri("refs/any.yaml", ".")).toEqual({ kind: "store", path: "refs", directory: true, fragment: null });
    expect(resolveReferenceUri("refs/any.yaml", "..")).toEqual({ kind: "store", path: "", directory: true, fragment: null });
    expect(resolveReferenceUri("a.md", "/")).toEqual({ kind: "store", path: "", directory: true, fragment: null });
  });

  test("ignores a query, so that x.md?plain=1#a resolves as x.md#a", () => {
    expect(resolveReferenceUri("docs/a.md", "x.md?plain=1#a")).toEqual({
      kind: "store",
      path: "docs/x.md",
      directory: false,
      fragment: "a",
    });
    expect(resolveReferenceUri("docs/a.md", "?plain=1")).toEqual({
      kind: "store",
      path: "docs/a.md",
      directory: false,
      fragment: null,
    });
  });

  test("puts a reference with a scheme or an authority outside the store", () => {
    for (const uri of ["https://example.com/a.md", "mailto:a@example.com", "x:y.md", "//host/a.md", "C:/a.md"]) {
      expect(resolveReferenceUri("docs/a.md", uri)).toEqual({ kind: "outside" });
    }
    // Near misses: a colon after the first segment, or after a slash, is part of a path.
    expect(resolveReferenceUri("docs/a.md", "./x:y.md")).toMatchObject({ kind: "store", path: "docs/x:y.md" });
    expect(resolveReferenceUri("docs/a.md", "1x:y.md")).toEqual({ kind: "outside" });
    expect(resolveReferenceUri("docs/a.md", "a/x:y.md")).toMatchObject({ kind: "store", path: "docs/a/x:y.md" });
  });

  // Predicted bug: RFC 3986's remove_dot_segments drops a `..` that climbs above the root, so `../../g` from `a/b.md` would
  // resolve to `g` inside the store.
  test("puts a path that climbs above the store root outside the store, where RFC 3986 would clamp it", () => {
    expect(resolveReferenceUri("a/b.md", "../../g.md")).toEqual({ kind: "outside" });
    expect(resolveReferenceUri("b.md", "../g.md")).toEqual({ kind: "outside" });
    expect(resolveReferenceUri("a/b.md", "/../g.md")).toEqual({ kind: "outside" });
    expect(resolveReferenceUri("a/b.md", "x/../../../g.md")).toEqual({ kind: "outside" });
    // Its near miss: climbing to the root and down again stays inside.
    expect(resolveReferenceUri("a/b.md", "../g.md")).toMatchObject({ kind: "store", path: "g.md" });
    expect(resolveReferenceUri("a/b.md", "x/../../g.md")).toMatchObject({ kind: "store", path: "g.md" });
  });

  test("percent-decodes the path as UTF-8, and keeps percent escapes in the fragment for the address to read", () => {
    expect(resolveReferenceUri("docs/a.md", "x%20y.md#a%20b")).toEqual({
      kind: "store",
      path: "docs/x y.md",
      directory: false,
      fragment: "a%20b",
    });
    expect(resolveReferenceUri("docs/a.md", "gr%C3%B6%C3%9Fe.md")).toMatchObject({ path: "docs/größe.md" });
    // A literal character outside ASCII is itself, as a Markdown destination may write it.
    expect(resolveReferenceUri("docs/a.md", "größe.md")).toMatchObject({ path: "docs/größe.md" });
  });

  // Predicted bug: `decodeURIComponent` throws a URIError on bytes that are not UTF-8, which would crash the check.
  test("says that a path whose escapes are not UTF-8, or not escapes, does not decode", () => {
    for (const uri of ["%E9.md", "caf%E9.md#a", "a%C3.md", "%ED%A0%80.md", "a%zz.md", "a%2.md", "100%.md"]) {
      const resolved = resolveReferenceUri("docs/a.md", uri);
      expect(resolved.kind, uri).toBe("invalid");
      expect(resolved.kind === "invalid" && resolved.message, uri).toMatch(/does not decode/);
    }
    // Its near miss: an escape of a whole UTF-8 sequence decodes.
    expect(resolveReferenceUri("docs/a.md", "caf%C3%A9.md")).toMatchObject({ kind: "store", path: "docs/café.md" });
  });

  test("keeps an encoded dot inside its segment, as RFC 3986 does, and refuses an encoded slash", () => {
    // The path is decoded after its dot segments are removed, so `%2E%2E` is a segment of that name, which no store path has.
    expect(resolveReferenceUri("docs/a.md", "%2E%2E/x.md")).toMatchObject({ kind: "store", path: "docs/../x.md" });
    // A segment that decodes to hold a `/` names no store path, rather than the path its slash would make.
    const slash = resolveReferenceUri("docs/a.md", "a%2Fb.md");
    expect(slash.kind).toBe("invalid");
    expect(slash.kind === "invalid" && slash.message).toMatch(/does not decode to a store path/);
  });
});
