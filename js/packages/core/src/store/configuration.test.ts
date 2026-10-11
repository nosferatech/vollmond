import { describe, expect, test } from "vitest";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import {
  MAX_CONFIGURATION_BYTES,
  readStoreConfiguration,
  type StoreConfiguration,
  SUPPORTED_FORMAT_VERSION,
} from "./configuration.js";

/** Reads a configuration held in `text`. */
function read(text: string | Uint8Array): Outcome<StoreConfiguration> {
  return readStoreConfiguration(typeof text === "string" ? new TextEncoder().encode(text) : text);
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

test("the supported format version is 1, and a configuration holds at most a mebibyte", () => {
  expect(SUPPORTED_FORMAT_VERSION).toBe(1);
  expect(MAX_CONFIGURATION_BYTES).toBe(1_048_576);
});

describe("a valid configuration", () => {
  test("holding only vmd: 1", () => {
    expect(read("vmd: 1\n")).toEqual({ ok: true, value: { vmd: 1, declared: 1 }, issues: [] });
  });

  test("declaring a newer minor version, which is read as major version 1 without a warning", () => {
    expect(read("vmd: 1.2\n")).toEqual({ ok: true, value: { vmd: 1, declared: 1.2 }, issues: [] });
  });

  test("with the other members of a configuration, which are not read yet", () => {
    const outcome = read(
      'vmd: 1\nuniqueness: lenient\ncollections:\n  tickets:\n    match: ["tickets/*.md"]\nignore: ["drafts/**"]\n',
    );
    expect(outcome).toEqual({ ok: true, value: { vmd: 1, declared: 1 }, issues: [] });
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

  test("of exactly the largest size", () => {
    const text = `vmd: 1\n#${"x".repeat(MAX_CONFIGURATION_BYTES - 9)}\n`;
    expect(new TextEncoder().encode(text).length).toBe(MAX_CONFIGURATION_BYTES);
    expect(read(text).ok).toBe(true);
  });

  test("is frozen", () => {
    const outcome = read("vmd: 1\n");
    expect(outcome.ok && Object.isFrozen(outcome.value)).toBe(true);
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
