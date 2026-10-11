import { describe, expect, test } from "vitest";
import { displayWidth, formatColumns, oneLine } from "./lines.js";

describe("oneLine", () => {
  test("keeps a title with a line break on one line", () => {
    expect(oneLine("first\nsecond\r\nthird")).toBe("first\\nsecond\\r\\nthird");
  });

  test("escapes a terminal escape sequence, so a record cannot act on the terminal", () => {
    expect(oneLine("\u001b[2Jcleared")).toBe("\\u001b[2Jcleared");
  });

  test("escapes DEL, C1 controls, the line and paragraph separators and the bidirectional controls", () => {
    expect(oneLine("a\u007fb\u0085c\u2028d\u2029e\u202ef\u2066g")).toBe("a\\u007fb\\u0085c\\u2028d\\u2029e\\u202ef\\u2066g");
  });

  test("keeps every other character, a tab-free line with non-ASCII text and a backslash included", () => {
    const text = "Überblick — 概要 😀 \\n é";
    expect(oneLine(text)).toBe(text);
  });
});

describe("displayWidth", () => {
  test("counts code points, not UTF-16 units", () => {
    expect(displayWidth("𝔸𝔹")).toBe(2);
  });

  test("counts East Asian characters and emoji two columns wide", () => {
    expect(displayWidth("概要")).toBe(4);
    expect(displayWidth("😀")).toBe(2);
  });

  test("counts a combining mark and a zero-width joiner as nothing", () => {
    expect(displayWidth("e\u0301")).toBe(1);
    expect(displayWidth("a\u200db")).toBe(2);
  });
});

describe("formatColumns", () => {
  test("aligns columns two spaces apart, one line per row, without trailing spaces", () => {
    expect(
      formatColumns([
        { cells: ["#overview", "1 Overview", "~2.1k tok"] },
        { cells: ["#log-format", "4 The log format", "~31k tok"] },
      ]),
    ).toBe("#overview    1 Overview        ~2.1k tok\n#log-format  4 The log format  ~31k tok\n");
  });

  test("indents a row two spaces per level, within its first column", () => {
    expect(formatColumns([{ cells: ["#log-format", "4"] }, { cells: ["#contiguous", "4.6"], depth: 1 }])).toBe(
      "#log-format    4\n  #contiguous  4.6\n",
    );
  });

  test("aligns after a cell outside the BMP by its columns, not its UTF-16 length", () => {
    expect(formatColumns([{ cells: ["𝔸", "x"] }, { cells: ["ab", "y"] }])).toBe("𝔸   x\nab  y\n");
  });

  test("aligns after East Asian text by its columns", () => {
    expect(formatColumns([{ cells: ["概要", "x"] }, { cells: ["abc", "y"] }])).toBe("概要  x\nabc   y\n");
  });

  test("keeps each row on one line when a cell holds a line break", () => {
    expect(formatColumns([{ cells: ["a\nb", "c"] }])).toBe("a\\nb  c\n");
  });

  test("leaves no trailing spaces after an empty last cell, and keeps a row of uneven length", () => {
    expect(formatColumns([{ cells: ["a", ""] }, { cells: ["bb"] }])).toBe("a\nbb\n");
  });

  test("gives the empty string for no rows", () => {
    expect(formatColumns([])).toBe("");
  });
});
