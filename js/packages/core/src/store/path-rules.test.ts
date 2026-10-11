import { describe, expect, test } from "vitest";
import type { Collection } from "../config/configuration.js";
import type { Issue } from "../issue/issue.js";
import { filenameMismatch, type ListedPath, pathRuleIssues } from "./path-rules.js";

/** The issues of the path rules over records, given by path. */
function recordIssues(...paths: string[]): Issue[] {
  return pathRuleIssues(paths.map((path) => ({ path, kind: "record" })));
}

/** Each issue as `code severity path at`. */
function shown(issues: readonly Issue[]): string[] {
  return issues.map((issue) => `${issue.code} ${issue.severity} ${issue.path} ${JSON.stringify(issue.at)}`);
}

describe("path-invalid", () => {
  test.each([
    ["a segment with a space", "my notes.md"],
    ["a segment starting with -", "-a.md"],
    ["a segment starting with _", "_a.md"],
    ["a directory segment outside the rule", "a+b/c.md"],
    ["a character outside ASCII", "café.md"],
    ["a segment ending in .", "docs./a.md"],
    ["a Windows reserved name", "con.md"],
    ["a Windows reserved name with any extension, in any case", "Lpt9.tar.md"],
    ["a Windows reserved name as a directory", "aux/a.md"],
    ["COM1 with an extension", "COM1.md"],
  ])("for %s, once, at the record", (_name, path) => {
    expect(shown(recordIssues(path))).toEqual([`path-invalid error ${path} ""`]);
  });

  test.each([
    ["names that only start like a reserved one", "console.md"],
    ["a reserved name with a suffix", "con1.md"],
    ["COM0 and LPT10, which Windows does not reserve", "COM0.md"],
    ["LPT10", "LPT10.md"],
    ["dots, digits, _ and - after the first character", "v1.2/a_b-c.d.md"],
    ["a segment starting with a digit", "0001-x.md"],
    ["upper case", "Docs/README.md"],
  ])("not for %s", (_name, path) => {
    expect(recordIssues(path)).toEqual([]);
  });

  test("for a segment of more than 255 bytes, and not for one of 255", () => {
    const longest = `${"a".repeat(252)}.md`;
    expect(recordIssues(longest)).toEqual([]);
    expect(shown(recordIssues(`a${longest}`))).toEqual([`path-invalid error a${longest} ""`]);
  });

  test("for a path of more than 1,024 bytes, and not for one of 1,024", () => {
    const segment = "a".repeat(200);
    const longest = `${segment}/${segment}/${segment}/${segment}/${"b".repeat(1024 - 4 * 201 - 3)}.md`;
    expect(new TextEncoder().encode(longest).length).toBe(1024);
    expect(recordIssues(longest)).toEqual([]);
    expect(shown(recordIssues(`b${longest}`))).toEqual([`path-invalid error b${longest} ""`]);
  });

  test("for a path that is not NFC, once, naming every rule it breaks", () => {
    const decomposed = "café.md";
    const [issue, ...more] = recordIssues(decomposed);
    expect(more).toEqual([]);
    expect(issue?.code).toBe("path-invalid");
    expect(issue?.message).toContain("NFC");
    expect(issue?.message).toContain("[A-Za-z0-9]");
  });

  test("names every rule a path breaks, in one issue", () => {
    const issues = recordIssues("con./my file.md");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/Windows reserves/);
    expect(issues[0]?.message).toMatch(/ends in \./);
    expect(issues[0]?.message).toMatch(/my file\.md/);
  });

  test("is a warning with no node for an asset", () => {
    expect(shown(pathRuleIssues([{ path: "my image.png", kind: "asset" }]))).toEqual(["path-invalid warning my image.png null"]);
  });
});

describe("path-case-conflict", () => {
  test("for each path after the first in byte order among paths that differ only by case", () => {
    const paths: ListedPath[] = [
      { path: "docs/readme.md", kind: "record" },
      { path: "docs/README.md", kind: "record" },
      { path: "Docs/readme.md", kind: "record" },
      { path: "docs/other.md", kind: "record" },
    ];
    expect(shown(pathRuleIssues(paths))).toEqual([
      'path-case-conflict error docs/README.md ""',
      'path-case-conflict error docs/readme.md ""',
    ]);
  });

  test("with the severity of the path it is about: a warning with no node for an asset", () => {
    const paths: ListedPath[] = [
      { path: "Notes.md", kind: "record" },
      { path: "notes.MD", kind: "asset" },
      { path: "notes.md", kind: "record" },
    ];
    expect(shown(pathRuleIssues(paths))).toEqual([
      "path-case-conflict warning notes.MD null",
      'path-case-conflict error notes.md ""',
    ]);
  });

  test("comparing by the default lower-case mapping of each code point, beyond ASCII", () => {
    const conflicts = (...paths: string[]) =>
      pathRuleIssues(paths.map((path) => ({ path, kind: "asset" })))
        .filter((issue) => issue.code === "path-case-conflict")
        .map((issue) => issue.path);
    expect(conflicts("Éa.png", "éa.png")).toEqual(["éa.png"]);
    // One code point at a time, with no context: a final capital sigma maps to σ, not to the final ς that toLowerCase gives.
    expect(conflicts("ΣΑΣ", "σασ")).toEqual(["σασ"]);
    expect(conflicts("ΣΑΣ", "σας")).toEqual([]);
  });

  test("not for paths that differ otherwise", () => {
    expect(recordIssues("a.md", "a.yaml", "b.md")).toEqual([]);
  });
});

describe("filename-mismatch", () => {
  const collection: Collection = {
    name: "tickets",
    match: ["tickets/*.md"],
    exclude: [],
    filename: "^[0-9]{4}-[a-z0-9-]+\\.md$",
    queryTarget: "records",
  };

  test("for a record whose file name does not match the collection's pattern, at the record", () => {
    expect(shown([filenameMismatch("tickets/171-short.md", collection)].filter((issue) => issue !== null))).toEqual([
      'filename-mismatch error tickets/171-short.md ""',
    ]);
  });

  test("matches the file name alone, not the directories above it", () => {
    expect(filenameMismatch("tickets/0171-clean-root.md", collection)).toBeNull();
    const anchored: Collection = { ...collection, filename: "^tickets" };
    expect(filenameMismatch("tickets/0171-clean-root.md", anchored)?.code).toBe("filename-mismatch");
  });

  test("searches the name as a pattern does, so a pattern without anchors matches anywhere in it", () => {
    const unanchored: Collection = { ...collection, filename: "[0-9]{4}" };
    expect(filenameMismatch("tickets/x-0171.md", unanchored)).toBeNull();
  });

  test("follows the portable subset's reading, with ASCII classes", () => {
    const words: Collection = { ...collection, filename: "^\\w+\\.md$" };
    expect(filenameMismatch("tickets/abc.md", words)).toBeNull();
    expect(filenameMismatch("tickets/abé.md", words)?.code).toBe("filename-mismatch");
    // RE2's \s is ASCII white space, where JavaScript's also matches a no-break space.
    const spaced: Collection = { ...collection, filename: "^a\\sb" };
    expect(filenameMismatch("tickets/a b.md", spaced)).toBeNull();
    expect(filenameMismatch("tickets/a b.md", spaced)?.code).toBe("filename-mismatch");
  });

  test("is never raised for a collection without a pattern", () => {
    const { filename: _, ...withoutPattern } = collection;
    expect(filenameMismatch("tickets/anything.md", withoutPattern)).toBeNull();
  });
});
