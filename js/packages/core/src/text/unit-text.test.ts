import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { readLineBreaksAsLf, sliceUnitText, type UnitText } from "./unit-text.js";

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
