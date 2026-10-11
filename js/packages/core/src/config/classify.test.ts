import { describe, expect, test } from "vitest";
import { compileGlob } from "../storage/path.js";
import { PathClassifier } from "./classify.js";
import { readStoreConfiguration, type StoreConfiguration } from "./configuration.js";

/** Reads a configuration that must be valid. */
function configurationOf(text: string): StoreConfiguration {
  const outcome = readStoreConfiguration(new TextEncoder().encode(text));
  if (!outcome.ok) expect.fail(JSON.stringify(outcome.issues));
  return outcome.value;
}

const CONFIGURATION = configurationOf(
  [
    "vmd: 1",
    "collections:",
    "  tickets:",
    '    match: ["tickets/*.md", "tickets/*.png"]',
    '    exclude: ["tickets/README.md"]',
    "  docs:",
    '    match: ["docs/**"]',
    "  everything:",
    '    match: ["**/*.yaml"]',
    'ignore: ["drafts/**", "*.tmp.md"]',
    "",
  ].join("\n"),
);

/** What a path is under the test configuration, with the names of its collections for a record. */
function kindOf(path: string, configuration = CONFIGURATION): string {
  const found = new PathClassifier(configuration).classify(path);
  return found.kind === "record"
    ? `record ${found.collections.map((collection) => collection.name).join(",")}`.trim()
    : found.kind;
}

describe("PathClassifier.classify", () => {
  test("ignores a path with a segment that starts with ., whatever the collections say", () => {
    expect(kindOf(".vmd/config.yaml")).toBe("ignored");
    expect(kindOf("docs/.draft.md")).toBe("ignored");
    expect(kindOf("tickets/.hidden/a.md")).toBe("ignored");
  });

  test("ignores a path an ignore glob matches, and only those", () => {
    expect(kindOf("drafts/a.md")).toBe("ignored");
    expect(kindOf("drafts/deep/b.png")).toBe("ignored");
    expect(kindOf("notes.tmp.md")).toBe("ignored");
    expect(kindOf("drafts.md")).toBe("record");
    expect(kindOf("sub/notes.tmp.md")).toBe("record");
  });

  test("gives a record by its extension, compared exactly, and an asset otherwise", () => {
    expect(kindOf("a.md")).toBe("record");
    expect(kindOf("a.MD")).toBe("asset");
    expect(kindOf("image.png")).toBe("asset");
  });

  test("gives a record the collections whose match globs match it and whose exclude globs do not", () => {
    expect(kindOf("tickets/0001-x.md")).toBe("record tickets");
    expect(kindOf("tickets/README.md")).toBe("record");
    expect(kindOf("tickets/sub/a.md")).toBe("record");
    expect(kindOf("docs/guide.md")).toBe("record docs");
  });

  test("gives every collection that matches, in name order, so that a conflict can be told", () => {
    expect(kindOf("docs/run.yaml")).toBe("record docs,everything");
  });

  test("puts no asset in a collection, even one a match glob names", () => {
    expect(kindOf("tickets/screen.png")).toBe("asset");
  });

  test("without collections or ignore globs, classifies only by dots and extensions", () => {
    const plain = configurationOf("vmd: 1\n");
    expect(kindOf("drafts/a.md", plain)).toBe("record");
    expect(kindOf(".vmd/x.md", plain)).toBe("ignored");
  });
});

describe("PathClassifier.ignoredGlobs", () => {
  test("match exactly the paths it ignores, for a backend's exclude", () => {
    const classifier = new PathClassifier(CONFIGURATION);
    const tests = classifier.ignoredGlobs.map((glob) => {
      const compiled = compileGlob(glob);
      if (!compiled.ok) expect.fail(glob);
      return compiled.value;
    });
    for (const path of ["a.md", ".vmd/config.yaml", "x/.y/z.md", "drafts/a.md", "notes.tmp.md", "sub/notes.tmp.md", "i.png"]) {
      expect(
        tests.some((matches) => matches(path)),
        path,
      ).toBe(classifier.classify(path).kind === "ignored");
    }
  });
});
