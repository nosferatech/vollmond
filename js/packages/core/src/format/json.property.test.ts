import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { ByteRange } from "../text/source-text.js";
import { decodeSource } from "../text/source-text.js";
import { createValueObject, type MutableValueObject, type Value, valuesEqual } from "../value/value.js";
import { parseJsonRecord } from "./json.js";

// Deviation from the I1 design, recorded in issue #11: the value view is not compared with what `JSON.parse` gives, since
// V8's JSON.parse (Node 24.21.0, V8 13.6) misreads an escaped member name after it has read an object with the same earlier
// members and another escaped name: after `JSON.parse('{"a": 1, "\\\\": 2}')`, `JSON.parse('{"a": 1, "\\n": 2}')` names its
// second member "\\". This property found it. So the oracle is the generated value itself, which `JSON.parse` reads the
// same way when it reads correctly, and node ranges are checked against the spans that the printer wrote.

const encoder = new TextEncoder();

/** A value of the data model, as a tree of its printable parts, so that the printer can put white space between tokens. */
type Tree =
  | { readonly kind: "scalar"; readonly value: null | boolean | number | string }
  | { readonly kind: "array"; readonly items: readonly Tree[] }
  | { readonly kind: "object"; readonly members: readonly (readonly [string, Tree])[] };

/** How a tree is printed: the white space between tokens, cycled, and whether every character outside ASCII is escaped. */
interface Printing {
  readonly whiteSpace: readonly string[];
  readonly escapeNonAscii: boolean;
}

/** Where the printer wrote a node: its value's span and, for a member, its key's start, as UTF-16 indexes into the text. */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly keyStart?: number;
}

/** Strings with characters of every UTF-8 length, the characters JSON escapes, and U+FEFF. */
const string = fc.oneof(
  fc.string({ unit: "binary", maxLength: 6 }),
  fc.string({ unit: fc.constantFrom("a", "é", "€", "\u{1f600}", "﻿", '"', "\\", "\n", "\u0000", "/"), maxLength: 6 }),
);

/**
 * Finite doubles whose shortest form, as `JSON.stringify` prints it, reads back as the same double. `JSON.stringify` prints
 * some doubles between 2^53 and 10^21 as integers that are not the double's exact value, such as `123456789012345680000`,
 * and §4.2 makes such an integer by form an error; those are left out here and tested apart.
 */
const double = fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.integer(), fc.maxSafeInteger()).filter((x) => {
  const text = JSON.stringify(x);
  return !/^-?[0-9]+$/.test(text) || BigInt(x) === BigInt(text);
});

/** Member names: none begins with `$`, so that the record's shape holds whatever the values are. */
const name = string.filter((text) => !text.startsWith("$"));

const { tree } = fc.letrec<{ tree: Tree; object: Tree }>((tie) => ({
  tree: fc.oneof(
    { depthSize: "small" },
    fc.oneof(fc.constant(null), fc.boolean(), double, string).map((value): Tree => ({ kind: "scalar", value })),
    fc.array(tie("tree"), { maxLength: 4 }).map((items): Tree => ({ kind: "array", items })),
    tie("object"),
  ),
  object: fc
    .uniqueArray(fc.tuple(name, tie("tree")), { selector: ([key]) => key, maxLength: 4 })
    .map((members): Tree => ({ kind: "object", members })),
}));

const record = fc
  .uniqueArray(fc.tuple(name, tree), { selector: ([key]) => key, maxLength: 5 })
  .map((members): Tree => ({ kind: "object", members }));

const printing = fc.record({
  whiteSpace: fc.array(fc.constantFrom("", " ", "\t", "\n", "\r\n", "\r", " \n\t "), { minLength: 1, maxLength: 20 }),
  escapeNonAscii: fc.boolean(),
});

/** The exact path of a child, written here apart from the parser's own. */
function pointer(parent: string, key: string | number): string {
  return `${parent}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/** Prints a tree as JSON, and returns the text and the span of every node below the root, by exact path. */
function print(root: Tree, { whiteSpace, escapeNonAscii }: Printing): { text: string; spans: Map<string, Span> } {
  let next = 0;
  let text = "";
  const spans = new Map<string, Span>();
  const space = () => {
    text += whiteSpace[next++ % whiteSpace.length] as string;
  };
  const scalar = (item: null | boolean | number | string) => {
    const json = JSON.stringify(item);
    text += escapeNonAscii
      ? json.replace(/[\u0080-\uffff]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
      : json;
  };
  const write = (node: Tree, at: string, keyStart?: number) => {
    const start = text.length;
    if (node.kind === "scalar") {
      scalar(node.value);
    } else if (node.kind === "array") {
      text += "[";
      space();
      node.items.forEach((item, index) => {
        if (index > 0) {
          text += ",";
          space();
        }
        write(item, pointer(at, index));
        space();
      });
      text += "]";
    } else {
      text += "{";
      space();
      node.members.forEach(([key, member], index) => {
        if (index > 0) {
          text += ",";
          space();
        }
        const memberKeyStart = text.length;
        scalar(key);
        space();
        text += ":";
        space();
        write(member, pointer(at, key), memberKeyStart);
        space();
      });
      text += "}";
    }
    if (at !== "") spans.set(at, keyStart === undefined ? { start, end: text.length } : { start, end: text.length, keyStart });
  };
  space();
  write(root, "");
  space();
  return { text, spans };
}

/** The value a tree stands for. */
function treeValue(node: Tree): Value {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "array") return node.items.map(treeValue);
  const object: MutableValueObject = createValueObject();
  for (const [key, member] of node.members) object[key] = treeValue(member);
  return object;
}

describe("property 2: JSON printed with random white space reads as the value printed", () => {
  test("the value view is the printed value, and every node's ranges are the bytes the printer wrote for it", () => {
    fc.assert(
      fc.property(record, printing, fc.boolean(), (root, how, bom) => {
        const { text, spans } = print(root, how);
        const file = bom ? `﻿${text}` : text;
        const bytes = encoder.encode(file);
        const source = decodeSource("p.json", bytes);
        if (!source.ok) throw new Error("not UTF-8");
        const outcome = parseJsonRecord("p.json", source.value);
        if (!outcome.ok) throw new Error(`failed: ${JSON.stringify(outcome.issues)} for ${JSON.stringify(text)}`);
        expect(valuesEqual(outcome.value.value, treeValue(root))).toBe(true);

        // Byte offsets from the encoder, not from the parser's own conversion.
        const offset = bom ? 1 : 0;
        const byteAt = (index: number) => encoder.encode(file.slice(0, offset + index)).length;
        const byteRange = (start: number, end: number): ByteRange => ({ start: byteAt(start), end: byteAt(end) });
        const { nodes } = outcome.value;
        expect(nodes.node("")?.range).toEqual({ start: 0, end: bytes.length });
        const seen = new Set<string>();
        const pending = [...nodes.children("")];
        while (pending.length > 0) {
          const node = pending.pop();
          if (node === undefined) break;
          seen.add(node.at);
          const span = spans.get(node.at);
          if (span === undefined) throw new Error(`no node was printed at ${node.at}`);
          expect(node.range).toEqual(byteRange(span.start, span.end));
          expect(node.memberRange).toEqual(span.keyStart === undefined ? undefined : byteRange(span.keyStart, span.end));
          pending.push(...nodes.children(node.at));
        }
        expect([...seen].sort()).toEqual([...spans.keys()].sort());
      }),
      { numRuns: 1000 },
    );
  });
});

/** The characters and short strings that random texts near JSON are made of. */
const nearJsonPart = fc.constantFrom(
  "{",
  "}",
  "[",
  "]",
  ":",
  ",",
  '"',
  "\\",
  "0",
  "1",
  "9",
  "-",
  "+",
  ".",
  "e",
  "E",
  "true",
  "false",
  "null",
  "nul",
  "a",
  " ",
  "\t",
  "\n",
  "\r",
  "\u000b",
  " ",
  " ",
  "﻿",
  "é",
  "\u{1f600}",
  "\u0001",
  "/",
  "*",
  "\\u",
  "\\ud800",
  "\\u00",
  "NaN",
  "Infinity",
  "'",
  '"a"',
  '"a":',
  "01",
  "1e5",
  "1.5",
  "-0",
);

/** A text near JSON: random parts, or a JSON record with one part inserted, replaced or deleted. */
const nearJson = fc.oneof(
  fc.array(nearJsonPart, { maxLength: 30 }).map((parts) => parts.join("")),
  fc
    .tuple(record, printing, fc.nat(), nearJsonPart, fc.constantFrom("insert", "replace", "delete"))
    .map(([root, how, at, part, edit]) => {
      const { text } = print(root, how);
      const i = at % text.length;
      if (edit === "insert") return text.slice(0, i) + part + text.slice(i);
      if (edit === "replace") return text.slice(0, i) + part + text.slice(i + 1);
      return text.slice(0, i) + text.slice(i + 1);
    }),
);

describe("strict JSON: the parser refuses exactly what JSON.parse refuses", () => {
  test("a text near JSON is one syntax-error, and nothing else, exactly when JSON.parse throws on it without its BOM", () => {
    fc.assert(
      fc.property(nearJson, fc.boolean(), (text, bom) => {
        const source = decodeSource("p.json", encoder.encode(bom ? `﻿${text}` : text));
        if (!source.ok) throw new Error("not UTF-8");
        // The decoded text, since cutting a surrogate pair in two leaves a U+FFFD there.
        const decoded = source.value.text;
        let jsonParseThrows = false;
        try {
          JSON.parse(source.value.hasBom ? decoded.slice(1) : decoded);
        } catch {
          jsonParseThrows = true;
        }
        const outcome = parseJsonRecord("p.json", source.value);
        const issues = outcome.ok ? outcome.value.issues : outcome.issues;
        expect(issues.filter((issue) => issue.code === "syntax-error")).toHaveLength(jsonParseThrows ? 1 : 0);
        if (jsonParseThrows) expect(issues).toHaveLength(1);
      }),
      { numRuns: 5000 },
    );
  });
});
