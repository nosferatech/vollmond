import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { type NumberLiteralReading, readNumberLiteral } from "./number.js";

const number = (value: number): NumberLiteralReading => ({ kind: "number", value });
const notRepresentable = (reason: "integer-changed" | "overflow" | "underflow"): NumberLiteralReading => ({
  kind: "not-representable",
  reason,
});

describe("readNumberLiteral, examples of §4.2", () => {
  test.each([
    ["1", 1],
    ["1.0", 1],
    ["10e-1", 1],
    ["0.1", 0.1],
    ["0.10000000000000001", 0.1],
    ["1e23", 1e23],
    ["9007199254740993.0", 9007199254740992],
    ["9007199254740991", 9007199254740991],
    ["-9007199254740991", -9007199254740991],
    ["1152921504606846976", 2 ** 60],
    ["5e-324", 5e-324],
    ["3e-324", 5e-324],
    ["1.7976931348623157e308", Number.MAX_VALUE],
    ["1.7976931348623158e308", Number.MAX_VALUE],
    ["0e999999", 0],
    ["0.0e-400", 0],
  ])("JSON %s reads as %d", (literal, value) => {
    expect(readNumberLiteral(literal, "json")).toEqual(number(value));
  });

  test.each([
    ["9007199254740993", "integer-changed"],
    ["-9007199254740993", "integer-changed"],
    ["12345678901234567890", "integer-changed"],
    ["1152921504606846977", "integer-changed"],
    ["1e400", "overflow"],
    ["-1e400", "overflow"],
    ["1.7976931348623159e308", "overflow"],
    ["1e-400", "underflow"],
    ["-1e-400", "underflow"],
    ["2e-324", "underflow"],
  ] as const)("JSON %s is not representable: %s", (literal, reason) => {
    expect(readNumberLiteral(literal, "json")).toEqual(notRepresentable(reason));
  });

  test("an integer by form too large for a double is an overflow, not a thrown BigInt(Infinity)", () => {
    const literal = `1${"0".repeat(400)}`;
    expect(readNumberLiteral(literal, "json")).toEqual(notRepresentable("overflow"));
    expect(readNumberLiteral(`-${literal}`, "json")).toEqual(notRepresentable("overflow"));
    expect(readNumberLiteral(`+${literal}`, "yaml")).toEqual(notRepresentable("overflow"));
    expect(readNumberLiteral(`0x${"f".repeat(300)}`, "yaml")).toEqual(notRepresentable("overflow"));
  });

  test("the largest integer that rounds to the largest double is integer-changed, the next one an overflow", () => {
    // Integers below 2^1024 - 2^970 round to Number.MAX_VALUE; from there on they round to infinity.
    const threshold = 2n ** 1024n - 2n ** 970n;
    expect(readNumberLiteral((threshold - 1n).toString(), "json")).toEqual(notRepresentable("integer-changed"));
    expect(readNumberLiteral(threshold.toString(), "json")).toEqual(notRepresentable("overflow"));
    expect(readNumberLiteral(BigInt(Number.MAX_VALUE).toString(), "json")).toEqual(number(Number.MAX_VALUE));
  });

  test("-0 reads as 0", () => {
    for (const literal of ["-0", "-0.0", "-0e5"]) {
      const reading = readNumberLiteral(literal, "json");
      expect(reading.kind).toBe("number");
      expect(Object.is(reading.kind === "number" ? reading.value : Number.NaN, 0)).toBe(true);
    }
    const yaml = readNumberLiteral("-0", "yaml");
    expect(Object.is(yaml.kind === "number" ? yaml.value : Number.NaN, 0)).toBe(true);
  });
});

describe("readNumberLiteral, YAML forms", () => {
  test.each([
    ["+1", 1],
    ["007", 7],
    ["-007", -7],
    ["0o17", 15],
    ["0x1F", 31],
    ["0x1f", 31],
    [".5", 0.5],
    ["+.5", 0.5],
    ["-.5e3", -500],
    ["5.", 5],
    ["1E3", 1000],
    ["0x1FFFFFFFFFFFFF", 2 ** 53 - 1],
  ])("YAML %s reads as %d", (literal, value) => {
    expect(readNumberLiteral(literal, "yaml")).toEqual(number(value));
  });

  test.each([
    ["+9007199254740993", "integer-changed"],
    ["0x20000000000001", "integer-changed"],
    ["0o400000000000000001", "integer-changed"],
    ["00000009007199254740993", "integer-changed"],
    [".1e-400", "underflow"],
    ["1.e400", "overflow"],
  ] as const)("YAML %s is not representable: %s", (literal, reason) => {
    expect(readNumberLiteral(literal, "yaml")).toEqual(notRepresentable(reason));
  });

  test("YAML forms that are not integers by form mean their nearest double", () => {
    expect(readNumberLiteral("9007199254740993.", "yaml")).toEqual(number(9007199254740992));
    expect(readNumberLiteral("9007199254740993e0", "yaml")).toEqual(number(9007199254740992));
  });
});

describe("readNumberLiteral, literals outside the syntax", () => {
  test.each([
    ["json", "+1"],
    ["json", ".5"],
    ["json", "01"],
    ["json", "1."],
    ["json", "0x1F"],
    ["json", "NaN"],
    ["json", "Infinity"],
    ["json", ""],
    ["json", " 1"],
    ["yaml", ".inf"],
    ["yaml", ".nan"],
    ["yaml", "-0x1F"],
    ["yaml", "0b101"],
    ["yaml", "0O17"],
    ["yaml", "1_000"],
    ["yaml", "."],
  ] as const)("%s %j is a caller's error", (syntax, literal) => {
    expect(() => readNumberLiteral(literal, syntax)).toThrow(RangeError);
  });

  test("the near misses of those literals read", () => {
    expect(readNumberLiteral("1", "json")).toEqual(number(1));
    expect(readNumberLiteral("0.5", "json")).toEqual(number(0.5));
    expect(readNumberLiteral("+1", "yaml")).toEqual(number(1));
    expect(readNumberLiteral("0o17", "yaml")).toEqual(number(15));
  });
});

// Property test 1 of the I1 design: integers by form against exact BigInt arithmetic, other literals against `Number`.

/** Whether the integer `n` is exactly a double, by its bits rather than by `Number`. */
function isExactDouble(n: bigint): boolean {
  let magnitude = n < 0n ? -n : n;
  if (magnitude === 0n) return true;
  if (magnitude.toString(2).length > 1024) return false;
  while ((magnitude & 1n) === 0n) magnitude >>= 1n;
  return magnitude.toString(2).length <= 53;
}

/** What §4.2 says an integer literal with the exact value `n` reads as, computed without `Number` for the decision. */
function expectedForInteger(n: bigint): NumberLiteralReading {
  const magnitude = n < 0n ? -n : n;
  if (magnitude >= 2n ** 1024n - 2n ** 970n) return notRepresentable("overflow");
  if (!isExactDouble(n)) return notRepresentable("integer-changed");
  return number(n === 0n ? 0 : Number(n));
}

/** What §4.2 says a literal that is not an integer by form reads as. */
function expectedForFraction(literal: string): NumberLiteralReading {
  const double = Number(literal);
  if (!Number.isFinite(double)) return notRepresentable("overflow");
  const mantissa = literal.split(/[eE]/)[0] ?? "";
  if (double === 0 && /[1-9]/.test(mantissa)) return notRepresentable("underflow");
  return number(double === 0 ? 0 : double);
}

const digit = fc.constantFrom(..."0123456789");
const nonZeroDigit = fc.constantFrom(..."123456789");
const hexDigit = fc.constantFrom(..."0123456789abcdefABCDEF");
const octalDigit = fc.constantFrom(..."01234567");
/** Digit counts that cover short literals, the edge of 2^53 (16 digits), and 400-digit literals that overflow. */
const digitCount = fc.oneof(
  fc.integer({ min: 1, max: 20 }),
  fc.integer({ min: 15, max: 20 }),
  fc.integer({ min: 300, max: 400 }),
);
const digits = (unit: fc.Arbitrary<string>) =>
  digitCount.chain((length) => fc.string({ unit, minLength: length, maxLength: length }));

/** Decimal integers without leading zeros, of any length, and integers near powers of two, where doubles stop being exact. */
const decimalInteger = fc.oneof(
  fc.tuple(nonZeroDigit, digits(digit)).map(([first, rest]) => first + rest),
  fc.constant("0"),
  fc.tuple(fc.integer({ min: 50, max: 1030 }), fc.bigInt({ min: -(2n ** 12n), max: 2n ** 12n })).map(([exponent, offset]) => {
    const n = 2n ** BigInt(exponent) + offset;
    return (n < 0n ? -n : n).toString();
  }),
  fc
    .tuple(fc.bigInt({ min: 1n, max: 2n ** 53n }), fc.integer({ min: 0, max: 980 }))
    .map(([odd, shift]) => (odd << BigInt(shift)).toString()),
);

const jsonInteger = fc.tuple(fc.boolean(), decimalInteger).map(([negative, n]) => (negative ? `-${n}` : n));
/** An exponent part, `e` or `E` with an optional sign, reaching past the range of doubles. */
const exponentPart = fc
  .tuple(fc.constantFrom("e", "E"), fc.constantFrom("", "+", "-"), fc.oneof(fc.nat({ max: 30 }), fc.nat({ max: 420 })))
  .map(([e, sign, n]) => `${e}${sign}${n}`);
const jsonFraction = fc
  .tuple(jsonInteger, digits(digit), fc.option(exponentPart))
  .map(([integer, fraction, e]) => `${integer}.${fraction}${e ?? ""}`);
const jsonExponentOnly = fc.tuple(jsonInteger, exponentPart).map(([integer, e]) => integer + e);

const yamlSign = fc.constantFrom("", "+", "-");
const yamlDecimalInteger = fc
  .tuple(yamlSign, fc.string({ unit: fc.constant("0"), maxLength: 3 }), decimalInteger)
  .map(([sign, zeros, n]) => sign + zeros + n);
const yamlOctal = digits(octalDigit).map((d) => `0o${d}`);
const yamlHex = digits(hexDigit).map((d) => `0x${d}`);
const yamlFloat = fc
  .tuple(
    yamlSign,
    fc.oneof(
      digits(digit).map((d) => `.${d}`),
      fc
        .tuple(digits(digit), fc.option(fc.option(digits(digit))))
        .map(([integer, fraction]) => (fraction === null ? integer : `${integer}.${fraction ?? ""}`)),
    ),
    fc.option(exponentPart),
  )
  // A float without a dot or an exponent is an integer by form, which the other generators cover.
  .filter(([, mantissa, e]) => mantissa.includes(".") || e !== null)
  .map(([sign, mantissa, e]) => sign + mantissa + (e ?? ""));

describe("property 1: number literals agree with BigInt for integers by form and with Number otherwise", () => {
  test("JSON integers by form", () => {
    fc.assert(
      fc.property(jsonInteger, (literal) => {
        expect(readNumberLiteral(literal, "json")).toEqual(expectedForInteger(BigInt(literal)));
      }),
      { numRuns: 2000 },
    );
  });

  test("JSON numbers with a fraction or an exponent", () => {
    fc.assert(
      fc.property(fc.oneof(jsonFraction, jsonExponentOnly), (literal) => {
        expect(readNumberLiteral(literal, "json")).toEqual(expectedForFraction(literal));
      }),
      { numRuns: 2000 },
    );
  });

  test("YAML integers by form: decimal with sign and leading zeros, octal, hexadecimal", () => {
    fc.assert(
      fc.property(fc.oneof(yamlDecimalInteger, yamlOctal, yamlHex), (literal) => {
        const exact = literal.startsWith("-") ? -BigInt(literal.slice(1)) : BigInt(literal.replace(/^\+/, ""));
        expect(readNumberLiteral(literal, "yaml")).toEqual(expectedForInteger(exact));
      }),
      { numRuns: 2000 },
    );
  });

  test("YAML floats", () => {
    fc.assert(
      fc.property(yamlFloat, (literal) => {
        expect(readNumberLiteral(literal, "yaml")).toEqual(expectedForFraction(literal));
      }),
      { numRuns: 2000 },
    );
  });

  test("the generators reach 400-digit literals and every outcome", () => {
    const samples = fc.sample(
      fc.oneof(
        jsonInteger.map((literal) => [literal, "json"] as const),
        jsonFraction.map((literal) => [literal, "json"] as const),
        yamlHex.map((literal) => [literal, "yaml"] as const),
      ),
      3000,
    );
    expect(samples.some(([literal]) => literal.replace(/[^0-9a-fA-F]/g, "").length >= 400)).toBe(true);
    const outcomes = new Set(
      samples.map(([literal, syntax]) => {
        const reading = readNumberLiteral(literal, syntax);
        return reading.kind === "number" ? "number" : reading.reason;
      }),
    );
    expect([...outcomes].sort()).toEqual(["integer-changed", "number", "overflow", "underflow"]);
  });
});
