import { makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";

/** A range of UTF-8 bytes, `[start, end)`: it includes `start` and excludes `end`. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * A place in a file: its UTF-8 byte offset from the first byte of the file, its line from 1, and its column in code points
 * from 1. A byte order mark counts in offsets but is not a column.
 */
export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly col: number;
}

// Deviation from the I1 design, recorded in issue #10: the map of line breaks read as LF back to the source is not here yet;
// the YAML parser, its first user, brings it.
/**
 * The decoded text of a file, with conversions between the UTF-16 indexes that JavaScript strings and parsers use and the
 * UTF-8 byte offsets that vmd reports. Lines end at LF, CRLF or a lone CR.
 */
export interface SourceText {
  /** The file's bytes, as given. */
  readonly bytes: Uint8Array;
  /** The file decoded as UTF-8. A byte order mark at byte 0 stays as U+FEFF at index 0, so that offsets count it. */
  readonly text: string;
  /** Whether the file starts with a byte order mark, which formats skip: parse units start at index 1 of `text`. */
  readonly hasBom: boolean;
  /**
   * Converts an index into `text` to the byte offset of the same place. Throws a `RangeError` for an index outside
   * `[0, text.length]` or between the two units of a surrogate pair.
   */
  byteOffset(utf16Index: number): number;
  /**
   * Converts a byte offset to the index into `text` of the same place. Throws a `RangeError` for an offset outside
   * `[0, bytes.length]` or inside a character.
   */
  utf16Index(byteOffset: number): number;
  /**
   * Gives the line and column of a byte offset. Around a byte order mark, offset 0, before it, and offset 3, after it, are
   * both line 1, column 1; offsets 1 and 2 are inside it, and throw. Throws a `RangeError` where
   * {@link SourceText.utf16Index} does. Its cost grows with the logarithm of the file's lines and of its characters outside
   * ASCII, not with the length of the line.
   */
  position(byteOffset: number): Position;
}

/** The issue a file that is not UTF-8 raises: `syntax-error` for a record, or a configuration's or a schema's own code. */
export type SourceTextIssueCode = "syntax-error" | "config-invalid" | "schema-invalid";

/**
 * Decodes a file as UTF-8. A file that is not UTF-8 fails with one issue of the given code, positioned at the first byte of
 * the first ill-formed sequence: a `syntax-error` attached to the record (`at` is `""`), or a `config-invalid` or
 * `schema-invalid`, which have no node (`at` is null). `path` is the file's store path, for that issue.
 *
 * Note: building the text costs one pass over it, and memory for each line start and for each character outside ASCII.
 */
export function decodeSource(path: string, bytes: Uint8Array, code: SourceTextIssueCode = "syntax-error"): Outcome<SourceText> {
  let text: string;
  try {
    // Without `ignoreBOM`, the decoder drops a leading byte order mark, and every index would be off by its three bytes.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    const offset = firstInvalidUtf8(bytes);
    // The bytes before the first ill-formed sequence are well formed.
    const prefix = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset));
    const position = new DecodedSourceText(bytes.subarray(0, offset), prefix).position(offset);
    const at = code === "syntax-error" ? "" : null;
    return fail([makeIssue({ code, path, at, message: `not valid UTF-8 at byte ${offset}`, position })]);
  }
  return succeed(new DecodedSourceText(bytes, text));
}

/**
 * Finds the first ill-formed UTF-8 sequence in `bytes`, by the well-formed sequences of the Unicode Standard (table 3-7), and
 * returns the offset of its first byte, or -1 when `bytes` is well formed.
 */
export function firstInvalidUtf8(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i] as number;
    if (lead < 0x80) {
      i += 1;
      continue;
    }
    let length: number;
    let low = 0x80;
    let high = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      length = 2;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      length = 3;
      if (lead === 0xe0) low = 0xa0;
      if (lead === 0xed) high = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      length = 4;
      if (lead === 0xf0) low = 0x90;
      if (lead === 0xf4) high = 0x8f;
    } else {
      return i;
    }
    // The second byte has the lead's range; the others are plain continuation bytes.
    for (let k = 1; k < length; k++) {
      const byte = bytes[i + k];
      if (byte === undefined || byte < (k === 1 ? low : 0x80) || byte > (k === 1 ? high : 0xbf)) return i;
    }
    i += length;
  }
  return -1;
}

const LF = 0x0a;
const CR = 0x0d;

class DecodedSourceText implements SourceText {
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly hasBom: boolean;
  /** The byte offset at which each line starts, in order; line 1 starts at 0. */
  readonly #lineStarts: number[] = [0];
  /**
   * For each character outside ASCII, in order: the index into `text` just after it, and the number of bytes by which the
   * UTF-8 offsets from there on exceed the UTF-16 indexes, and the number of characters outside the Basic Multilingual Plane
   * (two UTF-16 units each) up to it. All three arrays are empty for an ASCII file.
   */
  readonly #indexAfter: number[] = [];
  readonly #extraBytes: number[] = [];
  readonly #astralCount: number[] = [];

  constructor(bytes: Uint8Array, text: string) {
    this.bytes = bytes;
    this.text = text;
    this.hasBom = text.charCodeAt(0) === 0xfeff;
    let offset = 0;
    let extra = 0;
    let astral = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) {
        offset += 1;
        if (code === LF || (code === CR && text.charCodeAt(i + 1) !== LF)) this.#lineStarts.push(offset);
        continue;
      }
      if (code < 0x800) {
        offset += 2;
        extra += 1;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        // Decoded UTF-8 is well formed, so a high surrogate always starts a pair: 4 bytes for 2 units.
        offset += 4;
        extra += 2;
        astral += 1;
        i += 1;
      } else {
        offset += 3;
        extra += 2;
      }
      this.#indexAfter.push(i + 1);
      this.#extraBytes.push(extra);
      this.#astralCount.push(astral);
    }
  }

  byteOffset(utf16Index: number): number {
    if (!Number.isInteger(utf16Index) || utf16Index < 0 || utf16Index > this.text.length) {
      throw new RangeError(`index ${utf16Index} is outside the text`);
    }
    const code = this.text.charCodeAt(utf16Index);
    if (code >= 0xdc00 && code <= 0xdfff) throw new RangeError(`index ${utf16Index} is inside a surrogate pair`);
    const k = lastAtOrBefore(this.#indexAfter, utf16Index);
    return k < 0 ? utf16Index : utf16Index + (this.#extraBytes[k] as number);
  }

  utf16Index(byteOffset: number): number {
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > this.bytes.length) {
      throw new RangeError(`offset ${byteOffset} is outside the file`);
    }
    if (((this.bytes[byteOffset] ?? 0) & 0xc0) === 0x80) throw new RangeError(`offset ${byteOffset} is inside a character`);
    // The byte offset just after each character outside ASCII is its index plus its extra bytes.
    let lowIndex = 0;
    let highIndex = this.#indexAfter.length - 1;
    let k = -1;
    while (lowIndex <= highIndex) {
      const middle = (lowIndex + highIndex) >> 1;
      if ((this.#indexAfter[middle] as number) + (this.#extraBytes[middle] as number) <= byteOffset) {
        k = middle;
        lowIndex = middle + 1;
      } else {
        highIndex = middle - 1;
      }
    }
    return k < 0 ? byteOffset : byteOffset - (this.#extraBytes[k] as number);
  }

  position(byteOffset: number): Position {
    const end = this.utf16Index(byteOffset);
    const lineIndex = lastAtOrBefore(this.#lineStarts, byteOffset);
    let start = this.utf16Index(this.#lineStarts[lineIndex] as number);
    if (lineIndex === 0 && this.hasBom) start = Math.min(1, end);
    // Both ends are character boundaries, so the code points between them are the UTF-16 units less one per astral character.
    const col = 1 + end - start - (this.#astralBefore(end) - this.#astralBefore(start));
    return { offset: byteOffset, line: lineIndex + 1, col };
  }

  /** Counts the characters outside the Basic Multilingual Plane that end at or before `utf16Index`. */
  #astralBefore(utf16Index: number): number {
    const k = lastAtOrBefore(this.#indexAfter, utf16Index);
    return k < 0 ? 0 : (this.#astralCount[k] as number);
  }
}

/** Returns the position of the last element of the ascending `sorted` that is at most `value`, or -1. */
function lastAtOrBefore(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] as number) <= value) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
