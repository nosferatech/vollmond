import { describe, expect, test } from "vitest";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { readStoreConfiguration, type StoreConfiguration, SUPPORTED_FORMAT_VERSION } from "./configuration.js";

const NAME = ".vmd/config.yaml";

/** Reads a configuration held in `text`. */
function read(text: string | Uint8Array): Outcome<StoreConfiguration> {
  return readStoreConfiguration(NAME, typeof text === "string" ? new TextEncoder().encode(text) : text);
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

test("the supported format version is 1", () => {
  expect(SUPPORTED_FORMAT_VERSION).toBe(1);
});

describe("a valid configuration", () => {
  test("holding only vmd: 1", () => {
    expect(read("vmd: 1\n")).toEqual({ ok: true, value: { vmd: 1 }, issues: [] });
  });

  test("with the other members of a configuration, which are not read yet", () => {
    const outcome = read(
      'vmd: 1\nuniqueness: lenient\ncollections:\n  tickets:\n    match: ["tickets/*.md"]\nignore: ["drafts/**"]\n',
    );
    expect(outcome).toEqual({ ok: true, value: { vmd: 1 }, issues: [] });
  });

  test("with a byte order mark", () => {
    expect(read(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("vmd: 1\n")])).ok).toBe(true);
  });

  test("with CRLF line breaks and no final line break", () => {
    expect(read("# a store\r\nvmd: 1").ok).toBe(true);
  });

  test("with a member whose name begins with $, which a record would refuse but a configuration does not read yet", () => {
    expect(read("vmd: 1\n$key: 2\n").ok).toBe(true);
  });

  test("is frozen", () => {
    const outcome = read("vmd: 1\n");
    expect(outcome.ok && Object.isFrozen(outcome.value)).toBe(true);
  });
});

describe("config-invalid", () => {
  test.each([
    ["an empty file", ""],
    ["a file of comments", "# nothing\n"],
    ["a configuration without vmd", "uniqueness: strict\n"],
  ])("for %s, which has no vmd, with no position", (_name, text) => {
    expect(summary(read(text).issues)).toEqual([{ code: "config-invalid", path: NAME, at: null }]);
  });

  test.each([
    ["a string", 'vmd: "1"\n'],
    ["a fraction, while the form of a minor version is not decided", "vmd: 1.5\n"],
    ["zero", "vmd: 0\n"],
    ["a negative number", "vmd: -1\n"],
    ["null", "vmd:\n"],
    ["a list", "vmd: [1]\n"],
  ])("for vmd as %s, at the member", (_name, text) => {
    const outcome = read(text);
    expect(outcome.ok).toBe(false);
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: NAME, at: null, line: 1, col: 1 }]);
  });

  test("for a document that is not a mapping", () => {
    const outcome = read("- vmd: 1\n");
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: NAME, at: null, line: 1, col: 1 }]);
    expect(outcome.issues[0]?.message).toContain("mapping");
  });

  test("for a YAML syntax error, with its position and the library's message", () => {
    const outcome = read("vmd: 1\nissues: [\n");
    expect(outcome.ok).toBe(false);
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: NAME, at: null, line: 3, col: 1 }]);
    expect(outcome.issues[0]?.message).toContain("not valid YAML");
  });

  test("for what vmd's YAML refuses, an alias here, once for each problem", () => {
    const outcome = read("vmd: &v 1\nother: *v\n");
    expect(summary(outcome.issues).map((issue) => issue.code)).toEqual(["config-invalid", "config-invalid"]);
    expect(outcome.issues[0]?.message).toContain("anchor");
  });

  test("for a repeated vmd", () => {
    const outcome = read("vmd: 1\nvmd: 1\n");
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: NAME, at: null, line: 2, col: 1 }]);
  });

  test("for a file that is not UTF-8", () => {
    const outcome = read(new Uint8Array([0x76, 0x6d, 0x64, 0x3a, 0x20, 0xff]));
    expect(summary(outcome.issues)).toEqual([{ code: "config-invalid", path: NAME, at: null, line: 1, col: 6 }]);
  });
});

describe("format-version-unsupported", () => {
  test("for a newer major version, at the member, naming both versions", () => {
    const outcome = read("collections: {}\nvmd: 2\n");
    expect(outcome.ok).toBe(false);
    expect(summary(outcome.issues)).toEqual([{ code: "format-version-unsupported", path: NAME, at: null, line: 2, col: 1 }]);
    expect(outcome.issues[0]?.message).toMatch(/2.*1/);
  });
});
