import { describe, expect, test } from "vitest";
import { parseRecord } from "./parse-record.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("parseRecord", () => {
  test("parses a .json record as JSON", () => {
    const outcome = parseRecord("notes/a.json", bytes('{"a": 1}'));
    expect(outcome.ok && outcome.value).toMatchObject({ path: "notes/a.json", format: "json", value: { a: 1 } });
  });

  test("fails with one syntax-error at the root for a file that is not UTF-8, at its first bad byte", () => {
    const outcome = parseRecord("a.json", new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]));
    expect(outcome).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({ code: "syntax-error", path: "a.json", at: "", position: { offset: 2, line: 1, col: 3 } }),
      ],
    });
  });

  test("fails with the parser's structural errors", () => {
    const outcome = parseRecord("a.json", bytes("[1]"));
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.map((issue) => issue.code)).toEqual(["root-not-object"]);
  });

  test.each(["a.txt", "a", "a.JSON", "dir.json/", ".json"])("throws for %j, which is not the path of a record", (path) => {
    expect(() => parseRecord(path, bytes("{}"))).toThrow(/is not the path of a record/);
  });

  // Deviation from the I1 design, recorded in issue #11: until their parsers land, YAML and Markdown records throw.
  test.each(["a.yaml", "a.yml", "a.md"])("throws for %j, whose format has no parser yet", (path) => {
    expect(() => parseRecord(path, bytes("a: 1\n"))).toThrow(/cannot be parsed yet/);
  });
});
