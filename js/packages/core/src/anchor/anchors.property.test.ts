import fc from "fast-check";
import { expect, test } from "vitest";
import { parseRecord } from "../format/parse-record.js";
import type { ParsedRecord } from "../record/record.js";
import { isLetterMarkDigitOrConnector } from "./unicode/unicode.js";

// Markdown documents whose headings collide often: titles from a few words that slug alike (letter case, NFC and NFD, an
// ignorable or unassigned code point, a literal suffix such as `notes-1`, punctuation that gives an empty slug), at levels 1
// to 6, some with an anchor element, and headings inside list items and block quotes, which are prose and take no part.

const word = fc.constantFrom(
  "Notes",
  "notes",
  "NOTES",
  "notes-1",
  "Notes 1",
  "1",
  "-1",
  "-",
  "!",
  "",
  "É",
  "É",
  "e‍́",
  "a\u{1ade}̣",
  "ạ",
  "ΟΔΟΣ",
  "οδοσ",
  "x_y",
  "*em*",
  "[link](x.md)",
);
const title = fc.array(word, { minLength: 1, maxLength: 3 }).map((words) => words.join(" "));
const element = fc.constantFrom("", "", "", '<a id="notes"></a>', '<a id="notes-1"></a>', '<a class="t"></a>');
const heading = fc
  .tuple(fc.integer({ min: 1, max: 6 }), title, element)
  .map(([level, text, anchor]) => `${"#".repeat(level)} ${text}${anchor}`);
const prose = fc.oneof(
  title.map((text) => `- ## ${text}`),
  title.map((text) => `> ## ${text}`),
  fc.constantFrom('<a id="notes"></a>Paragraph.', '- <a id="notes-2"></a>Item.', "Plain text."),
);
/** A document's blocks, each marked as a top-level heading or as prose. */
const documentBlocks = fc.array(
  fc.oneof(
    { weight: 3, arbitrary: heading.map((text) => ({ heading: true, text })) },
    prose.map((text) => ({ heading: false, text })),
  ),
  { maxLength: 12 },
);

function parsed(text: string): ParsedRecord {
  const outcome = parseRecord("r.md", new TextEncoder().encode(text));
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => issue.code).join(", ")}`);
  return outcome.value;
}

const derivedOf = (record: ParsedRecord) => record.anchors.anchors.filter((entry) => entry.kind === "derived");

test("property 6: a record's derived anchors are distinct, and each is a slug, or a slug and a numeric suffix", () => {
  fc.assert(
    fc.property(documentBlocks, (blocks) => {
      const text = blocks.map((block) => block.text).join("\n\n");
      const record = parsed(text);
      const derived = derivedOf(record);
      expect(new Set(derived.map((entry) => entry.name)).size).toBe(derived.length);
      for (const entry of derived) {
        for (const c of entry.name) {
          const cp = c.codePointAt(0) as number;
          expect(cp === 0x2d || isLetterMarkDigitOrConnector(cp)).toBe(true);
        }
        // A section without an explicit anchor has its slug as its key, which its derived anchor extends with a suffix.
        const key = record.sectionKeys.get(entry.at);
        const section = record.nodes.node(entry.at);
        if (key !== undefined && record.anchors.of(entry.at).every((anchor) => anchor.kind === "derived")) {
          const suffixes = entry.name.slice(key.length);
          expect(entry.name.startsWith(key) && /^(-[1-9][0-9]*)*$/.test(suffixes)).toBe(true);
        }
        expect(section?.kind === "section" && section.heading?.derivedAnchor === entry.name).toBe(true);
      }
      // Only the record's own headings take part, never those inside list items and block quotes.
      const headings = record.nodes.sections().filter((section) => section.heading !== null);
      expect(headings.length).toBe(blocks.filter((block) => block.heading).length);
      expect(headings.filter((section) => section.heading?.derivedAnchor !== null).length).toBe(derived.length);
      // A CRLF copy has the same anchors.
      expect(derivedOf(parsed(text.replaceAll("\n", "\r\n")))).toEqual(derived);
    }),
    { numRuns: 500 },
  );
});
