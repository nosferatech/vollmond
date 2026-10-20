import type { Nodes, RootContent } from "mdast";
import { deriveAnchors } from "../../anchor/derived-anchors.js";
import { slugOf } from "../../anchor/slug.js";
import type { IssueCode } from "../../issue/codes.js";
import { type Issue, makeIssue } from "../../issue/issue.js";
import type { Outcome } from "../../issue/outcome.js";
import { childPath } from "../../record/exact-path.js";
import { NodeIndexBuilder } from "../../record/node-index.js";
import { type IgnoredAnchorElement, type ParsedRecord, parseOutcome } from "../../record/record.js";
import { nameRecord } from "../../record/record-names.js";
import type { ReferenceOccurrence } from "../../reference/reference.js";
import type { ByteRange, SourceText } from "../../text/source-text.js";
import { sliceUnitText } from "../../text/unit-text.js";
import { createValueObject, type MutableValueObject, type Value, type ValueObject } from "../../value/value.js";
import { parseYamlUnit } from "../yaml.js";
import { startOf } from "./anchor-element.js";
import { type BlockAnchor, type Body, BodyOffsets, findBody, readBlockAnchors } from "./body.js";
import { type DataBlock, type DataBlockNode, parseDataBlock, readFence } from "./data-block.js";
import { findFrontMatter } from "./front-matter.js";
import { type HeadingReading, readHeading, type TextRange } from "./heading.js";
import { parseMarkdownTree } from "./library.js";
import { lineStartOf, nextLineStart } from "./lines.js";
import { collectLinks } from "./links.js";

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
  /** The `<a id>` elements of every `$body` that anchor nothing, in document order. */
  readonly ignoredAnchorElements: readonly IgnoredAnchorElement[];
  /** The links, images and link reference definitions of every `$title` and `$body`, in document order. */
  readonly links: readonly ReferenceOccurrence[];
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
  return buildMarkdownRecord(readMarkdown(path, source));
}

/**
 * Reads a Markdown record: its front matter, its body as CommonMark with GFM 0.29's extensions, the section tree of its
 * top-level headings, the data blocks, the `$body` of each section, and the anchor elements of headings and blocks.
 *
 * - Front matter starts with a delimiter line at the start of the file, after a byte order mark. Unclosed, it is a
 *   `syntax-error` at the root, and nothing else is read. It is a YAML unit whose members are the root's fields.
 * - The body is parsed as the file's text after the front matter, its offsets shifted to the file's, so that every range is
 *   a range of the file. A body beyond a resource limit of the Markdown library's parse (containers nested too deep, too many
 *   runs of emphasis in a paragraph, table cell or heading) is a `syntax-error` at the root, and no section is read.
 * - Only the tree's top-level blocks make structure. The first block, not counting HTML blocks that hold only comments, is
 *   the title heading when it is a level-1 heading and the record's only one; several level-1 headings raise `multiple-h1`.
 *   Every other top-level heading starts a section, whose parent is the nearest earlier heading of a lower level.
 * - A section's data block is the fenced block right after its heading with the info string `yaml data` or `json data`; one
 *   whose fence is not closed is a `syntax-error` at its section. Such a block after the title heading, as the first block
 *   of a record without one (HTML blocks that hold only comments not counting, as for the title), or right after a data
 *   block, is `data-block-misplaced`, and a `syntax-error` too when it is not closed, at the root or the section; a `data`
 *   marker of a newer version in any of those places, or after a heading, is `feature-unsupported`.
 * - A section's `$body` runs from the line after its heading, or its data block, to the next top-level heading.
 */
export function readMarkdown(path: string, source: SourceText): MarkdownReading {
  const text = source.text;
  const issues: Issue[] = [];
  const raise = (code: IssueCode, at: string, message: string, index: number, offset?: number) => {
    const position = source.position(source.byteOffset(index));
    issues.push(makeIssue({ code, path, at, message, position, ...(offset === undefined ? {} : { offset }) }));
  };
  const nothing = (): MarkdownReading => ({
    path,
    source,
    issues,
    root: null,
    headings: [],
    blockAnchors: [],
    ignoredAnchorElements: [],
    links: [],
  });

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
    for (const issue of yaml.issues) issues.push(issue);
    if (yaml.value !== undefined) rootFields = { value: yaml.value, nodes: yaml.nodes };
    bodyStart = frontMatter.bodyStart;
  }

  // The library skips a U+FEFF that starts its text. One that starts the body is a character, so the parse starts one
  // character earlier: at the byte order mark, which it skips, or at the line break that ends the front matter.
  const parseStart = text.charCodeAt(bodyStart) === 0xfeff ? bodyStart - 1 : bodyStart;
  const shift = text.charCodeAt(parseStart) === 0xfeff ? parseStart + 1 : parseStart;
  const tree = parseMarkdownTree(text.slice(parseStart));
  if (!tree.ok) {
    raise("syntax-error", "", `the Markdown passes a resource limit: ${tree.message}`, shift + tree.limitAt);
    return nothing();
  }
  const blocks = tree.root.children;
  const headings: MarkdownHeading[] = [];
  const blockAnchors: BlockAnchor[] = [];
  const ignoredAnchorElements: IgnoredAnchorElement[] = [];
  const links: ReferenceOccurrence[] = [];
  /** Adds the links of `nodes`, which a `$title` or a `$body` at `at` holds, with `offsetOf` giving a place's offset in it. */
  const addLinks = (nodes: readonly Nodes[], at: string, offsetOf: (index: number) => number) => {
    for (const link of collectLinks(nodes, text, shift)) {
      const destination = link.destination;
      const start = destination === null ? 0 : shift + destination.start;
      const end = destination === null ? 0 : shift + destination.end;
      links.push({
        form: link.form,
        at,
        offset: offsetOf(shift + link.start),
        raw: text.slice(start, end),
        uri: link.url,
        ...(destination === null ? {} : { destination: { start: source.byteOffset(start), end: source.byteOffset(end) } }),
      });
    }
  };

  const levelOnes = blocks.filter((block) => block.type === "heading" && block.depth === 1);
  if (levelOnes.length > 1) {
    const message = `the record has ${levelOnes.length} level-1 headings, and so no title heading`;
    raise("multiple-h1", "", message, shift + startOf(levelOnes[1] as RootContent));
  }
  // HTML blocks of comments alone, such as `<!-- markdownlint-disable -->`, do not count as the first block for the title.
  let titleIndex = 0;
  while (isCommentsOnly(blocks[titleIndex])) titleIndex += 1;
  const first = blocks[titleIndex];
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
    addLinks(block.children, childPath(draft.at, "$title"), heading.titleOffsetOf);
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
    const bodyBlocks = blocks.slice(firstIndex, nextIndex);
    const found = readBlockAnchors(source, bodyBlocks, shift, body, bodyAt);
    for (const anchor of found.anchors) blockAnchors.push(anchor);
    for (const tag of found.ignored) {
      ignoredAnchorElements.push({ name: tag.id, at: bodyAt, position: source.position(source.byteOffset(tag.start)) });
    }
    for (const problem of found.problems) raise(problem.code, bodyAt, problem.message, problem.index, problem.offset);
    const offsets = new BodyOffsets(source, body.range);
    addLinks(bodyBlocks, bodyAt, (index) => offsets.valueOffset(index));
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
    index = titleIndex + 1;
    from = nextLineStart(text, heading.range.end);
  }
  // Where the root's data block would stand: right after the title heading, or else the first block, comments not counting.
  const rootFenceIndex = titleHeading === null ? titleIndex : index;
  const misplaced = readFence(text, blocks[rootFenceIndex], shift);
  if (misplaced?.marker === "yaml" || misplaced?.marker === "json") {
    const where = titleHeading === null ? "the first block of a record without a title heading" : "right after the title heading";
    const message = `a data block ${where} has no section; the root's fields come from front matter`;
    raise("data-block-misplaced", "", message, misplaced.start);
    if (!misplaced.closed) raise("syntax-error", "", UNCLOSED_MESSAGE, misplaced.start);
    const after = readFence(text, blocks[rootFenceIndex + 1], shift);
    if (after?.marker === "unsupported") raise("feature-unsupported", "", unsupportedMessage(after.words), after.start);
  } else if (misplaced?.marker === "unsupported") {
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
      if (fence.closed) {
        const dataBlock: DataBlock = parseDataBlock(path, source, { ...fence, marker: fence.marker }, draft.at);
        for (const issue of dataBlock.issues) issues.push(issue);
        if (dataBlock.value !== null) draft.fields = { value: dataBlock.value, nodes: dataBlock.nodes };
      } else {
        raise("syntax-error", draft.at, UNCLOSED_MESSAGE, fence.start);
      }
      after = fence.end;
      const second = readFence(text, blocks[index + 2], shift);
      if (second?.marker === "yaml" || second?.marker === "json") {
        raise("data-block-misplaced", draft.at, "a section has one data block, and this is a second", second.start);
        if (!second.closed) raise("syntax-error", draft.at, UNCLOSED_MESSAGE, second.start);
      } else if (second?.marker === "unsupported") {
        raise("feature-unsupported", draft.at, unsupportedMessage(second.words), second.start);
      }
    } else if (fence?.marker === "unsupported") {
      raise("feature-unsupported", draft.at, unsupportedMessage(fence.words), fence.start);
    }
    const next = nextHeadingIndex(index + 1);
    // The data block is among the body's blocks, which it does not change: a fence holds no HTML.
    readBodyOf(draft, nextLineStart(text, after), index + 1, next);
    index = next;
  }
  return { path, source, issues, root, headings, blockAnchors, ignoredAnchorElements, links };
}

// Deviation from the I1 design, recorded in issue #14: the derived anchors are computed here, after the structural check,
// rather than passed in, so that a record that cannot be read is never slugged.
/**
 * Builds a Markdown record from what {@link readMarkdown} read: fails with the structural errors when there is one, and
 * otherwise gives the value view, its index, the derived anchor of each heading, the anchor table, the section keys, and the
 * validation issues, those of the anchors and keys included.
 */
export function buildMarkdownRecord(reading: MarkdownReading): Outcome<ParsedRecord> {
  const { path, source } = reading;
  return parseOutcome(reading.issues, (issues) => {
    const headingSlugs = new Map<string, string>();
    const derivedAnchors = new Map<string, string>();
    const slugs = reading.headings.map((heading) => slugOf(heading.visibleText));
    deriveAnchors(slugs).forEach((anchor, index) => {
      const at = (reading.headings[index] as MarkdownHeading).at;
      headingSlugs.set(at, slugs[index] as string);
      if (anchor !== null) derivedAnchors.set(at, anchor);
    });
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
    const nodes = builder.build(derivedAnchors);
    return nameRecord(
      { path, format: "md", value, source, nodes, issues, links: reading.links },
      { headingSlugs, blockAnchors: reading.blockAnchors, ignoredAnchorElements: reading.ignoredAnchorElements },
    );
  });
}

/**
 * White space, then an HTML comment as CommonMark 0.31.2 reads one (section 6.6): `<!-->`, `<!--->`, or `<!--` to the first
 * `-->`; matched where the last match ended.
 */
const SPACE_THEN_COMMENT = /[ \t\r\n]*<!--(?:-?>|[\s\S]*?-->)/y;

/** Whether a block is an HTML block that holds only comments and white space. */
function isCommentsOnly(block: RootContent | undefined): boolean {
  if (block?.type !== "html") return false;
  const html = block.value;
  SPACE_THEN_COMMENT.lastIndex = 0;
  let end = 0;
  while (SPACE_THEN_COMMENT.test(html)) end = SPACE_THEN_COMMENT.lastIndex;
  return end > 0 && /^[ \t\r\n]*$/.test(html.slice(end));
}

/** The message of a data block whose fence is not closed, in its place or misplaced. */
const UNCLOSED_MESSAGE = "the data block's fence is not closed, so it would run to the end";

function unsupportedMessage(words: readonly string[]): string {
  return `the info string ${JSON.stringify(words.join(" "))} is not a data block of this version: only yaml data and json data are`;
}
