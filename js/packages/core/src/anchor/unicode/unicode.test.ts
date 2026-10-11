import { describe, expect, test } from "vitest";
import {
  CodePointRanges,
  isDefaultIgnorable,
  isLetterMarkDigitOrConnector,
  isWhiteSpace,
  LowerCaseMapping,
  lowerCaseOf,
  UNICODE_VERSION,
} from "./unicode.js";

/** Pairs each code point with its U+ digits, for `test.each` names. */
function named(codePoints: number[]): [string, number][] {
  return codePoints.map((cp) => [cp.toString(16).toUpperCase().padStart(4, "0"), cp]);
}

/** Lower-cases `text` one code point at a time, as the derived-anchor rule does. */
function lowerCasePerCodePoint(text: string): string {
  return [...text].map((c) => lowerCaseOf(c.codePointAt(0) as number)).join("");
}

test("the tables are Unicode 17.0.0", () => {
  expect(UNICODE_VERSION).toBe("17.0.0");
});

describe("lower case, one code point at a time", () => {
  test("Σ gives σ even at the end of a word, unlike String.prototype.toLowerCase (Final_Sigma)", () => {
    expect(lowerCasePerCodePoint("ΑΣ")).toBe("ασ");
    expect("ΑΣ".toLowerCase()).toBe("ας");
  });

  test("U+0130 gives two code points, i and U+0307 (SpecialCasing.txt, unconditional)", () => {
    expect(lowerCaseOf(0x130)).toBe("i̇");
  });

  test("no language rule applies: I gives i, not ı", () => {
    expect(lowerCaseOf(0x49)).toBe("i");
  });

  test.each([
    ["A", "a"],
    ["Z", "z"],
    ["a", "a"],
    ["É", "é"],
    ["Ā", "ā"], // the start of a run of stride 2
    ["ā", "ā"], // a code point such a run skips
    ["ẞ", "ß"],
    ["K", "k"], // U+212A KELVIN SIGN
    ["Ω", "ω"], // U+2126 OHM SIGN
    ["ᾈ", "ᾀ"], // in SpecialCasing.txt, with the same lower case as in UnicodeData.txt
    ["Ǆ", "ǆ"],
    ["ǅ", "ǆ"],
    ["𐐀", "𐐨"], // U+10400 DESERET CAPITAL LETTER LONG I
    ["-", "-"],
  ])("%s gives %s", (upper, lower) => {
    expect(lowerCasePerCodePoint(upper)).toBe(lower);
  });

  test("U+16EA0, added in Unicode 17.0, gives U+16EBB", () => {
    expect(lowerCaseOf(0x16ea0)).toBe("\u{16EBB}");
  });

  test("the highest code point and a lone surrogate map to themselves", () => {
    expect(lowerCaseOf(0x10ffff)).toBe("\u{10FFFF}");
    expect(lowerCaseOf(0xd800)).toBe("\uD800");
  });
});

describe("White_Space", () => {
  test("includes U+0085, which String.prototype.trim keeps", () => {
    expect(isWhiteSpace(0x85)).toBe(true);
    expect("\u0085".trim()).toBe("\u0085");
  });

  test.each(named([0x09, 0x0a, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x3000]))("includes U+%s", (_, cp) => {
    expect(isWhiteSpace(cp)).toBe(true);
  });

  test.each(named([0x08, 0x21, 0x84, 0x86, 0x180e, 0x200b, 0xfeff]))("excludes U+%s", (_, cp) => {
    expect(isWhiteSpace(cp)).toBe(false);
  });
});

describe("Default_Ignorable_Code_Point", () => {
  test("includes U+FE0F, which is also a mark, so the rule must remove it before it filters", () => {
    expect(isDefaultIgnorable(0xfe0f)).toBe(true);
    expect(isLetterMarkDigitOrConnector(0xfe0f)).toBe(true);
  });

  test.each(named([0xad, 0x34f, 0x200b, 0x200d, 0x2060, 0xfe00, 0xfeff, 0x1d173, 0xe0001, 0xe0fff]))("includes U+%s", (_, cp) => {
    expect(isDefaultIgnorable(cp)).toBe(true);
  });

  test.each(named([0x20, 0x2d, 0x301, 0xfe10, 0xe1000]))("excludes U+%s", (_, cp) => {
    expect(isDefaultIgnorable(cp)).toBe(false);
  });
});

describe("general categories L, M, Nd and Pc", () => {
  test.each([
    ["0061", "Ll", 0x61],
    ["0041", "Lu", 0x41],
    ["01C5", "Lt", 0x1c5],
    ["02B0", "Lm", 0x2b0],
    ["4E00", "Lo", 0x4e00],
    ["16EA0", "Lu, new in 17.0", 0x16ea0],
    ["0301", "Mn", 0x301],
    ["0903", "Mc", 0x903],
    ["20DD", "Me", 0x20dd],
    ["0030", "Nd", 0x30],
    ["0669", "Nd", 0x669],
    ["005F", "Pc", 0x5f],
    ["203F", "Pc", 0x203f],
  ])("keeps U+%s (%s)", (_, __, cp) => {
    expect(isLetterMarkDigitOrConnector(cp)).toBe(true);
  });

  test.each([
    ["0020", "Zs", 0x20],
    ["002D", "Pd", 0x2d],
    ["0021", "Po", 0x21],
    ["0024", "Sc", 0x24],
    ["00B2", "No", 0xb2],
    ["2160", "Nl", 0x2160],
    ["00AD", "Cf", 0xad],
    ["D800", "Cs", 0xd800],
    ["E000", "Co", 0xe000],
    ["0378", "Cn", 0x378],
    ["10FFFF", "Cn", 0x10ffff],
  ])("removes U+%s (%s)", (_, __, cp) => {
    expect(isLetterMarkDigitOrConnector(cp)).toBe(false);
  });
});

describe("the encodings", () => {
  test("ranges decode from [gap, length] pairs, both ends included and nothing outside", () => {
    const ranges = new CodePointRanges([2, 3, 1, 1]); // 2..4 and 6
    expect([0, 1, 2, 3, 4, 5, 6, 7].filter((cp) => ranges.has(cp))).toEqual([2, 3, 4, 6]);
  });

  test("lower-case runs decode with their stride, and expansions apply", () => {
    // 0x41..0x43 by +32; 0x100, 0x102 and 0x104 by +1; 0x130 expands.
    const mapping = new LowerCaseMapping([0x41, 3, 1, 32, 0x100 - 0x41, 3, 2, 1], [[0x130, 0x69, 0x307]]);
    const lowerOfEach = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => mapping.of(from + i).codePointAt(0) as number);
    expect(lowerOfEach(0x40, 0x44)).toEqual([0x40, 0x61, 0x62, 0x63, 0x44]);
    expect(lowerOfEach(0xff, 0x106)).toEqual([0xff, 0x101, 0x101, 0x103, 0x103, 0x105, 0x105, 0x106]);
    expect(mapping.of(0x130)).toBe("i̇");
  });
});
