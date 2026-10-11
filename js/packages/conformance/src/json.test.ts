import { describe, expect, test } from "vitest";
import { readJson } from "./json.js";
import { readNumber } from "./number.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("readNumber", () => {
  test.each([
    ["9007199254740993", "has no exact double"],
    ["12345678901234567890", "has no exact double"],
    ["-9007199254740993", "has no exact double"],
    ["1e400", "too large"],
    [`1${"0".repeat(400)}`, "too large"],
    ["1e-400", "its double is"],
    ["-1e-400", "its double is"],
  ])("rejects %s", (source, detail) => {
    const reading = readNumber(source, JSON.parse(source));
    expect(reading.ok).toBe(false);
    expect(reading.ok ? "" : reading.detail).toContain(detail);
  });

  test.each([
    ["9007199254740992", 9007199254740992],
    ["1152921504606846976", 2 ** 60],
    ["1e23", 1e23],
    ["9007199254740993.0", 9007199254740992],
    ["0.10000000000000001", 0.1],
    ["5e-324", 5e-324],
    ["0e10", 0],
    ["0.000", 0],
  ])("reads %s as its nearest double", (source, value) => {
    expect(readNumber(source, JSON.parse(source))).toEqual({ ok: true, value });
  });

  test("reads -0 as 0", () => {
    const reading = readNumber("-0", -0);
    expect(reading.ok && Object.is(reading.value, 0)).toBe(true);
  });
});

describe("readJson", () => {
  test("reads a document without problems", () => {
    expect(readJson(bytes('{"a": [1, 1.5, "x", null, true], "b": {"c": -0}}'))).toEqual({
      ok: true,
      value: { a: [1, 1.5, "x", null, true], b: { c: 0 } },
      problems: [],
    });
  });

  test("gives a number no double can hold as a problem at its path, and null in its place", () => {
    expect(readJson(bytes('{"cases": [{"input": {"a": [1, 9007199254740993]}}]}'))).toEqual({
      ok: true,
      value: { cases: [{ input: { a: [1, null] } }] },
      problems: [{ path: ["cases", 0, "input", "a", 1], detail: "the integer 9007199254740993 has no exact double" }],
    });
  });

  test("gives a repeated member name as a problem at its path, also when one is escaped", () => {
    const reading = readJson(bytes('{"cases": [{"id": "x", "input": {"a": 1, "\\u0061": 2}}], "b": {"c": 1, "c": 2}}'));
    expect(reading.ok && reading.problems.map((problem) => problem.path)).toEqual([
      ["cases", 0, "input", "a"],
      ["b", "c"],
    ]);
  });

  test("accepts the same member name in two objects", () => {
    const reading = readJson(bytes('[{"a": 1}, {"a": 2}, {"b": {"a": 3}, "a": 4}]'));
    expect(reading.ok && reading.problems).toEqual([]);
  });

  test("keeps a member named __proto__ as an own member", () => {
    const reading = readJson(bytes('{"__proto__": {"x": 1}}'));
    expect(reading.ok && Object.keys(reading.value as object)).toEqual(["__proto__"]);
  });

  test("rejects a file that is not UTF-8", () => {
    expect(readJson(new Uint8Array([0x22, 0xff, 0x22]))).toEqual({ ok: false, detail: "the file is not UTF-8" });
  });

  test("rejects a byte order mark, which RFC 8259 JSON does not start with", () => {
    expect(readJson(bytes("﻿{}")).ok).toBe(false);
    expect(readJson(bytes("{}")).ok).toBe(true);
  });

  test("rejects what JSON.parse rejects, such as a comment", () => {
    expect(readJson(bytes('{"a": 1 // no\n}')).ok).toBe(false);
  });
});
