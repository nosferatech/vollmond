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

/** A block of the written document: its text, and the section that holds it, -1 for the root. */
interface WrittenBlock {
  readonly text: string;
  readonly owner: number;
  readonly kind: "heading" | "data" | "body";
}

/**
 * Writes a generated document with LF line breaks, and gives the value view the grammar says it has: the front matter's
 * fields, the titles, the data blocks' fields, each section under the nearest earlier heading of a lower level, and each
 * `$body` as its blocks with the blank lines between them, trimmed at its end.
 */
function write(document: DocumentSource): { readonly text: string; readonly expected: ValueObject } {
  const blocks: WrittenBlock[] = [];
  if (document.title !== null) blocks.push({ text: `# ${document.title}`, owner: -1, kind: "heading" });
  for (const text of document.rootBody) blocks.push({ text, owner: -1, kind: "body" });
  document.sections.forEach((part, owner) => {
    const setext = part.setext && part.level === 2;
    const heading = setext ? `${part.title}\n---` : `${"#".repeat(part.level)} ${part.title}${part.closing ? " ##" : ""}`;
    blocks.push({ text: heading, owner, kind: "heading" });
    if (part.data) {
      blocks.push({ text: `\`\`\`yaml data\nowner: ${JSON.stringify(part.title)}\nruns: [1, 2]\n\`\`\``, owner, kind: "data" });
    }
    for (const text of part.body) blocks.push({ text, owner, kind: "body" });
  });
  const separators = document.sections.flatMap((part) => part.separators);
  const separatorBefore = (index: number) => separators[index % Math.max(separators.length, 1)] ?? "\n\n";
  let text = blocks.map((block, index) => (index === 0 ? block.text : `${separatorBefore(index)}${block.text}`)).join("");
  if (document.frontMatter) text = `---\nstatus: Open\nnotes: |\n  one\n  two\n---\n${text}`;
  if (document.finalBreak) text += "\n";

  // Each owner's body: its body blocks, with the separator before each block but its first.
  const bodyOf = (owner: number): string | undefined => {
    let body = "";
    blocks.forEach((block, index) => {
      if (block.owner !== owner || block.kind !== "body") return;
      body += body === "" ? block.text : `${separatorBefore(index)}${block.text}`;
    });
    const trimmed = body.replace(/[ \t\n]+$/, "");
    return trimmed === "" ? undefined : trimmed;
  };
  const root: Record<string, Value> = {};
  if (document.frontMatter) Object.assign(root, { status: "Open", notes: "one\ntwo\n" });
  if (document.title !== null) root.$title = document.title;
  const rootBody = bodyOf(-1);
  if (rootBody !== undefined) root.$body = rootBody;
  const open: { readonly level: number; readonly object: Record<string, Value> }[] = [{ level: 0, object: root }];
  document.sections.forEach((part, owner) => {
    const level = part.level;
    while ((open.at(-1)?.level ?? 0) >= level) open.pop();
    const parent = (open.at(-1) as (typeof open)[number]).object;
    const object: Record<string, Value> = { $title: part.title };
    if (part.data) Object.assign(object, { owner: part.title, runs: [1, 2] });
    const body = bodyOf(owner);
    if (body !== undefined) object.$body = body;
    parent.$sections = [...((parent.$sections as Value[] | undefined) ?? []), object];
    open.push({ level, object });
  });
  return { text, expected: root };
}

function parsed(text: string): ParsedRecord {
  const source = decodeSource("r.md", new TextEncoder().encode(text));
  if (!source.ok) throw new Error("not UTF-8");
  const outcome = parseMarkdownRecord("r.md", source.value);
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return outcome.value;
}

const decoder = new TextDecoder();
const lineBreaks = ["\n", "\r\n", "\r"] as const;

describe("property: Markdown documents", () => {
  test("parse to sections that tile the file, with trimmed bodies and the same value view whatever the line breaks", () => {
    fc.assert(
      fc.property(documentSource, fc.constantFrom(...lineBreaks), fc.boolean(), (document, lineBreak, bom) => {
        const { text: lf, expected } = write(document);
        const text = (bom ? "\u{FEFF}" : "") + lf.replaceAll("\n", lineBreak);
        const record = parsed(text);
        const bytes = record.source.bytes;

        // The value view is what the grammar wrote, whatever the line breaks and the byte order mark.
        expect(record.value).toEqual(expected);

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

        // Each body is its span, read with LF line breaks.
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
    // The 500 runs take under a second alone, and over five seconds beside the suite's other files on a loaded machine; the
    // property is about what the parser gives, not how fast.
  }, 30_000);
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
