import { describe, expect, test } from "vitest";
import type { ParsedRecord } from "../../record/record.js";
import type { ReferenceOccurrence } from "../../reference/reference.js";
import { parseRecord } from "../parse-record.js";
import { parseMarkdownTree } from "./library.js";

const utf8 = new TextEncoder();

function parsed(text: string | Uint8Array): ParsedRecord {
  const outcome = parseRecord("docs/r.md", typeof text === "string" ? utf8.encode(text) : text);
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => issue.code).join(", ")}`);
  return outcome.value;
}

/** The record's links, without their destinations. */
function linksOf(text: string): Omit<ReferenceOccurrence, "destination">[] {
  return (parsed(text).links ?? []).map(({ destination: _, ...rest }) => rest);
}

/** The text a link's destination range gives in the file. */
function destinationText(bytes: Uint8Array, link: ReferenceOccurrence): string | undefined {
  const range = link.destination;
  return range === undefined ? undefined : new TextDecoder().decode(bytes.subarray(range.start, range.end));
}

describe("the links of a Markdown record", () => {
  test("are its inline links, images and definitions, in the $body or $title that holds them, in document order", () => {
    const text = "# T [a](t.md)\n\nSee [b](b.md#x) and ![c](c.png).\n\n## S\n\n[d][r]\n\n[r]: target.md#frag\n";
    expect(linksOf(text)).toEqual([
      { form: "link", at: "/$title", offset: 2, raw: "t.md", uri: "t.md" },
      { form: "link", at: "/$body", offset: 4, raw: "b.md#x", uri: "b.md#x" },
      { form: "image", at: "/$body", offset: 20, raw: "c.png", uri: "c.png" },
      { form: "definition", at: "/$sections/0/$body", offset: 8, raw: "target.md#frag", uri: "target.md#frag" },
    ]);
  });

  test("keep the destination as written in raw, and as CommonMark reads it in uri", () => {
    expect(linksOf("[a](x&amp;y.md) [b](x\\_y.md) [c](<x y.md>) [d](x%20y.md)\n")).toEqual([
      { form: "link", at: "/$body", offset: 0, raw: "x&amp;y.md", uri: "x&y.md" },
      { form: "link", at: "/$body", offset: 16, raw: "x\\_y.md", uri: "x_y.md" },
      { form: "link", at: "/$body", offset: 29, raw: "x y.md", uri: "x y.md" },
      { form: "link", at: "/$body", offset: 43, raw: "x%20y.md", uri: "x%20y.md" },
    ]);
  });

  test("give an empty destination as an empty raw, without a destination range", () => {
    const record = parsed("[a]() [b](<>)\n");
    expect(record.links).toEqual([
      { form: "link", at: "/$body", offset: 0, raw: "", uri: "" },
      { form: "link", at: "/$body", offset: 6, raw: "", uri: "" },
    ]);
  });

  test("leave out autolinks, autolink literals, links in code, HTML and comments, and references to a definition", () => {
    const text = [
      "<https://example.com/a> www.example.com https://example.com/b",
      "",
      '`[a](code.md)` <!-- [b](comment.md) --> <a href="x.md">x</a>',
      "",
      "```",
      "[c](fenced.md)",
      "```",
      "",
      "<div>",
      "[d](html.md)",
      "</div>",
      "",
      "[e][undefined] [f][r]",
      "",
      "[r]: defined.md",
      "",
    ].join("\n");
    expect(linksOf(text).map((link) => link.raw)).toEqual(["defined.md"]);
  });

  test("find links in tables, lists and block quotes, at their offsets in the $body", () => {
    const text = "# T\n\n| a |\n| - |\n| [a](a.md) |\n\n- item [b](b.md)\n  - nested [c](c.md)\n\n> quote [d](d.md)\n";
    const body = parsed(text).value.$body as string;
    const offsets = linksOf(text).map((link) => link.offset);
    expect(offsets).toEqual(["[a]", "[b]", "[c]", "[d]"].map((label) => utf8.encode(body.slice(0, body.indexOf(label))).length));
  });

  test("count offsets in UTF-8 bytes of the value, CRLF read as LF, and destinations in bytes of the file", () => {
    const text = "﻿# Größe\r\n\r\nÜber [ä](ö.md)\r\n";
    const bytes = utf8.encode(text);
    const [link] = parsed(bytes).links ?? [];
    expect(link?.offset).toBe(utf8.encode("Über ").length);
    expect(destinationText(bytes, link as ReferenceOccurrence)).toBe("ö.md");
  });

  // Predicted bug: an offset counted from the title's first character in the file includes the anchor element, which the
  // `$title` value does not hold.
  test("give a link's offset in the $title after an anchor element, which the value leaves out", () => {
    const text = '## A <a id="x"></a>[l](l.md)\n';
    const record = parsed(text);
    const title = (record.value.$sections as readonly { $title: string }[])[0]?.$title as string;
    expect(title).toBe("A [l](l.md)");
    expect(linksOf(text)).toEqual([{ form: "link", at: "/$sections/0/$title", offset: 2, raw: "l.md", uri: "l.md" }]);
  });

  test("give a link's offset in a $title in UTF-8 bytes, after a leading anchor element and the space the value trims", () => {
    expect(linksOf("## Été [l](l.md)\n")[0]?.offset).toBe(utf8.encode("Été ").length);
    expect(linksOf('## <a id="x"></a> Été [l](l.md)\n')[0]?.offset).toBe(utf8.encode("Été ").length);
  });

  // Predicted bug: a setext title of two lines joins them with one `\n` and drops the second line's indentation, so an offset
  // counted in the file is off by the indentation and a CR.
  test("give a link's offset in a setext $title of two lines, whose lines the value joins", () => {
    const text = "Line one\r\n   then [l](l.md)\r\n---\r\n";
    const record = parsed(text);
    const title = (record.value.$sections as readonly { $title: string }[])[0]?.$title as string;
    expect(title).toBe("Line one\nthen [l](l.md)");
    expect(linksOf(text)).toEqual([
      { form: "link", at: "/$sections/0/$title", offset: "Line one\nthen ".length, raw: "l.md", uri: "l.md" },
    ]);
  });

  test("leave a Markdown tree as the library builds it, but for each destination's range", () => {
    const text = '[a](x.md "t") ![b](<y z.png>)\n\n[r]: d.md\n';
    const tree = parseMarkdownTree(text);
    const strip = (value: unknown) =>
      JSON.stringify(value, (key, item) => (key === "position" || key === "data" ? undefined : item));
    expect(tree.ok && strip(tree.root)).toBe(
      strip({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "link", title: "t", url: "x.md", children: [{ type: "text", value: "a" }] },
              { type: "text", value: " " },
              { type: "image", title: null, url: "y z.png", alt: "b" },
            ],
          },
          { type: "definition", identifier: "r", label: "r", title: null, url: "d.md" },
        ],
      }),
    );
  });
});
