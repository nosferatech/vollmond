import { afterEach, describe, expect, test, vi } from "vitest";
import { parseRecord } from "./parse-record.js";

// What the yaml package reports is changed here, to make each of the reader's own checks fire alone: a warning no known
// input produces, and directives the library reads differently from the reader's scan, or not at all. With `countReads`, the
// nodes and pairs of each composed document are wrapped so that every property the reader reads from them is counted in
// `reads`: the reader's work on the document, counted exactly, whatever the machine's load.
const library = vi.hoisted(() => ({
  warning: null as { code: string; pos: [number, number] } | null,
  hideDirectives: false,
  hideErrors: false,
  version: null as string | null,
  countReads: false,
  reads: 0,
}));

vi.mock("yaml", async (importOriginal) => {
  const yaml = await importOriginal<typeof import("yaml")>();
  /** Changes each composed document as the test asks. */
  const change = (doc: InstanceType<typeof yaml.Document>) => {
    if (library.warning !== null) {
      doc.warnings.push(new yaml.YAMLWarning(library.warning.pos, library.warning.code as never, "a warning"));
    }
    if (doc.directives === undefined) return;
    const directive = doc.directives.yaml as { version: string; explicit?: boolean };
    if (library.hideDirectives) {
      doc.errors = doc.errors.filter((error) => error.code !== "BAD_DIRECTIVE");
      doc.warnings = doc.warnings.filter((warning) => warning.code !== "BAD_DIRECTIVE");
      directive.version = "1.2";
      directive.explicit = false;
    }
    if (library.hideErrors) doc.errors = [];
    if (library.version !== null) {
      directive.version = library.version;
      directive.explicit = true;
    }
  };
  /** Wraps an object so that each property read from it counts. */
  const counted = <T extends object>(target: T): T =>
    new Proxy(target, {
      get: (object, property) => {
        library.reads += 1;
        return Reflect.get(object, property, object);
      },
    });
  /** Wraps a node and, inside it, its pairs and the nodes they hold. */
  const countedNode = (node: unknown): unknown => {
    if (yaml.isMap(node) || yaml.isSeq(node)) {
      node.items = node.items.map((item: unknown) => {
        if (!yaml.isPair(item)) return countedNode(item);
        item.key = countedNode(item.key);
        item.value = countedNode(item.value);
        return counted(item);
      }) as typeof node.items;
    }
    return yaml.isNode(node) ? counted(node) : node;
  };
  class Composer extends yaml.Composer {
    override *compose(...args: Parameters<InstanceType<typeof yaml.Composer>["compose"]>) {
      for (const doc of super.compose(...args)) {
        change(doc);
        if (library.countReads) doc.contents = countedNode(doc.contents) as typeof doc.contents;
        yield doc;
      }
    }
  }
  return { ...yaml, Composer };
});

afterEach(() => {
  library.warning = null;
  library.hideDirectives = false;
  library.hideErrors = false;
  library.version = null;
  library.countReads = false;
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

describe("the directive scan, without the library's errors", () => {
  test.each([
    ["directives followed by content", "%TAG ! tag:a,2026:\na: 1\n"],
    ["directives at the end", "%TAG ! tag:a,2026:\n"],
  ])("finds %s, with no --- after them, alone", (_name, text) => {
    library.hideErrors = true;
    expect(codes(text)).toEqual(["syntax-error"]);
  });

  test("near miss: a directive followed by ---", () => {
    library.hideErrors = true;
    expect(codes("%TAG ! tag:a,2026:\n---\na: 1\n")).toEqual([]);
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

describe("the reader's work", () => {
  /** Counts the reads of node properties that reading a record of `lines` tagged members takes. */
  const reads = (lines: number) => {
    library.countReads = true;
    library.reads = 0;
    const text = Array.from({ length: lines }, (_, i) => `k${i}: !foo 1\n`).join("");
    expect(codes(text)).toHaveLength(lines);
    return library.reads;
  };

  test("is linear in the tags: ten times the tags cost ten times the work, but for a constant", () => {
    const [one, two, ten] = [reads(1000), reads(2000), reads(10000)];
    // Work a·n + b gives the same step from 1,000 to 2,000 lines as each of the nine from 1,000 to 10,000.
    expect(two - one).toBeGreaterThan(0);
    expect(ten - one).toBe(9 * (two - one));
  });
});
