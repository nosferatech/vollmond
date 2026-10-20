import { describe, expect, test } from "vitest";
import { leastTimeRatio, timeOf } from "../../timing.testkit.js";
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

  test("reads in linear time, however much white space a tag holds", async () => {
    // Two tags with four runs of 20,000 white space characters, one closed and one not, are read in the time of tags with
    // SCALE times less. The ratio is about SCALE when the read is linear, and about its square when the read scans a run
    // again for each of its characters: 7.0 to 8.9 on a laptop under a load average of 24 to 70, and 70 with such a step,
    // which then takes seconds; longer runs would make it take minutes.
    const SCALE = 8;
    const tags = (repeats: number): [string, string] => {
      const space = " \t\r\n".repeat(repeats);
      return [`<a${space}id${space}=${space}"x"${space}x`, `<a${space}id${space}=${space}"x"${space}/>`];
    };
    const readTime =
      ([open, closed]: [string, string]) =>
      () =>
        timeOf(() => [readOpenTag(open, 0), readOpenTag(closed, 0)]);
    const [open, closed] = tags(5000);
    expect(readOpenTag(open, 0)).toBeNull();
    expect(readOpenTag(closed, 0)?.selfClosing).toBe(true);
    expect(await leastTimeRatio(readTime(tags(5000 / SCALE)), readTime([open, closed]))).toBeLessThan(3 * SCALE);
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
