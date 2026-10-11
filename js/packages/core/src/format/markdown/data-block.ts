import type { RootContent } from "mdast";
import type { Issue } from "../../issue/issue.js";
import { childPath } from "../../record/exact-path.js";
import type { NodeInit } from "../../record/node-index.js";
import { checkShape } from "../../record/shape.js";
import type { Position, SourceText } from "../../text/source-text.js";
import { sliceIndentedUnitText, sliceUnitText } from "../../text/unit-text.js";
import { createValueObject, type ValueObject } from "../../value/value.js";
import { parseJsonUnit } from "../json.js";
import { parseYamlUnit } from "../yaml.js";
import { endOf, startOf } from "./anchor-element.js";
import { lineEndOf, lineStartOf, nextLineStart } from "./lines.js";

/**
 * What a fenced code block's info string makes it, read from its source line: `yaml` or `json` for a data block, `unsupported`
 * for a `data` marker this version does not define, and `prose` for any other fence.
 */
export type FenceMarker = "yaml" | "json" | "unsupported" | "prose";

/** A fenced code block at the top level of a record, as a data block reads it. */
export interface Fence {
  readonly marker: FenceMarker;
  /** The info string's words, split on spaces and tabs. */
  readonly words: readonly string[];
  /** The index of the fence's first character in the file's text. */
  readonly start: number;
  /** The content lines: from the line after the opening fence to the start of the closing fence's line, or the block's end. */
  readonly contentStart: number;
  readonly contentEnd: number;
  /** How many spaces indent the opening fence, which its content lines lose. */
  readonly indent: number;
  /** The index in the file's text after the block's last character. */
  readonly end: number;
}

/**
 * Reads a block of the record's tree, whose offsets plus `shift` are indexes into the file's `text`, as a fence; null for a
 * block that is not a fenced code block, an indented code block included.
 *
 * The info string is the source text after the fence's backticks or tildes, before CommonMark decodes its entity references
 * and backslash escapes, split into words on spaces and tabs and compared with case. Exactly the two words `yaml data` or
 * `json data` make a data block. A second word `data` after another first word, or a third word after either, is a marker
 * of a newer version.
 */
export function readFence(text: string, block: RootContent | undefined, shift: number): Fence | null {
  if (block?.type !== "code") return null;
  const start = shift + startOf(block);
  const fenceCharacter = text[start];
  if (fenceCharacter !== "`" && fenceCharacter !== "~") return null;
  let fenceEnd = start;
  while (text[fenceEnd] === fenceCharacter) fenceEnd += 1;
  const lineEnd = lineEndOf(text, start);
  const words = text
    .slice(fenceEnd, lineEnd)
    .split(/[ \t]+/)
    .filter((word) => word !== "");
  const end = shift + endOf(block);
  const contentStart = Math.min(nextLineStart(text, start), end);
  const closing = new RegExp(`^ {0,3}${fenceCharacter === "`" ? "`" : "~"}{${fenceEnd - start},}[ \\t]*$`);
  const lastLine = lineStartOf(text, end, shift);
  const contentEnd = lastLine >= contentStart && closing.test(text.slice(lastLine, end)) ? lastLine : end;
  return {
    marker: markerOf(words),
    words,
    start,
    contentStart,
    contentEnd: Math.max(contentStart, contentEnd),
    indent: start - lineStartOf(text, start, shift),
    end,
  };
}

function markerOf(words: readonly string[]): FenceMarker {
  if (words[1] !== "data") return "prose";
  return words.length === 2 && (words[0] === "yaml" || words[0] === "json") ? words[0] : "unsupported";
}

/** A node of a data block's value, as the record's index takes it. */
export interface DataBlockNode {
  readonly parent: string;
  readonly key: string | number;
  readonly init: NodeInit;
}

/** What a data block holds: its fields, unless it has a syntax error or holds no object, its nodes and its issues. */
export interface DataBlock {
  readonly value: ValueObject | null;
  readonly nodes: readonly DataBlockNode[];
  readonly issues: readonly Issue[];
}

/**
 * Parses the content of a data block as the unit its marker names, whose object holds the fields of the section at exact
 * path `at`: YAML as a YAML unit, its lines without the fence's indentation, and JSON as a JSON unit, whose indentation is
 * white space to JSON. An empty block, or one of only white space, gives no fields. The shape of a data block applies: `$`
 * members are `dollar-member` or `feature-unsupported`.
 */
export function parseDataBlock(
  path: string,
  source: SourceText,
  fence: Fence & { marker: "yaml" | "json" },
  at: string,
): DataBlock {
  const text = source.text;
  if (fence.marker === "yaml") {
    const unit =
      fence.indent === 0
        ? sliceUnitText(text, fence.contentStart, fence.contentEnd)
        : sliceIndentedUnitText(text, fence.contentStart, fence.contentEnd, fence.indent);
    const yaml = parseYamlUnit(source, unit, { path, at, unit: "data-block" });
    return { value: yaml.value ?? null, nodes: yaml.nodes, issues: yaml.issues };
  }
  // Deviation from the I1 design, recorded in issue #13: a JSON block is a plain slice without the per-line map of an
  // indented fence, since its indentation is white space to JSON and a JSON string cannot span lines.
  if (/^[ \t\r\n]*$/.test(text.slice(fence.contentStart, fence.contentEnd))) {
    return { value: Object.freeze(createValueObject()), nodes: [], issues: [] };
  }
  const nodes: DataBlockNode[] = [];
  // The first byte of each node's member range, or of its range, for the positions of the shape's issues.
  const starts = new Map<string, number>();
  const json = parseJsonUnit({
    path,
    source,
    start: fence.contentStart,
    end: fence.contentEnd,
    at,
    nodes: {
      add: (parent, key, init) => {
        nodes.push({ parent, key, init });
        const child = childPath(parent, key);
        starts.set(child, (init.memberRange ?? init.range).start);
        return child;
      },
    },
    notObjectCode: "data-block-not-object",
  });
  const issues = [...json.issues];
  if (json.value !== null) {
    const locate = (node: string): Position | undefined => {
      const start = starts.get(node) ?? (node === at ? source.byteOffset(fence.contentStart) : undefined);
      return start === undefined ? undefined : source.position(start);
    };
    issues.push(...checkShape("data-block", json.value, at, { path, locate }));
  }
  return { value: json.value, nodes, issues };
}
