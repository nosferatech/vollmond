import { describe, expect, test } from "vitest";
import { jcs } from "./jcs.js";
import { createValueObject, hasMember, isValue, type Value, valuesEqual } from "./value.js";

/** Builds a null-prototype object from entries, as parsers do. */
function object(entries: readonly (readonly [string, Value])[]): Value {
  const result = createValueObject();
  for (const [name, value] of entries) result[name] = value;
  return result;
}

describe("a __proto__ member", () => {
  test("is an ordinary member of a value object", () => {
    const withProto = object([["__proto__", 1]]);
    expect(Object.keys(withProto as object)).toEqual(["__proto__"]);
    expect(hasMember(withProto as never, "__proto__")).toBe(true);
    expect(jcs(withProto)).toBe('{"__proto__":1}');
  });

  test("is not found in an object that only inherits __proto__", () => {
    expect(hasMember({} as never, "__proto__")).toBe(false);
  });

  test("makes objects unequal to one without it, even when the other inherits a __proto__ that looks empty", () => {
    // `{}.__proto__` is Object.prototype, which has no enumerable members, so a check by `in` and lookup would call these equal.
    const withProto = object([
      ["__proto__", object([])],
      ["x", 1],
    ]);
    const withoutProto: Value = { x: 1, y: 2 };
    expect(valuesEqual(withProto, withoutProto)).toBe(false);
    expect(valuesEqual(withoutProto, withProto)).toBe(false);
  });
});

describe("valuesEqual", () => {
  test("compares numbers by value, so -0 equals 0", () => {
    expect(valuesEqual(-0, 0)).toBe(true);
    expect(valuesEqual(0.1, 0.10000000000000001)).toBe(true);
    expect(valuesEqual(1, 1.5)).toBe(false);
  });

  test("ignores member order", () => {
    expect(valuesEqual({ a: 1, b: [true, null] }, { b: [true, null], a: 1 })).toBe(true);
    expect(valuesEqual(object([["a", 1]]), { a: 1 })).toBe(true);
  });

  test("keeps array order and length", () => {
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
    expect(valuesEqual([1], [1, 1])).toBe(false);
    expect(valuesEqual([], [])).toBe(true);
  });

  test("tells the types apart", () => {
    const values: Value[] = [null, false, 0, "", [], {}, "0", "null", [null], { "": null }];
    for (const [i, a] of values.entries()) {
      for (const [j, b] of values.entries()) expect(valuesEqual(a, b)).toBe(i === j);
    }
    expect(valuesEqual(true, 1)).toBe(false);
    expect(valuesEqual([], {})).toBe(false);
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valuesEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });
});

describe("isValue", () => {
  test("accepts the data model, noncharacters included", () => {
    expect(isValue({ a: [1, "\u{FFFF}", "\u{FDD0}", "\u{1F600}", null, true], b: { c: -0 } })).toBe(true);
    expect(isValue(object([["__proto__", 1]]))).toBe(true);
  });

  test("accepts plain and null-prototype objects, parsed JSON, and arrays whose items are all present", () => {
    expect(isValue(JSON.parse('{"a":[1,{"b":null}],"__proto__":2}'))).toBe(true);
    expect(isValue(Object.create(null))).toBe(true);
    expect(isValue([undefined].map(() => 1))).toBe(true);
    expect(isValue(Array.from({ length: 3 }, () => null))).toBe(true);
    expect(isValue([])).toBe(true);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["an unpaired surrogate", "\uD800"],
    ["an unpaired surrogate in a name", { "\uDC00": 1 }],
    ["undefined", undefined],
    ["a bigint", 1n],
    ["a function", () => 1],
    ["a nested NaN", [{ a: Number.NaN }]],
    ["a symbol-keyed member", { [Symbol("s")]: 1 }],
    ["an accessor", Object.defineProperty({}, "a", { get: () => 1, enumerable: true })],
    ["a non-enumerable member", Object.defineProperty({}, "a", { value: 1, enumerable: false })],
    ["a Date", new Date(0)],
    ["a Map", new Map([["a", 1]])],
    ["a Uint8Array", new Uint8Array([1])],
    ["a class instance", new (class Point {})()],
    ["an object with another prototype", Object.create({ inherited: 1 })],
    // biome-ignore lint/suspicious/noSparseArray: the hole is the point.
    ["an array with a hole", [1, , 2]],
    ["an array of length 2 without items", new Array(2)],
    ["an array subclass", new (class List extends Array {})()],
  ])("refuses %s", (_name, value) => {
    expect(isValue(value)).toBe(false);
  });
});
