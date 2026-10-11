import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { decodeSource, firstInvalidUtf8, type SourceText } from "./source-text.js";

const utf8 = (text: string) => new TextEncoder().encode(text);
const BOM = [0xef, 0xbb, 0xbf];

/** Decodes bytes that are valid UTF-8, failing the test otherwise. */
function source(bytes: Uint8Array | string): SourceText {
  const outcome = decodeSource("record.md", typeof bytes === "string" ? utf8(bytes) : bytes);
  if (!outcome.ok) throw new Error(`not decoded: ${outcome.issues[0]?.message}`);
  return outcome.value;
}

describe("the byte order mark", () => {
  test("stays in the text as U+FEFF, so that offsets count its three bytes", () => {
    const text = source(new Uint8Array([...BOM, 0x61, 0x0a, 0x62]));
    expect(text.text).toBe("\u{FEFF}a\nb");
    expect(text.hasBom).toBe(true);
    expect(text.byteOffset(1)).toBe(3);
    expect(text.utf16Index(3)).toBe(1);
  });

  test("is not a column: line 1's first character is column 1", () => {
    const text = source(new Uint8Array([...BOM, 0x61, 0x62, 0x0a, 0x63]));
    expect(text.position(3)).toEqual({ offset: 3, line: 1, col: 1 });
    expect(text.position(4)).toEqual({ offset: 4, line: 1, col: 2 });
    expect(text.position(6)).toEqual({ offset: 6, line: 2, col: 1 });
    expect(text.position(0)).toEqual({ offset: 0, line: 1, col: 1 });
  });

  test("is a BOM only at byte 0: a U+FEFF elsewhere is an ordinary character and a column", () => {
    const text = source("a\u{FEFF}b\n\u{FEFF}c");
    expect(text.hasBom).toBe(false);
    expect(text.position(4)).toEqual({ offset: 4, line: 1, col: 3 });
    expect(text.position(9)).toEqual({ offset: 9, line: 2, col: 2 });
  });

  test("a file without one starts at column 1 too", () => {
    const text = source("ab");
    expect(text.hasBom).toBe(false);
    expect(text.position(0)).toEqual({ offset: 0, line: 1, col: 1 });
    expect(text.position(1)).toEqual({ offset: 1, line: 1, col: 2 });
  });
});

describe("offsets", () => {
  // a (1 byte), e acute (2), euro sign (3), grinning face (4 bytes, 2 UTF-16 units), b.
  const text = source("a\u{E9}\u{20AC}\u{1F600}b");

  test("convert UTF-16 indexes to UTF-8 bytes", () => {
    expect([0, 1, 2, 3, 5, 6].map((index) => text.byteOffset(index))).toEqual([0, 1, 3, 6, 10, 11]);
  });

  test("convert UTF-8 bytes back to UTF-16 indexes", () => {
    expect([0, 1, 3, 6, 10, 11].map((offset) => text.utf16Index(offset))).toEqual([0, 1, 2, 3, 5, 6]);
  });

  test("refuse an index between the two units of a surrogate pair, a byte inside a character, and out of range", () => {
    expect(() => text.byteOffset(4)).toThrow(RangeError);
    expect(() => text.byteOffset(7)).toThrow(RangeError);
    expect(() => text.byteOffset(-1)).toThrow(RangeError);
    expect(() => text.byteOffset(1.5)).toThrow(RangeError);
    for (const offset of [2, 4, 5, 7, 8, 9, 12, -1]) expect(() => text.utf16Index(offset)).toThrow(RangeError);
    for (const offset of [2, 7, 12]) expect(() => text.position(offset)).toThrow(RangeError);
  });

  test("an ASCII file maps every index to itself", () => {
    const ascii = source("plain\ntext");
    for (let index = 0; index <= ascii.text.length; index++) expect(ascii.byteOffset(index)).toBe(index);
  });
});

describe("positions", () => {
  test("count lines from 1 across LF, CRLF and a lone CR", () => {
    const text = source("a\nb\r\nc\rd");
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((offset) => text.position(offset).line)).toEqual([1, 1, 2, 2, 2, 3, 3, 4, 4]);
  });

  test("count columns in code points from 1", () => {
    const text = source("\u{1F600}\u{E9}x\n\u{20AC}y");
    expect(text.position(4)).toEqual({ offset: 4, line: 1, col: 2 });
    expect(text.position(6)).toEqual({ offset: 6, line: 1, col: 3 });
    expect(text.position(11)).toEqual({ offset: 11, line: 2, col: 2 });
  });

  test("the end of the file is a position", () => {
    const text = source("ab\n");
    expect(text.position(3)).toEqual({ offset: 3, line: 2, col: 1 });
    expect(() => text.position(4)).toThrow(RangeError);
  });

  test("cost does not grow with the length of the line", () => {
    // A 2 MB single line with characters of every width; 20,000 positions near its end would take minutes at one step per
    // character, and take milliseconds through the table. The bound is far from both, so that a loaded machine does not
    // fail it.
    const line = "a\u{E9}\u{20AC}\u{1F600}".repeat(200_000);
    const text = source(line);
    const end = text.bytes.length;
    const started = performance.now();
    for (let k = 0; k < 20_000; k++) text.position(end - 10 * k);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(text.position(end)).toEqual({ offset: end, line: 1, col: 4 * 200_000 + 1 });
  });

  test("the empty file has one position", () => {
    expect(source("").position(0)).toEqual({ offset: 0, line: 1, col: 1 });
  });
});

describe("invalid UTF-8", () => {
  test("fails with one syntax-error at the record, positioned at the first byte of the ill-formed sequence", () => {
    const outcome = decodeSource("notes/bad.md", new Uint8Array([0x61, 0x0a, 0x62, 0xe2, 0x82, 0x41]));
    expect(outcome.ok).toBe(false);
    expect(outcome.issues).toEqual([
      {
        code: "syntax-error",
        severity: "error",
        class: "structural",
        path: "notes/bad.md",
        at: "",
        message: expect.stringContaining("byte 3"),
        position: { offset: 3, line: 2, col: 2 },
      },
    ]);
  });

  test("a configuration or a schema fails with its own operation code, which has no node", () => {
    const bad = new Uint8Array([0x76, 0x6d, 0x64, 0x3a, 0x20, 0xff]);
    for (const code of ["config-invalid", "schema-invalid"] as const) {
      const outcome = decodeSource(".vmd/config.yaml", bad, code);
      expect(outcome.issues.map((issue) => [issue.code, issue.class, issue.at, issue.path, issue.position])).toEqual([
        [code, "operation", null, ".vmd/config.yaml", { offset: 5, line: 1, col: 6 }],
      ]);
    }
    expect(decodeSource(".vmd/config.yaml", bad.subarray(0, 5), "config-invalid").ok).toBe(true);
  });

  test("positions the bad byte past a byte order mark, which is not a column", () => {
    const outcome = decodeSource("x.md", new Uint8Array([...BOM, 0x61, 0xff]));
    expect(outcome.issues[0]?.position).toEqual({ offset: 4, line: 1, col: 2 });
  });

  test.each([
    ["a lone continuation byte", [0x80]],
    ["an overlong encoding", [0xc0, 0xaf]],
    ["an encoded surrogate", [0xed, 0xa0, 0x80]],
    ["a code point beyond U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
    ["a truncated sequence at the end", [0xf0, 0x9f, 0x98]],
    ["0xFF", [0xff]],
  ])("refuses %s", (_name, bytes) => {
    expect(decodeSource("x.json", new Uint8Array([0x7b, ...bytes])).ok).toBe(false);
    expect(firstInvalidUtf8(new Uint8Array([0x7b, ...bytes]))).toBe(1);
  });

  test("accepts the near misses: the largest code point, the last before the surrogates, and a noncharacter", () => {
    for (const bytes of [
      [0xf4, 0x8f, 0xbf, 0xbf],
      [0xed, 0x9f, 0xbf],
      [0xef, 0xbf, 0xbf],
    ]) {
      expect(decodeSource("x.json", new Uint8Array(bytes)).ok).toBe(true);
      expect(firstInvalidUtf8(new Uint8Array(bytes))).toBe(-1);
    }
  });

  test("the validator agrees with TextDecoder on random bytes", () => {
    const fatal = new TextDecoder("utf-8", { fatal: true });
    const bytes = fc.array(
      fc.oneof(fc.integer({ min: 0, max: 255 }), fc.constantFrom(0x80, 0xbf, 0xc2, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0x9f, 0xa0)),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(bytes, (array) => {
        let valid = true;
        try {
          fatal.decode(new Uint8Array(array));
        } catch {
          valid = false;
        }
        expect(firstInvalidUtf8(new Uint8Array(array)) === -1).toBe(valid);
      }),
      { numRuns: 5000 },
    );
  });
});

// Property test 5 of the I1 design.
describe("property 5: SourceText agrees with TextEncoder on every prefix of random strings", () => {
  const piece = fc.oneof(
    fc.string({ unit: "binary", maxLength: 4 }),
    fc.constantFrom("\n", "\r", "\r\n", "\u{FEFF}", "a", "\u{E9}", "\u{20AC}", "\u{1F600}", "\u{10FFFF}", "\u{FFFF}"),
  );
  const document = fc.tuple(fc.boolean(), fc.array(piece, { maxLength: 30 })).map(([bom, pieces]) => {
    const text = pieces.join("");
    return bom ? `\u{FEFF}${text}` : text;
  });

  /**
   * The line and column of the end of `prefix`, computed by splitting on line breaks and counting code points. When `prefix`
   * ends inside a CRLF, the CR has not ended its line yet: the LF is still on it.
   */
  function expectedPosition(prefix: string, next: string, hasBom: boolean): { line: number; col: number } {
    const insideCrlf = prefix.endsWith("\r") && next === "\n";
    const lines = (insideCrlf ? prefix.slice(0, -1) : prefix).split(/\r\n|\r|\n/);
    const last = lines[lines.length - 1] ?? "";
    const columns = [...(lines.length === 1 && hasBom ? last.slice(1) : last)].length + (insideCrlf ? 1 : 0);
    return { line: lines.length, col: columns + 1 };
  }

  test("byteOffset, utf16Index and position", () => {
    fc.assert(
      fc.property(document, (documentText) => {
        const text = source(documentText);
        expect(text.text).toBe(documentText);
        expect(text.hasBom).toBe(documentText.startsWith("\u{FEFF}"));
        for (let index = 0; index <= documentText.length; index++) {
          const code = documentText.charCodeAt(index);
          const insidePair = code >= 0xdc00 && code <= 0xdfff && index > 0;
          if (insidePair) {
            expect(() => text.byteOffset(index)).toThrow(RangeError);
            continue;
          }
          const prefix = documentText.slice(0, index);
          const offset = new TextEncoder().encode(prefix).length;
          expect(text.byteOffset(index)).toBe(offset);
          expect(text.utf16Index(offset)).toBe(index);
          const position = text.position(offset);
          expect(position).toEqual({ offset, ...expectedPosition(prefix, documentText.charAt(index), text.hasBom) });
        }
      }),
      { numRuns: 1000 },
    );
  });
});
