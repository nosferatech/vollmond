import { describe, expect, test } from "vitest";
import { canonicalJson } from "./canonical-json.js";
import type { Value } from "./value.js";

/** The double whose IEEE 754 bits are the 16 hexadecimal digits `bits`, as RFC 8785's Appendix B gives them. */
function doubleFromBits(bits: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${bits}`));
  return view.getFloat64(0);
}

/** Reads JSON text in which each backslash is written as `~`, so that escapes stay as the RFC writes them. */
function parseTilde(text: string): Value {
  return JSON.parse(text.replaceAll("~", "\\")) as Value;
}

describe("RFC 8785", () => {
  // Appendix B, "Number Serialization Samples", every row with a JSON representation.
  test.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ])("Appendix B: %s is written %s", (bits, written) => {
    expect(canonicalJson(doubleFromBits(bits))).toBe(written);
  });

  // Appendix B's NaN and Infinity rows have no representation, and section 3.2.2.3 requires an error.
  test.each([
    ["7fffffffffffffff", "NaN"],
    ["7ff0000000000000", "Infinity"],
    ["fff0000000000000", "-Infinity"],
  ])("Appendix B: %s (%s) is refused", (bits) => {
    expect(() => canonicalJson(doubleFromBits(bits))).toThrow(TypeError);
    expect(() => canonicalJson([1, { a: doubleFromBits(bits) }])).toThrow(TypeError);
  });

  // Section 3.2.2.2: a lone surrogate must make the implementation fail.
  test("refuses an unpaired surrogate in a string or a member name, and writes a pair as its character", () => {
    expect(() => canonicalJson(String.fromCharCode(0xdead))).toThrow(TypeError);
    expect(() => canonicalJson({ [String.fromCharCode(0xd800)]: 1 })).toThrow(TypeError);
    expect(canonicalJson(String.fromCharCode(0xd83d, 0xde00))).toBe('"\u{1F600}"');
  });

  // Sections 3.2.2 and 3.2.3: the sample object, parsed, then canonicalized.
  const sample = parseTilde(`{
    "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
    "string": "~u20ac$~u000F~u000aA'~u0042~u0022~u005c~~~"~/",
    "literals": [null, true, false]
  }`);
  const canonicalSample =
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u{20AC}$~u000f~nA\'B~"~~~~~"/"}'.replaceAll(
      "~",
      "\\",
    );

  test("section 3.2.3: the sample is sorted and its primitives written canonically", () => {
    expect(canonicalJson(sample)).toBe(canonicalSample);
  });

  test("section 3.2.4: the sample's UTF-8 bytes", () => {
    const expected = `
      7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72
      75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a
      5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31
      65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37
      5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30
      30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d`
      .trim()
      .split(/\s+/)
      .map((byte) => Number.parseInt(byte, 16));
    expect([...new TextEncoder().encode(canonicalJson(sample))]).toEqual(expected);
  });

  test("section 3.2.3: properties are sorted by UTF-16 code units", () => {
    const value = parseTilde(`{
      "~u20ac": "Euro Sign",
      "~r": "Carriage Return",
      "~ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "~ud83d~ude00": "Emoji: Grinning Face",
      "~u0080": "Control",
      "~u00f6": "Latin Small Letter O With Diaeresis"
    }`);
    const order = [...canonicalJson(value).matchAll(/:"([^"]*)"/g)].map((match) => match[1]);
    expect(order).toEqual([
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ]);
  });

  test("section 3.2.3: names sort as the RFC's plain-English example", () => {
    expect(canonicalJson({ ab: 1, aa: 2, a: 3, "": 4 })).toBe('{"":4,"a":3,"aa":2,"ab":1}');
  });
});

describe("canonicalJson", () => {
  test("sorts nested objects and keeps array order", () => {
    expect(canonicalJson({ b: [{ z: 1, y: 2 }, 3], a: { d: null, c: "x" } })).toBe(
      '{"a":{"c":"x","d":null},"b":[{"y":2,"z":1},3]}',
    );
  });

  test("writes integer-valued doubles beyond 2^53 as JSON.stringify does, not in the record writer's exponent form", () => {
    expect(canonicalJson(2 ** 60)).toBe("1152921504606847000");
    expect(canonicalJson(1e21)).toBe("1e+21");
  });
});
