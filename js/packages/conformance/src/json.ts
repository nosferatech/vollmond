import { visit } from "jsonc-parser";
import { readNumber } from "./number.js";

/** A JSON value as the runner holds it: numbers are doubles, and objects are plain objects with own members. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

/** A JSON object; a member named `__proto__` is an own member like any other. */
export interface JsonObject {
  readonly [name: string]: JsonValue;
}

/** The location of a value in a JSON document, as member names and array indexes from the root. */
export type JsonPath = readonly (string | number)[];

/** Something in a readable JSON document that breaks the suite's reading rules, and where it is. */
export interface JsonProblem {
  readonly path: JsonPath;
  readonly detail: string;
}

/**
 * A JSON document as the runner reads it. A document that is not UTF-8 JSON is not `ok`. A readable one may still have
 * problems, a duplicate member name or a number no double can hold, each at its path, and then holds `null` where such a number
 * was.
 */
export type JsonReading =
  | { readonly ok: true; readonly value: JsonValue; readonly problems: readonly JsonProblem[] }
  | { readonly ok: false; readonly detail: string };

/** The extra argument that `JSON.parse` gives a reviver for a primitive value, which TypeScript's library does not declare. */
interface ReviverContext {
  readonly source?: string;
}

/** A number replaced while parsing, until its path is known. */
class RejectedNumber {
  constructor(readonly detail: string) {}
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Reads a JSON document the way the suite's files are read, independently of the library under test. The bytes must be UTF-8
 * as RFC 8259 defines JSON, with no byte order mark. Duplicate member names are problems, wherever they are, and so are numbers
 * that `readNumber` rejects.
 */
export function readJson(bytes: Uint8Array): JsonReading {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return { ok: false, detail: "the file is not UTF-8" };
  }
  let rejected = false;
  let value: JsonValue;
  try {
    value = JSON.parse(text, (_key: string, item: unknown, context?: ReviverContext) => {
      if (typeof item !== "number" || context?.source === undefined) {
        return item;
      }
      const reading = readNumber(context.source, item);
      if (reading.ok) {
        return reading.value;
      }
      rejected = true;
      return new RejectedNumber(reading.detail);
    }) as JsonValue;
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const problems: JsonProblem[] = [...findDuplicateMembers(text)];
  if (rejected) {
    value = replaceRejectedNumbers(value, [], problems);
  }
  return { ok: true, value, problems };
}

/** Lists every member name that repeats one of an earlier member of the same object, with the duplicate's path. */
function findDuplicateMembers(text: string): JsonProblem[] {
  const problems: JsonProblem[] = [];
  const names: Set<string>[] = [];
  visit(text, {
    onObjectBegin: () => {
      names.push(new Set());
    },
    onObjectEnd: () => {
      names.pop();
    },
    onObjectProperty: (name, _offset, _length, _line, _column, pathSupplier) => {
      const seen = names.at(-1);
      if (seen?.has(name)) {
        problems.push({ path: [...pathSupplier(), name], detail: `the member name ${JSON.stringify(name)} is repeated` });
      }
      seen?.add(name);
    },
  });
  return problems;
}

/** Returns `value` with each rejected number replaced by `null`, and adds a problem for each at its path. */
function replaceRejectedNumbers(value: unknown, path: JsonPath, problems: JsonProblem[]): JsonValue {
  if (value instanceof RejectedNumber) {
    problems.push({ path, detail: value.detail });
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceRejectedNumbers(item, [...path, index], problems));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(([name, item]) => [name, replaceRejectedNumbers(item, [...path, name], problems)]);
    return Object.fromEntries(entries) as JsonObject;
  }
  return value as JsonValue;
}

/** Whether a value is a JSON object, not an array or `null`. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
