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

  test.each(["notes/a.yaml", "notes/a.yml"])("parses %j as YAML", (path) => {
    const outcome = parseRecord(path, bytes("a: 1\n"));
    expect(outcome.ok && outcome.value).toMatchObject({ path, format: "yaml", value: { a: 1 } });
  });

  test("fails with the YAML parser's structural errors", () => {
    expect(parseRecord("a.yaml", bytes("- 1\n")).issues.map((issue) => issue.code)).toEqual(["root-not-object"]);
  });

  test("a .YAML file is not a record: extensions are compared exactly", () => {
    expect(() => parseRecord("a.YAML", bytes("a: 1\n"))).toThrow(/is not the path of a record/);
  });

  test("parses a .md file as Markdown", () => {
    const outcome = parseRecord("notes/a.md", bytes("---\na: 1\n---\n# Title\n"));
    expect(outcome.ok && outcome.value).toMatchObject({ path: "notes/a.md", format: "md", value: { a: 1, $title: "Title" } });
  });

  test("fails with the Markdown parser's structural errors", () => {
    expect(parseRecord("a.md", bytes("---\na: 1\n")).issues.map((issue) => issue.code)).toEqual(["syntax-error"]);
  });
});
