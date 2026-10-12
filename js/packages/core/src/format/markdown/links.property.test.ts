import fc from "fast-check";
import { expect, test } from "vitest";
import type { ReferenceOccurrence } from "../../reference/reference.js";
import type { Value } from "../../value/value.js";
import { parseRecord } from "../parse-record.js";

// Property 4 of the I2 design: Markdown generated with links at known places, in paragraphs, headings (some with an anchor
// element before the link), table cells, list items at two depths, block quotes, images and link reference definitions, beside
// code spans, comments, fenced code, HTML blocks and autolinks that hold link-like text, with LF or CRLF line breaks and with
// or without a byte order mark. Every planted reference is found, with its form, its raw text, its `$body` or `$title`, its
// offset and its destination, and nothing else is. Each planted reference has a unique label, which locates it in the value
// view: the `$body` or `$title` that holds the label is where it is, and the label's place there is its offset.

type Kind =
  | "paragraph"
  | "image"
  | "heading"
  | "anchored-heading"
  | "table"
  | "list"
  | "quote"
  | "definition"
  | "code-span"
  | "comment"
  | "fenced"
  | "html"
  | "autolink";

const kinds = fc.array(
  fc.constantFrom<Kind>(
    "paragraph",
    "image",
    "heading",
    "anchored-heading",
    "table",
    "list",
    "quote",
    "definition",
    "code-span",
    "comment",
    "fenced",
    "html",
    "autolink",
  ),
  { minLength: 1, maxLength: 12 },
);
const destination = fc.constantFrom("t.md", "../a/b.md#x", "c%20d.md", "é.md?q=1#f", "/root.md", "<x y.md>");

interface Planted {
  readonly form: ReferenceOccurrence["form"];
  /** The text the reference starts with in its value, unique in the document. */
  readonly label: string;
  readonly raw: string;
}

/** Renders the blocks, with the references planted in them. */
function render(blocks: readonly Kind[], destinations: readonly string[]): { text: string; planted: Planted[] } {
  const planted: Planted[] = [];
  const target = (n: number) => destinations[n % destinations.length] as string;
  const raw = (written: string) => (written.startsWith("<") ? written.slice(1, -1) : written);
  const link = (n: number, form: "link" | "image" = "link") => {
    const label = `${form === "image" ? "!" : ""}[L${n}]`;
    planted.push({ form, label: `${label}(`, raw: raw(target(n)) });
    return `${label}(${target(n)})`;
  };
  const rendered = blocks.map((kind, n) => {
    switch (kind) {
      case "paragraph":
        return `Text ${link(n)} and more.`;
      case "image":
        return `See ${link(n, "image")}.`;
      case "heading":
        return `## Heading ${n} ${link(n)}`;
      case "anchored-heading":
        return `## Heading ${n} <a id="h${n}"></a>${link(n)}`;
      case "table":
        return `| a | b |\n| - | - |\n| x | ${link(n)} |`;
      case "list":
        return `- item ${link(n)}\n  - nested ${link(n + 1000)}`;
      case "quote":
        return `> quoted ${link(n)}`;
      case "definition":
        planted.push({ form: "definition", label: `[R${n}]:`, raw: raw(target(n)) });
        return `[R${n}]: ${target(n)}\n\nUse [it][R${n}].`;
      case "code-span":
        return `Code \`[D${n}](d.md)\` here.`;
      case "comment":
        return `Hidden <!-- [D${n}](d.md) --> here.`;
      case "fenced":
        return `\`\`\`\n[D${n}](d.md)\n\`\`\``;
      case "html":
        return `<div>\n[D${n}](d.md)\n</div>`;
      case "autolink":
        return `Auto <https://example.com/${n}> and www.example.com/${n}.`;
      default:
        throw new Error(`no block of the kind ${kind satisfies never}`);
    }
  });
  return { text: `${rendered.join("\n\n")}\n`, planted };
}

/** Finds the `$body` or `$title` of the value that holds `label`, and the label's place in it. */
function locate(value: Value, label: string, at = ""): { at: string; index: number } | null {
  if (typeof value === "string") {
    const index = value.indexOf(label);
    return index < 0 ? null : { at, index };
  }
  if (typeof value !== "object" || value === null) return null;
  for (const [key, item] of Object.entries(value)) {
    const found = locate(item as Value, label, `${at}/${key}`);
    if (found !== null) return found;
  }
  return null;
}

const UTF8 = new TextEncoder();

test("property 4: every planted reference is found with its form, raw text, place, offset and destination, and no other", () => {
  fc.assert(
    fc.property(
      kinds,
      fc.array(destination, { minLength: 1, maxLength: 4 }),
      fc.boolean(),
      fc.boolean(),
      (blocks, targets, crlf, bom) => {
        const { text: lf, planted } = render(blocks, targets);
        const text = `${bom ? "﻿" : ""}${crlf ? lf.replaceAll("\n", "\r\n") : lf}`;
        const bytes = UTF8.encode(text);
        const outcome = parseRecord("docs/r.md", bytes);
        if (!outcome.ok) throw new Error(outcome.issues.map((issue) => issue.message).join("; "));
        const record = outcome.value;
        const expected = planted.map((reference) => {
          const place = locate(record.value, reference.label);
          if (place === null) throw new Error(`${reference.label} is not in the value view`);
          const holder = (place.at.match(/^(.*\/\$(?:body|title))$/u)?.[1] ?? "") as string;
          const value = holder === "" ? "" : (locateString(record.value, holder) ?? "");
          return {
            form: reference.form,
            at: holder,
            offset: UTF8.encode(value.slice(0, place.index)).length,
            raw: reference.raw,
          };
        });
        const found = (record.links ?? []).map(({ form, at, offset, raw }) => ({ form, at, offset, raw }));
        const order = (list: { at: string; offset: number | undefined }[]) =>
          [...list].sort((a, b) => a.at.localeCompare(b.at) || (a.offset ?? 0) - (b.offset ?? 0));
        expect(order(found)).toEqual(order(expected));
        for (const link of record.links ?? []) {
          const range = link.destination;
          if (range === undefined) throw new Error(`${link.raw} has no destination`);
          expect(new TextDecoder().decode(bytes.subarray(range.start, range.end))).toBe(link.raw);
        }
      },
    ),
    { numRuns: 300 },
  );
});

/** The string at an exact path of the value, which has no escaped tokens here. */
function locateString(value: Value, at: string): string | null {
  let current: Value = value;
  for (const key of at.split("/").slice(1)) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Readonly<Record<string, Value>>)[key] as Value;
  }
  return typeof current === "string" ? current : null;
}
