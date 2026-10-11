import { describe, expect, test } from "vitest";
import { gitBlobId } from "./blob.js";
import { standardComparison } from "./compare.js";

const { equal, equalUnordered } = standardComparison;

describe("standardComparison", () => {
  test("keeps the JSON types apart", () => {
    expect(equal(true, 1)).toBe(false);
    expect(equal(0, false)).toBe(false);
    expect(equal(null, 0)).toBe(false);
    expect(equal("", null)).toBe(false);
    expect(equal([], {})).toBe(false);
    expect(equal({}, [])).toBe(false);
    expect(equal({ 0: 1 }, [1])).toBe(false);
  });

  test("equates equal values of each type", () => {
    expect(equal(null, null)).toBe(true);
    expect(equal(false, false)).toBe(true);
    expect(equal(-0, 0)).toBe(true);
    expect(equal("é", "é")).toBe(true);
    expect(equal([{ a: [1, { b: null }] }], [{ a: [1, { b: null }] }])).toBe(true);
  });

  test("compares nested objects by every member", () => {
    expect(equal({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(equal({ a: { b: 1 } }, { a: { b: 1, c: null } })).toBe(false);
    expect(equal({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  test("compares arrays by length, so that a prefix differs from the whole", () => {
    expect(equal([1], [1, 2])).toBe(false);
    expect(equal([1, 2], [1])).toBe(false);
    expect(equal([], [null])).toBe(false);
    expect(equal([1, 2], [1, 2])).toBe(true);
  });

  test("never equates a value that is not JSON", () => {
    expect(equal(undefined, undefined)).toBe(false);
  });

  test("compares unordered lists as multisets", () => {
    expect(equalUnordered([{ a: 1 }, { b: 2 }], [{ b: 2 }, { a: 1 }])).toBe(true);
    expect(equalUnordered([1, 1, 2], [1, 2, 2])).toBe(false);
    expect(equalUnordered([1], [1, 1])).toBe(false);
    expect(equalUnordered([], [])).toBe(true);
  });
});

describe("gitBlobId", () => {
  test("gives the ids that git hash-object prints", () => {
    expect(gitBlobId(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(gitBlobId(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
