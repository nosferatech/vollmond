import { describe, expect, test } from "vitest";
import { leastTimeRatio, timeOf } from "../timing.testkit.js";
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

  test("matches in time linear in the path, whatever the globstars", async () => {
    // Three globs with `size` globstars or stars fail to match a path of twice as many segments. A backtracking regex takes
    // time exponential in the globstars on the first, which a merge alone would fix, and on the second, which it would not.
    // Matching takes time proportional to the path times the glob, so doubling both takes about 4 times as long: 3.2 to 3.6
    // on a laptop under a load average of 24 to 70. A backtracking regex takes 640 times as long; the globs are short so that
    // it fails the test in a second, where 12 globstars take about 100 s.
    const tests = (size: number) => {
      const path = Array.from({ length: 2 * size }, () => "a").join("/");
      const globs = [
        `${Array.from({ length: size }, () => "**").join("/")}/b`,
        `${Array.from({ length: size }, () => "**/a").join("/")}/b`,
        `${Array.from({ length: size }, () => "*a*").join("*/")}/b`,
      ].map(globTest);
      for (const test of globs) expect(test(path)).toBe(false);
      return () => timeOf(() => globs.map((test) => test(path)));
    };
    expect(await leastTimeRatio(tests(5), tests(10))).toBeLessThan(16);
  });
});

/** Compiles a glob that is well formed, and fails the test otherwise. */
function globTest(glob: string): (path: string) => boolean {
  const outcome = compileGlob(glob);
  if (!outcome.ok) expect.fail(`${glob} is malformed: ${outcome.issues[0]?.message}`);
  return outcome.value;
}
