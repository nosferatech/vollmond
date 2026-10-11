import { describe, expect, test } from "vitest";
import { parseMarkdownTree } from "./library.js";

describe("parseMarkdownTree", () => {
  test("applies GFM's autolink literals, which the library finds partly after the parse", () => {
    // The literal after a character reference is the transform's, not the parser's.
    const tree = parseMarkdownTree("Mail x@example.com or see &#42;www.example.com.\n");
    if (!tree.ok) throw new Error("too deep");
    const paragraph = tree.root.children[0];
    const links = paragraph?.type === "paragraph" ? paragraph.children.filter((node) => node.type === "link") : [];
    expect(links.map((link) => link.url)).toEqual(["mailto:x@example.com", "http://www.example.com"]);
  });

  test("has no footnotes, which GFM 0.29 lacks: [^1]: is a link reference definition", () => {
    const tree = parseMarkdownTree("[^1]: target.md\n");
    expect(tree.ok && tree.root.children.map((node) => node.type)).toEqual(["definition"]);
  });

  test("reads tables, strikethrough and task list items", () => {
    const tree = parseMarkdownTree("| a |\n|---|\n| ~~b~~ |\n\n- [x] done\n");
    if (!tree.ok) throw new Error("too deep");
    expect(tree.root.children.map((node) => node.type)).toEqual(["table", "list"]);
    const list = tree.root.children[1];
    expect(list?.type === "list" && list.children[0]?.checked).toBe(true);
  });
});
