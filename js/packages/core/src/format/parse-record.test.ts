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

  test.each([
    ["runs in the labels of references", "[a][*b*] ".repeat(2049), "[*b*]: /x", true],
    ["runs in the labels of undefined references", "[a][*b*] ".repeat(2049), "[b]: /x", false],
    ["a reference link in 255 levels of emphasis", `${"*a ".repeat(255)}[b][r]${" a*".repeat(255)}`, "[r]: /x", true],
    ["a reference link in 256 levels of emphasis", `${"*a ".repeat(256)}[b][r]${" a*".repeat(256)}`, "[r]: /x", false],
    ["an undefined reference in 256 levels of emphasis", `${"*a ".repeat(256)}[b][r]${" a*".repeat(256)}`, "[s]: /x", true],
  ])(
    "a JSON, YAML and Markdown record agree on %s",
    (_name, text, definition, reads) => {
      // The same record in each format, with the text as a paragraph and a heading. The definition is in the root's $body
      // and the text in another section's, and then the other way round; a Markdown file has them in one document.
      const layouts: [string, string][] = [
        [definition, text],
        [text, definition],
      ];
      for (const [first, second] of layouts) {
        const json = JSON.stringify({ $body: first, $sections: [{ $title: "S", $body: second }, { $title: text }] });
        const yaml = [
          `$body: ${JSON.stringify(first)}`,
          "$sections:",
          "  - $title: S",
          `    $body: ${JSON.stringify(second)}`,
          `  - $title: ${JSON.stringify(text)}`,
        ].join("\n");
        const markdown = `${first}\n\n## S\n\n${second}\n\n## ${text}\n`;
        expect(parseRecord("a.json", bytes(json)).ok).toBe(reads);
        expect(parseRecord("a.yaml", bytes(`${yaml}\n`)).ok).toBe(reads);
        expect(parseRecord("a.md", bytes(markdown)).ok).toBe(reads);
      }
      // Six records of up to 2,049 references each, which a loaded machine can take seconds to read.
    },
    30_000,
  );

  test.each([
    ["block quotes nested 256 levels", `${">".repeat(256)} a`, true],
    ["block quotes nested 257 levels", `${">".repeat(257)} a`, false],
    ["list items nested 257 levels", `${"- ".repeat(257)}a`, false],
    ["a paragraph of 4,096 runs", "*a* ".repeat(2048), true],
    ["a paragraph of 4,097 runs", `${"*a* ".repeat(2048)}_b_`, false],
    ["two paragraphs of 4,096 runs each", `${"*a* ".repeat(2048)}\n\n${"*a* ".repeat(2048)}`, true],
    ["emphasis nested 256 levels", `${"*a ".repeat(256)}b${" a*".repeat(256)}`, true],
    ["emphasis nested 257 levels", `${"*a ".repeat(257)}b${" a*".repeat(257)}`, false],
    ["runs in the labels of references defined beside them", `[*b*]: /x\n\n${"[a][*b*] ".repeat(2049)}`, true],
  ])("a JSON, YAML and Markdown record agree on a $body of %s, in the root and in a section", (_name, text, reads) => {
    const outcomes = (path: string, record: string) => {
      const outcome = parseRecord(path, bytes(record));
      return { ok: outcome.ok, issues: outcome.issues.map(({ code, at }) => `${code} ${at}`) };
    };
    const expected = reads ? { ok: true, issues: [] } : { ok: false, issues: ["syntax-error "] };
    expect(outcomes("a.json", JSON.stringify({ $body: text }))).toEqual(expected);
    expect(outcomes("a.yaml", `$body: ${JSON.stringify(text)}\n`)).toEqual(expected);
    expect(outcomes("a.md", text)).toEqual(expected);
    expect(outcomes("b.json", JSON.stringify({ $title: "T", $sections: [{ $title: "S", $body: text }] }))).toEqual(expected);
    expect(outcomes("b.yaml", `$title: T\n$sections:\n  - $title: S\n    $body: ${JSON.stringify(text)}\n`)).toEqual(expected);
    expect(outcomes("b.md", `# T\n\n## S\n\n${text}`)).toEqual(expected);
  });

  test("fails with the Markdown parser's structural errors", () => {
    expect(parseRecord("a.md", bytes("---\na: 1\n")).issues.map((issue) => issue.code)).toEqual(["syntax-error"]);
  });
});
