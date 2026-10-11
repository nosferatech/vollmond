import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { compileLineTest } from "./grep.js";
import { checkPortableRegex } from "./portable-regex.js";
import { candidatePatterns } from "./portable-regex.testkit.js";

describe("checkPortableRegex", () => {
  // Each construct outside the subset of §11.4, with a near miss that is inside it, and a phrase of the issue's message.
  test.each([
    ["a backreference", "(a)\\1", "(a)\\\\1", "a backreference"],
    ["a named backreference, ECMAScript's", "(a)\\k<n>", "(a)k<n>", "a named backreference"],
    ["a named backreference, Python's", "(?P=n)", "(?:P=n)", "a named backreference"],
    ["a lookahead", "a(?=b)", "a(?:b)", "a lookahead"],
    ["a negative lookahead", "a(?!b)", "a(?:!b)", "a negative lookahead"],
    ["a lookbehind", "(?<=a)b", "(?:<=a)b", "a lookbehind"],
    ["a negative lookbehind", "(?<!a)b", "(?:<!a)b", "a negative lookbehind"],
    ["a named group, ECMAScript's", "(?<y>\\d+)", "(?:<y>\\d+)", "a named group"],
    ["a named group, Python's", "(?P<y>\\d+)", "(?:P<y>\\d+)", "a named group"],
    ["an atomic group", "(?>a+)b", "(?:a+)b", "an atomic group"],
    ["a branch reset group", "(?|a|b)", "(?:a|b)", "a branch reset group"],
    ["a recursion", "(?P>n)", "(?:P>n)", "a recursion"],
    ["a comment group", "a(?#note)", "a(?:#note)", "a comment group"],
    ["a conditional group", "(a)?(?(1)b|c)", "(a)?(?:(1)b|c)", "a conditional group"],
    ["inline flags", "(?i)abc", "(?:i)abc", "inline flags"],
    ["an inline flag group", "(?i:abc)", "(?:i:abc)", "inline flags"],
    ["a possessive quantifier", "a*+", "a*?", "a quantifier after a quantifier"],
    ["a repeated quantifier", "a{2}{3}", "(?:a{2}){3}", "a quantifier after a quantifier"],
    ["a quantifier with nothing to repeat", "*a", "\\*a", "nothing to repeat"],
    ["a quantifier on an anchor", "^*a", "\\^*a", "a quantifier on an anchor"],
    ["a quantifier on a word boundary", "\\b+", "\\w+", "a quantifier on an anchor"],
    ["a repeat count above 1000", "a{1001}", "a{1000}", "a repeat count above 1000"],
    ["nested repeat counts above 1000", "(?:a{100}){11}", "(?:a{100}){10}", "nested repeat counts whose product"],
    ["a reversed repeat range", "a{3,2}", "a{2,3}", "minimum exceeds its maximum"],
    ["{,n}, at most n in Python and a literal in RE2", "a{,3}", "a{0,3}", "an unescaped {"],
    ["an unescaped {", "a{b", "a\\{b", "an unescaped {"],
    ["an unescaped }", "a}", "a\\}", "an unescaped }"],
    ["an unescaped ] outside a class", "a]", "a\\]", "an unescaped ]"],
    ["the Unicode property escape \\p", "\\p{L}", "p\\{L\\}", "Unicode property escape \\p"],
    ["the Unicode property escape \\P", "\\PL", "PL", "Unicode property escape \\P"],
    ["the escape \\u", "\\u0041", "\\x41", "the escape \\u"],
    ["the escape \\u{...}", "\\u{41}", "\\x41", "the escape \\u"],
    ["the escape \\x{...}", "\\x{41}", "\\x41", "the escape \\x{...}"],
    ["\\x without two hexadecimal digits", "\\x4", "\\x04", "without two hexadecimal digits"],
    ["the control escape \\c", "\\cJ", "\\n", "the control escape \\c"],
    ["the escape \\0", "\\0", "\\x00", "the escape \\0"],
    ["an octal escape", "\\012", "\\x0a", "the escape \\0"],
    ["the anchor \\A", "\\Aa", "^a", "the anchor \\A"],
    ["the anchor \\z", "a\\z", "a$", "the anchor \\z"],
    ["the anchor \\Z", "a\\Z", "a$", "the anchor \\Z"],
    ["the quoting escape \\Q", "\\Qa.b", "a\\.b", "the quoting escape \\Q"],
    ["an unknown letter escape", "\\e", "\\f", "the unknown escape \\e"],
    ["an escaped - outside a class", "a\\-b", "a[\\-]b", "the escape \\-"],
    ["an escaped punctuation character", "\\#", "#", "the escape \\#"],
    ["a ] first in a class", "[]a]", "[\\]a]", "a ] first in a class"],
    ["an empty negated class", "[^]", "[^\\]]", "a ] first in a class"],
    ["a POSIX class", "[[:alpha:]]", "[\\[:alpha:\\]]", "the POSIX class [:alpha:]"],
    ["an unescaped [ in a class", "[a[b]", "[a\\[b]", "an unescaped [ in a class"],
    ["a - in the middle of a class", "[a-c-e]", "[a-ce-]", "a - in the middle of a class"],
    ["-- in a class", "[+--]", "[+-\\-]", "-- in a class"],
    ["&& in a class", "[a&&b]", "[a&b]", "&& in a class"],
    ["|| in a class", "[a||b]", "[a|b]", "|| in a class"],
    ["~~ in a class", "[a~~b]", "[a~b]", "~~ in a class"],
    ["a class escape as the bound of a range", "[\\d-z]", "[\\d\\-z]", "a class escape as the bound of a range"],
    ["a reversed range", "[z-a]", "[a-z]", "a range whose start is above its end"],
    ["\\b in a class", "[\\b]", "[\\x08]", "\\b in a class"],
    ["\\B in a class", "[\\B]", "[B]", "\\B in a class"],
    ["an unclosed class", "[ab", "[ab]", "an unclosed class"],
    ["an unclosed group", "(ab", "(ab)", "an unclosed group"],
    ["an unmatched )", "ab)", "ab\\)", "an unmatched )"],
    ["a backslash at the end", "ab\\", "ab\\\\", "a backslash at the end"],
    ["a lone surrogate", "a\uD800", "a\u{1F600}", "a lone surrogate"],
  ])("rejects %s, once, and accepts its near miss", (_name, pattern, nearMiss, phrase) => {
    const issues = checkPortableRegex(pattern);
    expect(issues.map((issue) => issue.code)).toEqual(["query-invalid"]);
    expect(issues[0]?.message).toContain(phrase);
    expect(issues[0]?.class).toBe("operation");
    expect(checkPortableRegex(nearMiss)).toEqual([]);
    // Every near miss is a pattern ECMAScript compiles.
    expect(() => new RegExp(nearMiss, "u")).not.toThrow();
  });

  test.each([
    ["literals", "abc é \u{1F600}"],
    ["the escapes of the subset", "\\d\\D\\w\\W\\s\\S\\t\\n\\r\\f\\v\\x41"],
    ["escaped syntax characters", "\\^\\$\\\\\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/"],
    ["classes, ranges and escapes in them", "[a-z0-9_][^\\s\\]][-a][a-][\\-\\[\\]\\^]"],
    ["a class with characters above U+FFFF", "[\u{1F600}-\u{1F64F}]"],
    [".", "a.c"],
    ["anchors", "^\\bword\\B$"],
    ["groups and alternation", "(a|b)(?:c|)|d"],
    ["greedy and lazy quantifiers", "a*b+c?d{2}e{2,}f{2,5}g*?h+?i??j{2}?k{2,}?l{2,5}?"],
    ["a quantified group", "(?:ab)+(c)*"],
    ["the empty pattern", ""],
  ])("accepts %s", (_name, pattern) => {
    expect(checkPortableRegex(pattern)).toEqual([]);
    expect(() => new RegExp(pattern, "u")).not.toThrow();
  });

  test("reports each construct outside the subset, with its column in code points", () => {
    const issues = checkPortableRegex("\u{1F600}(?=a)\\1");
    expect(issues.map((issue) => issue.message)).toEqual([
      'pattern "\u{1F600}(?=a)\\\\1": a lookahead at column 2 is not in the portable regex subset',
      'pattern "\u{1F600}(?=a)\\\\1": a backreference at column 7 is not in the portable regex subset',
    ]);
  });

  // This guards the ECMAScript side only: RE2 is not run here, and Python's re is run by portable-regex.suite.test.ts.
  test("accepts only patterns that ECMAScript compiles with the u flag", () => {
    fc.assert(
      fc.property(candidatePatterns, (pattern) => {
        if (checkPortableRegex(pattern).length > 0) return;
        expect(() => new RegExp(pattern, "u"), pattern).not.toThrow();
      }),
      { numRuns: 20000 },
    );
  });

  test.each([
    ["(?:a{100}){11}", 1],
    ["(?:a{100}){10}", 0],
    ["(?:(?:a{10}){10}){11}", 1],
    ["(?:(?:a{10}){10}){10}", 0],
    ["(?:a{2,}){501}", 1],
    ["(?:a{2,}){500}", 0],
    ["(?:a{2}|b{600}){2}", 1],
    ["(?:a{2}|b{500}){2}", 0],
    ["(?:a{1000})*", 0],
    ["(?:a{1000}){0}", 0],
    ["a{1000}b{1000}", 0],
  ])("limits the product of nested repeat counts to 1000, as RE2 does: %s", (pattern, issues) => {
    const found = checkPortableRegex(pattern);
    expect(found.map((issue) => issue.message.includes("nested repeat counts whose product is above 1000"))).toEqual(
      Array(issues).fill(true),
    );
  });

  test("has no time limit: (a+)+$ is accepted, though JavaScript's engine backtracks on it", () => {
    expect(checkPortableRegex("(a+)+$")).toEqual([]);
  });
});

describe("compileLineTest", () => {
  test("fails with the checker's issues for a pattern outside the subset", () => {
    const outcome = compileLineTest({ pattern: "a(?=b)", mode: "regex" });
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.map((issue) => issue.code)).toEqual(["query-invalid"]);
  });

  test("does not check a literal pattern", () => {
    const outcome = compileLineTest({ pattern: "a(?=b)", mode: "literal" });
    expect(outcome.ok && outcome.value("xa(?=b)y")).toBe(true);
  });

  test("reads code points, as RE2 and Python do", () => {
    const outcome = compileLineTest({ pattern: "^[\u{1F600}]$", mode: "regex" });
    expect(outcome.ok && outcome.value("\u{1F600}")).toBe(true);
  });
});
