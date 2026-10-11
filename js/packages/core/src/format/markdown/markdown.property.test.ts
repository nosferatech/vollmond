import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { ParsedRecord } from "../../record/record.js";
import { decodeSource } from "../../text/source-text.js";
import { type Value, type ValueObject, valuesEqual } from "../../value/value.js";
import { parseMarkdownRecord } from "./markdown.js";

// Markdown documents from a small grammar: front matter, a title heading, sections with ATX or setext headings and data
// blocks, and bodies of paragraphs, fences, lists and block quotes, with non-ASCII text. Each is written with LF, CRLF or lone
// CR line breaks, and with or without a byte order mark.

const word = fc.constantFrom("alpha", "beta", "Größe", "日本", "😀", "x_y", "*em*", "`co de`", "e\u{301}", "a&amp;b");
const line = fc.array(word, { minLength: 1, maxLength: 4 }).map((words) => words.join(" "));
const trailing = fc.constantFrom("", "", " ", "  ", "\t");
const paragraph = fc
  .array(fc.tuple(line, trailing), { minLength: 1, maxLength: 3 })
  .map((lines) => lines.map(([text, space]) => text + space).join("\n"));
const fence = fc.array(line, { maxLength: 3 }).map((lines) => ["```sh", ...lines, "```"].join("\n"));
const list = fc
  .array(fc.tuple(line, fc.boolean()), { minLength: 1, maxLength: 3 })
  .map((items) => items.map(([text, nested]) => (nested ? `- ${text}\n  - ${text}` : `- ${text}`)).join("\n"));
const quote = line.map((text) => `> ${text}\n> ${text}`);
const bodyBlock = fc.oneof(paragraph, fence, list, quote);
const blank = fc.constantFrom("\n\n", "\n\n\n", "\n  \n", "\n\t\n\n");

/** A section of the generated document: its heading's level and title, its data block, and its body's blocks. */
interface SectionSource {
  readonly level: number;
  readonly title: string;
  readonly setext: boolean;
  readonly closing: boolean;
  readonly data: boolean;
  readonly body: readonly string[];
  readonly separators: readonly string[];
}

const section: fc.Arbitrary<SectionSource> = fc.record({
  level: fc.integer({ min: 2, max: 6 }),
  title: line,
  setext: fc.boolean(),
  closing: fc.boolean(),
  data: fc.boolean(),
  body: fc.array(bodyBlock, { maxLength: 3 }),
  separators: fc.array(blank, { minLength: 4, maxLength: 4 }),
});

interface DocumentSource {
  readonly frontMatter: boolean;
  readonly title: string | null;
  readonly rootBody: readonly string[];
  readonly sections: readonly SectionSource[];
  readonly finalBreak: boolean;
}

const documentSource: fc.Arbitrary<DocumentSource> = fc.record({
  frontMatter: fc.boolean(),
  title: fc.option(line),
  rootBody: fc.array(bodyBlock, { maxLength: 2 }),
  sections: fc.array(section, { maxLength: 6 }),
  finalBreak: fc.boolean(),
});

/** Writes a generated document with LF line breaks. */
function write(document: DocumentSource): string {
  const blocks: string[] = [];
  if (document.title !== null) blocks.push(`# ${document.title}`);
  blocks.push(...document.rootBody);
  for (const part of document.sections) {
    const setext = part.setext && part.level === 2;
    blocks.push(setext ? `${part.title}\n---` : `${"#".repeat(part.level)} ${part.title}${part.closing ? " ##" : ""}`);
    if (part.data) blocks.push(`\`\`\`yaml data\nowner: ${JSON.stringify(part.title)}\nruns: [1, 2]\n\`\`\``);
    blocks.push(...part.body);
  }
  let text = blocks.map((block, index) => (index === 0 ? block : `${separatorOf(document, index)}${block}`)).join("");
  if (document.frontMatter) text = `---\nstatus: Open\nnotes: |\n  one\n  two\n---\n${text}`;
  return document.finalBreak ? `${text}\n` : text;
}

function separatorOf(document: DocumentSource, index: number): string {
  const separators = document.sections.flatMap((part) => part.separators);
  return separators[index % Math.max(separators.length, 1)] ?? "\n\n";
}

function parsed(text: string): ParsedRecord {
  const source = decodeSource("r.md", new TextEncoder().encode(text));
  if (!source.ok) throw new Error("not UTF-8");
  const outcome = parseMarkdownRecord("r.md", source.value);
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return outcome.value;
}

/** Every `$body` in a value view, by the exact path of its section. */
function bodies(value: Value): string[] {
  const found: string[] = [];
  const pending: Value[] = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const object = next as ValueObject;
    if (typeof object.$body === "string") found.push(object.$body);
    if (Array.isArray(object.$sections)) pending.push(...(object.$sections as Value[]));
  }
  return found;
}

const decoder = new TextDecoder();
const lineBreaks = ["\n", "\r\n", "\r"] as const;

describe("property: Markdown documents", () => {
  test("parse to sections that tile the file, with trimmed bodies and the same value view whatever the line breaks", () => {
    fc.assert(
      fc.property(documentSource, fc.constantFrom(...lineBreaks), fc.boolean(), (document, lineBreak, bom) => {
        const lf = write(document);
        const text = (bom ? "\u{FEFF}" : "") + lf.replaceAll("\n", lineBreak);
        const record = parsed(text);
        const bytes = record.source.bytes;

        // Every top-level heading but the title is a section, in order.
        const sections = record.nodes.sections().slice(1);
        expect(sections.length).toBe(document.sections.length);
        const titles = sections.map((node) => decoder.decode(bytes.slice(...rangeOf(record, `${node.at}/$title`))));
        expect(titles).toEqual(document.sections.map((part) => part.title));

        // Sections tile the file: each parent's children follow one another to its end, from the start of a heading line.
        expect(record.nodes.node("")?.range).toEqual({ start: 0, end: bytes.length });
        for (const parent of record.nodes.sections()) {
          const children = record.nodes.children(`${parent.at}/$sections`);
          children.forEach((child, index) => {
            const next = children[index + 1];
            expect(child.range.end).toBe(next === undefined ? parent.range.end : next.range.start);
            const before = bytes[child.range.start - 1];
            const lineStart = before === 0x0a || before === 0x0d || child.range.start === (bom ? 3 : 0);
            expect(lineStart).toBe(true);
          });
          const first = children[0];
          if (first !== undefined) {
            expect(record.nodes.node(`${parent.at}/$sections`)?.range).toEqual({
              start: first.range.start,
              end: parent.range.end,
            });
          }
        }

        // No body has a leading blank line or trailing white space, and each is its span read with LF line breaks.
        for (const body of bodies(record.value)) {
          expect(body).not.toBe("");
          expect(body).not.toMatch(/^[ \t]*\n/);
          expect(body).not.toMatch(/[ \t\n]$/);
        }
        for (const node of record.nodes.sections()) {
          const body = record.nodes.node(`${node.at}/$body`);
          if (body === undefined) continue;
          const span = decoder.decode(bytes.slice(body.range.start, body.range.end)).replace(/\r\n?/g, "\n");
          expect(span).toBe(valueAt(record.value, body.at));
        }

        // The LF copy, without a byte order mark, has the same value view, and ranges that differ by the mark's bytes.
        const plain = parsed(lf);
        expect(valuesEqual(record.value, plain.value)).toBe(true);
        if (lineBreak === "\n") {
          const shift = bom ? 3 : 0;
          expect(sections.map((node) => node.range.start)).toEqual(
            plain.nodes
              .sections()
              .slice(1)
              .map((node) => node.range.start + shift),
          );
        }
      }),
      { numRuns: 500 },
    );
  });
});

function rangeOf(record: ParsedRecord, at: string): [number, number] {
  const node = record.nodes.node(at);
  if (node === undefined) throw new Error(`no node at ${at}`);
  return [node.range.start, node.range.end];
}

/** The value at an exact path of a value view. */
function valueAt(value: Value, at: string): Value {
  let current: Value = value;
  for (const token of at.split("/").slice(1)) {
    const name = token.replaceAll("~1", "/").replaceAll("~0", "~");
    current = Array.isArray(current) ? (current[Number(name)] as Value) : ((current as ValueObject)[name] as Value);
  }
  return current;
}
