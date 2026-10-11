import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { compileGlob, type GlobTest } from "../storage/path.js";
import { IGNORED_PATH_GLOBS, storePathKind } from "./store-path.js";

describe("storePathKind", () => {
  test("ignores .vmd/ and every path with a segment that starts with a dot, at any depth", () => {
    for (const path of [".vmd/config.yaml", ".gitignore", "docs/.draft.md", "a/.b/c.md", ".x/y/z.json"]) {
      expect(storePathKind(path)).toBe("ignored");
    }
  });

  test("tells records from assets by the extension, compared exactly", () => {
    expect(storePathKind("a.md")).toBe("record");
    expect(storePathKind("docs/b.yaml")).toBe("record");
    expect(storePathKind("c.yml")).toBe("record");
    expect(storePathKind("d.json")).toBe("record");
    expect(storePathKind("notes.MD")).toBe("asset");
    expect(storePathKind("image.png")).toBe("asset");
    // A dot inside a segment is not a dotfile.
    expect(storePathKind("v1.2/notes.md")).toBe("record");
  });
});

describe("IGNORED_PATH_GLOBS", () => {
  const tests: GlobTest[] = IGNORED_PATH_GLOBS.map((glob) => {
    const compiled = compileGlob(glob);
    if (!compiled.ok) throw new Error(`${glob} does not compile`);
    return compiled.value;
  });
  const ignoredByGlobs = (path: string) => tests.some((matches) => matches(path));

  test("match exactly the paths storePathKind ignores", () => {
    const segment = fc.stringMatching(/^[.a-z]{1,4}$/).filter((text) => text !== "." && text !== "..");
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), (segments) => {
        const path = segments.join("/");
        expect(ignoredByGlobs(path)).toBe(storePathKind(path) === "ignored");
      }),
      { numRuns: 2000 },
    );
  });

  test("need both globs: one for a dotfile, one for what is below a dot directory", () => {
    expect(tests[0]?.(".vmd/config.yaml")).toBe(false);
    expect(tests[1]?.(".vmd/config.yaml")).toBe(true);
    expect(tests[0]?.("docs/.draft.md")).toBe(true);
    expect(tests[1]?.("docs/.draft.md")).toBe(false);
  });
});
