import type { Nodes } from "mdast";
import { keepingLeadingFeff, parseInlineContent, parseMarkdownTree } from "../format/markdown/library.js";
import { collectLinks } from "../format/markdown/links.js";
import { definitionLabelsOfRecord } from "../record/definition-labels.js";
import { childPath } from "../record/exact-path.js";
import type { ParsedRecord } from "../record/record.js";
import type { ByteRange } from "../text/source-text.js";
import type { Value, ValueObject } from "../value/value.js";
import type { ReferenceOccurrence } from "./reference.js";

const UTF8 = new TextEncoder();

/**
 * Gives the references a record makes, in document order: the links, images and link reference definitions of every `$title`
 * and `$body`, and every `$ref` object in a field's value, wherever it stands. A Markdown record's links come from its parse;
 * a JSON or YAML record's `$body` strings are parsed here as Markdown documents, and its `$title` strings as a heading's
 * inline content, as their section keys are, each with the link reference definitions of every `$body` in scope, as in the
 * record's Markdown form. A parsed record's prose is within the Markdown parser's limits, which the reader
 * checks.
 *
 * With `under`, the exact path of a node, only the references in that node and below it are given, and only the prose there
 * is parsed. The root's `$schema` is stored data, and is not looked into.
 */
export function occurrencesOf(record: ParsedRecord, under = ""): ReferenceOccurrence[] {
  const inside = (at: string) => under === "" || at === under || at.startsWith(`${under}/`);
  let labels: readonly string[] | null = null;
  // Only a link reference has a label to look up, and it holds a `[`.
  const labelsFor = (prose: string): readonly string[] => {
    if (!prose.includes("[")) return [];
    labels ??= definitionLabelsOfRecord(record.value);
    return labels;
  };
  const found: ReferenceOccurrence[] = (record.links ?? []).filter((link) => inside(link.at));
  const pending: { readonly value: Value; readonly at: string; readonly section: boolean }[] = [
    { value: record.value, at: "", section: true },
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { value, at, section } = next;
    // A node outside `under` that is not above it holds nothing under it.
    if (!inside(at) && !under.startsWith(`${at}/`) && at !== "") continue;
    if (Array.isArray(value)) {
      value.forEach((item: Value, index: number) => {
        pending.push({ value: item, at: childPath(at, index), section: false });
      });
      continue;
    }
    if (!isObject(value)) continue;
    // A parsed record holds a `$ref` member only in a JSON Reference: one beside other members, or on a section, is a
    // structural error.
    const target = value.$ref;
    if (typeof target === "string") {
      if (inside(at)) found.push(refObject(record, at, target));
      continue;
    }
    for (const [name, member] of Object.entries(value)) {
      const memberAt = childPath(at, name);
      if (section && name === "$sections" && Array.isArray(member)) {
        member.forEach((item: Value, index: number) => {
          pending.push({ value: item, at: childPath(memberAt, index), section: true });
        });
      } else if (section && (name === "$body" || name === "$title")) {
        if (record.format !== "md" && typeof member === "string" && inside(memberAt)) {
          // One by one, since a text may hold more links than a call takes arguments.
          for (const link of proseLinks(member, memberAt, name === "$title", labelsFor(member))) found.push(link);
        }
      } else if (!section || !name.startsWith("$")) {
        pending.push({ value: member, at: memberAt, section: false });
      }
    }
  }
  // Each occurrence's node is looked up once, not at every comparison.
  const keyed = found.map((occurrence) => ({
    occurrence,
    start: record.nodes.node(occurrence.at)?.range.start ?? 0,
    offset: occurrence.offset ?? 0,
  }));
  keyed.sort((a, b) => a.start - b.start || a.offset - b.offset);
  return keyed.map(({ occurrence }) => occurrence);
}

/** The occurrence of a `$ref` object, with its destination where the `$ref` string's bytes in the file are the string. */
function refObject(record: ParsedRecord, at: string, target: string): ReferenceOccurrence {
  const occurrence: ReferenceOccurrence = { form: "ref-object", at, raw: target, uri: target };
  const node = record.nodes.node(childPath(at, "$ref"));
  if (node === undefined) return occurrence;
  const destination = rawRange(record, node.range, target);
  return destination === null ? occurrence : { ...occurrence, destination };
}

/** The range of `raw` in the file within `range`: the whole range, or inside its quotes; null when its bytes differ. */
function rawRange(record: ParsedRecord, range: ByteRange, raw: string): ByteRange | null {
  const { source } = record;
  const written = source.text.slice(source.utf16Index(range.start), source.utf16Index(range.end));
  if (written === raw) return range;
  const quote = written[0];
  if ((quote === '"' || quote === "'") && written === `${quote}${raw}${quote}`) {
    return { start: range.start + 1, end: range.end - 1 };
  }
  return null;
}

/**
 * Parses a JSON or YAML record's `$body` as a Markdown document, or its `$title`, with `title`, as a heading's inline
 * content, with the definitions whose labels are `labels` in scope, and gives its links at their offsets in the string.
 * They have no destination range, since the string's bytes in the file may hold escapes.
 *
 * The prose of a parsed record is within the Markdown parser's limits, since the reader refuses a record whose `$title` or
 * `$body` passes one; a text past them gives no links.
 */
function proseLinks(text: string, at: string, title: boolean, labels: readonly string[]): ReferenceOccurrence[] {
  // A U+FEFF that starts the string is a character of it, which the parse would skip.
  const kept = keepingLeadingFeff(text);
  let nodes: readonly Nodes[];
  if (title) {
    const content = parseInlineContent(kept.text, labels);
    if (content === null) return [];
    nodes = content;
  } else {
    const tree = parseMarkdownTree(kept.text, labels);
    if (!tree.ok) return [];
    nodes = tree.root.children;
  }
  const shift = kept.shift;
  const offsetOf = byteOffsets(text);
  return collectLinks(nodes, text, shift).map((link) => ({
    form: link.form,
    at,
    offset: offsetOf(shift + link.start),
    raw: link.destination === null ? "" : text.slice(shift + link.destination.start, shift + link.destination.end),
    uri: link.url,
  }));
}

/**
 * Gives a function from an index into `text` to its offset in the text's UTF-8 bytes, for indexes that are not inside a
 * surrogate pair. Called with indexes in ascending order, as the links of a text come, it encodes each character of the
 * text at most once; an index below the last one starts again from the text's start.
 */
function byteOffsets(text: string): (index: number) => number {
  let lastIndex = 0;
  let lastOffset = 0;
  return (index) => {
    if (index < lastIndex) {
      lastIndex = 0;
      lastOffset = 0;
    }
    lastOffset += UTF8.encode(text.slice(lastIndex, index)).length;
    lastIndex = index;
    return lastOffset;
  };
}

function isObject(value: Value): value is ValueObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
