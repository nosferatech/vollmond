import { describe, expect, test } from "vitest";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import {
  type Collection,
  MAX_CONFIGURATION_BYTES,
  readStoreConfiguration,
  type StoreConfiguration,
  SUPPORTED_FORMAT_VERSION,
} from "./configuration.js";

/** Reads a configuration held in `text`. */
function read(text: string | Uint8Array): Outcome<StoreConfiguration> {
  return readStoreConfiguration(typeof text === "string" ? new TextEncoder().encode(text) : text);
}

/** Reads a configuration and returns it, failing the test with its issues when it is not valid. */
function valid(text: string): StoreConfiguration {
  const outcome = read(text);
  if (!outcome.ok) expect.fail(`expected a valid configuration, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** The code, position and path of each issue, for comparisons. */
function summary(
  issues: readonly Issue[],
): { code: string; line?: number; col?: number; path: string | null; at: string | null }[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    at: issue.at,
    ...(issue.position === undefined ? {} : { line: issue.position.line, col: issue.position.col }),
  }));
}

/** The code and position of each issue of a configuration that must be invalid, as `code line:col`. */
function problems(text: string): string[] {
  const outcome = read(text);
  expect(outcome.ok).toBe(false);
  return outcome.issues.map((issue) => `${issue.code} ${issue.position?.line ?? "-"}:${issue.position?.col ?? "-"}`);
}

/** The messages of a configuration's issues. */
function messages(text: string): string[] {
  return read(text).issues.map((issue) => issue.message);
}

/** A configuration with one collection, `things`, whose members are the lines given, indented under it. */
function withCollection(...members: string[]): string {
  return `vmd: 1\ncollections:\n  things:\n${members.map((member) => `    ${member}\n`).join("")}`;
}

/** The one collection of a valid configuration. */
function onlyCollection(text: string): Collection {
  const { collections } = valid(text);
  expect(collections).toHaveLength(1);
  return collections[0] as Collection;
}

test("the supported format version is 1, and a configuration holds at most a mebibyte", () => {
  expect(SUPPORTED_FORMAT_VERSION).toBe(1);
  expect(MAX_CONFIGURATION_BYTES).toBe(1_048_576);
});

describe("a valid configuration", () => {
  test("holding only vmd: 1, with every default", () => {
    expect(read("vmd: 1\n")).toEqual({
      ok: true,
      value: {
        vmd: 1,
        declared: 1,
        uniqueness: "strict",
        yamlQuoting: "compatible",
        issues: new Map(),
        collections: [],
        ignore: [],
      },
      issues: [],
    });
  });

  test("declaring a newer minor version, which is read as major version 1 without a warning", () => {
    expect(read("vmd: 1.2\n")).toMatchObject({ ok: true, value: { vmd: 1, declared: 1.2 }, issues: [] });
    // The major version is the part before the point, not the nearest integer.
    expect(read("vmd: 1.9\n")).toMatchObject({ ok: true, value: { vmd: 1, declared: 1.9 }, issues: [] });
  });

  test("with every member", () => {
    const configuration = valid(
      [
        "vmd: 1",
        "uniqueness: lenient",
        "yaml_quoting: minimal",
        "issues:",
        "  heading-html: error",
        '  ref-derived-anchor: "off"',
        "  duplicate-key: warning",
        "  schema-violation: error",
        "collections:",
        "  tickets:",
        '    match: ["tickets/*.md"]',
        '    exclude: ["tickets/README.md"]',
        "    schema: ticket.schema.yaml",
        '    filename: "^[0-9]{4}-[a-z0-9-]+\\\\.md$"',
        '    key: { filename: "^([0-9]{4})-" }',
        "  docs:",
        '    match: ["docs/**/*.md"]',
        "    schema: doc.schema.yaml",
        "    key: { field: status-id }",
        "    query: { target: nodes }",
        'ignore: ["drafts/**"]',
        "",
      ].join("\n"),
    );
    expect(configuration).toEqual({
      vmd: 1,
      declared: 1,
      uniqueness: "lenient",
      yamlQuoting: "minimal",
      issues: new Map([
        ["heading-html", "error"],
        ["ref-derived-anchor", "off"],
        ["duplicate-key", "warning"],
        ["schema-violation", "error"],
      ]),
      collections: [
        {
          name: "docs",
          match: ["docs/**/*.md"],
          exclude: [],
          schema: "doc.schema.yaml",
          key: { field: "status-id" },
          queryTarget: "nodes",
        },
        {
          name: "tickets",
          match: ["tickets/*.md"],
          exclude: ["tickets/README.md"],
          schema: "ticket.schema.yaml",
          filename: "^[0-9]{4}-[a-z0-9-]+\\.md$",
          key: { filename: "^([0-9]{4})-" },
          queryTarget: "records",
        },
      ],
      ignore: ["drafts/**"],
    });
  });

  test("keeps collections in the UTF-8 byte order of their names, whatever order they are written in", () => {
    const { collections } = valid('vmd: 1\ncollections:\n  b: {match: ["b/*"]}\n  B: {match: ["B/*"]}\n  a: {match: ["a/*"]}\n');
    expect(collections.map((collection) => collection.name)).toEqual(["B", "a", "b"]);
  });

  test("with empty mappings and lists where they are allowed", () => {
    expect(valid("vmd: 1\nissues: {}\ncollections: {}\nignore: []\n").collections).toEqual([]);
    expect(onlyCollection(withCollection('match: ["*.md"]', "exclude: []")).exclude).toEqual([]);
    expect(onlyCollection(withCollection('match: ["*.md"]', "query: {}")).queryTarget).toBe("records");
  });

  test("with a byte order mark", () => {
    expect(read(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("vmd: 1\n")])).ok).toBe(true);
  });

  test("with CRLF line breaks and no final line break", () => {
    expect(read("# a store\r\nvmd: 1").ok).toBe(true);
  });

  test("of exactly the largest size", () => {
    const text = `vmd: 1\n#${"x".repeat(MAX_CONFIGURATION_BYTES - 9)}\n`;
    expect(new TextEncoder().encode(text).length).toBe(MAX_CONFIGURATION_BYTES);
    expect(read(text).ok).toBe(true);
  });

  test("is frozen, with its lists and collections", () => {
    const configuration = valid(withCollection('match: ["*.md"]'));
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.collections)).toBe(true);
    expect(Object.isFrozen(configuration.collections[0])).toBe(true);
    expect(Object.isFrozen(configuration.collections[0]?.match)).toBe(true);
    expect(Object.isFrozen(configuration.ignore)).toBe(true);
  });
});

describe("config-invalid, with no path, since a configuration is not a record", () => {
  test.each([
    ["an empty file", ""],
    ["a file of comments", "# nothing\n"],
    ["a configuration without vmd", "uniqueness: strict\n"],
  ])("for %s, which has no vmd, with no position", (_name, text) => {
    expect(summary(read(text).issues)).toEqual([{ code: "config-invalid", path: null, at: null }]);
  });

  test.each([
    ["a string, while the form of a minor version is not decided", 'vmd: "1.2"\n'],
    ["a fraction below 1", "vmd: 0.5\n"],
    ["zero", "vmd: 0\n"],
    ["a negative number", "vmd: -1\n"],
    ["null", "vmd:\n"],
    ["a list", "vmd: [1]\n"],
  ])("for vmd as %s, at the member", (_name, text) => {
    const outcome = read(text);
    expect(outcome.ok).toBe(false);
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: null, at: null, line: 1, col: 1 }]);
  });

  test("for a file larger than a mebibyte, without parsing it", () => {
    const outcome = read(`vmd: 1\n#${"x".repeat(MAX_CONFIGURATION_BYTES - 8)}\n`);
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: null, at: null }]);
    expect(outcome.issues[0]?.message).toContain("larger than");
  });

  test("for a document that is not a mapping", () => {
    const outcome = read("- vmd: 1\n");
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: null, at: null, line: 1, col: 1 }]);
    expect(outcome.issues[0]?.message).toContain("mapping");
  });

  test("for a YAML syntax error, with its position and the library's message", () => {
    const outcome = read("vmd: 1\nissues: [\n");
    expect(outcome.ok).toBe(false);
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: null, at: null, line: 3, col: 1 }]);
    expect(outcome.issues[0]?.message).toContain("not valid YAML");
  });

  test("for what vmd's YAML refuses, an alias here, once for each problem", () => {
    const outcome = read("vmd: &v 1\nother: *v\n");
    expect(summary(outcome.issues).map((issue) => issue.code)).toEqual(["config-invalid", "config-invalid"]);
    expect(outcome.issues[0]?.message).toContain("anchor");
  });

  test("for a repeated vmd", () => {
    const outcome = read("vmd: 1\nvmd: 1\n");
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: null, at: null, line: 2, col: 1 }]);
  });

  test("for a file that is not UTF-8", () => {
    const outcome = read(new Uint8Array([0x76, 0x6d, 0x64, 0x3a, 0x20, 0xff]));
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: null, at: null, line: 1, col: 6 }]);
  });

  test("for every problem at once, each at its position", () => {
    expect(problems("vmd: 1\nuniqueness: loose\nyaml_quoting: none\nignore: [docs/]\n")).toEqual([
      "config-invalid 2:1",
      "config-invalid 3:1",
      "config-invalid 4:10",
    ]);
  });
});

describe("feature-unsupported for a member this version does not define", () => {
  test("at the top, as an operation issue at the member, naming the store's declared version", () => {
    const outcome = read("vmd: 1.3\nfuture_setting: true\n");
    expect(summary(outcome.issues)).toEqual([{ code: "feature-unsupported", path: null, at: null, line: 2, col: 1 }]);
    expect(outcome.issues[0]?.class).toBe("operation");
    expect(outcome.issues[0]?.message).toContain('"future_setting"');
    expect(outcome.issues[0]?.message).toContain("1.3");
  });

  test("for jsonc, which the format defines and this vmd does not implement yet, saying so", () => {
    expect(problems("vmd: 1\njsonc: true\n")).toEqual(["feature-unsupported 2:1"]);
    const [message] = messages("vmd: 1\njsonc: true\n");
    expect(message).toContain("does not implement yet");
    expect(message).toContain("V1");
    expect(message).not.toContain("newer minor version");
    // The same name below the top is not the format's member.
    expect(messages(withCollection('match: ["*.md"]', "jsonc: true"))[0]).toContain("newer minor version");
  });

  test("in a collection, a key and a query", () => {
    expect(problems(withCollection('match: ["*.md"]', "sort: title"))).toEqual(["feature-unsupported 5:5"]);
    expect(problems(withCollection('match: ["*.md"]', "key: {field: id, prefix: t}"))).toEqual(["feature-unsupported 5:22"]);
    expect(problems(withCollection('match: ["*.md"]', "query: {target: nodes, limit: 3}"))).toEqual(["feature-unsupported 5:28"]);
  });

  test("saying so when the store declares no version", () => {
    expect(problems("future_setting: true\n")).toEqual(["config-invalid -:-", "feature-unsupported 1:1"]);
    expect(messages("future_setting: true\n")[1]).toContain("declares no format version");
  });

  test("for a member whose name begins with $, which is unknown like any other, whatever a record would make of it", () => {
    // In a record, $key is a dollar-member and $future a structural feature-unsupported; neither shape rule applies here.
    expect(problems("vmd: 1\n$key: 2\n")).toEqual(["feature-unsupported 2:1"]);
    const future = read("vmd: 1\n$future: 1\n");
    expect(future.issues.map((issue) => `${issue.code} ${issue.class}`)).toEqual(["feature-unsupported operation"]);
  });

  test("not for a newer major version, which may define it: that is refused alone", () => {
    expect(summary(read("future_setting: true\nvmd: 2\n").issues).map((issue) => issue.code)).toEqual([
      "format-version-unsupported",
    ]);
  });
});

describe("uniqueness and yaml_quoting", () => {
  test("take their two values", () => {
    expect(valid("vmd: 1\nuniqueness: strict\n").uniqueness).toBe("strict");
    expect(valid("vmd: 1\nuniqueness: lenient\n").uniqueness).toBe("lenient");
    expect(valid("vmd: 1\nyaml_quoting: compatible\n").yamlQuoting).toBe("compatible");
    expect(valid("vmd: 1\nyaml_quoting: minimal\n").yamlQuoting).toBe("minimal");
  });

  test.each([
    ["uniqueness: loose"],
    ["uniqueness: Lenient"],
    ["uniqueness: true"],
    ["uniqueness:"],
    ["yaml_quoting: relaxed"],
    ["yaml_quoting: [minimal]"],
  ])("are config-invalid as %s", (line) => {
    expect(problems(`vmd: 1\n${line}\n`)).toEqual(["config-invalid 2:1"]);
  });
});

describe("issues", () => {
  test("is config-invalid when it is not a mapping", () => {
    expect(problems("vmd: 1\nissues: [heading-html]\n")).toEqual(["config-invalid 2:1"]);
  });

  test("is config-invalid for an unknown code, at its entry", () => {
    expect(problems("vmd: 1\nissues:\n  heading-htm: error\n")).toEqual(["config-invalid 3:3"]);
    expect(messages("vmd: 1\nissues:\n  heading-htm: error\n")[0]).toContain("heading-htm");
  });

  test.each([["silent"], ["Error"], ["true"], ["1"], ["null"]])("is config-invalid for the setting %s", (setting) => {
    expect(problems(`vmd: 1\nissues:\n  heading-html: ${setting}\n`)).toEqual(["config-invalid 3:3"]);
    expect(messages(`vmd: 1\nissues:\n  heading-html: ${setting}\n`)[0]).toContain('a setting is "off", "warning" or "error"');
  });

  test.each([
    ["a structural code", "syntax-error: warning"],
    ["a structural code set to error, which it already is", "syntax-error: error"],
    ["an operation code", 'config-invalid: "off"'],
    ["a code structural in a record, an operation issue elsewhere", "feature-unsupported: warning"],
    ["an operation warning", 'unicode-runtime-older: "off"'],
    ["a validation error lowered to a warning", "schema-violation: warning"],
    ["a validation error turned off", 'ref-dangling: "off"'],
  ])("is config-invalid for %s, outside Appendix D's limits", (_name, entry) => {
    expect(problems(`vmd: 1\nissues:\n  ${entry}\n`)).toEqual(["config-invalid 3:3"]);
  });

  test.each([
    ["a validation error kept an error", "schema-violation: error"],
    ["a warning raised", "heading-html: error"],
    ["a warning turned off", 'multiple-h1: "off"'],
    ["a warning turned off, unquoted, which YAML 1.2 reads as a string", "multiple-h1: off"],
    ["a code that depends on context, off", 'path-invalid: "off"'],
    ["a code that depends on context, raised", "duplicate-anchor: error"],
  ])("accepts %s", (_name, entry) => {
    expect(valid(`vmd: 1\nissues:\n  ${entry}\n`).issues.size).toBe(1);
  });
});

describe("collections", () => {
  test("is config-invalid when it is not a mapping, or a collection is not one", () => {
    expect(problems("vmd: 1\ncollections: [things]\n")).toEqual(["config-invalid 2:1"]);
    expect(problems("vmd: 1\ncollections:\n  things: docs/*\n")).toEqual(["config-invalid 3:3"]);
  });

  test.each([["my/things"], ["2things"], ["_things"], ["things:2"], ["thing*"], ["tickets.md"], ['""'], ["café"]])(
    "is config-invalid for the collection name %s",
    (name) => {
      expect(problems(`vmd: 1\ncollections:\n  ${name}:\n    match: ["*.md"]\n`)).toEqual(["config-invalid 3:3"]);
    },
  );

  test("accepts names of letters, digits, _ and -, starting with a letter", () => {
    const names = ["a", "Z", "my-things_2", "T-1"];
    const text = `vmd: 1\ncollections:\n${names.map((name) => `  ${name}: {match: ["*.md"]}\n`).join("")}`;
    expect(valid(text).collections.map((collection) => collection.name)).toEqual(["T-1", "Z", "a", "my-things_2"]);
  });

  describe("match", () => {
    test("is required, and must be a list of at least one glob", () => {
      expect(problems(withCollection('exclude: ["*.md"]'))).toEqual(["config-invalid 3:3"]);
      expect(problems(withCollection("match: []"))).toEqual(["config-invalid 4:5"]);
      expect(problems(withCollection('match: "*.md"'))).toEqual(["config-invalid 4:5"]);
      expect(problems(withCollection("match: [1]"))).toEqual(["config-invalid 4:13"]);
    });

    test.each([["docs/"], ["/docs/*.md"], ["docs//a.md"], [""]])("is config-invalid for the malformed glob %j", (glob) => {
      expect(problems(withCollection(`match: ["*.md", "${glob}"]`))).toEqual(["config-invalid 4:21"]);
    });

    test.each([["../*.md"], ["docs/./a.md"], ["docs/.."], ["."], ["**/../**"]])(
      "is config-invalid for the glob %j, whose . or .. segment no store path has",
      (glob) => {
        expect(problems(withCollection(`match: ["*.md", "${glob}"]`))).toEqual(["config-invalid 4:21"]);
        expect(messages(withCollection(`match: ["${glob}"]`))[0]).toContain(". or .. segment");
      },
    );

    test("accepts segments that only start with a dot", () => {
      expect(onlyCollection(withCollection('match: [".cache/**", "**/.*.md", "..x/*", "a/...md"]')).match).toHaveLength(4);
    });

    test("accepts globs with * and **", () => {
      expect(onlyCollection(withCollection('match: ["docs/**", "*.md", "**/x/*.json"]')).match).toEqual([
        "docs/**",
        "*.md",
        "**/x/*.json",
      ]);
    });
  });

  describe("exclude", () => {
    test("must be a list of globs", () => {
      expect(problems(withCollection('match: ["*.md"]', 'exclude: "README.md"'))).toEqual(["config-invalid 5:5"]);
      expect(problems(withCollection('match: ["*.md"]', 'exclude: ["docs/"]'))).toEqual(["config-invalid 5:15"]);
      expect(onlyCollection(withCollection('match: ["*.md"]', 'exclude: ["README.md"]')).exclude).toEqual(["README.md"]);
    });
  });

  describe("schema", () => {
    test.each([
      ["a path that climbs out of the schema directory", "../ticket.schema.yaml"],
      ["an absolute path", "/ticket.schema.yaml"],
      ["a path with a . segment", "./ticket.schema.yaml"],
      ["a path with an empty segment", "a//ticket.schema.yaml"],
      ["a path with a backslash", "a\\\\ticket.schema.yaml"],
      ["an empty path", ""],
    ])("is config-invalid for %s", (_name, path) => {
      expect(problems(withCollection('match: ["*.md"]', `schema: "${path}"`))).toEqual(["config-invalid 5:5"]);
    });

    test("is config-invalid when it is not a string", () => {
      expect(problems(withCollection('match: ["*.md"]', "schema: [a.json]"))).toEqual(["config-invalid 5:5"]);
    });

    test("accepts a file of the schema directory, or of a directory in it", () => {
      expect(onlyCollection(withCollection('match: ["*.md"]', "schema: shared/ticket.schema.json")).schema).toBe(
        "shared/ticket.schema.json",
      );
    });
  });

  describe("filename", () => {
    test("must be a pattern in the portable subset", () => {
      expect(problems(withCollection('match: ["*.md"]', 'filename: "^(?<n>x)"'))).toEqual(["config-invalid 5:5"]);
      expect(problems(withCollection('match: ["*.md"]', 'filename: "(a"'))).toEqual(["config-invalid 5:5"]);
      expect(problems(withCollection('match: ["*.md"]', "filename: 3"))).toEqual(["config-invalid 5:5"]);
      expect(onlyCollection(withCollection('match: ["*.md"]', 'filename: "^[0-9]{4}-"')).filename).toBe("^[0-9]{4}-");
    });
  });

  describe("key", () => {
    test("is config-invalid when it is not a mapping, or gives both forms or neither", () => {
      expect(problems(withCollection('match: ["*.md"]', "key: id"))).toEqual(["config-invalid 5:5"]);
      expect(problems(withCollection('match: ["*.md"]', 'key: {field: id, filename: "^(x)"}'))).toEqual(["config-invalid 5:5"]);
      expect(problems(withCollection('match: ["*.md"]', "key: {}"))).toEqual(["config-invalid 5:5"]);
    });

    test("as a field, takes a member name", () => {
      expect(onlyCollection(withCollection('match: ["*.md"]', "key: {field: status-id}")).key).toEqual({ field: "status-id" });
      expect(problems(withCollection('match: ["*.md"]', "key: {field: 3}"))).toEqual(["config-invalid 5:11"]);
      expect(problems(withCollection('match: ["*.md"]', 'key: {field: ""}'))).toEqual(["config-invalid 5:11"]);
    });

    test("as a filename pattern, takes a portable pattern with exactly one capture group", () => {
      expect(onlyCollection(withCollection('match: ["*.md"]', 'key: {filename: "^(?:t-)?([0-9]+)"}')).key).toEqual({
        filename: "^(?:t-)?([0-9]+)",
      });
      expect(problems(withCollection('match: ["*.md"]', 'key: {filename: "^[0-9]+"}'))).toEqual(["config-invalid 5:11"]);
      expect(problems(withCollection('match: ["*.md"]', 'key: {filename: "^([0-9]+)-([a-z]+)"}'))).toEqual([
        "config-invalid 5:11",
      ]);
      expect(problems(withCollection('match: ["*.md"]', 'key: {filename: "^(?<n>[0-9]+)"}'))).toEqual(["config-invalid 5:11"]);
    });
  });

  describe("query", () => {
    test("takes a target of records or nodes", () => {
      expect(onlyCollection(withCollection('match: ["*.md"]', "query: {target: nodes}")).queryTarget).toBe("nodes");
      expect(onlyCollection(withCollection('match: ["*.md"]', "query: {target: records}")).queryTarget).toBe("records");
      expect(problems(withCollection('match: ["*.md"]', "query: {target: sections}"))).toEqual(["config-invalid 5:13"]);
      expect(problems(withCollection('match: ["*.md"]', "query: nodes"))).toEqual(["config-invalid 5:5"]);
    });
  });
});

describe("ignore", () => {
  test("must be a list of globs", () => {
    expect(problems('vmd: 1\nignore: "drafts/**"\n')).toEqual(["config-invalid 2:1"]);
    expect(problems('vmd: 1\nignore: ["drafts/**", "/x"]\n')).toEqual(["config-invalid 2:23"]);
    expect(valid('vmd: 1\nignore: ["drafts/**", "*.tmp"]\n').ignore).toEqual(["drafts/**", "*.tmp"]);
  });
});

describe("format-version-unsupported", () => {
  test("for a newer major version, at the member, naming both versions", () => {
    const outcome = read("collections: {}\nvmd: 2\n");
    expect(outcome.ok).toBe(false);
    expect(summary(outcome.issues)).toEqual([{ code: "format-version-unsupported", path: null, at: null, line: 2, col: 1 }]);
    expect(outcome.issues[0]?.message).toMatch(/2.*1/);
  });

  test("for a newer major version with a minor version", () => {
    expect(summary(read("vmd: 2.1\n").issues).map((issue) => issue.code)).toEqual(["format-version-unsupported"]);
  });
});
