import { afterEach, describe, expect, test, vi } from "vitest";
import { parseRecord } from "./parse-record.js";

// What the yaml package reports is changed here, to make each of the reader's own checks fire alone: a warning no known
// input produces, and directives the library reads differently from the reader's scan, or not at all.
const library = vi.hoisted(() => ({
  warning: null as { code: string; pos: [number, number] } | null,
  hideDirectives: false,
  version: null as string | null,
}));

vi.mock("yaml", async (importOriginal) => {
  const yaml = await importOriginal<typeof import("yaml")>();
  return {
    ...yaml,
    parseDocument: (...args: Parameters<typeof yaml.parseDocument>) => {
      const doc = yaml.parseDocument(...args);
      if (library.warning !== null) {
        doc.warnings.push(new yaml.YAMLWarning(library.warning.pos, library.warning.code as never, "a warning"));
      }
      const directive = doc.directives.yaml as { version: string; explicit?: boolean };
      if (library.hideDirectives) {
        doc.errors = doc.errors.filter((error) => error.code !== "BAD_DIRECTIVE");
        doc.warnings = doc.warnings.filter((warning) => warning.code !== "BAD_DIRECTIVE");
        directive.version = "1.2";
        directive.explicit = false;
      }
      if (library.version !== null) {
        directive.version = library.version;
        directive.explicit = true;
      }
      return doc;
    },
  };
});

afterEach(() => {
  library.warning = null;
  library.hideDirectives = false;
  library.version = null;
});

const codes = (text: string) => {
  const outcome = parseRecord("r.yaml", new TextEncoder().encode(text));
  return outcome.ok ? [] : outcome.issues.map((issue) => issue.code);
};

describe("the library's warnings", () => {
  test("a warning the reader does not explain is a syntax error", () => {
    library.warning = { code: "BAD_INDENT", pos: [0, 1] };
    expect(codes("a: 1\n")).toEqual(["syntax-error"]);
  });

  test.each(["TAG_RESOLVE_FAILED", "BAD_COLLECTION_TYPE", "BAD_ALIAS", "BAD_DIRECTIVE"])(
    "near miss: %s, which the walk or the directive scan reports, is not",
    (code) => {
      library.warning = { code, pos: [0, 1] };
      expect(codes("a: 1\n")).toEqual([]);
    },
  );
});

describe("the directive scan, without the library's reading", () => {
  test.each([["%YAML 1.1\n---\na: 1\n"], ["%YAML 1.3\n---\na: 1\n"], ["# note\n\n%YAML 1.1\n---\na: 1\n"]])(
    "finds the unsupported version in %j alone",
    (text) => {
      library.hideDirectives = true;
      expect(codes(text)).toEqual(["yaml-version-unsupported"]);
    },
  );

  test("finds a malformed %YAML directive alone", () => {
    library.hideDirectives = true;
    expect(codes("%YAML 1.2 x\n---\na: 1\n")).toEqual(["syntax-error"]);
  });

  test("near miss: %YAML 1.2", () => {
    library.hideDirectives = true;
    expect(codes("%YAML 1.2\n---\na: 1\n")).toEqual([]);
  });
});

describe("the cross-checks with the library", () => {
  test("a version the library read as other than 1.2 is unsupported, though the scan saw none", () => {
    library.version = "1.1";
    expect(codes("a: 1\n")).toEqual(["yaml-version-unsupported"]);
  });

  test("a BAD_DIRECTIVE warning on a %YAML line is unsupported, though the scan read 1.2", () => {
    library.warning = { code: "BAD_DIRECTIVE", pos: [6, 9] };
    expect(codes("%YAML 1.2\n---\na: 1\n")).toEqual(["yaml-version-unsupported"]);
  });
});
