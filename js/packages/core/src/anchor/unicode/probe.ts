// A check of the runtime's Unicode data against a few facts of the tables' version. The derived-anchor rule takes NFC from the
// runtime, and NFC is stable only for the characters the runtime's Unicode version knows: an older runtime may normalize a string
// that holds characters added since differently. The facts are about characters the tables' version added, so a runtime that
// knows them is at that version or later. The probe uses only standard JavaScript: property escapes and `toLowerCase`.

import { UNICODE_VERSION } from "./unicode.js";

/** What the probe asks of a runtime, one code point at a time. */
export interface UnicodeRuntime {
  /** Whether the code point's general category is a letter (L). */
  isLetter(codePoint: number): boolean;
  /** Whether the code point is assigned, of any general category but Cn. */
  isAssigned(codePoint: number): boolean;
  /** The lower case of the string holding the code point alone. */
  lowerCase(codePoint: number): string;
}

const LETTER = /^\p{L}$/u;
const ASSIGNED = /^\p{Assigned}$/u;

/** The runtime this code runs on, through property escapes and `String.prototype.toLowerCase`. */
export const STANDARD_RUNTIME: UnicodeRuntime = Object.freeze({
  isLetter: (codePoint: number) => LETTER.test(String.fromCodePoint(codePoint)),
  isAssigned: (codePoint: number) => ASSIGNED.test(String.fromCodePoint(codePoint)),
  lowerCase: (codePoint: number) => String.fromCodePoint(codePoint).toLowerCase(),
});

/** A fact of the tables' Unicode version about one code point. */
export type UnicodeFact =
  | { readonly kind: "letter"; readonly codePoint: number }
  | { readonly kind: "assigned"; readonly codePoint: number }
  | { readonly kind: "lower-case"; readonly codePoint: number; readonly lower: number };

/** Facts of Unicode 17.0 about characters it added: Beria Erfe (U+16EA0 to U+16EDF) and the Saudi riyal sign. */
export const PROBE_FACTS: readonly UnicodeFact[] = Object.freeze([
  Object.freeze({ kind: "letter", codePoint: 0x16ea0 }),
  Object.freeze({ kind: "lower-case", codePoint: 0x16ea0, lower: 0x16ebb }),
  Object.freeze({ kind: "assigned", codePoint: 0x20c1 }),
] as const);

/** The probe's result: whether the runtime agrees with every fact, and a sentence for each fact it fails. */
export interface UnicodeRuntimeProbe {
  /** The tables' Unicode version, which the facts are of. */
  readonly version: string;
  /** Whether every fact holds on the runtime; then its NFC is the tables' version's for every character that version knows. */
  readonly agrees: boolean;
  /** One sentence for each fact the runtime fails, in the order of the facts; empty when it agrees. */
  readonly failures: readonly string[];
}

/** Writes a code point as `U+` and at least four upper-case hexadecimal digits. */
function codePointName(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Writes each code point of `text` as `U+` digits, separated by spaces. */
function codePointNames(text: string): string {
  return [...text].map((c) => codePointName(c.codePointAt(0) as number)).join(" ");
}

/** Returns the sentence for a fact the runtime fails, or null when it holds. */
function failure(fact: UnicodeFact, runtime: UnicodeRuntime): string | null {
  const name = codePointName(fact.codePoint);
  switch (fact.kind) {
    case "letter":
      return runtime.isLetter(fact.codePoint) ? null : `${name} is not a letter here`;
    case "assigned":
      return runtime.isAssigned(fact.codePoint) ? null : `${name} is not assigned here`;
    case "lower-case": {
      const lower = runtime.lowerCase(fact.codePoint);
      const expected = String.fromCodePoint(fact.lower);
      return lower === expected ? null : `${name} lower-cases to ${codePointNames(lower)} here, not ${codePointName(fact.lower)}`;
    }
  }
}

/** Checks the facts against `runtime`: {@link unicodeRuntimeProbe} for a runtime given as functions. */
export function probeUnicodeRuntime(runtime: UnicodeRuntime): UnicodeRuntimeProbe {
  const failures = PROBE_FACTS.map((fact) => failure(fact, runtime)).filter((sentence) => sentence !== null);
  return Object.freeze({ version: UNICODE_VERSION, agrees: failures.length === 0, failures: Object.freeze(failures) });
}

/**
 * Checks a few facts of the Unicode version of vmd's tables against this runtime's Unicode data. A runtime that fails one has
 * older Unicode data: its NFC, which derived anchors use, may then differ from the tables' version on strings that hold
 * characters added since, so a heading with such a character may get another anchor than on other runtimes. A runtime with
 * newer Unicode data agrees. Costs a few regular-expression tests.
 */
export function unicodeRuntimeProbe(): UnicodeRuntimeProbe {
  return probeUnicodeRuntime(STANDARD_RUNTIME);
}
