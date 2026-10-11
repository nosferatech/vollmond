import { describe, expect, test } from "vitest";
import { compileGlob } from "./path.js";

// The glob syntax of §11.2, which list, grep, a collection's match and exclude, the configuration's ignore and VQL's @path share.
describe("compileGlob", () => {
  test.each([
    // ** as a whole segment: any number of whole segments, none included; a / after it is kept.
    ["docs/**", "docs/a.md", true],
    ["docs/**", "docs/a/b.md", true],
    ["docs/**", "docs", false],
    // A final /** is one or more segments, so not the empty rest after docs/.
    ["docs/**", "docs/", false],
    ["docs/**", "docsx/a.md", false],
    ["**/a.md", "a.md", true],
    ["**/a.md", "x/y/a.md", true],
    ["**/a.md", "xa.md", false],
    ["a/**/b.md", "a/b.md", true],
    ["a/**/b.md", "a/x/y/b.md", true],
    ["a/**/b.md", "ab.md", false],
    ["**", "a/b/c.md", true],
    // * within one segment, none included, a leading . too: dotfiles are not special.
    ["*", ".vmd", true],
    ["*.md", ".md", true],
    ["*.md", "a/b.md", false],
    ["a*b", "ab", true],
    ["a*b", "a/b", false],
    ["*/config.yaml", ".vmd/config.yaml", true],
    // ** inside a segment is two *, within that segment.
    ["a**b", "axyb", true],
    ["a**b", "a/b", false],
    // Every other character matches itself, regex syntax included.
    ["a?.md", "ab.md", false],
    ["a?.md", "a?.md", true],
    ["[ab].md", "a.md", false],
    ["[ab].md", "[ab].md", true],
    ["{a,b}.md", "{a,b}.md", true],
    ["a.md", "aXmd", false],
    ["(a|b)+$", "(a|b)+$", true],
  ])("%j against %j gives %s", (glob, path, expected) => {
    expect(globTest(glob)(path)).toBe(expected);
  });

  test.each([
    ["a/", "it ends with /"],
    ["/a", "it starts with /"],
    ["a//b", "it has an empty segment"],
    ["", "it is empty"],
  ])("reports %j as malformed: %s", (glob, problem) => {
    const outcome = compileGlob(glob);
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.map((issue) => issue.code)).toEqual(["query-invalid"]);
    expect(outcome.issues[0]?.message).toContain(problem);
  });

  test("merges consecutive ** segments", () => {
    expect(globTest("a/**/**/b.md")("a/b.md")).toBe(true);
    expect(globTest("**/**")("x/y")).toBe(true);
    expect(globTest("a/**/**")("a")).toBe(false);
  });

  test("matches in time linear in the path, whatever the globstars", () => {
    const path = Array.from({ length: 25 }, () => "a").join("/");
    const start = performance.now();
    // A backtracking regex takes about 100 s on the first, which a merge alone would fix, and on the second, which it would not.
    expect(globTest(`${Array.from({ length: 12 }, () => "**").join("/")}/b`)(path)).toBe(false);
    expect(globTest(`${Array.from({ length: 12 }, () => "**/a").join("/")}/b`)(path)).toBe(false);
    expect(globTest(`${Array.from({ length: 12 }, () => "*a*").join("*/")}/b`)(path)).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

/** Compiles a glob that is well formed, and fails the test otherwise. */
function globTest(glob: string): (path: string) => boolean {
  const outcome = compileGlob(glob);
  if (!outcome.ok) expect.fail(`${glob} is malformed: ${outcome.issues[0]?.message}`);
  return outcome.value;
}
