// Lookups over the Unicode tables of the derived-anchor rule. The tables are generated from the Unicode Character Database, so
// the rule gives the same anchors on every runtime, whatever Unicode data the runtime bundles.
//
// NFC is not here: the rule takes it from the runtime's `String.prototype.normalize`. That is stable for every character the
// runtime's Unicode version knows. The Unicode Character Encoding Stability Policy, "Normalization Stability" (Unicode 4.1 and
// later), says: "given versions V and U of Unicode, and any string S which only contains characters assigned according to both V
// and U", toNFC of S is the same under V and U. So a runtime at the tables' version or later normalizes as they would; an older
// runtime may differ on strings that contain characters assigned after its version. `unicodeRuntimeProbe()`, in `probe.ts`,
// tells which kind of runtime this is.

import {
  DEFAULT_IGNORABLE_CODE_POINT,
  LETTER_MARK_DIGIT_CONNECTOR,
  LOWER_CASE_EXPANSIONS,
  LOWER_CASE_RUNS,
  UNICODE_VERSION,
  WHITE_SPACE,
} from "./unicode-17.0.0.generated.js";

export { UNICODE_VERSION };

/** A set of code points, held as sorted, disjoint ranges. */
export class CodePointRanges {
  /** First code point of each range, ascending. */
  readonly #starts: Uint32Array;
  /** One past the last code point of each range. */
  readonly #ends: Uint32Array;

  /**
   * Decodes ranges written as [gap, length] pairs, each gap counted from the end of the previous range (from 0 for the first).
   * Precondition: an even number of non-negative integers, every length at least 1 and every gap after the first at least 1.
   */
  constructor(encoded: readonly number[]) {
    const count = encoded.length / 2;
    this.#starts = new Uint32Array(count);
    this.#ends = new Uint32Array(count);
    let end = 0;
    for (let i = 0; i < count; i++) {
      const start = end + (encoded[2 * i] as number);
      end = start + (encoded[2 * i + 1] as number);
      this.#starts[i] = start;
      this.#ends[i] = end;
    }
  }

  /** Returns whether `codePoint` is in the set. */
  has(codePoint: number): boolean {
    const i = lastAtOrBelow(this.#starts, codePoint);
    return i >= 0 && codePoint < (this.#ends[i] as number);
  }
}

/** A code point's full lower-case mapping, by Unicode's default mapping with no context and no locale. */
export class LowerCaseMapping {
  readonly #runStarts: Uint32Array;
  /** Per run: [count, stride, delta]. */
  readonly #runs: Int32Array;
  readonly #expansions: ReadonlyMap<number, string>;

  /**
   * Decodes runs written as [start gap, count, stride, delta], the gap counted from the previous run's start (from 0 for the
   * first): `count` code points from the start, `stride` apart, each mapping to itself plus `delta`. Expansions are
   * [code point, ...mapping] for mappings to more than one code point. Precondition: runs ascend and do not interleave.
   */
  constructor(runs: readonly number[], expansions: readonly (readonly number[])[]) {
    const count = runs.length / 4;
    this.#runStarts = new Uint32Array(count);
    this.#runs = new Int32Array(3 * count);
    let start = 0;
    for (let i = 0; i < count; i++) {
      start += runs[4 * i] as number;
      this.#runStarts[i] = start;
      this.#runs.set(runs.slice(4 * i + 1, 4 * i + 4), 3 * i);
    }
    this.#expansions = new Map(expansions.map(([codePoint, ...lower]) => [codePoint as number, String.fromCodePoint(...lower)]));
  }

  /** Returns the lower-case mapping of `codePoint` as one or more code points; it is the code point itself if there is none. */
  of(codePoint: number): string {
    const expansion = this.#expansions.get(codePoint);
    if (expansion !== undefined) return expansion;
    const i = lastAtOrBelow(this.#runStarts, codePoint);
    if (i >= 0) {
      const offset = codePoint - (this.#runStarts[i] as number);
      const count = this.#runs[3 * i] as number;
      const stride = this.#runs[3 * i + 1] as number;
      if (offset % stride === 0 && offset / stride < count)
        return String.fromCodePoint(codePoint + (this.#runs[3 * i + 2] as number));
    }
    return String.fromCodePoint(codePoint);
  }
}

/** Returns the index of the last element of the ascending `sorted` that is at most `value`, or -1 if there is none. */
function lastAtOrBelow(sorted: Uint32Array, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle] as number) <= value) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

const whiteSpace = new CodePointRanges(WHITE_SPACE);
const defaultIgnorable = new CodePointRanges(DEFAULT_IGNORABLE_CODE_POINT);
const letterMarkDigitConnector = new CodePointRanges(LETTER_MARK_DIGIT_CONNECTOR);
const lowerCase = new LowerCaseMapping(LOWER_CASE_RUNS, LOWER_CASE_EXPANSIONS);

/** Returns whether `codePoint` has the White_Space property, which includes U+0085 and excludes U+FEFF. */
export function isWhiteSpace(codePoint: number): boolean {
  return whiteSpace.has(codePoint);
}

/** Returns whether `codePoint` has the Default_Ignorable_Code_Point property, as U+00AD, U+200D and U+FE0F do. */
export function isDefaultIgnorable(codePoint: number): boolean {
  return defaultIgnorable.has(codePoint);
}

/** Returns whether the general category of `codePoint` is a letter (L), a mark (M), a decimal digit (Nd) or a connector (Pc). */
export function isLetterMarkDigitOrConnector(codePoint: number): boolean {
  return letterMarkDigitConnector.has(codePoint);
}

/**
 * Returns the default lower-case mapping of `codePoint`, one code point at a time: SpecialCasing.txt's unconditional mapping
 * where there is one, otherwise UnicodeData.txt's simple mapping, otherwise the code point itself. No context applies, so U+03A3
 * always gives U+03C3, never the final sigma U+03C2, and U+0130 gives U+0069 U+0307.
 */
export function lowerCaseOf(codePoint: number): string {
  return lowerCase.of(codePoint);
}
