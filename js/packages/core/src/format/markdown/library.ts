import type { Nodes, PhrasingContent, Root } from "mdast";
import { type Extension, fromMarkdown, type Options, type Transform } from "mdast-util-from-markdown";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { parse } from "micromark";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { MAX_EMPHASIS_RUNS, MAX_NESTING } from "../limits.js";

// The types of micromark's constructs, which its package does not export by name, from the parser it does export.
type ParseContext = ReturnType<typeof parse>;
type ConstructRecord = ParseContext["constructs"]["document"];
type Construct = Extract<NonNullable<ConstructRecord[number]>, { tokenize: unknown }>;
type Tokenizer = Construct["tokenize"];
type TokenizeContext = ThisParameterType<Tokenizer>;
type State = Parameters<Tokenizer>[1];
type Code = Parameters<State>[0];
type MicromarkExtension = NonNullable<Options["extensions"]>[number];

// Deviation from the I1 design, recorded in issue #13: the library is imported with the module, not on first use, since
// parsing a record is synchronous.
// The autolink literal extension finds most literals with a tree transform, which recurses into every node: it overflows
// the stack at about 5,600 nested block quotes, where the parser and the compiler, which keep their own stacks, do not. So
// the transform runs here, after the nesting check, rather than inside the parse.
const { transforms: AUTOLINK_TRANSFORMS = [], ...autolinkLiteralFromMarkdown }: Extension = gfmAutolinkLiteralFromMarkdown();

/**
 * CommonMark with exactly the extensions of GitHub Flavored Markdown 0.29: tables, strikethrough, task list items and autolink
 * literals. The bundle of all of GitHub's extensions is not used, since its footnotes are not part of GFM 0.29 and change
 * block structure: a `[^1]: target` line is a link reference definition without them.
 */
const GFM_EXTENSIONS: readonly MicromarkExtension[] = [gfmTable(), gfmStrikethrough(), gfmTaskListItem(), gfmAutolinkLiteral()];
const GFM_FROM_MARKDOWN: readonly Extension[] = [
  gfmTableFromMarkdown(),
  gfmStrikethroughFromMarkdown(),
  gfmTaskListItemFromMarkdown(),
  autolinkLiteralFromMarkdown,
];

/** The library's own container constructs, block quotes and lists, by the character that starts them. */
const CONTAINERS: ReadonlyMap<number, Construct> = (() => {
  const document = parse().constructs.document;
  const found = new Map<number, Construct>();
  for (const [key, entry] of Object.entries(document)) {
    for (const construct of Array.isArray(entry) ? entry : [entry]) {
      if (construct !== undefined && (construct.name === "blockQuote" || construct.name === "list")) {
        found.set(Number(key), construct);
      }
    }
  }
  // `>` for block quotes; `*`, `+`, `-` and the ten digits for lists.
  if (found.size !== 14) throw new Error(`the Markdown library has ${found.size} container starts, where 14 were expected`);
  return found;
})();

/** The characters whose runs are counted: `*`, `_` and `~`. */
const RUN_CHARACTERS: readonly number[] = [0x2a, 0x5f, 0x7e];

/**
 * The inline node types that hold other inline nodes, whose nesting the specification's nesting limit bounds within each block
 * (see {@link parseMarkdownTree}).
 */
const INLINE_NESTING_TYPES: ReadonlySet<Nodes["type"]> = new Set(["emphasis", "strong", "delete", "link", "linkReference"]);

/** The extension that bounds the nesting of containers, made once: it keeps its counts per parse. */
const CONTAINER_DEPTH: MicromarkExtension = containerDepthExtension();

/** The options of a record's parse, made once rather than for every record. */
const RECORD_OPTIONS: Options = optionsOf([CONTAINER_DEPTH, runCountExtension([])]);

/** The syntax tree of a Markdown text, or where it passes a resource limit and why. */
export type MarkdownTree =
  | { readonly ok: true; readonly root: Root }
  | {
      readonly ok: false;
      /** The index into the text where the limit is passed: the container, the run or the inline node too many. */
      readonly limitAt: number;
      /** Which limit, for people. */
      readonly message: string;
    };

/** A limit passed inside the library's parse, which this module throws there to stop it and catches. */
class LimitPassed extends Error {
  readonly at: number;
  readonly kind: "nesting" | "runs";

  constructor(kind: "nesting" | "runs", at: number) {
    super(kind === "nesting" ? `containers nest more than ${MAX_NESTING} deep` : `more than ${MAX_EMPHASIS_RUNS} runs`);
    this.kind = kind;
    this.at = at;
  }
}

// The specification's nesting limit covers inline nodes that hold inline nodes, since a single run of 10,000 `*` nests 5,000
// levels of emphasis, which the run limit allows and the autolink transform's recursion does not.
/**
 * Parses a Markdown text into its syntax tree, whose positions are UTF-16 indexes into `text`, with tabs counted as one
 * character, a CRLF as two, and one exception: a U+FEFF at index 0 is skipped, and the indexes count from the character after
 * it. A caller that reads U+FEFF as content passes a text that does not start with one.
 *
 * The resource limits of a Markdown record hold, and a text beyond one gives no tree:
 *
 * - block quotes and list items nest at most {@link MAX_NESTING} deep, a container at the top counting as level 1. The parse
 *   stops at the first container too deep, so that the text after it costs nothing;
 * - a paragraph or a table cell holds at most {@link MAX_EMPHASIS_RUNS} runs of `*`, `_` or `~`. A run is one that starts a
 *   delimiter run where the library reads inline content, so a backslash escape, a code span, raw HTML or an autolink holds
 *   none. A heading's runs are not counted. The parse stops at the first run too many, before the library resolves the
 *   emphasis, whose cost grows with the square of the runs;
 * - inline nodes that hold inline nodes (emphasis, strong, strikethrough, links and link references) nest at most
 *   {@link MAX_NESTING} deep within their block.
 *
 * Costs time linear in the text, but for the library's own costs, and a second parse of the text without emphasis when a
 * heading passes the limit of runs, to tell it from a paragraph.
 */
export function parseMarkdownTree(text: string): MarkdownTree {
  let headings: readonly IndexRange[] = [];
  for (;;) {
    let root: Root;
    try {
      const options = headings.length === 0 ? RECORD_OPTIONS : optionsOf([CONTAINER_DEPTH, runCountExtension(headings)]);
      root = fromMarkdown(text, options);
    } catch (error) {
      if (!(error instanceof LimitPassed)) throw error;
      if (error.kind === "runs" && headings.length === 0) {
        // Runs are counted in inline content, which the library reads after every container, so the containers are within
        // their limit here.
        const found = headingRangesOf(text);
        if (found.some((range) => range.start <= error.at && error.at < range.end)) {
          headings = found;
          continue;
        }
      }
      return { ok: false, limitAt: error.at, message: error.message };
    }
    const tooDeepAt = inlineNestedBeyond(root, MAX_NESTING);
    if (tooDeepAt !== null) {
      return { ok: false, limitAt: tooDeepAt, message: `inline nodes nest more than ${MAX_NESTING} deep` };
    }
    for (const transform of AUTOLINK_TRANSFORMS as readonly Transform[]) root = transform(root) ?? root;
    return { ok: true, root };
  }
}

/**
 * Parses a text as a heading's inline content, as a JSON or YAML section's `$title` is read: a line break is a soft break, no
 * closing sequence is stripped, nothing in it starts a block, and the link reference definitions whose labels are `labels`,
 * as written in their definitions, are in scope. Returns its inline nodes, a blank line between two of its lines giving a
 * text node of two line feeds, or null when its inline nodes nest deeper than {@link MAX_NESTING}. Runs are not counted.
 */
export function parseInlineContent(text: string, labels: readonly string[]): readonly PhrasingContent[] | null {
  const identifiers = labels.map(normalizeIdentifier);
  const defineLabels: Construct = {
    partial: true,
    tokenize(_effects, _ok, nok) {
      const defined = this.parser.defined;
      for (const identifier of identifiers) if (!defined.includes(identifier)) defined.push(identifier);
      return nok;
    },
  };
  const blocks = ["blockQuote", "list", "codeFenced", "codeIndented", "headingAtx", "htmlFlow", "setextUnderline"];
  const extensions: MicromarkExtension[] = [
    { document: { null: defineLabels }, disable: { null: [...blocks, "thematicBreak", "definition", "table"] } },
  ];
  const root = fromMarkdown(text, optionsOf(extensions));
  if (inlineNestedBeyond(root, MAX_NESTING) !== null) return null;
  let transformed = root;
  for (const transform of AUTOLINK_TRANSFORMS as readonly Transform[]) transformed = transform(transformed) ?? transformed;
  const content: PhrasingContent[] = [];
  for (const block of transformed.children) {
    if (block.type !== "paragraph") throw new Error(`a heading's content parsed as a ${block.type}`);
    if (content.length > 0) content.push({ type: "text", value: "\n\n" });
    content.push(...block.children);
  }
  return content;
}

/**
 * Finds the labels of the link reference definitions in a Markdown text, as written, in document order, at any depth of
 * containers. A text beyond a resource limit has none.
 */
export function definitionLabelsIn(text: string): string[] {
  const tree = parseMarkdownTree(text);
  if (!tree.ok) return [];
  const labels: string[] = [];
  const pending: Nodes[] = [tree.root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === "definition") labels.push(node.label ?? node.identifier);
    if ("children" in node) for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i] as Nodes);
  }
  return labels;
}

/** The library's options: GFM 0.29's extensions, then `extensions`. */
function optionsOf(extensions: readonly MicromarkExtension[]): Options {
  return { extensions: [...GFM_EXTENSIONS, ...extensions], mdastExtensions: [...GFM_FROM_MARKDOWN] };
}

/** A range of a text, `[start, end)`, in UTF-16 indexes. */
interface IndexRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Finds the headings of a text, which hold runs that are not counted, by a parse without emphasis and strikethrough, whose
 * cost does not grow with the square of the runs. The text's containers must be known to nest within the limit, as they are
 * once a parse has reached its inline content: the library reads every container before any inline text.
 */
function headingRangesOf(text: string): IndexRange[] {
  const root = fromMarkdown(text, optionsOf([{ disable: { null: ["attention", "strikethrough"] } }]));
  const ranges: IndexRange[] = [];
  const pending: Nodes[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === "heading") {
      ranges.push({ start: node.position?.start.offset ?? 0, end: node.position?.end.offset ?? 0 });
    } else if ("children" in node) {
      for (const child of node.children) pending.push(child as Nodes);
    }
  }
  return ranges;
}

/** The depth that a container's state holds, from 1 for a container at the top. */
const DEPTH = Symbol("vmd container depth");

/**
 * An extension that counts the depth of block quotes and lists as the library opens them, and stops the parse with a
 * {@link LimitPassed} at the first one deeper than {@link MAX_NESTING}. A list item that holds a list is one level, as the
 * library's list containers are one per level.
 *
 * The library's own containers are wrapped, and tried first. On each line, the library continues the open containers in order
 * and then tries new ones, each after the last; a container that a check finds is found again by the attempt that follows, at
 * the same place. So a new container's depth is one more than that of the last container continued or opened on its line
 * that ends before it starts, which a stack of the line's marks gives. The marks are kept per parse, by the library's parser,
 * so that the extension is made once.
 */
function containerDepthExtension(): MicromarkExtension {
  const parses = new WeakMap<ParseContext, { line: number; marks: { end: number; depth: number }[] }>();
  /** The marks of the parse of `context` on `line`, emptied when the line is a new one. */
  const marksOn = (context: TokenizeContext, line: number) => {
    let parse = parses.get(context.parser);
    if (parse === undefined) {
      parse = { line, marks: [] };
      parses.set(context.parser, parse);
    } else if (parse.line !== line) {
      parse.line = line;
      parse.marks.length = 0;
    }
    return parse.marks;
  };
  const counted = (construct: Construct): Construct => {
    const continuation = construct.continuation as Construct;
    return {
      ...construct,
      tokenize(effects, ok, nok) {
        const start = this.now();
        return construct.tokenize.call(
          this,
          effects,
          (code: Code) => {
            const marks = marksOn(this, start.line);
            while (marks.length > 0 && (marks.at(-1)?.end as number) > start.offset) marks.pop();
            const depth = (marks.at(-1)?.depth ?? 0) + 1;
            if (depth > MAX_NESTING) throw new LimitPassed("nesting", start.offset);
            (this.containerState as Record<symbol, number>)[DEPTH] = depth;
            marks.push({ end: this.now().offset, depth });
            return ok(code);
          },
          nok,
        );
      },
      continuation: {
        ...continuation,
        tokenize(effects, ok, nok) {
          return continuation.tokenize.call(
            this,
            effects,
            (code: Code) => {
              const end = this.now();
              const depth = (this.containerState as Record<symbol, number | undefined>)[DEPTH];
              const marks = marksOn(this, end.line);
              if (depth !== undefined) marks.push({ end: end.offset, depth });
              return ok(code);
            },
            nok,
          );
        },
      },
    };
  };
  const document: Record<number, Construct> = {};
  for (const [code, construct] of CONTAINERS) document[code] = counted(construct);
  return { document };
}

/**
 * An extension that counts the runs of `*`, `_` and `~` of each inline text the library reads: a paragraph's, a table cell's
 * or a heading's, each read by a tokenizer of its own. It stops the parse with a {@link LimitPassed} at the first run beyond
 * {@link MAX_EMPHASIS_RUNS} in one text, unless that text starts inside one of `headings`.
 *
 * The library tries the counter at each run's first character, and the emphasis construct then takes the whole run. A run of
 * `~` that is not strikethrough is taken one character at a time, so a character right after the last one counted continues
 * its run.
 */
function runCountExtension(headings: readonly IndexRange[]): MicromarkExtension {
  const texts = new WeakMap<TokenizeContext, { runs: number; last: number; exempt: boolean }>();
  const counter: Construct = {
    partial: true,
    tokenize(_effects, _ok, nok) {
      const at = this.now().offset;
      return (code: Code) => {
        let text = texts.get(this);
        if (text === undefined) {
          text = { runs: 0, last: -2, exempt: headings.some((range) => range.start <= at && at < range.end) };
          texts.set(this, text);
        }
        if (!text.exempt && !(text.last === at - 1 && this.previous === code)) {
          text.runs += 1;
          if (text.runs > MAX_EMPHASIS_RUNS) throw new LimitPassed("runs", at);
        }
        text.last = at;
        return nok(code);
      };
    },
  };
  const text: Record<number, Construct> = {};
  for (const code of RUN_CHARACTERS) text[code] = counter;
  return { text };
}

/**
 * Normalizes a link label as CommonMark matches labels, and as the library keeps them: white space runs read as one space, the
 * ends trimmed, and case folded.
 */
function normalizeIdentifier(label: string): string {
  return label
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase()
    .toUpperCase();
}

/**
 * Finds the first inline node in document order nested deeper than `limit` among inline nodes that hold inline nodes, counted
 * from its block, without recursion, and returns its start, or null when there is none.
 */
function inlineNestedBeyond(root: Root, limit: number): number | null {
  const pending: [Nodes, number][] = [[root, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [node, depth] = next;
    const level = INLINE_NESTING_TYPES.has(node.type) ? depth + 1 : depth;
    if (level > limit) return node.position?.start.offset ?? 0;
    if ("children" in node) {
      // The last child first, so that the walk visits the nodes in document order.
      for (let i = node.children.length - 1; i >= 0; i--) pending.push([node.children[i] as Nodes, level]);
    }
  }
  return null;
}
