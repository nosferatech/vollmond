import { describe, expect, test } from "vitest";
import { MAX_RECORD_BYTES } from "./limits.js";
import { parseRecord } from "./parse-record.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("parseRecord", () => {
  test("fails with one syntax-error at the root for a record over 16 MiB, and parses one of exactly 16 MiB", () => {
    expect(MAX_RECORD_BYTES).toBe(16 * 1024 * 1024);
    const record = (size: number) => new TextEncoder().encode(`{"a": "${"x".repeat(size - 9)}"}`);
    expect(record(MAX_RECORD_BYTES)).toHaveLength(MAX_RECORD_BYTES);
    expect(parseRecord("a.json", record(MAX_RECORD_BYTES)).ok).toBe(true);
    const larger = parseRecord("a.json", record(MAX_RECORD_BYTES + 1));
    expect(larger.issues.map(({ code, path, at }) => ({ code, path, at }))).toEqual([
      { code: "syntax-error", path: "a.json", at: "" },
    ]);
    expect(larger.issues[0]?.message).toContain("larger than 16777216 bytes");
  });

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

  test.each(["a.md", "a.json", "a.yaml"])(
    "fails %s of more than 16 MiB with one syntax-error at the root, read no further",
    (path) => {
      // Not UTF-8 either, which only a read would find.
      const content = new Uint8Array(MAX_RECORD_BYTES + 1).fill(0xff);
      expect(parseRecord(path, content)).toEqual({
        ok: false,
        issues: [expect.objectContaining({ code: "syntax-error", path, at: "" })],
      });
      expect(parseRecord(path, content).issues[0]?.message).toContain("larger than 16777216 bytes");
    },
  );

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

  test.each([
    ["a.json", (title: string) => JSON.stringify({ $sections: [{ $title: title }] })],
    ["a.yaml", (title: string) => `$sections:\n  - $title: ${JSON.stringify(title)}\n`],
  ])("a section's $title of 4,096 runs reads, and one of 4,097 fails with a syntax-error at the root, in %s", (path, record) => {
    expect(parseRecord(path, bytes(record("*a* ".repeat(2048)))).ok).toBe(true);
    const outcome = parseRecord(path, bytes(record(`${"*a* ".repeat(2048)}_b_`)));
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.map(({ code, path: issuePath, at }) => ({ code, path: issuePath, at }))).toEqual([
      { code: "syntax-error", path, at: "" },
    ]);
  });

  test.each([
    ["a.json", (title: string) => JSON.stringify({ $sections: [{ $title: title }] })],
    ["a.yaml", (title: string) => `$sections:\n  - $title: ${JSON.stringify(title)}\n`],
  ])(
    "a section's $title with emphasis nested 256 levels reads, and 257 levels fail with a syntax-error at the root, in %s",
    (path, record) => {
      const nested = (levels: number) => `${"*a ".repeat(levels)}b${" a*".repeat(levels)}`;
      expect(parseRecord(path, bytes(record(nested(256)))).ok).toBe(true);
      const outcome = parseRecord(path, bytes(record(nested(257))));
      expect(outcome.ok).toBe(false);
      expect(outcome.issues.map(({ code, path: issuePath, at }) => ({ code, path: issuePath, at }))).toEqual([
        { code: "syntax-error", path, at: "" },
      ]);
    },
  );

  test("a $title of 20,000 *a* is refused without resolving its emphasis", () => {
    const started = performance.now();
    const outcome = parseRecord("a.json", bytes(JSON.stringify({ $sections: [{ $title: "*a* ".repeat(20_000) }] })));
    expect(outcome.ok).toBe(false);
    // Resolved, the emphasis takes about a second; refused at run 4,097, a few milliseconds. The bound is far from both.
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test("fails with the Markdown parser's structural errors", () => {
    expect(parseRecord("a.md", bytes("---\na: 1\n")).issues.map((issue) => issue.code)).toEqual(["syntax-error"]);
  });
});
