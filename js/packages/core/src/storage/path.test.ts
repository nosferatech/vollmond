import { describe, expect, test } from "vitest";
import { compileGlob } from "./path.js";

// The glob syntax of §11.2, which list, grep, a collection's match and exclude, the configuration's ignore and VQL's @path share.
describe("compileGlob", () => {
  test.each([
    // ** as a whole segment: any number of whole segments, none included; a / after it is kept.
    ["docs/**", "docs/a.md", true],
    ["docs/**", "docs/a/b.md", true],
    ["docs/**", "docs", false],
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
    expect(compileGlob(glob)(path)).toBe(expected);
  });
});
