import { type Node, type ParseError, parseTree } from "jsonc-parser";
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

/** What a walk of a syntax tree needs besides the node: the document's text, and the problems found so far. */
interface TreeWalk {
  readonly text: string;
  readonly problems: JsonProblem[];
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
  // JSON.parse only decides what is JSON, and its value is not used: Node 24.21.0's JSON.parse can misread an escaped member
  // name after parsing a similar one. The value is built from jsonc-parser's tree.
  try {
    JSON.parse(text);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  if (root === undefined || errors.length > 0) {
    return { ok: false, detail: "jsonc-parser cannot read what JSON.parse reads" };
  }
  const problems: JsonProblem[] = [];
  return { ok: true, value: buildValue(root, [], { text, problems }), problems };
}

/**
 * Builds the value of a node of a syntax tree without errors. A repeated member name is a problem, and keeps the first member's
 * place and the last one's value, as `JSON.parse` does. A number that `readNumber` rejects is a problem, and `null`.
 */
function buildValue(node: Node, path: JsonPath, walk: TreeWalk): JsonValue {
  switch (node.type) {
    case "object": {
      const object: Record<string, JsonValue> = {};
      for (const [name, item] of (node.children ?? []).map(readMember)) {
        if (Object.hasOwn(object, name)) {
          walk.problems.push({ path: [...path, name], detail: `the member name ${JSON.stringify(name)} is repeated` });
        }
        // defineProperty, since assigning to `__proto__` would set the prototype instead of making an own member.
        const value = buildValue(item, [...path, name], walk);
        Object.defineProperty(object, name, { value, enumerable: true, writable: true, configurable: true });
      }
      return object;
    }
    case "array":
      return (node.children ?? []).map((item, index) => buildValue(item, [...path, index], walk));
    case "number": {
      const source = walk.text.slice(node.offset, node.offset + node.length);
      const reading = readNumber(source, Number(source));
      if (reading.ok) {
        return reading.value;
      }
      walk.problems.push({ path, detail: reading.detail });
      return null;
    }
    default:
      return node.value as JsonValue;
  }
}

/** Returns the name and the value node of a member node of a syntax tree without errors. */
function readMember(property: Node): [string, Node] {
  const [key, item] = property.children ?? [];
  if (key === undefined || item === undefined || typeof key.value !== "string") {
    throw new Error("a member of a syntax tree without errors has a name and a value");
  }
  return [key.value, item];
}

/** Whether a value is a JSON object, not an array or `null`. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
