import { describe, expect, test } from "vitest";
import { compileLineTest } from "./grep.js";

/** Whether `pattern`, compiled as a grep line test, matches `line`. */
function matches(pattern: string, line: string, ignoreCase = false): boolean {
  const outcome = compileLineTest({ pattern, mode: "regex", ignoreCase });
  if (!outcome.ok) expect.fail(`${pattern} is not portable: ${outcome.issues[0]?.message}`);
  return outcome.value(line);
}

// The rows of §11.4's table, "Classes and case": each line gives a pattern, a line, the flag i, and what RE2 reads, which is
// what a pattern means. RE2's readings are the table's; RE2 itself is not run here.
describe("compileLineTest reads a pattern as RE2 does (§11.4)", () => {
  test.each([
    // \d and \D: ASCII. U+0663 is ARABIC-INDIC DIGIT THREE.
    ["\\d", "7", false, true],
    ["\\d", "٣", false, false],
    ["\\D", "٣", false, true],
    ["[\\d]", "٣", false, false],
    // \w and \W: ASCII, and under i also U+017F (long s) and U+212A (Kelvin sign).
    ["^\\w$", "ſ", false, false],
    ["^\\w$", "K", false, false],
    ["^\\w$", "é", false, false],
    ["^\\w$", "ſ", true, true],
    ["^\\w$", "K", true, true],
    ["^\\W$", "ſ", false, true],
    ["^[\\w]$", "K", true, true],
    // \s and \S: [\t\n\f\r ], so not \v, U+00A0, U+2028 or U+FEFF.
    ["^\\s$", "\t", false, true],
    ["^\\s$", " ", false, true],
    ["^\\s$", "\f", false, true],
    ["^\\s$", "\v", false, false],
    ["^\\s$", " ", false, false],
    ["^\\s$", " ", false, false],
    ["^\\s$", "﻿", false, false],
    ["^\\S$", "\v", false, true],
    ["^\\S$", " ", false, true],
    ["^\\S$", " ", false, false],
    ["^\\s+$", "\t \f", false, true],
    ["^\\s$", "\v", true, false],
    // \s and \S inside a class, written out.
    ["^[\\s]$", "\v", false, false],
    ["^[\\s]$", " ", false, true],
    ["^[^\\s]$", "\v", false, true],
    ["^[^\\s]$", " ", false, false],
    ["^[a\\s]$", " ", false, false],
    ["^[\\S]$", "\v", false, true],
    ["^[\\S]$", " ", false, false],
    ["^[^\\S]$", " ", false, true],
    ["^[^\\S]$", "\v", false, false],
    ["^[a\\S]$", "\v", false, true],
    ["^[a\\S]$", "a", false, true],
    ["^[a\\S]$", " ", false, false],
    ["^[^a\\S]$", " ", false, true],
    ["^[^a\\S]$", "a", false, false],
    ["^[^a\\S]$", "\v", false, false],
    ["^[^ \\S]$", " ", false, false],
    ["^[^ \\S]$", "\t", false, true],
    ["^[\\S^]$", "^", false, true],
    ["^[\\S-]+$", "-a", false, true],
    ["^[a\\S]+b$", "a\vb", false, true],
    // \b and \B: ASCII boundaries, also under i.
    ["\\bs", "ſ", true, false],
    ["\\bk", "K", true, false],
    ["a\\b", "aK", true, true],
    ["a\\B", "aK", true, false],
    ["a\\b", "aK", false, true],
    ["a\\B", "ab", true, true],
    ["\\bab\\b", "x ab y", true, true],
    ["\\bAB\\b", "x ab y", true, true],
    ["^\\B$", "", true, true],
    // i is simple case folding: the Kelvin sign folds to k, and long s to s.
    ["^k$", "K", true, true],
    ["^s$", "ſ", true, true],
    ["^k$", "K", false, false],
    // . matches any character of a line, U+2028 and U+2029 included.
    ["^a.b$", "a b", false, true],
    ["^a.b$", "a b", false, true],
    ["^.$", "\u{1F600}", false, true],
  ])("%j on %j with i=%s gives %s", (pattern, line, ignoreCase, expected) => {
    expect(matches(pattern, line, ignoreCase)).toBe(expected);
  });
});
