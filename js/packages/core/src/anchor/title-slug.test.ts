import { describe, expect, test } from "vitest";
import { MAX_NESTING } from "../format/limits.js";
import { parseInlineContent } from "../format/markdown/library.js";
import { titleSlugOf } from "./title-slug.js";

describe("the slug of a data section's $title, read as a heading's inline content", () => {
  test.each([
    ["What *is* confirmed", "what-is-confirmed"],
    ["A [link](x.md) &amp; more", "a-link--more"],
    ["`code` and \\*escaped\\*", "code-and-escaped"],
    ["An ![image](i.png) here", "an--here"],
    ["<b>Bold</b> <!-- note --> text", "bold--text"],
    ['Done <a id="done"></a>', "done"],
    ["Plain", "plain"],
    ["", ""],
  ])("%j gives %j", (title, slug) => {
    expect(titleSlugOf(title, [])).toBe(slug);
  });

  test("no closing sequence is stripped, as in a setext heading: Foo # gives foo-, and # alone the empty slug", () => {
    expect(titleSlugOf("Foo #", [])).toBe("foo-");
    expect(titleSlugOf("Foo ##   ", [])).toBe("foo-");
    expect(titleSlugOf("#", [])).toBe("");
  });

  test("white space at either end is not content", () => {
    expect(titleSlugOf("  Notes\t", [])).toBe("notes");
    expect(titleSlugOf("    Notes", [])).toBe("notes");
  });

  test("a line break is a soft break, so the title's lines give one slug, as a setext heading's do", () => {
    expect(titleSlugOf("One\ntwo", [])).toBe("one-two");
    expect(titleSlugOf("One\r\ntwo", [])).toBe("one-two");
    expect(titleSlugOf("One   \n   two", [])).toBe("one-two");
    expect(titleSlugOf("One  \ntwo", [])).toBe("one-two");
    expect(titleSlugOf("`a\nb` c", [])).toBe("a-b-c");
  });

  test("a blank line between two lines counts two line breaks", () => {
    expect(titleSlugOf("One\n\ntwo", [])).toBe("one--two");
  });

  test("nothing in a title starts a block: list markers, quotes, fences, headings and definitions are text", () => {
    expect(titleSlugOf("- item", [])).toBe("--item");
    expect(titleSlugOf("1. one", [])).toBe("1-one");
    expect(titleSlugOf("> quote", [])).toBe("-quote");
    expect(titleSlugOf("## Part", [])).toBe("-part");
    expect(titleSlugOf("[a]: b", [])).toBe("a-b");
    expect(titleSlugOf("One\n===", [])).toBe("one-");
    expect(titleSlugOf("One\n- two", [])).toBe("one---two");
    expect(titleSlugOf("<div>x</div>", [])).toBe("x");
    expect(titleSlugOf("| a | b |\n|---|---|", [])).toBe("-a--b--------");
  });

  test("the record's link reference definitions are in scope: a reference gives its text only where its label is defined", () => {
    expect(titleSlugOf("[Foo][bar] baz", ["bar"])).toBe("foo-baz");
    expect(titleSlugOf("[Foo][bar] baz", [])).toBe("foobar-baz");
    expect(titleSlugOf("![Foo][bar] baz", ["bar"])).toBe("baz");
    expect(titleSlugOf("[Foo][ BAR\n  x ]", ["bar x"])).toBe("foo");
    expect(titleSlugOf("[Foo][other]", ["bar"])).toBe("fooother");
  });

  test("labels match with full case folding, as CommonMark matches them: ẞ is SS", () => {
    expect(titleSlugOf("[Foo][SS] x", ["ẞ"])).toBe("foo-x");
    expect(titleSlugOf("[Foo][ẞ] x", ["ss"])).toBe("foo-x");
  });

  test("a thematic break is text in a title", () => {
    expect(titleSlugOf("- - -", [])).toBe("-----");
    expect(titleSlugOf("***", [])).toBe("");
  });

  test("a title whose emphasis nests deeper than the Markdown parser reads is slugged as plain text", () => {
    const depth = MAX_NESTING + 1;
    const title = `${"*a ".repeat(depth)}b &amp;${" c*".repeat(depth)}`;
    expect(parseInlineContent(title, [])).toBeNull();
    // As Markdown, the reference would give `&`, which the filter removes; as plain text it gives `amp`.
    expect(titleSlugOf(title, [])).toBe(`${"a-".repeat(depth)}b-amp${"-c".repeat(depth)}`);
    expect(titleSlugOf("*a* b &amp; *c*", [])).toBe("a-b--c");
  });

  test("a title of more runs than a heading may hold is slugged as plain text, and one at the limit is read", () => {
    // A record with such a title is refused when it is parsed, so this is only what the function does if asked.
    // As Markdown, `&amp;` gives `&`, which the filter removes; as plain text it gives `amp`.
    expect(titleSlugOf(`${"*a* ".repeat(2048)}&amp;`, [])).toBe("a-".repeat(2048));
    expect(titleSlugOf(`${"*a* ".repeat(2049)}&amp;`, [])).toBe(`${"a-".repeat(2049)}amp`);
  });
});
