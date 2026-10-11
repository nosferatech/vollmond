/** The syntax a number literal was written in, which decides which literals are integers by form. */
export type NumberSyntax = "json" | "yaml";

/** Why a number literal has no value: a double cannot hold it. */
export type NotRepresentableReason =
  /** An integer by form whose nearest double is a different integer. */
  | "integer-changed"
  /** A literal whose magnitude is too large for a double. */
  | "overflow"
  /** A non-zero literal that a double rounds to zero. */
  | "underflow";

/** What a number literal reads as: its nearest double, or the reason that it is not representable. */
export type NumberLiteralReading =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "not-representable"; readonly reason: NotRepresentableReason };

const JSON_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;
// The YAML 1.2.2 core schema's integer and float forms; `.inf` and `.nan` are not numbers here.
const YAML_INTEGER = /^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$/;
const YAML_FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;

/**
 * Reads a number literal as the value view holds it. A number means its nearest double, and `-0` reads as `0`. It is not
 * representable when it is an integer by form (written with its syntax's integer form: no fraction and no exponent, and in
 * YAML also a leading `+` and the `0o` and `0x` forms) whose double differs from it, when it is too large for a double, or when
 * it is not zero and its double is.
 *
 * Throws a `RangeError` when `literal` is not a number in `syntax`: callers pass the source text of a number their parser read.
 * In YAML, `.inf` and `.nan` are therefore the caller's to report.
 */
export function readNumberLiteral(literal: string, syntax: NumberSyntax): NumberLiteralReading {
  const isInteger = syntax === "json" ? JSON_INTEGER.test(literal) : YAML_INTEGER.test(literal);
  if (!isInteger && !(syntax === "json" ? JSON_NUMBER : YAML_FLOAT).test(literal)) {
    throw new RangeError(`not a ${syntax === "json" ? "JSON" : "YAML"} number literal: ${JSON.stringify(literal)}`);
  }
  const double = Number(literal);
  // Infinity first: `BigInt(Infinity)` throws.
  if (!Number.isFinite(double)) return { kind: "not-representable", reason: "overflow" };
  if (isInteger) {
    // `BigInt` reads the `0x` and `0o` forms and a leading `+` itself.
    if (BigInt(double) !== BigInt(literal)) return { kind: "not-representable", reason: "integer-changed" };
  } else if (double === 0 && hasNonZeroMantissa(literal)) {
    return { kind: "not-representable", reason: "underflow" };
  }
  return { kind: "number", value: double === 0 ? 0 : double };
}

/** Whether a decimal literal has a non-zero digit before its exponent. */
function hasNonZeroMantissa(literal: string): boolean {
  for (const character of literal) {
    if (character === "e" || character === "E") return false;
    if (character >= "1" && character <= "9") return true;
  }
  return false;
}
