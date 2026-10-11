import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { compileLineTest } from "./grep.js";
import { checkPortableRegex, portableRegexToJavaScript } from "./portable-regex.js";
import { candidatePatterns } from "./portable-regex.testkit.js";

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
    ["^[\\S^]$", " ", false, false],
    ["^[^\\S^]$", " ", false, true],
    ["^[^\\S^]$", "^", false, false],
    ["^[\\S ]$", " ", false, true],
    ["^[^\\S ]$", " ", false, false],
    ["^[^\\S ]$", "\t", false, true],
    ["^[^\\S\\s]$", " ", false, false],
    ["^[\\S\\s]$", "\v", false, true],
    ["^[\\SA]$", " ", true, false],
    ["^[^\\Sa]$", "\t", true, true],
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

describe("compileLineTest runs in time linear in the line", () => {
  test("a class holding \\S is one class, not an alternation that backtracks", () => {
    const outcome = compileLineTest({ pattern: "^[a\\S]+$", mode: "regex" });
    if (!outcome.ok) expect.fail("not portable");
    const start = performance.now();
    expect(outcome.value(`${"a".repeat(40)} `)).toBe(false);
    // Overlapping branches take time doubling with each a: about 700 ms at 26 of them, and days at 40. The bound is far from
    // both, so that a loaded machine does not fail it: it tells milliseconds from days.
    expect(performance.now() - start).toBeLessThan(5000);
  });
});

describe("the translation keeps the pattern's meaning where the engines agree", () => {
  // No \v, U+00A0, U+2028, U+017F or U+212A: on these characters JavaScript reads \s, \b and i as RE2 does.
  const agreeing = fc.string({ unit: fc.constantFrom(..."aAbkKs_0- \t^é"), maxLength: 8 });

  test("the translated expression matches what the pattern matches in JavaScript", () => {
    fc.assert(
      fc.property(candidatePatterns, fc.boolean(), agreeing, (pattern, ignoreCase, line) => {
        if (checkPortableRegex(pattern).length > 0) return;
        const flags = ignoreCase ? "usi" : "us";
        const translated = new RegExp(portableRegexToJavaScript(pattern, ignoreCase), flags);
        expect(translated.test(line), `${pattern} on ${JSON.stringify(line)}`).toBe(new RegExp(pattern, flags).test(line));
      }),
      { numRuns: 20000 },
    );
  });
});

describe("classes mean what RE2 reads them as", () => {
  // A small model of RE2's class membership: ASCII classes, and under i simple case folding, which adds U+017F and U+212A
  // to \w and so takes them out of \W (`AddFoldedRange` and `AddUGroup` in RE2's parse.cc).
  const word = (c: string) => /^[0-9A-Za-z_]$/.test(c);
  const foldedWord = (c: string) => word(c) || c === "ſ" || c === "K";
  const space = (c: string) => "\t\n\f\r ".includes(c);
  const items: Record<string, (c: string, i: boolean) => boolean> = {
    a: (c, i) => (i ? "aA" : "a").includes(c),
    k: (c, i) => (i ? "kKK" : "k").includes(c),
    "\\s": (c) => space(c),
    "\\S": (c) => !space(c),
    "\\d": (c) => /^[0-9]$/.test(c),
    "\\D": (c) => !/^[0-9]$/.test(c),
    "\\w": (c, i) => (i ? foldedWord(c) : word(c)),
    "\\W": (c, i) => !(i ? foldedWord(c) : word(c)),
    "\\x09-\\x0b": (c) => "\t\n\v".includes(c),
    "\\x20": (c) => c === " ",
    "\\^": (c) => c === "^",
  };
  const probes = [..."aAkKsS0_ ^-\t\v\f\r", "K", "ſ", " ", " ", "é", "\u{1F600}"];

  test("for every combination of up to four items, negated or not, with and without i", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...Object.keys(items)), { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        fc.boolean(),
        (chosen, negated, ignoreCase) => {
          const pattern = `^[${negated ? "^" : ""}${chosen.join("")}]$`;
          const outcome = compileLineTest({ pattern, mode: "regex", ignoreCase });
          if (!outcome.ok) expect.fail(`${pattern} is not portable`);
          for (const probe of probes) {
            const member = chosen.some((item) => (items[item] as (c: string, i: boolean) => boolean)(probe, ignoreCase));
            expect(outcome.value(probe), `${pattern} with i=${ignoreCase} on ${JSON.stringify(probe)}`).toBe(member !== negated);
          }
        },
      ),
      { numRuns: 3000 },
    );
  });
});
