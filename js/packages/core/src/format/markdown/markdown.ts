import type { RootContent } from "mdast";
import type { IssueCode } from "../../issue/codes.js";
import { type Issue, makeIssue } from "../../issue/issue.js";
import type { Outcome } from "../../issue/outcome.js";
import { childPath } from "../../record/exact-path.js";
import { NodeIndexBuilder } from "../../record/node-index.js";
import { type ParsedRecord, parseOutcome } from "../../record/record.js";
import type { ByteRange, SourceText } from "../../text/source-text.js";
import { sliceUnitText } from "../../text/unit-text.js";
import { createValueObject, type MutableValueObject, type Value, type ValueObject } from "../../value/value.js";
import { parseYamlUnit } from "../yaml.js";
import { startOf } from "./anchor-element.js";
import { type BlockAnchor, type Body, findBody, readBlockAnchors } from "./body.js";
import { type DataBlock, type DataBlockNode, parseDataBlock, readFence } from "./data-block.js";
import { findFrontMatter } from "./front-matter.js";
import { type HeadingReading, readHeading, type TextRange } from "./heading.js";
import { parseMarkdownTree } from "./library.js";
import { lineStartOf, nextLineStart } from "./lines.js";

/** A heading that names a node: the title heading, at the root, or a section's. */
export interface MarkdownHeading {
  /** The exact path of the section the heading starts, `""` for the title heading. */
  readonly at: string;
  readonly level: number;
  /** The text a reader sees in the heading, from which its slug is derived. */
  readonly visibleText: string;
}

/** A Markdown record as its parse units and its tree give it, before its value and its index are built. */
export interface MarkdownReading {
  readonly path: string;
  readonly source: SourceText;
  /** Every issue found, structural or not, in document order within each unit. */
  readonly issues: readonly Issue[];
  /** The root section's plan; null when the record cannot have a value view, as with unclosed front matter. */
  readonly root: SectionPlan | null;
  /** The title heading, if any, and every section's heading, in document order. */
  readonly headings: readonly MarkdownHeading[];
  /** The block anchors of every `$body`, in document order. */
  readonly blockAnchors: readonly BlockAnchor[];
}

/** What a section, or the root, is made of: its heading, its fields, its body and its children. */
export interface SectionPlan {
  readonly at: string;
  /** The heading's level, 0 for the root. */
  readonly level: number;
  /** From the start of its heading's line to the start of the heading that ends it, or the end of the file; the whole file for the root. */
  readonly range: TextRange;
  readonly heading: HeadingReading | null;
  /** The fields: the front matter's for the root, the data block's for a section; null for none. */
  readonly fields: { readonly value: ValueObject; readonly nodes: readonly DataBlockNode[] } | null;
  readonly body: Body | null;
  readonly children: readonly SectionPlan[];
}

/** A section plan while the walk still finds its children and the end of its range. */
interface SectionDraft {
  at: string;
  level: number;
  range: { start: number; end: number };
  heading: HeadingReading | null;
  fields: SectionPlan["fields"];
  body: Body | null;
  children: SectionDraft[];
}

/**
 * Parses a Markdown record from its decoded file into its value view, or fails with its structural errors. See
 * {@link readMarkdown} for what it reads; the validation issues go on the record.
 */
export function parseMarkdownRecord(path: string, source: SourceText): Outcome<ParsedRecord> {
  const reading = readMarkdown(path, source);
  // TODO(#14): headings get no derived anchor until the slug rule lands, which maps `reading.headings` to them here.
  return buildMarkdownRecord(reading, new Map());
}

/**
 * Reads a Markdown record: its front matter, its body as CommonMark with GFM 0.29's extensions, the section tree of its
 * top-level headings, the data blocks, the `$body` of each section, and the anchor elements of headings and blocks.
 *
 * - Front matter starts with a delimiter line at the start of the file, after a byte order mark. Unclosed, it is a
 *   `syntax-error` at the root, and nothing else is read. It is a YAML unit whose members are the root's fields.
 * - The body is parsed as the file's text after the front matter, its offsets shifted to the file's, so that every range is
 *   a range of the file. Containers nested deeper than the limit are a `syntax-error` at the root, and no section is read.
 * - Only the tree's top-level blocks make structure. The first block is the title heading when it is a level-1 heading and
 *   the record's only one; several level-1 headings raise `multiple-h1`. Every other top-level heading starts a section,
 *   whose parent is the nearest earlier heading of a lower level.
 * - A section's data block is the fenced block right after its heading with the info string `yaml data` or `json data`.
 *   Such a block after the title heading, as the first block of a record without one, or right after a data block, is
 *   `data-block-misplaced`; a `data` marker of a newer version after a heading is `feature-unsupported`.
 * - A section's `$body` runs from the line after its heading, or its data block, to the next top-level heading.
 */
export function readMarkdown(path: string, source: SourceText): MarkdownReading {
  const text = source.text;
  const issues: Issue[] = [];
  const raise = (code: IssueCode, at: string, message: string, index: number, offset?: number) => {
    const position = source.position(source.byteOffset(index));
    issues.push(makeIssue({ code, path, at, message, position, ...(offset === undefined ? {} : { offset }) }));
  };
  const nothing = (): MarkdownReading => ({ path, source, issues, root: null, headings: [], blockAnchors: [] });

  const afterBom = source.hasBom ? 1 : 0;
  const frontMatter = findFrontMatter(text, afterBom);
  if (frontMatter.kind === "unclosed") {
    raise("syntax-error", "", "front matter is not closed: no --- line follows the first", afterBom);
    return nothing();
  }
  let rootFields: SectionPlan["fields"] = null;
  let bodyStart = afterBom;
  if (frontMatter.kind === "closed") {
    const unit = sliceUnitText(text, frontMatter.contentStart, frontMatter.contentEnd);
    const yaml = parseYamlUnit(source, unit, { path, at: "", unit: "front-matter" });
    issues.push(...yaml.issues);
    if (yaml.value !== undefined) rootFields = { value: yaml.value, nodes: yaml.nodes };
    bodyStart = frontMatter.bodyStart;
  }

  // The library skips a U+FEFF that starts its text. One that starts the body is a character, so the parse starts one
  // character earlier: at the byte order mark, which it skips, or at the line break that ends the front matter.
  const parseStart = text.charCodeAt(bodyStart) === 0xfeff ? bodyStart - 1 : bodyStart;
  const shift = text.charCodeAt(parseStart) === 0xfeff ? parseStart + 1 : parseStart;
  const tree = parseMarkdownTree(text.slice(parseStart));
  if (!tree.ok) {
    raise("syntax-error", "", "Markdown containers are nested too deep for vmd to read", shift + tree.tooDeepAt);
    return nothing();
  }
  const blocks = tree.root.children;
  const headings: MarkdownHeading[] = [];
  const blockAnchors: BlockAnchor[] = [];

  const levelOnes = blocks.filter((block) => block.type === "heading" && block.depth === 1);
  if (levelOnes.length > 1) {
    const message = `the record has ${levelOnes.length} level-1 headings, and so no title heading`;
    raise("multiple-h1", "", message, shift + startOf(levelOnes[1] as RootContent));
  }
  const first = blocks[0];
  const titleHeading = first?.type === "heading" && first.depth === 1 && levelOnes.length === 1 ? first : null;

  const root: SectionDraft = {
    at: "",
    level: 0,
    range: { start: 0, end: text.length },
    heading: null,
    fields: rootFields,
    body: null,
    children: [],
  };
  /** Raises a heading's problems at its section, and records it. */
  const readHeadingOf = (draft: SectionDraft, block: RootContent & { type: "heading" }) => {
    const heading = readHeading(text, block, shift);
    draft.heading = heading;
    for (const problem of heading.problems) raise(problem.code, draft.at, problem.message, problem.index);
    if (heading.multiLine) {
      const message = "a title of several lines cannot be written back as a heading";
      raise("not-representable", childPath(draft.at, "$title"), message, heading.titleRange.start);
    }
    headings.push({ at: draft.at, level: heading.level, visibleText: heading.visibleText });
    return heading;
  };
  /** Reads the `$body` of `draft` from `from` to the block at `nextIndex`, a heading, or the end. */
  const readBodyOf = (draft: SectionDraft, from: number, firstIndex: number, nextIndex: number) => {
    const next = blocks[nextIndex];
    // The spaces before an indented heading are trimmed away with the body's trailing white space.
    const to = next === undefined ? text.length : shift + startOf(next);
    const body = findBody(text, from, to);
    draft.body = body;
    if (body === null) return;
    const bodyAt = childPath(draft.at, "$body");
    const found = readBlockAnchors(source, blocks.slice(firstIndex, nextIndex), shift, body, bodyAt);
    blockAnchors.push(...found.anchors);
    for (const problem of found.problems) raise(problem.code, bodyAt, problem.message, problem.index, problem.offset);
  };
  const nextHeadingIndex = (from: number) => {
    let index = from;
    while (index < blocks.length && blocks[index]?.type !== "heading") index += 1;
    return index;
  };

  let index = 0;
  let from = bodyStart;
  if (titleHeading !== null) {
    const heading = readHeadingOf(root, titleHeading);
    index = 1;
    from = nextLineStart(text, heading.range.end);
  }
  const misplaced = readFence(text, blocks[index], shift);
  if (misplaced?.marker === "yaml" || misplaced?.marker === "json") {
    const where = titleHeading === null ? "the first block of a record without a title heading" : "right after the title heading";
    const message = `a data block ${where} has no section; the root's fields come from front matter`;
    raise("data-block-misplaced", "", message, misplaced.start);
  } else if (misplaced?.marker === "unsupported" && titleHeading !== null) {
    raise("feature-unsupported", "", unsupportedMessage(misplaced.words), misplaced.start);
  }
  const firstSection = nextHeadingIndex(index);
  readBodyOf(root, from, index, firstSection);

  const open: SectionDraft[] = [root];
  for (index = firstSection; index < blocks.length; ) {
    const block = blocks[index] as RootContent & { type: "heading" };
    const lineStart = lineStartOf(text, shift + startOf(block), shift);
    while ((open.at(-1) as SectionDraft).level >= block.depth) (open.pop() as SectionDraft).range.end = lineStart;
    const parent = open.at(-1) as SectionDraft;
    const draft: SectionDraft = {
      at: childPath(childPath(parent.at, "$sections"), parent.children.length),
      level: block.depth,
      range: { start: lineStart, end: text.length },
      heading: null,
      fields: null,
      body: null,
      children: [],
    };
    parent.children.push(draft);
    open.push(draft);
    const heading = readHeadingOf(draft, block);

    let after = heading.range.end;
    const fence = readFence(text, blocks[index + 1], shift);
    if (fence?.marker === "yaml" || fence?.marker === "json") {
      const dataBlock: DataBlock = parseDataBlock(path, source, { ...fence, marker: fence.marker }, draft.at);
      issues.push(...dataBlock.issues);
      if (dataBlock.value !== null) draft.fields = { value: dataBlock.value, nodes: dataBlock.nodes };
      after = fence.end;
      const second = readFence(text, blocks[index + 2], shift);
      if (second?.marker === "yaml" || second?.marker === "json") {
        raise("data-block-misplaced", draft.at, "a section has one data block, and this is a second", second.start);
      }
    } else if (fence?.marker === "unsupported") {
      raise("feature-unsupported", draft.at, unsupportedMessage(fence.words), fence.start);
    }
    const next = nextHeadingIndex(index + 1);
    // The data block is among the body's blocks, which it does not change: a fence holds no HTML.
    readBodyOf(draft, nextLineStart(text, after), index + 1, next);
    index = next;
  }
  return { path, source, issues, root, headings, blockAnchors };
}

/**
 * Builds a Markdown record from what {@link readMarkdown} read: fails with the structural errors when there is one, and
 * otherwise gives the value view, its index, with `derivedAnchors` mapping the exact path of each section with a heading to
 * its derived anchor, and the validation issues.
 */
export function buildMarkdownRecord(
  reading: MarkdownReading,
  derivedAnchors: ReadonlyMap<string, string>,
): Outcome<ParsedRecord> {
  const { path, source } = reading;
  return parseOutcome(reading.issues, (issues) => {
    const root = reading.root;
    if (root === null) throw new Error("a Markdown record without a section plan raised no structural error");
    const bytes = (range: TextRange): ByteRange => ({
      start: source.byteOffset(range.start),
      end: source.byteOffset(range.end),
    });
    const titleHeading = root.heading;
    const builder = new NodeIndexBuilder({
      range: bytes(root.range),
      ...(titleHeading === null ? {} : { heading: { level: titleHeading.level, range: bytes(titleHeading.range) } }),
    });

    /** Adds the members of a section, whose own node is in the index already, and returns its value. */
    const section = (plan: SectionPlan): ValueObject => {
      const object: MutableValueObject = createValueObject();
      const fields = () => {
        if (plan.fields === null) return;
        for (const node of plan.fields.nodes) builder.add(node.parent, node.key, node.init);
        for (const [name, value] of Object.entries(plan.fields.value)) object[name] = value;
      };
      if (plan.level === 0) fields();
      const heading = plan.heading;
      if (heading !== null) {
        builder.add(plan.at, "$title", { kind: "string", range: bytes(heading.titleRange) });
        object.$title = heading.title;
        const elementRange = heading.elementRange === null ? null : bytes(heading.elementRange);
        if (heading.anchor !== null && elementRange !== null) {
          builder.add(plan.at, "$anchor", { kind: "string", range: elementRange });
          object.$anchor = heading.anchor;
        }
        if (heading.tags.length > 0 && elementRange !== null) {
          const tagsAt = builder.add(plan.at, "$tags", { kind: "array", range: elementRange });
          heading.tags.forEach((tag, index) => {
            builder.add(tagsAt, index, { kind: "string", range: bytes(tag.range) });
          });
          object.$tags = Object.freeze(heading.tags.map((tag) => tag.name));
        }
      }
      if (plan.level > 0) fields();
      if (plan.body !== null) {
        builder.add(plan.at, "$body", { kind: "string", range: bytes(plan.body.range) });
        object.$body = plan.body.value;
      }
      const firstChild = plan.children[0];
      if (firstChild !== undefined) {
        const range = { start: firstChild.range.start, end: plan.range.end };
        const sectionsAt = builder.add(plan.at, "$sections", { kind: "array", range: bytes(range) });
        const children: Value[] = plan.children.map((child, index) => {
          const childHeading = child.heading as HeadingReading;
          builder.add(sectionsAt, index, {
            kind: "object",
            range: bytes(child.range),
            heading: { level: childHeading.level, range: bytes(childHeading.range) },
          });
          return section(child);
        });
        object.$sections = Object.freeze(children);
      }
      return Object.freeze(object);
    };

    const value = section(root);
    return { path, format: "md", value, source, nodes: builder.build(derivedAnchors), issues };
  });
}

function unsupportedMessage(words: readonly string[]): string {
  return `the info string ${JSON.stringify(words.join(" "))} is not a data block of this version: only yaml data and json data are`;
}
