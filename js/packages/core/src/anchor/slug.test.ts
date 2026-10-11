import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { isAnchorName, slugOf } from "./slug.js";
import { isLetterMarkDigitOrConnector } from "./unicode/unicode.js";

describe("the slug of a heading's visible text", () => {
  test.each([
    ["What was done", "what-was-done"],
    ["Größe", "größe"],
    ["A link & more", "a-link--more"],
    ["snake_case and kebab-case", "snake_case-and-kebab-case"],
    ["", ""],
    ["!!!", ""],
  ])("%j gives %j", (text, slug) => {
    expect(slugOf(text)).toBe(slug);
  });

  test("lower-cases one code point at a time, so a final capital sigma gives σ, where toLowerCase gives ς", () => {
    expect("ΟΔΟΣ".toLowerCase()).toBe("οδος");
    expect(slugOf("ΟΔΟΣ")).toBe("οδοσ");
  });

  test("lower-cases U+0130 to i and U+0307, a mark, which the filter keeps", () => {
    expect(slugOf("İ")).toBe("i̇");
  });

  test("trims White_Space at both ends, U+0085 included, which String.prototype.trim keeps", () => {
    expect(slugOf("\u0085a\u0085b\u0085")).toBe("a-b");
    expect(slugOf("　a b ")).toBe("a-b");
  });

  test("trims before it filters, so a removed character at an end leaves its space as a hyphen", () => {
    expect(slugOf("Done !")).toBe("done-");
    expect(slugOf("! Done")).toBe("-done");
  });

  test("does not collapse hyphens or white space", () => {
    expect(slugOf("a - b")).toBe("a---b");
    expect(slugOf("a  \t b")).toBe("a----b");
  });

  test("turns a line break, which a setext heading of several lines gives, into a hyphen", () => {
    expect(slugOf("one\ntwo")).toBe("one-two");
  });

  test("removes default-ignorable code points before NFC, so e, U+FE0F, U+0301 gives é as é does", () => {
    expect(slugOf("e️́")).toBe("é");
    expect(slugOf("é")).toBe("é");
  });

  test("removes U+FEFF and U+200D inside a word, which are not White_Space", () => {
    expect(slugOf("a﻿b‍c")).toBe("abc");
  });

  test("removes code points unassigned in 17.0.0 before NFC: a, U+1ADE, U+0323 gives ạ", () => {
    expect(slugOf("a\u{1ade}̣")).toBe("ạ");
  });

  test("removes noncharacters before NFC: e, U+FDD0, U+0301 gives é", () => {
    expect(slugOf("e﷐́")).toBe("é");
  });

  test("normalizes to NFC, so a decomposed heading gives the composed slug", () => {
    expect(slugOf("Café")).toBe("café");
  });

  test("keeps letters, marks, decimal digits and connectors of every script, and removes symbols and other numbers", () => {
    expect(slugOf("日本語 ١٢٣ ‿ x²")).toBe("日本語-١٢٣-‿-x");
    expect(slugOf("🚀 Launch")).toBe("-launch");
  });

  test("property: a slug holds only letters, marks, decimal digits, connector punctuation and -", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), fc.string({ unit: "binary" }), (graphemes, binary) => {
        for (const text of [graphemes, binary]) {
          for (const c of slugOf(text)) {
            const cp = c.codePointAt(0) as number;
            expect(cp === 0x2d || isLetterMarkDigitOrConnector(cp)).toBe(true);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("anchor and tag names", () => {
  test.each(["a", "A", "z9", "Shelf_A-1", "a-", "a_"])("%j is a name", (name) => {
    expect(isAnchorName(name)).toBe(true);
  });

  test.each(["", "1a", "-a", "_a", "a b", "a.b", "é", "a\n", "ａ"])("%j is not", (name) => {
    expect(isAnchorName(name)).toBe(false);
  });
});
