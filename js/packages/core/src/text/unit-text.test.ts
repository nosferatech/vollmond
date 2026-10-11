import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { readLineBreaksAsLf, sliceIndentedUnitText, sliceUnitText, type UnitText } from "./unit-text.js";

/** The file index of every index of a unit text, from 0 to its length. */
function fileIndexes(unit: UnitText): number[] {
  return Array.from({ length: unit.text.length + 1 }, (_, index) => unit.fileIndex(index));
}

describe("sliceUnitText", () => {
  test("shifts every index by the slice's start", () => {
    const unit = sliceUnitText("ab\ncd", 3, 5);
    expect(unit.text).toBe("cd");
    expect(fileIndexes(unit)).toEqual([3, 4, 5]);
  });

  test("an empty slice has the one index of its place", () => {
    expect(fileIndexes(sliceUnitText("abc", 2, 2))).toEqual([2]);
  });

  test.each([
    [-1, 1],
    [2, 1],
    [0, 4],
    [0.5, 1],
  ])("refuses the range [%d, %d) of a text of three", (start, end) => {
    expect(() => sliceUnitText("abc", start, end)).toThrow(RangeError);
  });

  test("refuses an index outside the slice", () => {
    const unit = sliceUnitText("abc", 1, 2);
    expect(() => unit.fileIndex(2)).toThrow(RangeError);
    expect(() => unit.fileIndex(-1)).toThrow(RangeError);
  });
});

describe("readLineBreaksAsLf", () => {
  test("a text without a CR is returned as it is", () => {
    const unit = sliceUnitText("a\nb", 0, 3);
    expect(readLineBreaksAsLf(unit)).toBe(unit);
  });

  test("a CRLF becomes LF, whose index maps to the CR and the next index past the LF", () => {
    const unit = readLineBreaksAsLf(sliceUnitText("a\r\nb", 0, 4));
    expect(unit.text).toBe("a\nb");
    expect(fileIndexes(unit)).toEqual([0, 1, 3, 4]);
  });

  test("a lone CR becomes LF in place", () => {
    const unit = readLineBreaksAsLf(sliceUnitText("a\rb\r", 0, 4));
    expect(unit.text).toBe("a\nb\n");
    expect(fileIndexes(unit)).toEqual([0, 1, 2, 3, 4]);
  });

  test("CR CR LF is a lone CR and then a CRLF", () => {
    const unit = readLineBreaksAsLf(sliceUnitText("\r\r\n", 0, 3));
    expect(unit.text).toBe("\n\n");
    expect(fileIndexes(unit)).toEqual([0, 1, 3]);
  });

  test("a \\r escape is two characters, not a line break", () => {
    expect(readLineBreaksAsLf(sliceUnitText('"\\r"\r\n', 0, 6)).text).toBe('"\\r"\n');
  });

  test("composes with the slice: indexes go back to the file", () => {
    const unit = readLineBreaksAsLf(sliceUnitText("xx\r\na\r\nb", 4, 8));
    expect(unit.text).toBe("a\nb");
    expect(fileIndexes(unit)).toEqual([4, 5, 7, 8]);
  });

  test("refuses an index outside the new text", () => {
    const unit = readLineBreaksAsLf(sliceUnitText("a\r\n", 0, 3));
    expect(() => unit.fileIndex(3)).toThrow(RangeError);
    expect(() => unit.fileEnd(3)).toThrow(RangeError);
  });

  test("a slice's ends map as its starts do", () => {
    const unit = sliceUnitText("ab\ncd", 1, 5);
    expect([0, 1, 2, 3, 4].map((index) => unit.fileEnd(index))).toEqual([1, 2, 3, 4, 5]);
    expect(() => unit.fileEnd(5)).toThrow(RangeError);
  });

  test("passes ends through to the unit it reads, which may map them apart from starts", () => {
    // A unit that leaves out two spaces of indentation at the start of its second line, "  b".
    const indented: UnitText = {
      text: "a\r\nb",
      fileIndex: (index) => (index < 3 ? index : index + 2),
      fileEnd: (index) => (index <= 3 ? index : index + 2),
    };
    const unit = readLineBreaksAsLf(indented);
    expect(unit.text).toBe("a\nb");
    expect(fileIndexes(unit)).toEqual([0, 1, 5, 6]);
    expect([0, 1, 2, 3].map((index) => unit.fileEnd(index))).toEqual([0, 1, 3, 6]);
  });

  test("agrees with a character-by-character reading on random texts", () => {
    const piece = fc.constantFrom("a", "\r", "\n", "\r\n", "\u{E9}", "\u{1F600}");
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 40 }), fc.nat(5), (pieces, prefix) => {
        const file = "p".repeat(prefix) + pieces.join("");
        const unit = readLineBreaksAsLf(sliceUnitText(file, prefix, file.length));
        // The oracle: walk the file, emitting LF for each break, and note the file index of each emitted index.
        let text = "";
        const expected: number[] = [];
        for (let i = prefix; i < file.length; i++) {
          expected.push(i);
          if (file[i] === "\r" && file[i + 1] === "\n") {
            text += "\n";
            i += 1;
          } else {
            text += file[i] === "\r" ? "\n" : file[i];
          }
        }
        expected.push(file.length);
        expect(unit.text).toBe(text);
        expect(fileIndexes(unit)).toEqual(expected);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("sliceIndentedUnitText", () => {
  test("removes up to the indentation's spaces from each line, and maps indexes back past them", () => {
    // "  a\n   b\n c\n" from index 0, as the content of a fence indented by two spaces.
    const file = "  a\n   b\r\n c\rd";
    const unit = sliceIndentedUnitText(file, 0, file.length, 2);
    expect(unit.text).toBe("a\n b\r\nc\rd");
    expect(fileIndexes(unit)).toEqual([2, 3, 6, 7, 8, 9, 11, 12, 13, 14]);
    // At a line's start a range ends before the spaces removed there, and at the unit's start after them.
    expect([0, 2, 6, 8].map((index) => unit.fileEnd(index))).toEqual([2, 4, 10, 13]);
  });

  test("a tab stops the removal, and so does the end of the slice", () => {
    const unit = sliceIndentedUnitText("x\n\t a\n  ", 2, 8, 3);
    expect(unit.text).toBe("\t a\n");
    expect(unit.fileIndex(unit.text.length)).toBe(8);
    expect(unit.fileEnd(unit.text.length)).toBe(6);
  });

  test("an indentation of 0 is a plain slice, and an empty slice has the one index of its place", () => {
    expect(sliceIndentedUnitText("ab\n cd", 1, 6, 0).text).toBe("b\n cd".slice(0, 5));
    expect(fileIndexes(sliceIndentedUnitText("abc", 2, 2, 2))).toEqual([2]);
  });

  test("agrees with removing the spaces line by line, on random texts", () => {
    const piece = fc.constantFrom("a", " ", "\t", "\r", "\n", "\r\n", "\u{E9}");
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 30 }), fc.nat(4), (pieces, indent) => {
        const file = pieces.join("");
        const unit = sliceIndentedUnitText(file, 0, file.length, indent);
        // The oracle: every unit index maps to a file index whose character is the unit's.
        for (let index = 0; index < unit.text.length; index++) {
          expect(file[unit.fileIndex(index)]).toBe(unit.text[index]);
          expect(unit.fileEnd(index)).toBeLessThanOrEqual(unit.fileIndex(index));
        }
        const lines = file.split(/(?<=\r\n|\r(?!\n)|\n)/);
        const expected = lines.map((line) => line.replace(new RegExp(`^ {0,${indent}}`), "")).join("");
        expect(unit.text).toBe(file === "" ? "" : expected);
      }),
      { numRuns: 1000 },
    );
  });

  test.each([
    [0, 4, 1],
    [2, 1, 1],
    [0, 1, -1],
    [0, 1, 0.5],
  ])("refuses the range [%d, %d) or the indentation %d", (start, end, indent) => {
    expect(() => sliceIndentedUnitText("abc", start, end, indent)).toThrow(RangeError);
  });
});
