import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { Value } from "../value/value.js";
import { valuesEqual } from "../value/value.js";
import { parseRecord } from "./parse-record.js";

// A small YAML printer of the test's own, so that the expected values and spans do not come from a YAML library. It prints
// plain scalars on one line or folded over several, double-quoted scalars, literal and folded block scalars, number forms of
// the core schema, booleans and nulls, block mappings and sequences (compact inside a sequence), and flow collections, and
// records for each node the span its value takes and, for a member, the span from its key.

/** A node as the printer writes it, with the value it reads as. */
type Printed =
  | { readonly kind: "plain"; readonly lines: readonly (readonly string[])[] }
  | { readonly kind: "quoted"; readonly words: readonly string[] }
  | { readonly kind: "literal" | "folded"; readonly lines: readonly (readonly string[])[] }
  | { readonly kind: "literal-scalar"; readonly source: string; readonly value: Value }
  | { readonly kind: "map"; readonly entries: readonly (readonly [string, Printed])[] }
  | { readonly kind: "seq"; readonly items: readonly Printed[] }
  | { readonly kind: "flow"; readonly items: readonly Printed[] };

const WORDS = ["alpha", "beta", "gamma", "déjà", "x\u{1F600}y", "k9"];
const word = fc.constantFrom(...WORDS);
const words = fc.array(word, { minLength: 1, maxLength: 4 });
const lines = fc.array(words, { minLength: 1, maxLength: 3 });
const LITERALS: readonly [string, Value][] = [
  ["0x1F", 31],
  ["0o17", 15],
  ["+4", 4],
  ["-7", -7],
  ["1e3", 1000],
  ["0.5", 0.5],
  ["-0", 0],
  ["017", 17],
  ["true", true],
  ["False", false],
  ["~", null],
  ["null", null],
];
const literal = fc.constantFrom(...LITERALS).map(([source, value]): Printed => ({ kind: "literal-scalar", source, value }));
const flowScalar = fc.oneof(
  literal,
  words.map((w): Printed => ({ kind: "plain", lines: [w] })),
  words.map((w): Printed => ({ kind: "quoted", words: w })),
);
const { node } = fc.letrec<{ node: Printed; flow: Printed }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    literal,
    lines.map((l): Printed => ({ kind: "plain", lines: l })),
    words.map((w): Printed => ({ kind: "quoted", words: w })),
    lines.map((l): Printed => ({ kind: "literal", lines: l })),
    lines.map((l): Printed => ({ kind: "folded", lines: l })),
    tie("flow"),
    fc
      .uniqueArray(fc.tuple(word, tie("node")), { selector: ([key]) => key, minLength: 1, maxLength: 3 })
      .map((entries): Printed => ({ kind: "map", entries })),
    fc.array(tie("node"), { minLength: 1, maxLength: 3 }).map((items): Printed => ({ kind: "seq", items })),
  ),
  flow: fc
    .array(fc.oneof({ depthSize: "small" }, flowScalar, tie("flow")), { maxLength: 3 })
    .map((items): Printed => ({ kind: "flow", items })),
}));
const root = fc
  .uniqueArray(fc.tuple(word, node), { selector: ([key]) => key, minLength: 1, maxLength: 4 })
  .map((entries): Printed => ({ kind: "map", entries }));

/** What the printer expects of a node: its value, its span, and a member's span from its key. */
interface Expected {
  readonly value: Value;
  readonly start: number;
  readonly end: number;
  readonly memberStart?: number;
}

class Printer {
  out = "";
  readonly expected = new Map<string, Expected>();

  /** Prints a block mapping's entries at `indent`, the first without its indentation when `compact`. */
  map(entries: readonly (readonly [string, Printed])[], indent: number, at: string, compact: boolean): Value {
    const value: Record<string, Value> = {};
    entries.forEach(([key, child], index) => {
      if (index > 0 || !compact) this.out += " ".repeat(indent);
      const memberStart = this.out.length;
      this.out += `${key}:`;
      value[key] = this.#member(child, indent, `${at}/${key}`, memberStart);
    });
    return value;
  }

  /** Prints a block sequence's items at `indent`, the first without its indentation when `compact`. */
  seq(items: readonly Printed[], indent: number, at: string, compact: boolean): Value {
    return items.map((child, index) => {
      if (index > 0 || !compact) this.out += " ".repeat(indent);
      this.out += "- ";
      const path = `${at}/${index}`;
      if (child.kind === "map" || child.kind === "seq") return this.#block(child, indent + 2, path, true);
      return this.#inline(child, indent + 2, path);
    });
  }

  /** Prints a member's value after its key and colon. */
  #member(child: Printed, indent: number, path: string, memberStart: number): Value {
    if (child.kind === "map" || child.kind === "seq") {
      this.out += "\n";
      return this.#block(child, indent + 2, path, false, memberStart);
    }
    this.out += " ";
    return this.#inline(child, indent + 2, path, memberStart);
  }

  /** Prints a block collection, recording its span from its first entry to the end of its last value. */
  #block(child: Printed, indent: number, path: string, compact: boolean, memberStart?: number): Value {
    const start = this.out.length + (compact ? 0 : indent);
    const value =
      child.kind === "map"
        ? this.map(child.entries, indent, path, compact)
        : this.seq((child as { items: readonly Printed[] }).items, indent, path, compact);
    // The block ends with its last value, before the line break that follows it, unless that value is a block scalar.
    const last = this.#lastEnd;
    this.#record(path, value, start, last, memberStart);
    return value;
  }

  /** The end of the last value printed. */
  #lastEnd = 0;

  /** Prints a scalar or a flow collection on the current line, then ends the line unless a block scalar did. */
  #inline(child: Printed, indent: number, path: string, memberStart?: number): Value {
    const start = this.out.length;
    let value: Value;
    switch (child.kind) {
      case "plain":
        // A plain scalar folded over lines, each continuation line more indented than the collection it is in.
        this.out += child.lines.map((line) => line.join(" ")).join(`\n${" ".repeat(indent)}`);
        value = child.lines.map((line) => line.join(" ")).join(" ");
        break;
      case "quoted":
        this.out += `"${child.words.join(" ")}"`;
        value = child.words.join(" ");
        break;
      case "literal-scalar":
        this.out += child.source;
        value = child.value;
        break;
      case "literal":
      case "folded":
        this.out += child.kind === "literal" ? "|\n" : ">\n";
        for (const line of child.lines) this.out += `${" ".repeat(indent)}${line.join(" ")}\n`;
        value = `${child.lines.map((line) => line.join(" ")).join(child.kind === "literal" ? "\n" : " ")}\n`;
        this.#record(path, value, start, this.out.length, memberStart);
        return value;
      case "flow":
        value = this.#flow(child, path);
        break;
      default:
        throw new Error(`not inline: ${child.kind}`);
    }
    this.#record(path, value, start, this.out.length, memberStart);
    this.out += "\n";
    return value;
  }

  /** Prints a flow sequence of scalars and flow sequences. */
  #flow(child: Printed & { kind: "flow" }, path: string): Value {
    this.out += "[";
    const value = child.items.map((item, index) => {
      if (index > 0) this.out += ", ";
      const start = this.out.length;
      const itemPath = `${path}/${index}`;
      let itemValue: Value;
      if (item.kind === "flow") {
        itemValue = this.#flow(item, itemPath);
      } else if (item.kind === "quoted") {
        this.out += `"${item.words.join(" ")}"`;
        itemValue = item.words.join(" ");
      } else if (item.kind === "literal-scalar") {
        this.out += item.source;
        itemValue = item.value;
      } else if (item.kind === "plain") {
        this.out += (item.lines[0] as readonly string[]).join(" ");
        itemValue = (item.lines[0] as readonly string[]).join(" ");
      } else {
        throw new Error(`not in a flow: ${item.kind}`);
      }
      this.#record(itemPath, itemValue, start, this.out.length);
      return itemValue;
    });
    this.out += "]";
    return value;
  }

  #record(path: string, value: Value, start: number, end: number, memberStart?: number): void {
    this.expected.set(path, memberStart === undefined ? { value, start, end } : { value, start, end, memberStart });
    this.#lastEnd = end;
  }
}

describe("property: YAML from the test's own printer", () => {
  test("reads as printed, with each node's range and member range where the printer put them, with LF, CRLF or CR", () => {
    fc.assert(
      fc.property(root, fc.constantFrom("\n", "\r\n", "\r"), (document, eol) => {
        const printer = new Printer();
        const value = printer.map((document as { entries: readonly (readonly [string, Printed])[] }).entries, 0, "", false);
        const printed = printer.out;
        const text = printed.replaceAll("\n", eol);
        // A place in the printed text, as a byte offset into the file with its line breaks.
        const byteAt = (index: number) => {
          const lineBreaks = printed.slice(0, index).split("\n").length - 1;
          return new TextEncoder().encode(text.slice(0, index + lineBreaks * (eol.length - 1))).length;
        };
        const outcome = parseRecord("r.yaml", new TextEncoder().encode(text));
        if (!outcome.ok) throw new Error(`${JSON.stringify(text)}: ${outcome.issues.map((i) => i.message).join("; ")}`);
        expect(valuesEqual(outcome.value.value, value)).toBe(true);
        for (const [at, expected] of printer.expected) {
          const info = outcome.value.nodes.node(at);
          expect([at, info?.range]).toEqual([at, { start: byteAt(expected.start), end: byteAt(expected.end) }]);
          if (expected.memberStart !== undefined) {
            expect([at, info?.memberRange]).toEqual([at, { start: byteAt(expected.memberStart), end: byteAt(expected.end) }]);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
