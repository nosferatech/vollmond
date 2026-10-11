import type { Value, ValueObject } from "./value.js";

/**
 * Serializes a value as the canonical JSON of RFC 8785 (JCS): no white space, object members sorted by the UTF-16 code units
 * of their names, and strings and numbers written as ECMAScript's `JSON.stringify` writes them, so `-0` is written `0`.
 *
 * Throws a `TypeError` for a number that is not finite or a string with an unpaired surrogate, which RFC 8785 requires an
 * implementation to refuse; neither is a value of the data model.
 */
export function canonicalJson(value: Value): string {
  const parts: string[] = [];
  write(value, parts);
  return parts.join("");
}

function write(value: Value, parts: string[]): void {
  if (value === null || typeof value === "boolean") {
    parts.push(String(value));
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`canonical JSON has no form for the number ${value}`);
    parts.push(JSON.stringify(value));
  } else if (typeof value === "string") {
    parts.push(stringLiteral(value));
  } else if (Array.isArray(value)) {
    parts.push("[");
    value.forEach((item, index) => {
      if (index > 0) parts.push(",");
      write(item, parts);
    });
    parts.push("]");
  } else {
    const object = value as ValueObject;
    // The default sort compares UTF-16 code units, which is the order RFC 8785 specifies.
    const names = Object.keys(object).sort();
    parts.push("{");
    names.forEach((name, index) => {
      if (index > 0) parts.push(",");
      parts.push(stringLiteral(name), ":");
      write(object[name] as Value, parts);
    });
    parts.push("}");
  }
}

function stringLiteral(text: string): string {
  if (!text.isWellFormed()) throw new TypeError(`canonical JSON has no form for a string with an unpaired surrogate`);
  return JSON.stringify(text);
}
