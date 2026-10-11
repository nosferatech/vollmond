import { describe, expect, test } from "vitest";
import { classTokens, readClosingTagName, readOpenTag } from "./html-tag.js";

describe("readOpenTag", () => {
  test("reads a tag's name and attributes, with each kind of value, names in lower case", () => {
    const text = `x<A ID="done" Class='a b' data-x=1 hidden\n title = "t">`;
    expect(readOpenTag(text, 1)).toEqual({
      name: "a",
      attributes: [
        { name: "id", value: "done", valueStart: 8 },
        { name: "class", value: "a b", valueStart: 21 },
        { name: "data-x", value: "1", valueStart: 33 },
        { name: "hidden", value: "", valueStart: 41 },
        { name: "title", value: "t", valueStart: 52 },
      ],
      selfClosing: false,
      end: text.length,
    });
  });

  test("reads a self-closing tag and white space before the end", () => {
    expect(readOpenTag("<br />", 0)).toEqual({ name: "br", attributes: [], selfClosing: true, end: 6 });
    expect(readOpenTag("<a\tid=x\r\n>", 0)?.end).toBe(10);
  });

  test.each([
    ["a closing tag", "</a>"],
    ["a comment", "<!-- a -->"],
    ["a declaration", "<!DOCTYPE html>"],
    ["an attribute without white space before it", '<a id="x"class="y">'],
    ["an unclosed tag", '<a id="x"'],
    ["a quote in an unquoted value", "<a id=x'y>"],
    ["a name that starts with a digit", "<1a>"],
    ["text", "a"],
  ])("finds no open tag in %s", (_, text) => {
    expect(readOpenTag(text, 0)).toBeNull();
  });

  test("reads in linear time, however much white space a tag holds", () => {
    const space = " \t\r\n".repeat(50_000);
    const started = performance.now();
    expect(readOpenTag(`<a${space}id${space}=${space}"x"${space}x`, 0)).toBeNull();
    expect(readOpenTag(`<a${space}id${space}=${space}"x"${space}/>`, 0)?.selfClosing).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("readClosingTagName", () => {
  test("reads a closing tag's name in lower case, and nothing else", () => {
    expect(readClosingTagName("</A >")).toBe("a");
    expect(readClosingTagName("</span>")).toBe("span");
    expect(readClosingTagName("<a>")).toBeNull();
    expect(readClosingTagName("</a> ")).toBeNull();
  });
});

describe("classTokens", () => {
  test("splits on ASCII white space, in source order, keeping repeats, at indexes of the text", () => {
    const tag = readOpenTag('<a class=" b\ta\fb\u{A0}c ">', 0);
    const attribute = tag?.attributes[0];
    if (attribute === undefined) throw new Error("no attribute");
    expect(classTokens(attribute)).toEqual([
      { name: "b", start: 11 },
      { name: "a", start: 13 },
      { name: "b\u{A0}c", start: 15 },
    ]);
  });
});
