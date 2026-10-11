import { describe, expect, test } from "vitest";
import { ISSUE_CODES } from "../issue/codes.js";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import type { ParsedRecord } from "../record/record.js";
import type { ShapeUnit } from "../record/shape.js";
import { decodeSource, type SourceText } from "../text/source-text.js";
import { sliceUnitText, type UnitText } from "../text/unit-text.js";
import type { Value } from "../value/value.js";
import { parseRecord } from "./parse-record.js";
import { parseYamlUnit, type YamlUnit } from "./yaml.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

function parse(text: string): Outcome<ParsedRecord> {
  return parseRecord("r.yaml", utf8(text));
}

/** The code and `at` of each issue of a parse, failed or not. */
function issuesOf(text: string): [string, string | null][] {
  const outcome = parse(text);
  const issues = outcome.ok ? outcome.value.issues : outcome.issues;
  return issues.map((issue) => [issue.code, issue.at]);
}

/** The value view of a record that parses, failing the test otherwise. */
function valueView(text: string): Value {
  const outcome = parse(text);
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return outcome.value.value;
}

function decoded(text: string): SourceText {
  const outcome = decodeSource("r.md", utf8(text));
  if (!outcome.ok) throw new Error("not UTF-8");
  return outcome.value;
}

/** Parses `text.slice(start, end)` as a unit of `unit` at `at`. */
function unitOf(text: string, start: number, end: number, unit: ShapeUnit, at: string): YamlUnit {
  const source = decoded(text);
  return parseYamlUnit(source, sliceUnitText(source.text, start, end), { path: "r.md", at, unit });
}

/**
 * The unit text of lines `[start, end)` of a file, each indented by `indent` spaces that the unit leaves out, as a fenced
 * block indented in a list item is read. An index at a line's start maps after the indentation as a start, before it as an end.
 */
function indentedUnit(fileText: string, start: number, end: number, indent: number): UnitText {
  const lineStarts: number[] = [];
  let text = "";
  for (let at = start; at < end; ) {
    const newline = fileText.indexOf("\n", at);
    const lineEnd = newline < 0 || newline >= end ? end : newline + 1;
    lineStarts.push(text.length);
    text += fileText.slice(at + indent, lineEnd);
    at = lineEnd;
  }
  const lineOf = (index: number) => lineStarts.findLastIndex((lineStart) => lineStart <= index);
  // The file index of each line's first character after the indentation.
  const fileStarts: number[] = [];
  for (let at = start; at < end; ) {
    fileStarts.push(at + indent);
    const newline = fileText.indexOf("\n", at);
    at = newline < 0 || newline >= end ? end : newline + 1;
  }
  const fileIndex = (index: number) => {
    const line = lineOf(index);
    return (fileStarts[line] as number) + index - (lineStarts[line] as number);
  };
  return {
    text,
    fileIndex,
    fileEnd: (index) => {
      const line = lineOf(index);
      return index > 0 && lineStarts[line] === index ? fileIndex(index) - indent : fileIndex(index);
    },
  };
}

const codesAt = (issues: readonly Issue[]) => issues.map((issue) => [issue.code, issue.at]);

describe("line breaks: the yaml package does not read a lone CR as one", () => {
  test("a block scalar and a plain scalar with lone CRs read as with LF", () => {
    const text = "notes: |\r  line one\r  line two\rtitle: a long\r  plain scalar\r";
    expect(valueView(text)).toEqual({ notes: "line one\nline two\n", title: "a long plain scalar" });
  });

  test("CRLF reads as LF, in a block scalar too", () => {
    expect(valueView("a: |\r\n  x\r\n  y\r\nb: 1\r\n")).toEqual({ a: "x\ny\n", b: 1 });
  });

  test("a CR in a quoted scalar is a line break, folded as LF would be; a \\r escape stays", () => {
    expect(valueView('a: "x\r  y"\rb: "\\r"\r')).toEqual({ a: "x y", b: "\r" });
  });

  test("ranges count the bytes of the file, CRs included", () => {
    const text = "a: 1\r\nb: x\r\nc: 2\r";
    const record = parse(text);
    if (!record.ok) throw new Error("failed");
    const b = record.value.nodes.node("/b");
    const c = record.value.nodes.node("/c");
    expect(b?.range).toEqual({ start: 9, end: 10 });
    expect(b?.memberRange).toEqual({ start: 6, end: 10 });
    expect(c?.range).toEqual({ start: 15, end: 16 });
  });

  test("a position after CRLF lines is on the right line", () => {
    const outcome = parse("a: 1\r\nb: .inf\r\n");
    expect(outcome.ok).toBe(false);
    expect(outcome.issues[0]?.position).toEqual({ offset: 9, line: 2, col: 4 });
  });
});

describe("block scalars at the end of the unit", () => {
  test.each([
    ["a literal scalar", "a: |\n  x", "x"],
    ["a folded scalar", "a: >\n  x", "x"],
    ["a kept literal scalar", "a: |+\n  x", "x"],
    ["a literal scalar of two lines", "a: |\n  x\n  y", "x\ny"],
    ["a literal scalar as a sequence item", "a:\n- |\n  x", ["x"]],
    ["a literal scalar with CR line breaks", "a: |\r  x\r  y", "x\ny"],
  ])("%s whose last line has no line break reads without one", (_name, text, value) => {
    expect(valueView(text)).toEqual({ a: value });
  });

  test.each([
    ["a line break at the end", "a: |\n  x\n", "x\n"],
    ["trailing spaces on a last line of their own", "a: |\n  x\n  ", "x\n"],
    ["strip chomping", "a: |-\n  x", "x"],
    ["a literal scalar followed by a member", "a: |\n  x\nb: 1", "x\n"],
    ["a kept scalar whose last line of spaces has no line break", "a: |+\n  x\n\n  ", "x\n\n"],
  ])("near miss: %s", (_name, text, value) => {
    expect((valueView(text) as { a: string }).a).toBe(value);
  });
});

describe("%YAML directives", () => {
  test("%YAML 1.1, which the yaml package honors, is yaml-version-unsupported, and nothing is read as 1.1", () => {
    expect(issuesOf("%YAML 1.1\n---\na: 2026-10-09\nb: !!binary aGVsbG8=\n")).toEqual([["yaml-version-unsupported", ""]]);
  });

  test("%YAML 1.3, which the yaml package reads as 1.2 with a warning, is yaml-version-unsupported", () => {
    expect(issuesOf("%YAML 1.3\n---\na: 1\n")).toEqual([["yaml-version-unsupported", ""]]);
  });

  test("so is %YAML 2.0, and %YAML 1.1 with a tab, after a comment or with a comment", () => {
    expect(issuesOf("%YAML 2.0\n---\na: 1\n")).toEqual([["yaml-version-unsupported", ""]]);
    expect(issuesOf("%YAML\t1.1\n---\na: 1\n")).toEqual([["yaml-version-unsupported", ""]]);
    expect(issuesOf("# note\n\n%YAML 1.1 # old\n---\na: 1\n")).toEqual([["yaml-version-unsupported", ""]]);
  });

  test("near miss: %YAML 1.2 is allowed, and so are %TAG and a reserved directive", () => {
    expect(valueView("%YAML 1.2\n---\na: yes\n")).toEqual({ a: "yes" });
    expect(valueView("%TAG !e! tag:example.com,2026:\n---\na: 1\n")).toEqual({ a: 1 });
    expect(valueView("%FOO bar\n---\na: 1\n")).toEqual({ a: 1 });
  });

  test("near miss: a %YAML line inside a block scalar is text", () => {
    expect(valueView("a: |\n  %YAML 1.1\n")).toEqual({ a: "%YAML 1.1\n" });
  });

  test("two %YAML directives in one document are a syntax error, which the yaml package does not report", () => {
    expect(issuesOf("%YAML 1.2\n%YAML 1.2\n---\na: 1\n")).toEqual([["syntax-error", ""]]);
  });

  test("a %YAML directive without a version, or with two parts, is a syntax error", () => {
    expect(issuesOf("%YAML\n---\na: 1\n")).toEqual([["syntax-error", ""]]);
    expect(issuesOf("%YAML 1.2 x\n---\na: 1\n")).toEqual([["syntax-error", ""]]);
  });

  test.each([
    ["two %TAG directives for one handle", "%TAG !e! tag:a,2026:\n%TAG !e! tag:b,2026:\n---\na: 1\n"],
    ["a %TAG handle without its first !", "%TAG e! tag:a,2026:\n---\na: 1\n"],
    ["a named %TAG handle without its last !", "%TAG !e tag:a,2026:\n---\na: 1\n"],
    ["a directive after a document end, with no --- after it", "a: 1\n...\n%TAG !e! tag:a,2026:\n"],
    ["a %YAML directive after a document end, with no --- after it", "a: 1\n...\n%YAML 1.2\n"],
    ["a directive followed by content, not ---", "%TAG ! tag:a,2026:\na: 1\n"],
  ])("%s is a syntax-error", (_name, text) => {
    expect(issuesOf(text)).toEqual([["syntax-error", ""]]);
  });

  test("near miss: each document of several has its own directives", () => {
    const text = "%YAML 1.2\n%TAG !e! tag:a,2026:\n---\na: 1\n...\n%YAML 1.2\n%TAG !e! tag:b,2026:\n---\nb: 1\n";
    expect(issuesOf(text)).toEqual([["yaml-multiple-documents", ""]]);
  });

  test("near miss: handles !, !! and two named ones, each once, and a comment after a document end", () => {
    const text = "%TAG ! tag:a,2026:\n%TAG !! tag:b,2026:\n%TAG !e! tag:c,2026:\n%TAG !f! tag:d,2026:\n--- # c\na: 1\n";
    expect(valueView(text)).toEqual({ a: 1 });
    expect(valueView("a: 1\n...\n# c\n")).toEqual({ a: 1 });
  });

  test("in a data block, %YAML 1.1 is yaml-version-unsupported at the section", () => {
    const text = "%YAML 1.1\n---\na: 1\n";
    expect(codesAt(unitOf(text, 0, text.length, "data-block", "/$sections/0").issues)).toEqual([
      ["yaml-version-unsupported", "/$sections/0"],
    ]);
  });

  test("in front matter, a %YAML line is a syntax error, even %YAML 1.2", () => {
    const text = "---\n%YAML 1.2\n---\n";
    expect(codesAt(unitOf(text, 4, 14, "front-matter", "").issues)).toEqual([["syntax-error", ""]]);
  });
});

describe("syntax errors: one per unit, and no value checks", () => {
  test("the library's errors are one syntax-error at the record, listing each position", () => {
    const outcome = parse("a: [1, 2\nb: 3\nc: !foo x\n");
    expect(outcome.ok).toBe(false);
    expect(codesAt(outcome.issues)).toEqual([["syntax-error", ""]]);
    expect(outcome.issues[0]?.message).toMatch(/\(2:1\)/);
  });

  test("problems are listed in document order, whoever found them", () => {
    const outcome = parse("a: [1, 2\nb: 3\nc: x\u0001\n");
    expect(codesAt(outcome.issues)).toEqual([["syntax-error", ""]]);
    expect(outcome.issues[0]?.position?.line).toBe(2);
    expect(outcome.issues[0]?.message).toMatch(/\(2:1\).*U\+0001 .*\(3:5\)/);
  });

  test("several problems are still one issue, positioned at the first", () => {
    const outcome = parse("a: x\u0001\nb: y\uFFFE\n");
    expect(codesAt(outcome.issues)).toEqual([["syntax-error", ""]]);
    expect(outcome.issues[0]?.message).toMatch(/U\+0001 .*\(1:5\).*U\+FFFE .*\(2:5\)/);
    expect(outcome.issues[0]?.position).toEqual({ offset: 4, line: 1, col: 5 });
  });

  test("an invalid UTF-8 file is a syntax-error at the root", () => {
    expect(parseRecord("r.yaml", new Uint8Array([0x61, 0x3a, 0x20, 0xff])).issues.map((issue) => issue.code)).toEqual([
      "syntax-error",
    ]);
  });

  test.each([
    ["a C0 control in a plain scalar", "a: x\u0001y\n"],
    ["a C0 control in a quoted scalar", 'a: "x\u0001y"\n'],
    ["a C0 control in a comment", "# \u0007\na: 1\n"],
    ["NUL", "a: \u0000\n"],
    ["a raw U+FFFE", "a: x\uFFFEy\n"],
    ["a raw U+FFFF, even quoted", 'a: "x\uFFFFy"\n'],
    ["DEL in a plain scalar", "a: x\u007Fy\n"],
    ["U+0080, the first C1 control, in a plain scalar", "a: x\u0080y\n"],
    ["a C1 control in a plain scalar", "a: x\u0081y\n"],
    ["U+FEFF in a plain scalar", "a: x\uFEFFy\n"],
    ["U+FEFF in a key on a later line", "a: 1\n\uFEFFb: 2\n"],
    ["U+FEFF at the start of a line after a comment", "# c\n\uFEFFa: 1\n"],
    ["U+FEFF in a comment", "a: 1 # \uFEFF\n"],
    ["U+FEFF in a block scalar", "a: |\n  x\uFEFF\n"],
  ])("%s is a syntax-error", (_name, text) => {
    expect(issuesOf(text)).toEqual([["syntax-error", ""]]);
  });

  test.each([
    ["an escaped C0 control", 'a: "\\x01"\n', { a: "\u0001" }],
    ["a tab", "a:\tx\t# c\n", { a: "x" }],
    ["an escaped U+FFFE", 'a: "\\uFFFE"\n', { a: "\uFFFE" }],
    ["a raw noncharacter other than U+FFFE and U+FFFF", "a: x\uFDD0y\n", { a: "x\uFDD0y" }],
    ["DEL and a C1 control inside double quotes", 'a: "x\u007F\u0081y"\n', { a: "x\u007F\u0081y" }],
    ["NEL in a plain scalar, which is printable", "a: x\u0085y\n", { a: "x\u0085y" }],
    ["U+FEFF in double quotes", 'a: "x\uFEFFy"\n', { a: "x\uFEFFy" }],
    ["U+FEFF in single quotes, in a key", "'\uFEFFk': 1\n", { "\uFEFFk": 1 }],
  ])("near miss: %s reads", (_name, text, value) => {
    expect(valueView(text)).toEqual(value);
  });

  test("a byte order mark at byte 0 is skipped, and offsets count it", () => {
    const outcome = parseRecord("r.yaml", new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("a: 1\n")]));
    if (!outcome.ok) throw new Error("failed");
    expect(outcome.value.value).toEqual({ a: 1 });
    expect(outcome.value.nodes.node("/a")?.range).toEqual({ start: 6, end: 7 });
  });

  test("a second byte order mark is a syntax-error", () => {
    expect(parseRecord("r.yaml", new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61, 0x3a, 0x20, 0x31])).ok).toBe(false);
  });

  test("a syntax error hides the constructs of the unit, which a recovering parser only guesses at", () => {
    expect(issuesOf("a: &x 1\nb: [\n")).toEqual([["syntax-error", ""]]);
  });
});

describe("constructs outside the data model", () => {
  test.each([
    ["a core schema tag", "a: !!str 12\n", "/a"],
    ["a core schema tag on a quoted scalar", 'a: !!int "1"\n', "/a"],
    ["the non-specific tag", "a: ! 12\n", "/a"],
    ["a custom tag", "a: !foo x\n", "/a"],
    ["a tag on a mapping", "m: !point {x: 1}\n", "/m"],
    ["a tag on a sequence item", "a: [1, !!int 2]\n", "/a/1"],
    ["a tag on the root", "--- !foo\nk: v\n", ""],
    ["a tag on a key, at its mapping", "m:\n  !!str k: v\n", "/m"],
    ["a 1.1 tag the library still knows", "s: !!set {a, b}\n", "/s"],
    ["a tagged empty value", "a: !foo\nb: 1\n", "/a"],
  ])("yaml-tag for %s", (_name, text, at) => {
    expect(issuesOf(text)).toEqual([["yaml-tag", at]]);
  });

  test.each([
    ["an undefined tag handle", "a: !e!x 1\n"],
    ["an undefined tag handle on an empty root", "!e!x\n"],
    ["an undefined tag handle after ---", "--- !e!x\n"],
    ["an invalid verbatim tag", "a: !<!> x\n"],
    ["an invalid verbatim tag on an empty root", "!<!>\n"],
    ["an invalid verbatim tag after ---", "--- !<!>\n"],
  ])("%s is a syntax-error", (_name, text) => {
    expect(issuesOf(text)).toEqual([["syntax-error", ""]]);
  });

  test("near miss: a tag handle that %TAG declares is only yaml-tag", () => {
    expect(issuesOf("%TAG !e! tag:example.com,2026:\n---\na: !e!x 1\n")).toEqual([["yaml-tag", "/a"]]);
  });

  test("near miss: a quoted '!foo' is a string", () => {
    expect(valueView("a: '!foo'\nb: x!y\n")).toEqual({ a: "!foo", b: "x!y" });
  });

  test.each([
    ["an anchor", "a: &x 1\n", [["yaml-alias", "/a"]]],
    [
      "an anchor and its alias",
      "a: &x 1\nb: *x\n",
      [
        ["yaml-alias", "/a"],
        ["yaml-alias", "/b"],
      ],
    ],
    ["an alias to an undefined anchor", "a: *nope\n", [["yaml-alias", "/a"]]],
    ["an anchor on a mapping", "m: &x\n  k: 1\n", [["yaml-alias", "/m"]]],
    ["an anchor on the root", "&a\nk: v\n", [["yaml-alias", ""]]],
    ["an anchor on a key, at its mapping", "&k a: 1\n", [["yaml-alias", ""]]],
    ["an alias as a key, at its mapping", "*x : 2\n", [["yaml-alias", ""]]],
    ["an anchor ending in a colon, which the library only warns about", "a: &x: 1\n", [["yaml-alias", "/a"]]],
  ])("yaml-alias for %s", (_name, text, issues) => {
    expect(issuesOf(text)).toEqual(issues);
  });

  test("near miss: & and * inside scalars are text", () => {
    expect(valueView('a: "&x"\nb: x&y\nc: "*x"\n')).toEqual({ a: "&x", b: "x&y", c: "*x" });
  });

  test.each([
    ["a merge key with a mapping", "<<: {a: 1}\nb: 2\n", ""],
    ["a merge key with a scalar", "<<: 1\n", ""],
    ["a merge key in a nested mapping", "m:\n  <<: {a: 1}\n", "/m"],
    ["a merge key in a flow mapping", "m: {<<: 1}\n", "/m"],
  ])("yaml-merge-key for %s, at the mapping", (_name, text, at) => {
    expect(issuesOf(text)).toEqual([["yaml-merge-key", at]]);
  });

  test("near miss: a tagged << is a string, whose error is its tag", () => {
    expect(issuesOf("!!str <<: 1\n")).toEqual([["yaml-tag", ""]]);
  });

  test("near miss: a quoted << is a member, and << as a value is a string", () => {
    expect(valueView('"<<": {a: 1}\nb: <<\n')).toEqual({ "<<": { a: 1 }, b: "<<" });
  });

  test.each([
    ["an integer key", "1: a\n", ""],
    ["a boolean key", "true: a\n", ""],
    ["a null key", "~: a\n", ""],
    ["an empty key", ": a\n", ""],
    ["an empty key in a flow mapping", "{: a}\n", ""],
    ["a float key in a nested mapping", "m:\n  1.5: a\n", "/m"],
    ["a sequence key", "? [a, b]\n: c\n", ""],
    ["a mapping key", "? {a: 1}\n: c\n", ""],
  ])("yaml-non-string-key for %s, at the mapping", (_name, text, at) => {
    expect(issuesOf(text)).toEqual([["yaml-non-string-key", at]]);
  });

  test("near miss: quoted keys and keys the core schema reads as strings", () => {
    expect(valueView("\"1\": a\n'true': b\n2026-10-09: c\nyes: d\n? e\n: f\n")).toEqual({
      "1": "a",
      true: "b",
      "2026-10-09": "c",
      yes: "d",
      e: "f",
    });
  });

  test.each([".inf", "-.inf", "+.inf", ".Inf", ".INF", ".nan", ".NaN", ".NAN"])("yaml-non-finite for %s", (literal) => {
    expect(issuesOf(`a: [1, ${literal}]\n`)).toEqual([["yaml-non-finite", "/a/1"]]);
  });

  test("near miss: non-finite look-alikes are strings", () => {
    expect(valueView('a: ".inf"\nb: .iNf\nc: inf\nd: nan\ne: .Nan\nf: -.nan\n')).toEqual({
      a: ".inf",
      b: ".iNf",
      c: "inf",
      d: "nan",
      e: ".Nan",
      f: "-.nan",
    });
  });

  test("several documents are yaml-multiple-documents at the record, and the first document is still walked", () => {
    expect(issuesOf("a: !foo 1\n---\nb: 2\n")).toEqual([
      ["yaml-multiple-documents", ""],
      ["yaml-tag", "/a"],
    ]);
    expect(issuesOf("a: 1\n...\nb: 2\n")).toEqual([["yaml-multiple-documents", ""]]);
  });

  test("near miss: one document with its markers, and a document end followed by a comment", () => {
    expect(valueView("---\na: 1\n...\n")).toEqual({ a: 1 });
    expect(valueView("a: 1\n...\n# c\n")).toEqual({ a: 1 });
  });

  test("every construct is reported, each at its node", () => {
    expect(issuesOf("a: .nan\nb: !foo x\nc: &y 1\n")).toEqual([
      ["yaml-non-finite", "/a"],
      ["yaml-tag", "/b"],
      ["yaml-alias", "/c"],
    ]);
  });
});

describe("nesting", () => {
  const flow = (depth: number) => `a: ${"[".repeat(depth - 1)}${"]".repeat(depth - 1)}\n`;
  const block = (depth: number) => Array.from({ length: depth }, (_, i) => `${" ".repeat(i)}k:\n`).join("");

  test("256 collections one inside another read, in flow and in block style", () => {
    expect(issuesOf(flow(256))).toEqual([]);
    expect(issuesOf(block(256))).toEqual([]);
  });

  test("257 are a syntax-error, in flow and in block style", () => {
    expect(issuesOf(flow(257))).toEqual([["syntax-error", ""]]);
    expect(issuesOf(block(257))).toEqual([["syntax-error", ""]]);
  });

  test("a document nested 100,000 deep is a syntax-error, not a stack overflow, under a deep stack too", () => {
    const text = `${"[".repeat(100000)}${"]".repeat(100000)}\n`;
    const deep = (frames: number): [string, string | null][] => (frames === 0 ? issuesOf(text) : deep(frames - 1));
    expect(deep(5000)).toEqual([["syntax-error", ""]]);
  });

  test("near miss: a key that is a collection counts too", () => {
    expect(issuesOf(`? ${"[".repeat(256)}${"]".repeat(256)}\n: 1\n`)).toEqual([["syntax-error", ""]]);
  });
});

describe("numbers by form", () => {
  test.each([
    ["n: 9007199254740993\n"],
    ["n: +9007199254740993\n"],
    ["n: -9007199254740993\n"],
    ["n: 0x20000000000001\n"],
    ["n: 0o400000000000000001\n"],
    ["n: 1e400\n"],
    ["n: -1e400\n"],
    ["n: 1e-400\n"],
  ])("number-not-representable for %j", (text) => {
    expect(issuesOf(text)).toEqual([["number-not-representable", "/n"]]);
  });

  test("near miss: the forms that a double holds read as their doubles", () => {
    expect(
      valueView("a: 0x1F\nb: 0o17\nc: +42\nd: 017\ne: 1e23\nf: 9007199254740993.0\ng: -0\nh: .5\ni: 1.\nj: 0x20000000000000\n"),
    ).toEqual({ a: 31, b: 15, c: 42, d: 17, e: 1e23, f: 9007199254740992, g: 0, h: 0.5, i: 1, j: 2 ** 53 });
  });

  test("-0 reads as 0, not -0", () => {
    expect(Object.is((valueView("a: -0\nb: -0.0\n") as { a: number }).a, 0)).toBe(true);
  });

  test("near miss: a quoted big integer and forms the core schema does not read are strings", () => {
    expect(valueView('n: "9007199254740993"\nb: 0b101\nu: 1_000\nx: -0x1F\n')).toEqual({
      n: "9007199254740993",
      b: "0b101",
      u: "1_000",
      x: "-0x1F",
    });
  });
});

describe("strings and members", () => {
  test("unpaired-surrogate for a 16-bit or a 32-bit escape, once per string, at the string", () => {
    expect(issuesOf('s: "\\ud800 and \\udc00"\nt: "\\U0000DC00"\n')).toEqual([
      ["unpaired-surrogate", "/s"],
      ["unpaired-surrogate", "/t"],
    ]);
  });

  test("unpaired-surrogate in a key is at the mapping", () => {
    expect(issuesOf('m:\n  "\\ud800": 1\n')).toEqual([["unpaired-surrogate", "/m"]]);
  });

  test("near miss: a pair of escapes is one character", () => {
    expect(valueView('s: "\\ud83d\\ude00"\n')).toEqual({ s: "\u{1F600}" });
  });

  test("duplicate-member at each repeat after the first, plain or quoted, in block and flow mappings", () => {
    expect(issuesOf('a: 1\na: 2\n"a": 3\nm: {k: 1, k: 2}\n')).toEqual([
      ["duplicate-member", "/a"],
      ["duplicate-member", "/a"],
      ["duplicate-member", "/m/k"],
    ]);
  });

  test("a repeat's value is not looked into", () => {
    expect(issuesOf("a: 1\na: !foo 2\n")).toEqual([["duplicate-member", "/a"]]);
  });

  test("nor is the value of a member whose name holds an unpaired surrogate", () => {
    expect(issuesOf('"\\ud800": !foo {b: .inf}\n')).toEqual([["unpaired-surrogate", ""]]);
  });

  test("near miss: names that differ, and __proto__, an ordinary member", () => {
    const value = valueView('a: 1\n"a ": 2\nA: 3\n__proto__: {x: 1}\n') as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(["a", "a ", "A", "__proto__"]);
    expect(Object.getPrototypeOf(value)).toBe(null);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toEqual({ x: 1 });
  });

  test("the core schema's booleans and nulls, and its strings", () => {
    expect(valueView("a: True\nb: FALSE\nc: Null\nd: ~\ne:\nf: yes\ng: 2026-10-09\n")).toEqual({
      a: true,
      b: false,
      c: null,
      d: null,
      e: null,
      f: "yes",
      g: "2026-10-09",
    });
  });

  test("the value is frozen", () => {
    const value = valueView("a: [1, {b: 2}]\n") as { a: [number, object] };
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a[1])).toBe(true);
  });
});

describe("the shape of a YAML record", () => {
  test.each([
    ["a sequence", "- a\n- b\n"],
    ["a scalar", "x\n"],
    ["null", "~\n"],
    ["an alias", "*a\n"],
  ])("root-not-object for %s", (_name, text) => {
    expect(issuesOf(text).filter(([code]) => code === "root-not-object")).toEqual([["root-not-object", ""]]);
  });

  test("a root that is not a mapping still has its anchor and tag reported", () => {
    expect(issuesOf("--- !foo\n- 1\n")).toEqual([
      ["yaml-tag", ""],
      ["root-not-object", ""],
    ]);
  });

  test("a document of an empty node with an anchor or a tag is not the empty record", () => {
    expect(issuesOf("--- !foo\n")).toEqual([
      ["yaml-tag", ""],
      ["root-not-object", ""],
    ]);
    expect(issuesOf("--- &a\n")).toEqual([
      ["yaml-alias", ""],
      ["root-not-object", ""],
    ]);
  });

  test.each([
    ["an empty file", ""],
    ["a file of comments and blank lines", "# a comment\n\n  # another\n"],
  ])("near miss: %s is the empty record", (_name, text) => {
    expect(valueView(text)).toEqual({});
  });

  test("a document marker alone is an empty node, null, and so root-not-object", () => {
    expect(issuesOf("---\n")).toEqual([["root-not-object", ""]]);
    expect(issuesOf("---\n...\n")).toEqual([["root-not-object", ""]]);
  });

  test("an empty node with a tag or an anchor is not the empty record either", () => {
    expect(issuesOf("--- !foo\n")).toEqual([
      ["yaml-tag", ""],
      ["root-not-object", ""],
    ]);
    expect(issuesOf("!foo\n")).toEqual([
      ["yaml-tag", ""],
      ["root-not-object", ""],
    ]);
  });

  test("a document that is not a mapping is still walked for its other issues", () => {
    expect(issuesOf("- !foo 1\n- &a 2\n- [.inf]\n")).toEqual([
      ["yaml-tag", "/0"],
      ["yaml-alias", "/1"],
      ["yaml-non-finite", "/2/0"],
      ["root-not-object", ""],
    ]);
  });

  test("section-title-missing at an item of $sections without $title", () => {
    expect(issuesOf("$sections:\n  - $body: Text.\n")).toEqual([["section-title-missing", "/$sections/0"]]);
  });

  test("near miss: the item with its $title", () => {
    expect(valueView("$sections:\n  - $title: A\n    $body: Text.\n")).toEqual({ $sections: [{ $title: "A", $body: "Text." }] });
  });

  test("ref-malformed for a $ref object with another member, or a $ref that is not a string", () => {
    expect(issuesOf("parent: {$ref: other.yaml, note: x}\nchild: {$ref: 1}\n")).toEqual([
      ["ref-malformed", "/parent"],
      ["ref-malformed", "/child"],
    ]);
  });

  test("near miss: a $ref object alone, and $refs, an ordinary member", () => {
    expect(valueView("parent: {$ref: other.yaml}\nother: {$refs: x.md, a: 1}\n")).toEqual({
      parent: { $ref: "other.yaml" },
      other: { $refs: "x.md", a: 1 },
    });
  });

  test("dollar-member for $key on a section and $schema below the root", () => {
    expect(issuesOf("$sections:\n  - $title: A\n    $key: a\n    $schema: s.json\n")).toEqual([
      ["dollar-member", "/$sections/0/$key"],
      ["dollar-member", "/$sections/0/$schema"],
    ]);
  });

  test("near miss: $schema on the root, and $key inside a field's value", () => {
    expect(valueView("$schema: https://example.com/s.json\ndata: {$key: 1}\n")).toEqual({
      $schema: "https://example.com/s.json",
      data: { $key: 1 },
    });
  });

  test("feature-unsupported for another $ member on a section", () => {
    expect(issuesOf("$foo: 1\n$sections:\n  - $title: A\n    $bar: 2\n")).toEqual([
      ["feature-unsupported", "/$foo"],
      ["feature-unsupported", "/$sections/0/$bar"],
    ]);
  });

  test("near miss: $foo inside a field's value is data", () => {
    expect(valueView("data:\n  $foo: 3\nlist:\n  - $sections: 5\n")).toEqual({ data: { $foo: 3 }, list: [{ $sections: 5 }] });
  });

  test("reserved-member-type for $tags that is not an array of strings, at the member", () => {
    expect(issuesOf("$tags: [stock, 3]\nshelf:\n  $tags: front\n")).toEqual([
      ["reserved-member-type", "/$tags"],
      ["reserved-member-type", "/shelf/$tags"],
    ]);
  });

  test("a repeated tag is a duplicate-tag warning, and the value keeps it", () => {
    const outcome = parse("$tags: [open, review, open]\n");
    if (!outcome.ok) throw new Error("failed");
    expect(outcome.value.value).toEqual({ $tags: ["open", "review", "open"] });
    expect(codesAt(outcome.value.issues)).toEqual([["duplicate-tag", ""]]);
  });

  test("a shape issue is positioned at its member's key", () => {
    const outcome = parse("a: 1\n$foo: 2\n");
    expect(outcome.issues[0]?.position).toEqual({ offset: 5, line: 2, col: 1 });
  });
});

describe("the node index", () => {
  test("every node, in source order, with its kind; sections are the items of $sections", () => {
    const outcome = parse("$title: T\nz: {b: [1, true, null]}\na: x\n$sections:\n  - $title: S\n");
    if (!outcome.ok) throw new Error("failed");
    const nodes = outcome.value.nodes;
    expect(nodes.children("").map((node) => [node.at, node.kind])).toEqual([
      ["/$title", "string"],
      ["/z", "object"],
      ["/a", "string"],
      ["/$sections", "array"],
    ]);
    expect(nodes.children("/z/b").map((node) => node.kind)).toEqual(["number", "boolean", "null"]);
    expect(nodes.sections().map((section) => [section.at, section.depth])).toEqual([
      ["", 0],
      ["/$sections/0", 1],
    ]);
  });

  test("the root's range is the whole file; a member's is its value, and its member range from its key", () => {
    const text = "k: x\u{1F600}y\nn: 0x1F # c\n";
    const outcome = parse(text);
    if (!outcome.ok) throw new Error("failed");
    const nodes = outcome.value.nodes;
    expect(nodes.node("")?.range).toEqual({ start: 0, end: utf8(text).length });
    expect(nodes.node("/k")?.range).toEqual({ start: 3, end: 9 });
    expect(nodes.node("/n")?.range).toEqual({ start: 13, end: 17 });
    expect(nodes.node("/n")?.memberRange).toEqual({ start: 10, end: 17 });
  });

  test("a block collection's range ends with its last value, before the line break and a trailing comment", () => {
    const text = "m:\n  k: 1\n  j: [1, 2]\n  # end\nz: x\n";
    const outcome = parse(text);
    if (!outcome.ok) throw new Error("failed");
    const m = outcome.value.nodes.node("/m");
    expect(text.slice(m?.range.start, m?.range.end)).toBe("k: 1\n  j: [1, 2]");
    expect(text.slice(m?.memberRange?.start, m?.memberRange?.end)).toBe("m:\n  k: 1\n  j: [1, 2]");
    const s = parse("s:\n- 1\n- 2\n");
    if (!s.ok) throw new Error("failed");
    expect(s.value.nodes.node("/s")?.range).toEqual({ start: 3, end: 10 });
  });

  test("an explicit key's member range starts at its ?", () => {
    const outcome = parse("? a\n: 1\n");
    if (!outcome.ok) throw new Error("failed");
    expect(outcome.value.nodes.node("/a")?.memberRange).toEqual({ start: 0, end: 7 });
    expect(outcome.value.nodes.node("/a")?.range).toEqual({ start: 6, end: 7 });
  });

  test("an empty value and a flow member without one have empty ranges after their keys", () => {
    const text = "a:\nm: {b}\n";
    const outcome = parse(text);
    if (!outcome.ok) throw new Error("failed");
    expect(outcome.value.value).toEqual({ a: null, m: { b: null } });
    expect(outcome.value.nodes.node("/a")?.range).toEqual({ start: 2, end: 2 });
    expect(outcome.value.nodes.node("/m/b")?.range).toEqual({ start: 8, end: 8 });
    expect(outcome.value.nodes.node("/m/b")?.memberRange).toEqual({ start: 7, end: 8 });
  });

  test("a block scalar's range includes its last line break, which its value holds", () => {
    const text = "a: |\n  x\nb: 1\n";
    const outcome = parse(text);
    if (!outcome.ok) throw new Error("failed");
    const a = outcome.value.nodes.node("/a");
    expect(text.slice(a?.range.start, a?.range.end)).toBe("|\n  x\n");
  });
});

describe("units of a Markdown record", () => {
  test("front matter: its members are the root's fields, under the root, with the file's offsets", () => {
    const text = "---\ntitle: x\nn: 1\n---\n# T\n";
    const unit = unitOf(text, 4, 18, "front-matter", "");
    expect(unit.value).toEqual({ title: "x", n: 1 });
    expect(unit.nodes.map((node) => [node.parent, node.key, node.init.range])).toEqual([
      ["", "title", { start: 11, end: 12 }],
      ["", "n", { start: 16, end: 17 }],
    ]);
    expect(unit.issues).toEqual([]);
  });

  test("front matter: a section member is dollar-member, and $schema is allowed", () => {
    const text = "$title: x\n$schema: s.json\n";
    expect(codesAt(unitOf(text, 0, text.length, "front-matter", "").issues)).toEqual([["dollar-member", "/$title"]]);
  });

  test("a data block: nodes and issues are under its section", () => {
    const text = "a: [1, .inf]\nb: 2\n";
    const unit = unitOf(text, 0, text.length, "data-block", "/$sections/1");
    expect(codesAt(unit.issues)).toEqual([["yaml-non-finite", "/$sections/1/a/1"]]);
    expect(unit.nodes.map((node) => [node.parent, node.key])).toEqual([
      ["/$sections/1", "a"],
      ["/$sections/1/a", 0],
      ["/$sections/1/a", 1],
      ["/$sections/1", "b"],
    ]);
  });

  test("a data block that is not a mapping is data-block-not-object at its section, and has no value", () => {
    const unit = unitOf("- 1\n", 0, 4, "data-block", "/$sections/0");
    expect(codesAt(unit.issues)).toEqual([["data-block-not-object", "/$sections/0"]]);
    expect(unit.value).toBeUndefined();
  });

  test("front matter holds no directive of any kind", () => {
    const text = "%TAG !e! tag:example.com,2026:\n---\na: 1\n";
    expect(codesAt(unitOf(text, 0, text.length, "front-matter", "").issues)).toEqual([["syntax-error", ""]]);
  });

  test("near miss: the same %TAG directive in a data block", () => {
    const text = "%TAG !e! tag:example.com,2026:\n---\na: 1\n";
    expect(unitOf(text, 0, text.length, "data-block", "/$sections/0").value).toEqual({ a: 1 });
  });

  test("the value of a unit with a repeated member keeps the first", () => {
    expect(unitOf("a: 1\na: 2\n", 0, 10, "data-block", "/$sections/0").value).toEqual({ a: 1 });
  });

  test("front matter that is not a mapping is data-block-not-object at the root", () => {
    expect(codesAt(unitOf("x\n", 0, 2, "front-matter", "").issues)).toEqual([["data-block-not-object", ""]]);
  });

  test("an empty unit is the empty object", () => {
    expect(unitOf("---\n---\n", 4, 4, "front-matter", "").value).toEqual({});
  });

  test("a syntax error in a data block is at its section", () => {
    expect(codesAt(unitOf("a: [\n", 0, 5, "data-block", "/$sections/2").issues)).toEqual([["syntax-error", "/$sections/2"]]);
  });

  test("U+FEFF at the start of front matter is a syntax-error, though the library would strip it", () => {
    const text = "---\n\uFEFFa: 1\n---\n";
    expect(codesAt(unitOf(text, 4, 12, "front-matter", "").issues)).toEqual([["syntax-error", ""]]);
  });

  test("a data block in a fence indented 2 spaces: a range ends before the next line's indentation", () => {
    const text = "- item\n\n  ```yaml data\n  a: 1\n  b: |\n    x\n  c: 2\n  ```\n";
    const start = text.indexOf("  a: 1");
    const end = text.indexOf("  ```\n", start);
    const source = decoded(text);
    const unit = parseYamlUnit(source, indentedUnit(source.text, start, end, 2), { path: "r.md", at: "/x", unit: "data-block" });
    expect(unit.value).toEqual({ a: 1, b: "x\n", c: 2 });
    const range = (key: string) => unit.nodes.find((node) => node.key === key)?.init;
    expect(text.slice(range("b")?.range.start, range("b")?.range.end)).toBe("|\n    x\n");
    expect(text.slice(range("b")?.memberRange?.start, range("b")?.memberRange?.end)).toBe("b: |\n    x\n");
    expect(text.slice(range("c")?.memberRange?.start, range("c")?.memberRange?.end)).toBe("c: 2");
  });

  test("a CRLF unit maps its offsets back to the file", () => {
    const text = "---\r\na: 1\r\nb: x\r\n---\r\n";
    const unit = unitOf(text, 5, 17, "front-matter", "");
    expect(unit.value).toEqual({ a: 1, b: "x" });
    expect(unit.nodes.map((node) => node.init.range)).toEqual([
      { start: 8, end: 9 },
      { start: 14, end: 15 },
    ]);
  });
});

describe("issue classes", () => {
  test("every code the YAML parser raises is structural, but duplicate-tag, which Appendix D makes a validation warning", () => {
    const inputs = [
      "a: [\n",
      "%YAML 1.1\n---\na: 1\n",
      "a: 1\n---\nb: 2\n",
      'a: !foo 1\nb: &x 2\n<<: 1\n1: a\nc: .inf\nd: 1e400\ne: "\\ud800"\nf: 1\nf: 2\n',
      "- 1\n",
      "$tags: [a, a]\n$sections:\n  - $body: x\n  - $key: k\n    $foo: 1\n    $title: [1]\n    r: {$ref: 1}\n",
    ];
    const seen = new Map<string, string>();
    for (const input of inputs) {
      for (const issue of unitOf(input, 0, input.length, "record", "").issues) seen.set(issue.code, issue.class);
    }
    expect([...seen.keys()].sort()).toEqual(
      [
        "syntax-error",
        "yaml-version-unsupported",
        "yaml-multiple-documents",
        "yaml-tag",
        "yaml-alias",
        "yaml-merge-key",
        "yaml-non-string-key",
        "yaml-non-finite",
        "number-not-representable",
        "unpaired-surrogate",
        "duplicate-member",
        "root-not-object",
        "duplicate-tag",
        "section-title-missing",
        "dollar-member",
        "feature-unsupported",
        "reserved-member-type",
        "ref-malformed",
      ].sort(),
    );
    for (const [code, issueClass] of seen) {
      expect([code, issueClass]).toEqual([code, ISSUE_CODES[code as keyof typeof ISSUE_CODES].classes[0]]);
    }
  });
});
