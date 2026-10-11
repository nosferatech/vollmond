import { describe, expect, test } from "vitest";
import { ISSUE_CODES } from "../issue/codes.js";
import type { Issue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import type { ParsedRecord } from "../record/record.js";
import { decodeSource } from "../text/source-text.js";
import { JSON_NESTING_LIMIT, parseJsonRecord } from "./json.js";

const encoder = new TextEncoder();
const PATH = "r.json";

/** Parses `text`, given as the file's characters, as the JSON record `r.json`. */
function parse(text: string | Uint8Array): Outcome<ParsedRecord> {
  const source = decodeSource(PATH, typeof text === "string" ? encoder.encode(text) : text);
  if (!source.ok) throw new Error("the test's text is not UTF-8");
  return parseJsonRecord(PATH, source.value);
}

/** Parses `text`, which must parse, and returns the record. */
function record(text: string): ParsedRecord {
  const outcome = parse(text);
  if (!outcome.ok) throw new Error(`expected a record, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** The code and `at` of each issue, sorted, for outcomes whose issue order is not part of the contract. */
function issuesOf(outcome: Outcome<ParsedRecord>): [string, string | null][] {
  const issues: readonly Issue[] = outcome.ok ? outcome.value.issues : outcome.issues;
  return issues.map((issue): [string, string | null] => [issue.code, issue.at]).sort();
}

/** The issues of a parse that must fail. */
function failure(text: string): [string, string | null][] {
  const outcome = parse(text);
  expect(outcome.ok).toBe(false);
  return issuesOf(outcome);
}

/** The single issue of a parse that must fail with one. */
function onlyIssue(text: string): Issue {
  const outcome = parse(text);
  if (outcome.ok || outcome.issues.length !== 1) throw new Error(`expected one issue, got ${JSON.stringify(outcome)}`);
  return outcome.issues[0] as Issue;
}

describe("values", () => {
  test("reads every JSON type as JSON.parse does", () => {
    const text = '{"s": "x\\n\\u00e9", "n": -1.5e3, "t": true, "f": false, "z": null, "a": [1, [], {}], "o": {"k": "v"}}';
    expect(record(text).value).toEqual(JSON.parse(text));
  });

  test("builds objects with a null prototype, so that __proto__ is an ordinary member", () => {
    const value = record('{"__proto__": {"x": 1}, "o": {"__proto__": 2}}').value;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.keys(value)).toEqual(["__proto__", "o"]);
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toEqual({ x: 1 });
    expect(Object.hasOwn(value.o as object, "__proto__")).toBe(true);
  });

  test("reads -0 as 0", () => {
    const value = record('{"a": -0, "b": -0.0, "c": -0e5}').value;
    for (const name of ["a", "b", "c"]) expect(Object.is(value[name], 0)).toBe(true);
  });

  test("reads numbers by their source text, which keeps 2^53 + 1 apart from 2^53", () => {
    expect(record('{"n": 9007199254740992, "f": 9007199254740993.0, "e": 1e23}').value).toEqual({
      n: 2 ** 53,
      f: 2 ** 53,
      e: 1e23,
    });
  });

  test("does not normalize strings or member names", () => {
    expect(record('{"é": 1, "é": "é"}').value).toEqual({ é: 1, é: "é" });
  });

  test("combines an escaped surrogate pair into one character", () => {
    expect(record('{"s": "\\ud83d\\ude00"}').value).toEqual({ s: "\u{1f600}" });
  });
});

describe("byte order marks", () => {
  test("skips a byte order mark at byte 0, which jsonc-parser would reject", () => {
    expect(record('﻿{"a": 1}').value).toEqual({ a: 1 });
  });

  test("counts the byte order mark in ranges, but not as a column", () => {
    const parsed = record('﻿{"a": 1}');
    expect(parsed.nodes.node("")?.range).toEqual({ start: 0, end: 11 });
    expect(parsed.nodes.node("/a")).toMatchObject({ range: { start: 9, end: 10 }, memberRange: { start: 4, end: 10 } });
    expect(onlyIssue('﻿{"a": 1e400}').position).toEqual({ offset: 9, line: 1, col: 7 });
  });

  test("a second U+FEFF is a character, and so a syntax error outside a string", () => {
    expect(failure('﻿﻿{"a": 1}')).toEqual([["syntax-error", ""]]);
    expect(failure('﻿{"a": 1}﻿')).toEqual([["syntax-error", ""]]);
  });

  test("a U+FEFF inside a string is kept", () => {
    expect(record('{"s": "x﻿y"}').value).toEqual({ s: "x﻿y" });
  });
});

describe("syntax errors", () => {
  test.each([
    ["the empty file", ""],
    ["white space only", " \n\t\r\n"],
    ["a byte order mark only", "﻿"],
    ["a leading zero", '{"a": 01}'],
    ["a plus sign", '{"a": +1}'],
    ["a leading dot", '{"a": .5}'],
    ["a trailing dot", '{"a": 1.}'],
    ["an exponent without digits", '{"a": 1e}'],
    ["NaN", '{"a": NaN}'],
    ["Infinity", '{"a": Infinity}'],
    ["a lone minus", '{"a": -}'],
    ["a line comment", '{"a": 1} // c'],
    ["a block comment", '{/* c */"a": 1}'],
    ["a trailing comma in an object", '{"a": 1,}'],
    ["a trailing comma in an array", '{"a": [1,]}'],
    ["a raw control character in a string", '{"a": "x\u0001"}'],
    ["a raw line feed in a string", '{"a": "x\ny"}'],
    ["an invalid escape", '{"a": "\\x"}'],
    ["a short \\u escape", '{"a": "\\u12"}'],
    ["a single-quoted string", "{'a': 1}"],
    ["an unquoted name", "{a: 1}"],
    ["a second value", "{} {}"],
    ["an unclosed object", '{"a": 1'],
    ["vertical tab as white space", '{"a":\u000b1}'],
    ["no-break space as white space", '{"a": 1}'],
  ])("%s is one syntax-error at the root", (_name, text) => {
    expect(failure(text)).toEqual([["syntax-error", ""]]);
  });

  test("one syntax-error per file, however many errors it holds, with each in the message", () => {
    const issue = onlyIssue('{"a": 01, "b": +1}');
    expect(issue).toMatchObject({ code: "syntax-error", severity: "error", class: "structural", path: PATH, at: "" });
    expect(issue.position).toEqual({ offset: 7, line: 1, col: 8 });
    expect(issue.message).toContain("1:8");
    expect(issue.message).toContain("1:16");
  });

  test("a file of millions of errors gives one syntax-error whose message names ten and counts the rest", () => {
    const commas = 3_000_000;
    const issue = onlyIssue(`{${",".repeat(commas)}}`);
    expect(issue.code).toBe("syntax-error");
    expect(issue.message.length).toBeLessThan(1000);
    expect(issue.message.match(/ at \d+:\d+/g)).toHaveLength(10);
    expect(issue.message).toMatch(/, and \d+ more$/);
    expect(onlyIssue("{,,}").message).not.toContain("more");
  });

  test("the syntax error is positioned at the first error, also when a bracket of the wrong kind comes later", () => {
    const issue = onlyIssue('{"a" 1, "b": [}');
    expect(issue.position).toEqual({ offset: 5, line: 1, col: 6 });
    expect(issue.message).toMatch(/^not JSON: ColonExpected at 1:6, .*\} closes no array or object here at 1:15$/);
    // With nothing wrong before it, the refused bracket is the first error.
    expect(onlyIssue('{"a": [}').position).toEqual({ offset: 7, line: 1, col: 8 });
    expect(onlyIssue('{"a": [}').message).toBe("not JSON: } closes no array or object here at 1:8");
  });

  test("a file with a syntax error has no other issue, since the recovered tree is a guess", () => {
    expect(failure('{"a": 1e400, "a": [1, "\\ud800"], "$foo": 01}')).toEqual([["syntax-error", ""]]);
    expect(failure("[1e400, 01]")).toEqual([["syntax-error", ""]]);
  });

  test("positions count lines and code points, and offsets UTF-8 bytes", () => {
    expect(onlyIssue('{\n  "é\u{1f600}": 01}').position).toEqual({ offset: 15, line: 2, col: 10 });
  });
});

describe("nesting", () => {
  test(`nesting deeper than ${JSON_NESTING_LIMIT} levels is a syntax-error, not a stack overflow`, () => {
    for (const depth of [JSON_NESTING_LIMIT + 1, 100_000]) {
      expect(failure(`{"a": ${"[".repeat(depth - 1)}${"]".repeat(depth - 1)}}`)).toEqual([["syntax-error", ""]]);
      expect(failure(`${'{"a": '.repeat(depth)}1${"}".repeat(depth)}`)).toEqual([["syntax-error", ""]]);
    }
  });

  test(`nesting of ${JSON_NESTING_LIMIT} levels reads`, () => {
    const depth = JSON_NESTING_LIMIT;
    expect(parse(`{"a": ${"[".repeat(depth - 1)}${"]".repeat(depth - 1)}}`).ok).toBe(true);
    expect(parse(`${'{"a": '.repeat(depth)}1${"}".repeat(depth)}`).ok).toBe(true);
  });

  test("brackets inside strings do not count as nesting", () => {
    const deep = "[".repeat(JSON_NESTING_LIMIT * 2);
    expect(record(`{"${deep}": "${deep}\\"${deep}"}`).value).toEqual({ [deep]: `${deep}"${deep}` });
  });

  test("brackets that balance without pairing up cannot lead the recovering parser deeper than the count", () => {
    // jsonc-parser's recovery skips a } inside an array, so each [ of `[},[},...` opens a level that no bracket closes.
    for (const text of ["[},".repeat(100_000), `{"a": ${"[},".repeat(100_000)}`, '{"a":[}'.repeat(100_000)]) {
      expect(failure(text)).toEqual([["syntax-error", ""]]);
    }
  });

  test("a quote inside a comment hides no bracket from the count, since it counts the parser's own tokens", () => {
    for (const text of [
      `/*"*/${"[".repeat(100_000)}`,
      `{"a":/*"*/${"[".repeat(100_000)}`,
      `{"a": 1 // "\n${"[".repeat(100_000)}`,
    ]) {
      expect(failure(text)).toEqual([["syntax-error", ""]]);
    }
  });

  test("brackets inside comments do not count", () => {
    expect(failure(`{"a": 1 /* ${"[".repeat(JSON_NESTING_LIMIT * 2)} */}`)).toEqual([["syntax-error", ""]]);
    expect(onlyIssue(`{"a": 1 /* ${"[".repeat(JSON_NESTING_LIMIT * 2)} */}`).message).toContain("InvalidCommentToken");
  });

  test("a closing bracket of the wrong kind is a syntax error, positioned at it", () => {
    expect(onlyIssue('{"a": [1}}').position).toMatchObject({ offset: 8 });
    expect(onlyIssue("{}]").position).toMatchObject({ offset: 2 });
  });

  test("a line break ends a string for the nesting count as it does for jsonc-parser, so its brackets count", () => {
    // After the string that the line break ends, the array goes on, and the parser recurses into each [.
    const deep = "[".repeat(100_000);
    expect(failure(`["x\n, ${deep}`)).toEqual([["syntax-error", ""]]);
    expect(failure(`["x\r, ${deep}`)).toEqual([["syntax-error", ""]]);
  });
});

describe("numbers", () => {
  test.each([
    ["an integer by form that a double rounds", "9007199254740993"],
    ["an integer of twenty digits", "12345678901234567890"],
    // JSON.stringify(1.2345678901234568e20) prints it, but it is not that double's exact value.
    ["a double as JSON.stringify prints it, in integer form", "123456789012345680000"],
    ["a number too large for a double", "1e400"],
    ["a negative one", "-1e400"],
    ["a non-zero number a double rounds to zero", "1e-400"],
  ])("%s is number-not-representable at the number", (_name, literal) => {
    const issue = onlyIssue(`{"n": ${literal}}`);
    expect(issue).toMatchObject({ code: "number-not-representable", at: "/n", position: { offset: 6, line: 1, col: 7 } });
    expect(issue.hint).toBeDefined();
  });

  test("every number error is reported", () => {
    expect(failure('{"a": 9007199254740993, "b": [1, 1e400], "c": {"d": 1e-400}, "ok": 1}')).toEqual([
      ["number-not-representable", "/a"],
      ["number-not-representable", "/b/1"],
      ["number-not-representable", "/c/d"],
    ]);
  });
});

describe("duplicate members", () => {
  test("each member after the first is duplicate-member, at its exact path and the repeat's key", () => {
    const issue = onlyIssue('{"a": 1, "a": 2}');
    expect(issue).toMatchObject({ code: "duplicate-member", at: "/a", position: { offset: 9, line: 1, col: 10 } });
    expect(failure('{"a": 1, "a": 2, "a": 3}')).toEqual([
      ["duplicate-member", "/a"],
      ["duplicate-member", "/a"],
    ]);
  });

  test("names are compared after their escapes are read", () => {
    expect(failure('{"a": 1, "\\u0061": 1}')).toEqual([["duplicate-member", "/a"]]);
  });

  test("a duplicate in a nested object is at that object's member, even with an equal value", () => {
    expect(failure('{"x": {"k": 1, "k": 1}, "y": [{"k": 1, "k": 1}]}')).toEqual([
      ["duplicate-member", "/x/k"],
      ["duplicate-member", "/y/0/k"],
    ]);
  });

  test("the same name in two objects is no duplicate", () => {
    expect(parse('{"x": {"k": 1}, "y": {"k": 1}, "k": 1}').ok).toBe(true);
  });

  test("names that differ by normalization or case are different", () => {
    expect(parse('{"é": 1, "é": 2, "A": 3, "a": 4}').ok).toBe(true);
  });
});

describe("unpaired surrogates", () => {
  test.each([
    ["a high surrogate", '{"s": "\\ud800"}', "/s"],
    ["a low surrogate", '{"s": "\\udead"}', "/s"],
    ["a reversed pair, reported once per string", '{"s": "\\udc00\\ud800"}', "/s"],
    ["one in a string in an array", '{"a": ["x", "a\\ud800b"]}', "/a/1"],
    ["one in a member name, at the object that holds the member", '{"m": {"\\ud800": 1}}', "/m"],
    ["one in a root member name, at the root", '{"\\ud800": 1}', ""],
  ])("%s is unpaired-surrogate", (_name, text, at) => {
    expect(failure(text)).toEqual([["unpaired-surrogate", at]]);
  });

  test("an escaped noncharacter is a character", () => {
    expect(record('{"a": "\\uffff", "b": "\\ufdd0", "c": "\\ud83f\\udffe"}').value).toEqual({
      a: "￿",
      b: "﷐",
      c: "\u{1fffe}",
    });
  });

  test("every error is reported: a surrogate and a duplicate together", () => {
    expect(failure('{"a": "\\ud800", "b": 1, "b": 2}')).toEqual([
      ["duplicate-member", "/b"],
      ["unpaired-surrogate", "/a"],
    ]);
  });
});

// Each shape guard fires once, and its near miss reads.
describe("the record's shape", () => {
  test.each([
    ["an array", "[1]"],
    ["a string", '"x"'],
    ["a number", "1"],
    ["null", "null"],
  ])("a root that is %s is root-not-object, at the root", (_name, text) => {
    expect(failure(text)).toEqual([["root-not-object", ""]]);
  });

  test("near miss: an empty object is a record", () => {
    expect(record("{}").value).toEqual({});
  });

  test("a root that is not an object still reports the errors inside it", () => {
    expect(failure('[1e400, {"a": 1, "a": 2}]')).toEqual([
      ["duplicate-member", "/1/a"],
      ["number-not-representable", "/0"],
      ["root-not-object", ""],
    ]);
  });

  test("section-title-missing at an item of $sections without $title; near miss: the same item with one", () => {
    expect(failure('{"$sections": [{"$body": "Text."}]}')).toEqual([["section-title-missing", "/$sections/0"]]);
    expect(parse('{"$sections": [{"$title": "S", "$body": "Text."}]}').ok).toBe(true);
  });

  test("ref-malformed for a $ref object with another member, and for a $ref that is not a string", () => {
    expect(failure('{"f": {"$ref": "x.md", "a": 1}}')).toEqual([["ref-malformed", "/f"]]);
    expect(failure('{"f": {"$ref": 1}}')).toEqual([["ref-malformed", "/f"]]);
  });

  test("near misses: a $ref object alone, and $refs, which is an ordinary member inside a field", () => {
    expect(parse('{"f": {"$ref": "x.md"}}').ok).toBe(true);
    expect(parse('{"f": {"$refs": "x.md", "a": 1}}').ok).toBe(true);
  });

  test("dollar-member for $key on a section, and for $schema on an item of $sections", () => {
    expect(failure('{"$key": "k"}')).toEqual([["dollar-member", "/$key"]]);
    expect(failure('{"$sections": [{"$title": "S", "$schema": "s.json"}]}')).toEqual([["dollar-member", "/$sections/0/$schema"]]);
  });

  test("near misses: $schema on the root, and $key inside a field's value", () => {
    expect(parse('{"$schema": "https://example.com/s.json"}').ok).toBe(true);
    expect(parse('{"f": {"$key": "k"}}').ok).toBe(true);
  });

  test("feature-unsupported for another $ member on a section; near miss: the same inside a field's value", () => {
    expect(failure('{"$foo": 1}')).toEqual([["feature-unsupported", "/$foo"]]);
    expect(failure('{"$sections": [{"$title": "S", "$foo": 1}]}')).toEqual([["feature-unsupported", "/$sections/0/$foo"]]);
    expect(parse('{"f": {"$foo": 1}, "g": [{"$foo": 1}]}').ok).toBe(true);
  });

  test("reserved-member-type for a section member of the wrong type", () => {
    expect(failure('{"$title": 1, "$anchor": ["a"]}')).toEqual([
      ["reserved-member-type", "/$anchor"],
      ["reserved-member-type", "/$title"],
    ]);
  });

  test("shape issues point at the member's key", () => {
    expect(onlyIssue('{\n  "$foo": 1}').position).toEqual({ offset: 4, line: 2, col: 3 });
  });

  test("shape issues are reported along with the walk's own", () => {
    expect(failure('{"$foo": 1e400, "a": 1, "a": 2}')).toEqual([
      ["duplicate-member", "/a"],
      ["feature-unsupported", "/$foo"],
      ["number-not-representable", "/$foo"],
    ]);
  });

  test("a validation issue leaves the record readable and stays on it", () => {
    const outcome = parse('{"f": {"$tags": ["a", "a"]}}');
    expect(outcome.ok).toBe(true);
    expect(outcome.issues).toEqual([]);
    expect(issuesOf(outcome)).toEqual([["duplicate-tag", "/f"]]);
  });

  test("every code the JSON parser raises has its Appendix D class", () => {
    const texts = ["", "[1]", '{"a": 1e400, "b": "\\ud800", "c": 1, "c": 2, "$foo": 1, "$key": 1, "f": {"$ref": 1}}'];
    for (const text of texts) {
      const outcome = parse(text);
      const issues = outcome.ok ? outcome.value.issues : outcome.issues;
      for (const issue of issues) expect(ISSUE_CODES[issue.code].classes[0]).toBe(issue.class);
      expect(issues.every((issue) => issue.class === "structural")).toBe(!outcome.ok);
    }
  });
});

describe("the node index", () => {
  test("indexes every node with its kind, key, value range and member range, in UTF-8 bytes", () => {
    const text = '{"é": "€", "a": [true, null, {"k": 1}]} ';
    const parsed = record(text);
    const bytes = encoder.encode(text);
    const slice = (range: { start: number; end: number } | undefined) =>
      range === undefined ? undefined : new TextDecoder().decode(bytes.subarray(range.start, range.end));
    expect(parsed.nodes.node("")).toMatchObject({ kind: "section", range: { start: 0, end: bytes.length }, depth: 0 });
    const expected: [string, string, string, string | undefined][] = [
      ["/é", "string", '"€"', '"é": "€"'],
      ["/a", "array", '[true, null, {"k": 1}]', '"a": [true, null, {"k": 1}]'],
      ["/a/0", "boolean", "true", undefined],
      ["/a/1", "null", "null", undefined],
      ["/a/2", "object", '{"k": 1}', undefined],
      ["/a/2/k", "number", "1", '"k": 1'],
    ];
    for (const [at, kind, range, memberRange] of expected) {
      const node = parsed.nodes.node(at);
      expect(node?.kind).toBe(kind);
      expect(slice(node?.range)).toBe(range);
      expect(slice(node?.memberRange)).toBe(memberRange);
    }
  });

  test("keeps members in source order, which the value's own order does not", () => {
    const parsed = record('{"b": 1, "10": 2, "a": 3, "2": 4}');
    expect(Object.keys(parsed.value)).toEqual(["2", "10", "b", "a"]);
    expect(parsed.nodes.children("").map((node) => node.key)).toEqual(["b", "10", "a", "2"]);
  });

  test("makes the object items of $sections sections, and a $sections inside a field data", () => {
    const parsed = record('{"$sections": [{"$title": "A", "$sections": [{"$title": "B"}]}], "f": {"$sections": [{}]}}');
    expect(parsed.nodes.sections().map((section) => [section.at, section.depth])).toEqual([
      ["", 0],
      ["/$sections/0", 1],
      ["/$sections/0/$sections/0", 2],
    ]);
    expect(parsed.nodes.node("/f/$sections/0")?.kind).toBe("object");
  });

  test("gives the record its path, format and source", () => {
    const parsed = record("{}");
    expect(parsed).toMatchObject({ path: PATH, format: "json" });
    expect(parsed.source.text).toBe("{}");
  });
});
