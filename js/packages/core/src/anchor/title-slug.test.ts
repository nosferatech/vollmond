import { describe, expect, test } from "vitest";
import { MAX_NESTING } from "../format/limits.js";
import { parseMarkdownTree } from "../format/markdown/library.js";
import { titleSlugOf } from "./title-slug.js";

describe("the slug of a data section's $title, read as the content of an ATX heading", () => {
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
    expect(titleSlugOf(title)).toBe(slug);
  });

  test("a closing sequence is not content, as in a heading: Foo # gives foo, and # alone the empty slug", () => {
    expect(titleSlugOf("Foo #")).toBe("foo");
    expect(titleSlugOf("#")).toBe("");
  });

  test("white space at either end is not content", () => {
    expect(titleSlugOf("  Notes\t")).toBe("notes");
  });

  test("the heading ends at a line break, so a title of several lines gives its first line's slug (an open question)", () => {
    expect(titleSlugOf("One\ntwo")).toBe("one");
    expect(titleSlugOf("One\r\ntwo")).toBe("one");
  });

  test("a title whose emphasis nests deeper than the Markdown parser reads is slugged as plain text", () => {
    const depth = MAX_NESTING + 1;
    const title = `${"*a ".repeat(depth)}b &amp;${" c*".repeat(depth)}`;
    expect(parseMarkdownTree(`## ${title}`).ok).toBe(false);
    // As Markdown, the reference would give `&`, which the filter removes; as plain text it gives `amp`.
    expect(titleSlugOf(title)).toBe(`${"a-".repeat(depth)}b-amp${"-c".repeat(depth)}`);
    expect(titleSlugOf("*a* b &amp; *c*")).toBe("a-b--c");
  });
});
