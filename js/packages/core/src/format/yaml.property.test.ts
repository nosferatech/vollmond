import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { parse as parseWithLibrary, stringify } from "yaml";
import type { Value, ValueObject } from "../value/value.js";
import { valuesEqual } from "../value/value.js";
import { parseRecord } from "./parse-record.js";

// Values of the data model that a YAML writer prints in forms vmd reads back. Two exclusions are vmd's rules, not the
// generator's convenience: a raw U+FFFE or U+FFFF is a syntax error in YAML, and the yaml package writes them raw; and an
// integer-valued double from 2^53 to 1e21 is printed as an integer by form that the double does not equal (2^60 as
// 1152921504606847000), which is not representable. Names beginning with `$` are section syntax, which the shape tests cover.
const text = fc.oneof(
  fc.string({ unit: "binary", maxLength: 12 }).filter((s) => s.isWellFormed() && !/[￾￿]/.test(s)),
  // Words, which the writer folds over several lines when they pass its line width.
  fc
    .array(fc.constantFrom("word", "été", "\u{1F600}", "a\u007Fb", "x﻿y", "tab\t"), { maxLength: 20 })
    .map((words) => words.join(" ")),
);
const name = text.filter((s) => !s.startsWith("$") && s !== "__proto__");
const number = fc.oneof(
  fc.integer(),
  fc.maxSafeInteger(),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .filter((x) => !(Number.isInteger(x) && Math.abs(x) >= 2 ** 53 && Math.abs(x) < 1e21)),
);
const { value: dataValue } = fc.letrec<{ value: unknown; object: Record<string, unknown> }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constant(null),
    fc.boolean(),
    number,
    text,
    fc.array(tie("value"), { maxLength: 4 }),
    tie("object"),
  ),
  object: fc.dictionary(name, tie("value"), { maxKeys: 4 }),
}));
const root = fc.dictionary(name, dataValue, { maxKeys: 5 });
const lineBreak = fc.constantFrom("\n", "\r\n", "\r");

/** The value at an exact path, from the root. */
function valueAt(rootValue: Value, at: string): Value {
  let current = rootValue;
  for (const token of at.split("/").slice(1)) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    current = Array.isArray(current) ? (current[Number(key)] as Value) : ((current as ValueObject)[key] as Value);
  }
  return current;
}

/** Whether a value holds -0 anywhere. */
function holdsNegativeZero(value: Value): boolean {
  if (Object.is(value, -0)) return true;
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some(holdsNegativeZero);
}

describe("property: YAML that the yaml package writes reads back", () => {
  test("to the value written, -0 as 0, with each node's range slicing to text that reads as the node", () => {
    fc.assert(
      fc.property(
        root,
        lineBreak,
        fc.integer({ min: 20, max: 80 }),
        fc.integer({ min: 2, max: 4 }),
        (value, eol, width, indent) => {
          const printed = stringify(value, {
            defaultStringType: "QUOTE_DOUBLE",
            defaultKeyType: "QUOTE_DOUBLE",
            lineWidth: width,
            indent,
          }).replaceAll("\n", eol);
          // The yaml package (2.9.1) can fold a double-quoted line between the two halves of a surrogate pair, writing text
          // that is not well formed, which no UTF-8 file holds. That is the writer's bug, so such a case is not run.
          fc.pre(printed.isWellFormed());
          const bytes = new TextEncoder().encode(printed);
          const outcome = parseRecord("r.yaml", bytes);
          if (!outcome.ok) throw new Error(`${JSON.stringify(printed)}: ${outcome.issues.map((i) => i.message).join("; ")}`);
          const record = outcome.value;
          expect(valuesEqual(record.value, value as Value)).toBe(true);
          expect(holdsNegativeZero(record.value)).toBe(false);
          const decoder = new TextDecoder();
          const pending = [...record.nodes.children("")];
          while (pending.length > 0) {
            const node = pending.pop();
            if (node === undefined) break;
            pending.push(...record.nodes.children(node.at));
            // Indent the slice as its first line stands in the file, so that a block collection's later lines line up.
            const column = record.source.position(node.range.start).col - 1;
            const slice = " ".repeat(column) + decoder.decode(bytes.subarray(node.range.start, node.range.end));
            const reread = parseWithLibrary(slice.replaceAll(/\r\n?/g, "\n"), { schema: "core" }) as Value;
            const expected = valueAt(record.value, node.at);
            if (!valuesEqual(reread ?? null, expected)) {
              throw new Error(
                `${node.at} in ${JSON.stringify(printed)}: ${JSON.stringify(slice)} reads as ${JSON.stringify(reread)}`,
              );
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
