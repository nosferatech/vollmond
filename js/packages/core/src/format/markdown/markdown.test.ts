import { parse as libraryParse } from "micromark";
import { describe, expect, test } from "vitest";
import { ISSUE_CODES, type IssueCode } from "../../issue/codes.js";
import type { Issue } from "../../issue/issue.js";
import type { Outcome } from "../../issue/outcome.js";
import type { ParsedRecord } from "../../record/record.js";
import type { ByteRange } from "../../text/source-text.js";
import { decodeSource, type SourceText } from "../../text/source-text.js";
import { hasMember, type Value } from "../../value/value.js";
import { MAX_NESTING } from "../limits.js";
import { type MarkdownReading, parseMarkdownRecord, readMarkdown } from "./markdown.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

/** A construct of the Markdown library, the type its package does not export by name. */
type Construct = Extract<NonNullable<ReturnType<typeof libraryParse>["constructs"]["document"][number]>, { tokenize: unknown }>;

/**
 * The Markdown library's construct `name` among those it tries at `character` in `content`: one object that every parse uses,
 * so that counting the calls of its methods counts the work of every parse.
 */
function libraryConstruct(content: "document" | "text", character: string, name: string): Construct {
  const entry = libraryParse().constructs[content][character.charCodeAt(0)];
  const construct = (Array.isArray(entry) ? entry : [entry]).find((candidate) => candidate?.name === name);
  if (construct === undefined) throw new Error(`the Markdown library has no ${name} at ${character}`);
  return construct;
}

/** A method of the Markdown library's, as {@link callsDuring} wraps it. */
type LibraryMethod = (this: never, ...args: never[]) => unknown;

/**
 * Counts the calls of `object`'s method `method` while `run` runs, and restores the method. Unlike a spy, it keeps no call's
 * arguments, so that millions of calls cost no memory.
 */
function callsDuring<K extends string>(
  object: { [key in K]?: LibraryMethod | undefined },
  method: K,
  run: () => unknown,
): number {
  const original = object[method];
  if (original === undefined) throw new Error(`no method ${method}`);
  let calls = 0;
  object[method] = function (this: never, ...args: never[]) {
    calls += 1;
    return original.apply(this, args);
  };
  try {
    run();
  } finally {
    object[method] = original;
  }
  return calls;
}

function decoded(text: string): SourceText {
  const outcome = decodeSource("r.md", utf8(text));
  if (!outcome.ok) throw new Error("not UTF-8");
  return outcome.value;
}

function parse(text: string): Outcome<ParsedRecord> {
  return parseMarkdownRecord("r.md", decoded(text));
}

function read(text: string): MarkdownReading {
  return readMarkdown("r.md", decoded(text));
}

/** The record of a text that parses, failing the test otherwise. */
function record(text: string): ParsedRecord {
  const outcome = parse(text);
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return outcome.value;
}

function valueView(text: string): Value {
  return record(text).value;
}

/** The code and `at` of each issue of a parse, failed or not. */
function issuesOf(text: string): [IssueCode, string | null][] {
  const outcome = parse(text);
  const issues: readonly Issue[] = outcome.ok ? outcome.value.issues : outcome.issues;
  return issues.map((issue) => [issue.code, issue.at]);
}

/** The UTF-8 byte range of the `occurrence`-th appearance of `part` in `text`. */
function bytesOf(text: string, part: string, occurrence = 0): ByteRange {
  let index = -1;
  for (let i = 0; i <= occurrence; i++) {
    index = text.indexOf(part, index + 1);
    if (index < 0) throw new Error(`${JSON.stringify(part)} is not in the text`);
  }
  const start = utf8(text.slice(0, index)).length;
  return { start, end: start + utf8(part).length };
}

/** The UTF-8 byte range of `text` from `start`, the start of one part, to `end`, the start of another, or the end. */
function bytesBetween(text: string, start: string, end: string | null): ByteRange {
  const from = bytesOf(text, start).start;
  return { start: from, end: end === null ? utf8(text).length : bytesOf(text, end).start };
}

/** The range of the node at `at`, failing the test when there is none. */
function rangeAt(parsed: ParsedRecord, at: string): ByteRange {
  const node = parsed.nodes.node(at);
  if (node === undefined) throw new Error(`no node at ${at}`);
  return node.range;
}

describe("front matter", () => {
  test("is the YAML between a --- line at the start and the next, whose members are the root's fields", () => {
    expect(valueView("---\nstatus: Open\nruns: [1, 2]\n---\n# Title\n\nText.\n")).toEqual({
      status: "Open",
      runs: [1, 2],
      $title: "Title",
      $body: "Text.",
    });
  });

  test("unclosed, it is a syntax error at the root, and nothing else is read", () => {
    expect(issuesOf("---\nstatus: Open\n\n# Title\n\n```yaml data\na: 1\n```\n")).toEqual([["syntax-error", ""]]);
    expect(issuesOf("---")).toEqual([["syntax-error", ""]]);
    expect(issuesOf("---\n")).toEqual([["syntax-error", ""]]);
  });

  test("near miss: a delimiter line may end with spaces and tabs, and the closing one may end the file", () => {
    expect(valueView("--- \t\na: 1\n---\t")).toEqual({ a: 1 });
    expect(valueView("---\n---")).toEqual({});
  });

  test("a line that only starts with --- is not a delimiter, and neither is an indented one", () => {
    expect(valueView("----\na\n")).toEqual({ $body: "----\na" });
    expect(valueView(" ---\na\n")).toEqual({ $body: " ---\na" });
    expect(issuesOf("---\nnotes: |\n  ---\n")).toEqual([["syntax-error", ""]]);
    expect(valueView("--\n# T\n")).toEqual({ $body: "--", $sections: [{ $title: "T" }] });
  });

  test("its line breaks may be CRLF or a lone CR", () => {
    expect(valueView("---\r\na: 1\r\n---\r\n# T\r\n")).toEqual({ a: 1, $title: "T" });
    expect(valueView("---\ra: 1\r---\r# T\r")).toEqual({ a: 1, $title: "T" });
  });

  test("a front matter that holds no mapping is data-block-not-object at the root", () => {
    expect(issuesOf("---\n- 1\n---\n")).toEqual([["data-block-not-object", ""]]);
    expect(valueView("---\n# only a comment\n---\n")).toEqual({});
  });

  test("a member named __proto__ is an ordinary field", () => {
    const value = valueView('---\n"__proto__": 1\n---\n') as { readonly [name: string]: Value };
    expect(hasMember(value, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toBe(1);
  });

  test("a $ member that a heading also gives fails, without a clash in the index", () => {
    expect(issuesOf("---\n$title: X\n$body: Y\n---\n# Title\n\nText.\n")).toEqual([
      ["dollar-member", "/$title"],
      ["dollar-member", "/$body"],
    ]);
  });
});

describe("the body unit", () => {
  test("a U+FEFF that starts the body after front matter is text, which the library would skip", () => {
    const text = "---\na: 1\n---\n\u{FEFF}# Title\n\n## Part\n";
    const parsed = record(text);
    expect(parsed.value).toEqual({ a: 1, $body: "\u{FEFF}# Title", $sections: [{ $title: "Part" }] });
    expect(rangeAt(parsed, "/$body")).toEqual(bytesOf(text, "\u{FEFF}# Title"));
    expect(rangeAt(parsed, "/$sections/0")).toEqual(bytesBetween(text, "## Part", null));
  });

  test("a second U+FEFF after a byte order mark is text, and offsets count the byte order mark", () => {
    const text = "\u{FEFF}\u{FEFF}# Title\n\n## Part\n";
    const parsed = record(text);
    expect(parsed.value).toEqual({ $body: "\u{FEFF}# Title", $sections: [{ $title: "Part" }] });
    expect(rangeAt(parsed, "/$body")).toEqual({ start: 3, end: 3 + utf8("\u{FEFF}# Title").length });
    expect(rangeAt(parsed, "/$sections/0")).toEqual(bytesBetween(text, "## Part", null));
  });

  test("a byte order mark is skipped and counted in offsets, but is not a column", () => {
    const text = '\u{FEFF}# Title\n\n## Part\n\n<a id="x">y</a>Text.\n';
    const parsed = parse(text);
    expect(parsed.ok).toBe(false);
    const issue = parsed.issues[0] as Issue;
    expect(issue.code).toBe("anchor-element-invalid");
    expect(issue.position).toEqual({ offset: bytesOf(text, "<a id").start, line: 5, col: 1 });
    expect(record("\u{FEFF}# Title\n").nodes.node("/$title")?.range).toEqual({ start: 5, end: 10 });
  });

  test("a heading on the first line starts after the byte order mark, which is not part of the line", () => {
    const parsed = record("\u{FEFF}## Part\n\nText.\n");
    expect(rangeAt(parsed, "/$sections/0")).toEqual({ start: 3, end: 18 });
    const titled = parsed.nodes.node("");
    expect(titled?.kind === "section" && titled.range).toEqual({ start: 0, end: 18 });
    const root = record("\u{FEFF}# Title\n").nodes.node("");
    expect(root?.kind === "section" && root.heading?.range).toEqual({ start: 3, end: 10 });
  });

  test("ranges are UTF-8 bytes of the file, where the library counts UTF-16 units", () => {
    const text = "# Größe 😀\n\nÉté.\n\n## Zwei 日本\n\nText.\n";
    const parsed = record(text);
    expect(rangeAt(parsed, "/$title")).toEqual(bytesOf(text, "Größe 😀"));
    expect(rangeAt(parsed, "/$body")).toEqual(bytesOf(text, "Été."));
    expect(rangeAt(parsed, "/$sections/0")).toEqual(bytesBetween(text, "## Zwei", null));
    expect(rangeAt(parsed, "/$sections/0/$title")).toEqual(bytesOf(text, "Zwei 日本"));
  });

  test("a tab counts as one character, though the library expands it to a tab stop", () => {
    const text = "# T\n\n\tcode\ta\n\n## P\n";
    expect(rangeAt(record(text), "/$sections/0")).toEqual(bytesBetween(text, "## P", null));
  });

  test("CRLF and lone CR line breaks are read as LF, and ranges count their bytes", () => {
    const text = "# T\r\n\r\nLine one\r\nline two\r\n\r\n## P\rText.\r";
    const parsed = record(text);
    expect(parsed.value).toEqual({ $title: "T", $body: "Line one\nline two", $sections: [{ $title: "P", $body: "Text." }] });
    expect(rangeAt(parsed, "/$body")).toEqual(bytesOf(text, "Line one\r\nline two"));
    expect(rangeAt(parsed, "/$sections/0")).toEqual(bytesBetween(text, "## P", null));
  });

  test("an empty file, and one of a byte order mark alone, is the empty record", () => {
    expect(valueView("")).toEqual({});
    expect(valueView("\u{FEFF}")).toEqual({});
    expect(valueView("\n\n  \n")).toEqual({});
  });
});

describe("nesting", () => {
  const quotes = (depth: number) => `${">".repeat(depth)} x\n`;

  test(`containers nested ${MAX_NESTING} deep are read; one level more is a syntax error at the root`, () => {
    expect(issuesOf(quotes(MAX_NESTING))).toEqual([]);
    expect(issuesOf(quotes(MAX_NESTING + 1))).toEqual([["syntax-error", ""]]);
  });

  test("lists and inline nodes nest too, and front matter is still read", () => {
    const lists = `${"- ".repeat(MAX_NESTING + 1)}x`;
    expect(issuesOf(`---\na: [1\n---\n${lists}\n`)).toEqual([
      ["syntax-error", ""],
      ["syntax-error", ""],
    ]);
    const emphasis = `${"*a ".repeat(MAX_NESTING + 1)}b${" c*".repeat(MAX_NESTING + 1)}\n`;
    expect(issuesOf(emphasis)).toEqual([["syntax-error", ""]]);
    expect(issuesOf(`${"*a ".repeat(MAX_NESTING)}b${" c*".repeat(MAX_NESTING)}\n`)).toEqual([]);
  });

  // Emphasis around an inline node that holds emphasis: each counts one level, so the input nests one level past the limit
  // only when the node in the middle counts.
  test.each([
    ["strong", "**x *y* z**"],
    ["strikethrough", "~~x *y* z~~"],
    ["a link", "[x *y* z](u)"],
    ["a link reference", "[x *y* z][r]"],
    ["emphasis", "*x *y* z*"],
  ])("%s nests one level", (_, inner) => {
    const nested = (outer: number) => `${"*a ".repeat(outer)}${inner}${" c*".repeat(outer)}\n\n[r]: u\n`;
    expect(issuesOf(nested(MAX_NESTING - 2))).toEqual([]);
    expect(issuesOf(nested(MAX_NESTING - 1))).toEqual([["syntax-error", ""]]);
  });

  test("a block quote and a list item nest one level each, and a list adds none", () => {
    const mixed = (pairs: number) => `${"> - ".repeat(pairs)}x\n`;
    expect(issuesOf(mixed(MAX_NESTING / 2))).toEqual([]);
    expect(issuesOf(`>${mixed(MAX_NESTING / 2)}`)).toEqual([["syntax-error", ""]]);
  });

  test("the syntax error points at the first node nested too deep", () => {
    const text = `Text.\n\n${quotes(MAX_NESTING + 1)}\nText.\n\n${quotes(MAX_NESTING + 5)}`;
    const issue = parse(text).issues[0];
    expect(issue?.position).toEqual({ offset: bytesOf(text, ">").start + MAX_NESTING, line: 3, col: MAX_NESTING + 1 });
  });

  test("ten thousand nested block quotes are a syntax error, not a stack overflow", () => {
    expect(issuesOf(quotes(10_000))).toEqual([["syntax-error", ""]]);
  });

  /** A list nested `depth` levels by indentation, one item a line. */
  const indentedList = (depth: number) => Array.from({ length: depth }, (_, i) => `${"  ".repeat(i)}- x`).join("\n");

  test("a thousand levels of list indentation are refused at the first item too deep, before the rest is parsed", () => {
    // The library continues each open list on each line, so the lists it continues grow with the square of the depth, and
    // parsed to the end, these 980 KB take about 20 s. So they are counted rather than timed: as many as for the lines up
    // to the first item too deep alone, 33,153, which shows that it reads no line after it, where parsed to the end they are
    // 500,500.
    const continuation = libraryConstruct("document", "-", "list").continuation as Construct;
    const text = `${indentedList(1000)}\n`;
    let issue: Issue | undefined;
    const continuedInText = callsDuring(continuation, "tokenize", () => {
      issue = parse(text).issues[0];
    });
    const continuedBeforeRefusal = callsDuring(continuation, "tokenize", () => parse(`${indentedList(MAX_NESTING + 1)}\n`));
    expect(continuedBeforeRefusal).toBeGreaterThan(0);
    expect(continuedInText).toBe(continuedBeforeRefusal);
    expect([issue?.code, issue?.at]).toEqual(["syntax-error", ""]);
    expect(issue?.position).toEqual({ offset: bytesOf(text, "- x", MAX_NESTING).start, line: MAX_NESTING + 1, col: 513 });
  });

  test("list markers on one line nest one level each, 256 of them read and one more refused at it", () => {
    expect(issuesOf(`${"- ".repeat(MAX_NESTING)}x\n`)).toEqual([]);
    const text = `${"- ".repeat(MAX_NESTING + 1)}x\n`;
    expect(parse(text).issues[0]?.position?.offset).toBe(2 * MAX_NESTING);
  });

  test("a level counts on the line that opens it, after a blank or a lazy line, and a closed list frees its levels", () => {
    // Markers on one line open the levels cheaply; the line after continues every item at its content's column.
    const markers = `${"- ".repeat(MAX_NESTING)}x`;
    const deepest = "  ".repeat(MAX_NESTING);
    expect(issuesOf(`${markers}\n\n${deepest}- y\n`)).toEqual([["syntax-error", ""]]);
    expect(issuesOf(`${markers}\nlazy\n${deepest}- y\n`)).toEqual([["syntax-error", ""]]);
    expect(issuesOf(`${markers}\n\n${deepest}y\n`)).toEqual([]);
    expect(issuesOf(`${markers}\n\nText.\n\n${markers}\n`)).toEqual([]);
    expect(issuesOf(`${markers}\n- y\n  ${"- ".repeat(MAX_NESTING - 1)}x\n`)).toEqual([]);
    expect(issuesOf(`${markers}\n- y\n  ${"- ".repeat(MAX_NESTING)}x\n`)).toEqual([["syntax-error", ""]]);
  });
});

describe("emphasis runs", () => {
  test("a paragraph holds 4,096 runs of *, _ or ~; one more is a syntax error at the root, at the run", () => {
    expect(issuesOf(`${"*a* ".repeat(2048)}\n`)).toEqual([]);
    const text = `# R\n\n${"*a* ".repeat(2048)}_b_\n`;
    const issue = parse(text).issues[0];
    expect([issue?.code, issue?.at, issue?.position?.offset]).toEqual(["syntax-error", "", bytesOf(text, "_b_").start]);
    expect(issuesOf(`${"~a~ ".repeat(2048)}~\n`)).toEqual([["syntax-error", ""]]);
  });

  test("runs are counted per paragraph, across its lines, and per table cell", () => {
    const half = "*a* ".repeat(1024);
    expect(issuesOf(`${half}\n${half}\n\n${half}\n${half}\n`)).toEqual([]);
    expect(issuesOf(`${half}\n${half}\n${half}\n`)).toEqual([["syntax-error", ""]]);
    const cells = `| ${half}${half} | ${half}${half} |`;
    expect(issuesOf(`| a | b |\n|---|---|\n${cells}\n`)).toEqual([]);
    expect(issuesOf(`| a |\n|---|\n| ${half}${half}${half} |\n`)).toEqual([["syntax-error", ""]]);
  });

  test("a run is a delimiter run: a long run counts once, and an escaped or quoted * none", () => {
    expect(issuesOf(`${"*".repeat(5000)}a\n`)).toEqual([]);
    expect(issuesOf(`${"\\* ".repeat(5000)}\n`)).toEqual([]);
    expect(issuesOf(`\`${"* ".repeat(5000)}\`\n`)).toEqual([]);
    // Three ~ are no strikethrough, so the library reads them one at a time, and they are one run still.
    expect(issuesOf(`x ${"~~~ ".repeat(2000)}\n`)).toEqual([]);
    expect(issuesOf(`x ${"~~~ ".repeat(4097)}\n`)).toEqual([["syntax-error", ""]]);
    // A run of _ right after a run of * is a run of its own, though it starts right after the last one counted.
    expect(issuesOf(`${"*_".repeat(2048)}\n`)).toEqual([]);
    expect(issuesOf(`${"*_".repeat(2049)}\n`)).toEqual([["syntax-error", ""]]);
    // A * right after an escaped one starts a run, though the character before it is a *.
    expect(issuesOf(`${"\\**a* ".repeat(2048)}\n`)).toEqual([]);
    expect(issuesOf(`${"\\**a* ".repeat(2049)}\n`)).toEqual([["syntax-error", ""]]);
  });

  test("a heading holds 4,096 runs like a paragraph; one more is a syntax error at the root, at the run", () => {
    expect(issuesOf(`# R\n\n## ${"*a* ".repeat(2048)}\n`)).toEqual([]);
    const text = `# R\n\n## ${"*a* ".repeat(2048)}_b_\n`;
    const issue = parse(text).issues[0];
    expect([issue?.code, issue?.at, issue?.position?.offset]).toEqual(["syntax-error", "", bytesOf(text, "_b_").start]);
    // The title heading, and a setext heading, whose text is read as a paragraph's is.
    expect(issuesOf(`# ${"*a* ".repeat(2049)}\n`)).toEqual([["syntax-error", ""]]);
    expect(issuesOf(`${"*a* ".repeat(2049)}\n---\n`)).toEqual([["syntax-error", ""]]);
  });

  test("near miss: each heading counts on its own, as each paragraph and table cell does", () => {
    const full = "*a* ".repeat(2048);
    expect(issuesOf(`# ${full}\n\n## ${full}\n\n${full}\n\n### ${full}\n\n| a |\n|---|\n| ${full} |\n`)).toEqual([]);
    const some = "*a* ".repeat(100);
    expect(issuesOf(`## A ${some}\n\n## B ${some}\n\nText ${some}\n`)).toEqual([]);
  });

  test("containers nested too deep after a heading beyond the runs are a syntax error at the containers, found first", () => {
    const text = `## ${"*a* ".repeat(2049)}\n\n${">".repeat(MAX_NESTING + 1)} x\n`;
    const issue = parse(text).issues[0];
    expect([issue?.code, issue?.at, issue?.position?.line]).toEqual(["syntax-error", "", 3]);
  });

  test("ten thousand nested emphasis levels are refused before the library resolves them", () => {
    // Resolved, the emphasis takes about 17 s, growing with the square of the runs; refused at run 4,097, a few
    // milliseconds. So the library's resolutions of emphasis are counted rather than timed: some for a paragraph under the
    // limit, none here, where resolved they are 10,001.
    const attention = libraryConstruct("text", "*", "attention");
    const resolvedUnderLimit = callsDuring(attention, "resolveAll", () => {
      expect(issuesOf(`${"*a ".repeat(100)}b${" a*".repeat(100)}\n`)).toEqual([]);
    });
    const resolvedBeyondLimit = callsDuring(attention, "resolveAll", () => {
      expect(issuesOf(`${"*a ".repeat(10_000)}b${" a*".repeat(10_000)}\n`)).toEqual([["syntax-error", ""]]);
    });
    expect(resolvedUnderLimit).toBeGreaterThan(0);
    expect(resolvedBeyondLimit).toBe(0);
  });
});

describe("sections", () => {
  test("every top-level heading but the title heading starts a section, nested by level", () => {
    expect(valueView("# R\n\n## A\n\n#### A1\n\n### A2\n\n## B\n\n###### B1\n")).toEqual({
      $title: "R",
      $sections: [
        { $title: "A", $sections: [{ $title: "A1" }, { $title: "A2" }] },
        { $title: "B", $sections: [{ $title: "B1" }] },
      ],
    });
  });

  test("the title heading is the first block when it is the only level-1 heading", () => {
    expect(valueView("# One\n\nText.\n")).toEqual({ $title: "One", $body: "Text." });
    expect(valueView("Intro.\n\n# One\n")).toEqual({ $body: "Intro.", $sections: [{ $title: "One" }] });
    expect(valueView("# One\n\n# Two\n")).toEqual({ $sections: [{ $title: "One" }, { $title: "Two" }] });
    expect(valueView("## Two\n\n# One\n")).toEqual({ $sections: [{ $title: "Two" }, { $title: "One" }] });
  });

  test("a link reference definition is a first block, so a level-1 heading after it is a section", () => {
    expect(valueView("[x]: https://example.com\n# One\n")).toEqual({
      $body: "[x]: https://example.com",
      $sections: [{ $title: "One" }],
    });
  });

  test("HTML blocks of comments alone before the title heading do not count as the first block", () => {
    expect(valueView("<!-- markdownlint-disable -->\n# One\n\nText.\n")).toEqual({ $title: "One", $body: "Text." });
    expect(valueView("---\na: 1\n---\n<!-- x -->\n\n<!--\ny --> <!-- z -->\n# One\n")).toEqual({ a: 1, $title: "One" });
    expect(valueView("<!---->\n<!-->\n# One\n")).toEqual({ $title: "One" });
  });

  test("HTML blocks of comments alone do not count as the first block for a misplaced data block either", () => {
    expect(issuesOf("<!-- c -->\n\n```yaml data\na: 1\n```\n")).toEqual([["data-block-misplaced", ""]]);
    expect(issuesOf("<!-- c -->\n\n```json data\n{}\n```\n")).toEqual([["data-block-misplaced", ""]]);
    expect(issuesOf("<!-- c -->\n\n```toml data\na = 1\n```\n")).toEqual([["feature-unsupported", ""]]);
    // Several comment blocks, and after front matter.
    expect(issuesOf("---\na: 1\n---\n<!-- x -->\n\n<!--\ny --> <!-- z -->\n\n```yaml data\nb: 1\n```\n")).toEqual([
      ["data-block-misplaced", ""],
    ]);
    // A misplaced block that is not closed is a syntax error too, and a marker of a newer version after one is detected.
    expect(issuesOf("<!-- c -->\n\n```yaml data\na: 1\n")).toEqual([
      ["data-block-misplaced", ""],
      ["syntax-error", ""],
    ]);
    expect(issuesOf("<!-- c -->\n\n```yaml data\na: 1\n```\n```toml data\n```\n")).toEqual([
      ["data-block-misplaced", ""],
      ["feature-unsupported", ""],
    ]);
  });

  test("the comment blocks before a misplaced data block stay in the root's $body", () => {
    const body = "<!-- c -->\n\n```yaml data\na: 1\n```\nText.";
    expect(read(`${body}\n`).root?.body?.value).toBe(body);
  });

  test("near miss: a comment block after the title heading is the block right after it, so it hides a data block", () => {
    expect(issuesOf("# R\n\n<!-- c -->\n\n```yaml data\na: 1\n```\n")).toEqual([]);
    expect(issuesOf("# R\n\n<!-- c -->\n\n```toml data\na = 1\n```\n")).toEqual([]);
  });

  test("near miss: an HTML block with more than comments is the first block, so a data block after it is a prose fence", () => {
    for (const html of ["<div>Note</div>", "<!-- c --> text", "<!-- c -->\n<div></div>", "<!-- c --> <b>x</b>"]) {
      expect(issuesOf(`${html}\n\n\`\`\`yaml data\na: 1\n\`\`\`\n`)).toEqual([]);
      expect(issuesOf(`${html}\n\n\`\`\`toml data\na = 1\n\`\`\`\n`)).toEqual([]);
    }
    expect(issuesOf("Text.\n\n<!-- c -->\n\n```yaml data\na: 1\n```\n")).toEqual([]);
  });

  test("near miss: an HTML block with more than comments is the first block, so a level-1 heading after it is a section", () => {
    expect(valueView("<!-- x --> text\n\n# One\n")).toEqual({ $body: "<!-- x --> text", $sections: [{ $title: "One" }] });
    expect(valueView("<div></div>\n\n# One\n")).toEqual({ $body: "<div></div>", $sections: [{ $title: "One" }] });
    expect(valueView("<!-- x -->\n\nText.\n\n# One\n")).toEqual({
      $body: "<!-- x -->\n\nText.",
      $sections: [{ $title: "One" }],
    });
  });

  test("several level-1 headings warn multiple-h1 at the root, once", () => {
    expect(issuesOf("# One\n\n# Two\n\n# Three\n")).toEqual([["multiple-h1", ""]]);
  });

  test("near miss: a level-1 heading inside a container counts for neither rule", () => {
    expect(issuesOf("# One\n\n- # Two\n\n> # Three\n")).toEqual([]);
    expect(valueView("# One\n\n- # Two\n")).toEqual({ $title: "One", $body: "- # Two" });
  });

  test("an indented heading's section starts at its line's start, and ends the one before there", () => {
    const text = "# R\n\n## A\n\nText.\n   ## B\n";
    const parsed = record(text);
    expect(rangeAt(parsed, "/$sections/0")).toEqual(bytesBetween(text, "## A", "   ## B"));
    expect(rangeAt(parsed, "/$sections/1")).toEqual(bytesBetween(text, "   ## B", null));
    const section = parsed.nodes.node("/$sections/1");
    expect(section?.kind === "section" && section.heading?.range).toEqual(bytesOf(text, "   ## B"));
  });

  test("headings in fences, block quotes and HTML blocks are prose", () => {
    expect(valueView("# R\n\n```\n## no\n```\n\n<div>\n## no\n</div>\n\n> ## no\n")).toEqual({
      $title: "R",
      $body: "```\n## no\n```\n\n<div>\n## no\n</div>\n\n> ## no",
    });
  });
});

describe("titles", () => {
  test("a title is the heading's inline source, without a closing sequence, trimmed", () => {
    expect(valueView("#   *Use* `code` &amp; [x](y)   ##  \n")).toEqual({ $title: "*Use* `code` &amp; [x](y)" });
    expect(valueView("## C#\n")).toEqual({ $sections: [{ $title: "C#" }] });
    expect(valueView("## \\#\n")).toEqual({ $sections: [{ $title: "\\#" }] });
    expect(valueView("##\n")).toEqual({ $sections: [{ $title: "" }] });
  });

  test("the anchor element is removed before trimming, wherever it stands in the heading", () => {
    const expected = { $sections: [{ $title: "What was done", $anchor: "done", $tags: ["decision"] }] };
    expect(valueView('## What was done <a id="done" class="decision"></a>\n')).toEqual(expected);
    expect(valueView('## What was done<a id="done" class="decision"></a>\n')).toEqual(expected);
    expect(valueView('## <a id="done" class="decision"></a> What was done\n')).toEqual(expected);
    expect(valueView('## What <a id="done" class="decision"></a>was done\n')).toEqual(expected);
  });

  test("a setext heading of several lines has its lines without their indentation, joined by \\n", () => {
    const text = "# R\n\nFirst line\n   second line  \r\n\tthird\n---\n";
    expect(valueView(text)).toEqual({ $title: "R", $sections: [{ $title: "First line\nsecond line  \nthird" }] });
    expect(issuesOf(text)).toEqual([["not-representable", "/$sections/0/$title"]]);
    expect(rangeAt(record(text), "/$sections/0/$title")).toEqual(bytesOf(text, "First line\n   second line  \r\n\tthird"));
  });

  test("near miss: a setext heading of one line is representable", () => {
    expect(issuesOf("Title\n=====\n\nPart\n----\n")).toEqual([]);
    expect(valueView("Title\n=====\n\nPart\n----\n")).toEqual({ $title: "Title", $sections: [{ $title: "Part" }] });
  });

  test("a title heading of several lines is not representable at /$title", () => {
    expect(issuesOf("Record\nline two\n===\n")).toEqual([["not-representable", "/$title"]]);
  });

  test("its visible text, for the slug, is what a reader sees", () => {
    const visible = (heading: string) => read(heading).headings.map((found) => found.visibleText);
    expect(
      visible('## A [link](x.md) &amp; `co de` *em* ~~del~~ ![img](i.png) <span>s</span><!-- c --> <a id="x"></a>\n'),
    ).toEqual(["A link & co de em del  s "]);
    expect(visible("Two\r\nlines\n---\n")).toEqual(["Two\nlines"]);
    expect(visible("Hard  \nbreak\n---\n")).toEqual(["Hard\nbreak"]);
    expect(visible("## \\*not em\\* www.example.com\n")).toEqual(["*not em* www.example.com"]);
  });
});

describe("anchor elements in headings", () => {
  test("give $anchor and $tags, the tags in source order, a repeat dropped with duplicate-tag at the section", () => {
    const text = '# R\n\n## Part <a id="p" class="b a\tb  c a"></a>\n';
    expect(valueView(text)).toEqual({ $title: "R", $sections: [{ $title: "Part", $anchor: "p", $tags: ["b", "a", "c"] }] });
    expect(issuesOf(text)).toEqual([
      ["duplicate-tag", "/$sections/0"],
      ["duplicate-tag", "/$sections/0"],
    ]);
  });

  test("near miss: distinct tokens warn nothing, and a class alone gives tags without an anchor", () => {
    expect(issuesOf('# R <a class="x y"></a>\n')).toEqual([]);
    expect(valueView('# R <a class="x y"></a>\n')).toEqual({ $title: "R", $tags: ["x", "y"] });
    expect(valueView('# R <a class=""></a>\n')).toEqual({ $title: "R" });
    expect(valueView("# R <A ID=top></A>\n")).toEqual({ $title: "R", $anchor: "top" });
  });

  test("the title heading's element labels the root", () => {
    expect(issuesOf('# R <a id="top" class="x x"></a>\n')).toEqual([["duplicate-tag", ""]]);
  });

  test.each([
    ["content", '## Done<a id="done">now</a>\n'],
    ["another attribute", '## Done<a id="done" title="Done"></a>\n'],
    ["a repeated attribute", '## Done<a id="a" id="b"></a>\n'],
    ["no closing tag", '## Done<a id="done">\n'],
    ["a self-closing tag", '## Done<a id="done"/></a>\n'],
    ["a self-closing tag alone", '## Done<a id="done"/>\n'],
    ["a second element", '## Done<a id="a"></a><a class="b"></a>\n'],
  ])("an anchor element with %s is anchor-element-invalid at the section", (_, heading) => {
    expect(issuesOf(`# R\n\n${heading}`)).toEqual([["anchor-element-invalid", "/$sections/0"]]);
  });

  test.each([
    ["emphasis", '## *A <a id="d"></a>*\n'],
    ["strong emphasis", '## **A <a class="t"></a>**\n'],
    ["a link", '## [A <a id="d"></a>](u.md)\n'],
    ["strikethrough", '## ~~A <a id="d"></a>~~\n'],
  ])("an anchor element inside %s is anchor-element-invalid at the section, not heading-html", (_, heading) => {
    expect(issuesOf(`# R\n\n${heading}`)).toEqual([["anchor-element-invalid", "/$sections/0"]]);
  });

  test("near miss: an anchor element among the heading's direct children, beside emphasis, labels the section", () => {
    expect(valueView('# R\n\n## *A* <a id="d"></a>\n')).toEqual({ $title: "R", $sections: [{ $title: "*A*", $anchor: "d" }] });
    expect(issuesOf('# R\n\n## *A <span>s</span>* <a id="d"></a>\n')).toEqual([]);
  });

  test("character references in its attributes are not decoded", () => {
    expect(valueView('# R\n\n## A<a id="a&amp;b" class="x&#32;y"></a>\n')).toEqual({
      $title: "R",
      $sections: [{ $title: "A", $anchor: "a&amp;b", $tags: ["x&#32;y"] }],
    });
  });

  test("a self-closing anchor element is refused as one, though no closing tag follows it", () => {
    expect(parse('## Done<a id="d"/>\n').issues[0]?.message).toMatch(/self-closing/);
  });

  test("near miss: an <a> without id or class is other HTML, heading-html", () => {
    expect(issuesOf('# R\n\n## See <a href="x">this</a>\n')).toEqual([["heading-html", "/$sections/0"]]);
  });

  test("other HTML in a heading is one heading-html for the heading, and stays in the title", () => {
    const text = "# R\n\n## Fix <u>now</u> <!-- later --><br>\n";
    expect(issuesOf(text)).toEqual([["heading-html", "/$sections/0"]]);
    expect(valueView(text)).toEqual({ $title: "R", $sections: [{ $title: "Fix <u>now</u> <!-- later --><br>" }] });
  });

  test("near miss: the supported inline elements are no warning", () => {
    expect(issuesOf("# R\n\n## <span>a</span> <B>b</B> <i>i</i> <em>e</em> <strong>s</strong> <code>c</code>\n")).toEqual([]);
    expect(issuesOf("# R\n\n## <kbd>k</kbd> <sup>1</sup> <sub>2</sub> <span class='x'>y</span>\n")).toEqual([]);
  });
});

describe("data blocks", () => {
  test("a yaml data or json data fence right after a section's heading holds its fields", () => {
    expect(
      valueView('# R\n\n## A\n\n```yaml data\nowner: ana\n```\n\nText.\n\n## B\n~~~json data\n{"runs": [7]}\n~~~\n'),
    ).toEqual({
      $title: "R",
      $sections: [
        { $title: "A", owner: "ana", $body: "Text." },
        { $title: "B", runs: [7] },
      ],
    });
  });

  test("its info string is read from the source, split on spaces and tabs, compared with case", () => {
    expect(valueView("## A\n```yaml \t data\na: 1\n```\n")).toEqual({ $sections: [{ $title: "A", a: 1 }] });
    expect(valueView("## A\n```yaml&#32;data\na: 1\n```\n")).toEqual({
      $sections: [{ $title: "A", $body: "```yaml&#32;data\na: 1\n```" }],
    });
    expect(valueView("## A\n```Yaml Data\na: 1\n```\n")).toEqual({
      $sections: [{ $title: "A", $body: "```Yaml Data\na: 1\n```" }],
    });
  });

  test.each([
    ["toml data", "/$sections/0"],
    ["yaml data extra", "/$sections/0"],
    ["YAML data", "/$sections/0"],
  ])("the marker %j after a heading is feature-unsupported at the section", (info, at) => {
    expect(issuesOf(`## A\n\n\`\`\`${info}\na = 1\n\`\`\`\n`)).toEqual([["feature-unsupported", at]]);
  });

  test("near miss: a fence without the data marker is prose, and so is data alone", () => {
    expect(issuesOf("## A\n\n```toml\na = 1\n```\n")).toEqual([]);
    expect(issuesOf("## A\n\n```data\na = 1\n```\n")).toEqual([]);
    expect(issuesOf("## A\n\n```toml datum\na = 1\n```\n")).toEqual([]);
  });

  test("an unsupported marker after the title heading is feature-unsupported at the root", () => {
    expect(issuesOf("# R\n\n```toml data\na = 1\n```\n")).toEqual([["feature-unsupported", ""]]);
  });

  test("an unsupported marker is feature-unsupported as the first block without a title heading, at the root", () => {
    expect(issuesOf("```toml data\na = 1\n```\n")).toEqual([["feature-unsupported", ""]]);
    expect(issuesOf("---\na: 1\n---\n\n```json data x\n{}\n```\n")).toEqual([["feature-unsupported", ""]]);
  });

  test("an unsupported marker right after a data block is feature-unsupported, at the data block's section or the root", () => {
    expect(issuesOf("## A\n```yaml data\na: 1\n```\n```toml data\n```\n")).toEqual([["feature-unsupported", "/$sections/0"]]);
    expect(issuesOf("# R\n\n```yaml data\na: 1\n```\n\n```toml data\n```\n")).toEqual([
      ["data-block-misplaced", ""],
      ["feature-unsupported", ""],
    ]);
  });

  test("near miss: an unsupported marker after a paragraph is prose", () => {
    expect(valueView("Text.\n\n```toml data\na = 1\n```\n")).toEqual({ $body: "Text.\n\n```toml data\na = 1\n```" });
    expect(issuesOf("## A\n```yaml data\na: 1\n```\nText.\n```toml data\n```\n")).toEqual([]);
  });

  test("a data block after the title heading, or as the first block without one, is data-block-misplaced at the root", () => {
    expect(issuesOf("# R\n\n```yaml data\na: 1\n```\n")).toEqual([["data-block-misplaced", ""]]);
    expect(issuesOf("```json data\n{}\n```\n")).toEqual([["data-block-misplaced", ""]]);
    expect(issuesOf("---\na: 1\n---\n\n```yaml data\nb: 1\n```\n")).toEqual([["data-block-misplaced", ""]]);
  });

  test("near miss: a data fence after a paragraph is prose", () => {
    expect(issuesOf("# R\n\nText.\n\n```yaml data\na: 1\n```\n")).toEqual([]);
    expect(issuesOf("Text.\n\n```yaml data\na: 1\n```\n")).toEqual([]);
  });

  test("a second data block right after the first is data-block-misplaced at the section", () => {
    expect(issuesOf("## A\n```yaml data\na: 1\n```\n```json data\n{}\n```\n")).toEqual([
      ["data-block-misplaced", "/$sections/0"],
    ]);
  });

  test("near miss: a data fence after the data block and a paragraph is prose", () => {
    expect(valueView("## A\n```yaml data\na: 1\n```\nText.\n```json data\n{}\n```\n")).toEqual({
      $sections: [{ $title: "A", a: 1, $body: "Text.\n```json data\n{}\n```" }],
    });
  });

  test("an empty data block gives no fields, in YAML and in JSON, also with white space only", () => {
    expect(valueView("## A\n```yaml data\n```\n")).toEqual({ $sections: [{ $title: "A" }] });
    expect(valueView("## A\n```json data\n```\n")).toEqual({ $sections: [{ $title: "A" }] });
    expect(valueView("## A\n```json data\n  \n\t\n```\n")).toEqual({ $sections: [{ $title: "A" }] });
  });

  test("a block that holds no object is data-block-not-object at its section", () => {
    expect(issuesOf("## A\n```yaml data\n- 1\n```\n")).toEqual([["data-block-not-object", "/$sections/0"]]);
    expect(issuesOf('## A\n```json data\n"x"\n```\n')).toEqual([["data-block-not-object", "/$sections/0"]]);
  });

  test("a syntax error is one per data block, at its section, and the other units are still read", () => {
    expect(issuesOf('---\na: [\n---\n## A\n```json data\n{"a": }\n```\n## B\n```yaml data\na: [\n```\n')).toEqual([
      ["syntax-error", ""],
      ["syntax-error", "/$sections/0"],
      ["syntax-error", "/$sections/1"],
    ]);
  });

  test("$ members of a JSON data block are refused as in YAML, without a clash in the index", () => {
    expect(issuesOf('## A\n```json data\n{"$title": "X", "$key": "k", "$foo": 1, "$schema": "s"}\n```\n')).toEqual([
      ["dollar-member", "/$sections/0/$title"],
      ["dollar-member", "/$sections/0/$key"],
      ["feature-unsupported", "/$sections/0/$foo"],
      ["dollar-member", "/$sections/0/$schema"],
    ]);
    expect(issuesOf('## A\n```json data\n{"x": {"$ref": 1}}\n```\n')).toEqual([["ref-malformed", "/$sections/0/x"]]);
  });

  test("an unclosed data fence is a syntax error at its section, since YAML would read the headings after it as comments", () => {
    expect(issuesOf("## A\n```yaml data\na: 1\n\n## B\n\nText.\n")).toEqual([["syntax-error", "/$sections/0"]]);
    expect(issuesOf('# R\n\n## A\n~~~json data\n{"a": 1}\n')).toEqual([["syntax-error", "/$sections/0"]]);
    expect(issuesOf("## A\n```yaml data")).toEqual([["syntax-error", "/$sections/0"]]);
    // Its last line would close a shorter fence, and does not close this one.
    expect(issuesOf("## A\n````yaml data\na: |\n  x\n  ```")).toEqual([["syntax-error", "/$sections/0"]]);
    expect(parse("## A\n\n```yaml data\na: 1\n").issues[0]?.position?.line).toBe(3);
  });

  test("a misplaced or second data block whose fence is not closed is a syntax error too, at the root or the section", () => {
    expect(issuesOf("# R\n\n```yaml data\na: 1\n\n## B\n")).toEqual([
      ["data-block-misplaced", ""],
      ["syntax-error", ""],
    ]);
    expect(issuesOf("## A\n```yaml data\na: 1\n```\n```json data\n{}\n")).toEqual([
      ["data-block-misplaced", "/$sections/0"],
      ["syntax-error", "/$sections/0"],
    ]);
  });

  test("near miss: a data fence closed on the last line of the file, and an unclosed fence that is prose, are no error", () => {
    expect(valueView("## A\n```yaml data\na: 1\n```")).toEqual({ $sections: [{ $title: "A", a: 1 }] });
    expect(valueView("## A\n```yaml data\na: 1\n  ```  ")).toEqual({ $sections: [{ $title: "A", a: 1 }] });
    expect(issuesOf("## A\n```yaml\na: 1\n")).toEqual([]);
    expect(issuesOf("## A\n\nText.\n\n```yaml data\na: 1\n")).toEqual([]);
  });

  test("an indented fence's lines lose columns: a tab partly removed leaves spaces, as CommonMark reads it", () => {
    const text = "## A\n  ```yaml data\n\ta: 1\n \tb:\n\t  - x\n  ```\n";
    const parsed = record(text);
    expect(parsed.value).toEqual({ $sections: [{ $title: "A", a: 1, b: ["x"] }] });
    expect(parsed.nodes.node("/$sections/0/a")?.memberRange).toEqual(bytesOf(text, "a: 1"));
    expect(rangeAt(parsed, "/$sections/0/b/0")).toEqual(bytesOf(text, "x"));
  });

  test("an indented fence's lines lose its indentation, and the ranges stay the file's", () => {
    const text = "## A\n  ```yaml data\n  a: 1\n  b:\n    - x\n  ```\nText.\n";
    const parsed = record(text);
    expect(parsed.value).toEqual({ $sections: [{ $title: "A", a: 1, b: ["x"], $body: "Text." }] });
    expect(rangeAt(parsed, "/$sections/0/a")).toEqual(bytesOf(text, "1"));
    expect(parsed.nodes.node("/$sections/0/a")?.memberRange).toEqual(bytesOf(text, "a: 1"));
    expect(rangeAt(parsed, "/$sections/0/b")).toEqual(bytesOf(text, "- x"));
    expect(rangeAt(parsed, "/$sections/0/b/0")).toEqual(bytesOf(text, "x", 0));
    // A line indented less than the fence loses what it has, which YAML reads as the same indentation.
    expect(valueView("## A\n  ```yaml data\n  a: 1\n b: 2\nc: 3\n  ```\n")).toEqual({
      $sections: [{ $title: "A", a: 1, b: 2, c: 3 }],
    });
    const json = '## A\n   ```json data\n   {"a":\n   [1]}\n   ```\n';
    expect(rangeAt(record(json), "/$sections/0/a")).toEqual(bytesOf(json, "[1]"));
  });
});

describe("$body", () => {
  test("runs to the next heading, without leading blank lines or trailing spaces, tabs and line breaks", () => {
    expect(valueView("# R\n \t\n\n  indented first\n\nlast \t\n\n## A\nA text.\n\n### B\n\n")).toEqual({
      $title: "R",
      $body: "  indented first\n\nlast",
      $sections: [{ $title: "A", $body: "A text.", $sections: [{ $title: "B" }] }],
    });
  });

  test("a trailing no-break space or form feed is content", () => {
    expect(valueView("# R\n\nText.\u{A0}\n")).toEqual({ $title: "R", $body: "Text.\u{A0}" });
    expect(valueView("# R\n\nText.\f\n")).toEqual({ $title: "R", $body: "Text.\f" });
  });

  test("is raw Markdown, never re-serialized", () => {
    const body = "Some *emphasis*  \nand __strong__, `code`, a [link][x] and\n\n* a list\n+ another\n\n[x]: <y>";
    expect(valueView(`# R\n\n${body}\n`)).toEqual({ $title: "R", $body: body });
  });
});

describe("block anchors", () => {
  const anchorsOf = (text: string) => read(text).blockAnchors.map(({ name, at, range }) => ({ name, at, range }));

  test("start a paragraph at the top level of a $body, or a list item at any depth", () => {
    const text = '# Log\n\n- <a id="room"></a>**Room.** Seats ten.\n- Two chairs.\n\n<a id="hall"></a>The hall is next door.\n';
    expect(anchorsOf(text)).toEqual([
      { name: "room", at: "/$body", range: { start: 0, end: 39 } },
      { name: "hall", at: "/$body", range: { start: 55, end: 94 } },
    ]);
    expect(issuesOf(text)).toEqual([]);
    const nested = '# R\n\n## P\n\n- Outer\n  - <a id="inner"></a>Inner\n    more  \n1. <a id="o"></a>x\n';
    expect(anchorsOf(nested)).toEqual([
      { name: "inner", at: "/$sections/0/$body", range: { start: 10, end: 44 } },
      { name: "o", at: "/$sections/0/$body", range: { start: 47, end: 65 } },
    ]);
  });

  test("count the bytes of the value, whose line breaks are \\n", () => {
    const text = '# R\r\n\r\nÉté\r\nline\r\n\r\n<a id="x"></a>Text\r\nmore  \r\n';
    expect(anchorsOf(text)).toEqual([{ name: "x", at: "/$body", range: { start: 12, end: 35 } }]);
    const body = record(text).value.$body as string;
    expect(new TextDecoder().decode(utf8(body).slice(12, 35))).toBe('<a id="x"></a>Text\nmore');
    expect(read(text).blockAnchors[0]?.fileRange).toEqual(bytesOf(text, '<a id="x"></a>Text\r\nmore'));
  });

  test.each([
    ["two elements at the start of a paragraph", '<a id="a"></a><a id="b"></a>Text.'],
    ["two elements at the start of a list item", '- <a id="a"></a><a id="b"></a>Item.'],
    ["an element with another attribute", '<a id="room" title="Room"></a>Text.'],
    ["an element with content", '<a id="room">x</a>Text.'],
  ])("%s is anchor-element-invalid at the $body", (_, block) => {
    expect(issuesOf(`# R\n\n${block}\n`)).toEqual([["anchor-element-invalid", "/$body"]]);
  });

  test("an element with a class is block-anchor-class at the $body, a validation error, and its id still anchors the block", () => {
    const text = '# R\n\n<a id="room" class="x"></a>Text.\n\n- <a id="item" class="y z"></a>Item.\n\n<a class="x"></a>None.\n';
    const outcome = parse(text);
    expect(outcome.ok).toBe(true);
    const issues = outcome.ok ? outcome.value.issues : [];
    expect(issues.map((issue) => [issue.code, issue.at, issue.class, issue.offset])).toEqual([
      ["block-anchor-class", "/$body", "validation", 0],
      ["block-anchor-class", "/$body", "validation", 36],
      ["block-anchor-class", "/$body", "validation", 72],
    ]);
    expect(anchorsOf(text).map((anchor) => anchor.name)).toEqual(["room", "item"]);
  });

  test("near miss: an element with an empty class still has a class, and one without is a plain block anchor", () => {
    expect(issuesOf('# R\n\n<a id="room" class=""></a>Text.\n')).toEqual([["block-anchor-class", "/$body"]]);
    expect(issuesOf('# R\n\n<a id="room"></a>Text.\n')).toEqual([]);
  });

  test("start any paragraph of a list item at any depth, a later one included, which is the range", () => {
    const text =
      '# R\n\n- One.\n\n  <a id="second"></a>Second paragraph.\n\n  Third <a id="mid"></a>paragraph.\n' +
      '- Outer\n  - Inner\n\n    <a id="deep"></a>Deep.  \n\n    - Deeper\n\n    <a id="after"></a>After a list.\n';
    const body = record(text).value.$body as string;
    const rangeOf = (part: string) => {
      const start = utf8(body.slice(0, body.indexOf(part))).length;
      return { start, end: start + utf8(part).length };
    };
    expect(anchorsOf(text)).toEqual([
      { name: "second", at: "/$body", range: rangeOf('<a id="second"></a>Second paragraph.') },
      { name: "deep", at: "/$body", range: rangeOf('<a id="deep"></a>Deep.') },
      { name: "after", at: "/$body", range: rangeOf('<a id="after"></a>After a list.') },
    ]);
    expect(issuesOf(text)).toEqual([["anchor-element-ignored", "/$body"]]);
  });

  test("a list item's range is trimmed of trailing white space, like a paragraph's", () => {
    const text = '# R\n\n- <a id="first"></a>First.   \n- Two.\n- <a id="loose"></a>Loose.\n\n  More. \t\n\n- Three.\n';
    expect(anchorsOf(text)).toEqual([
      { name: "first", at: "/$body", range: { start: 0, end: 26 } },
      { name: "loose", at: "/$body", range: { start: 37, end: 72 } },
    ]);
  });

  test("any other <a id> in a $body is anchor-element-ignored at the $body, with its offset", () => {
    const text =
      '# R\n\nBook <a id="room"></a>the room.\n\n> <a id="q"></a>Quoted.\n\n> - <a id="ql"></a>Listed.\n\n' +
      '- One.\n\n  > <a id="lq"></a>Quoted in a list.\n\n<div>\n<a id="html"></a>\n</div>\n\n| <a id="t"></a> |\n|---|\n\n' +
      '- ## Heading <a id="h"></a>\n';
    const outcome = parse(text);
    expect(outcome.ok).toBe(true);
    const issues = outcome.ok ? outcome.value.issues : [];
    expect(issues.map((issue) => [issue.code, issue.at])).toEqual(Array(7).fill(["anchor-element-ignored", "/$body"]));
    const body = outcome.ok ? (outcome.value.value.$body as string) : "";
    expect(issues.map((issue) => issue.offset)).toEqual(
      ["room", "q", "ql", "lq", "html", "t", "h"].map((name) => utf8(body.slice(0, body.indexOf(`<a id="${name}"`))).length),
    );
    expect(read(text).blockAnchors).toEqual([]);
  });

  test("near miss: an element at the start of a task list item is a block anchor", () => {
    expect(anchorsOf('# R\n\n- [ ] <a id="t"></a>Task.\n')).toEqual([{ name: "t", at: "/$body", range: { start: 0, end: 25 } }]);
  });

  test("an <a> without id is no anchor and no warning, and nor is another element with an id", () => {
    expect(issuesOf('# R\n\nSee <a href="x">here</a> and <a class="c"></a>.\n')).toEqual([]);
    expect(issuesOf('# R\n\n<abbr id="x">A</abbr> and <span id="y"></span>.\n')).toEqual([]);
  });

  test("a list item's range ends with the $body, without the trailing white space the $body loses", () => {
    expect(anchorsOf('# R\n\n- <a id="x"></a>Item.  \t\n\n')).toEqual([
      { name: "x", at: "/$body", range: { start: 0, end: 21 } },
    ]);
  });
});

describe("spans", () => {
  const text =
    '---\nstatus: Open\n---\n\n# Ticket <a id="t" class="x y"></a>\n\nRoot text.\n\n## One\n\n```yaml data\nruns: [1]\n```\n\n' +
    "One text.\n\n### One.A\n\nDeep.\n\n\n## Two\n\nTwo text.\n\n";
  const parsed = record(text);

  test("the root is the whole file", () => {
    expect(rangeAt(parsed, "")).toEqual({ start: 0, end: utf8(text).length });
  });

  test("a section runs from its heading line to the heading that ends it, trailing blank lines included", () => {
    expect(rangeAt(parsed, "/$sections/0")).toEqual(bytesBetween(text, "## One", "## Two"));
    expect(rangeAt(parsed, "/$sections/0/$sections/0")).toEqual(bytesBetween(text, "### One.A", "## Two"));
    expect(rangeAt(parsed, "/$sections/1")).toEqual(bytesBetween(text, "## Two", null));
  });

  test("a $sections array runs from its first section to the end of its parent", () => {
    expect(rangeAt(parsed, "/$sections")).toEqual(bytesBetween(text, "## One", null));
    expect(rangeAt(parsed, "/$sections/0/$sections")).toEqual(bytesBetween(text, "### One.A", "## Two"));
  });

  test("$anchor and $tags from an <a> element have the element's range, and each tag its token's", () => {
    const element = bytesOf(text, '<a id="t" class="x y"></a>');
    expect(rangeAt(parsed, "/$anchor")).toEqual(element);
    expect(rangeAt(parsed, "/$tags")).toEqual(element);
    const tokens = bytesOf(text, "x y");
    expect(rangeAt(parsed, "/$tags/0")).toEqual({ start: tokens.start, end: tokens.start + 1 });
    expect(rangeAt(parsed, "/$tags/1")).toEqual({ start: tokens.start + 2, end: tokens.end });
  });

  test("a front matter or data block member is its value, with a member range from its key", () => {
    expect(rangeAt(parsed, "/status")).toEqual(bytesOf(text, "Open"));
    expect(parsed.nodes.node("/status")?.memberRange).toEqual(bytesOf(text, "status: Open"));
    expect(rangeAt(parsed, "/$sections/0/runs")).toEqual(bytesOf(text, "[1]"));
    expect(parsed.nodes.node("/$sections/0/runs")?.memberRange).toEqual(bytesOf(text, "runs: [1]"));
  });

  test("an empty title's span is empty, where its content starts", () => {
    const text = '## <a id="x"></a>\n';
    const start = bytesOf(text, "<a").start;
    expect(rangeAt(record(text), "/$sections/0/$title")).toEqual({ start, end: start });
    expect(rangeAt(record("## \n"), "/$sections/0/$title")).toEqual({ start: 3, end: 3 });
  });

  test("$title and $body are their source spans", () => {
    expect(rangeAt(parsed, "/$title")).toEqual(bytesOf(text, "Ticket"));
    expect(rangeAt(parsed, "/$body")).toEqual(bytesOf(text, "Root text."));
    expect(rangeAt(parsed, "/$sections/0/$body")).toEqual(bytesOf(text, "One text."));
  });

  test("a section's heading has its level, its lines and its derived anchor", () => {
    const section = parsed.nodes.node("/$sections/0");
    expect(section?.kind === "section" && section.heading).toEqual({
      level: 2,
      range: bytesOf(text, "## One"),
      derivedAnchor: "one",
    });
    const root = parsed.nodes.node("");
    expect(root?.kind === "section" && root.heading?.range).toEqual(bytesOf(text, '# Ticket <a id="t" class="x y"></a>'));
    expect(root?.kind === "section" && root.heading?.derivedAnchor).toBe("ticket");
  });

  test("the index lists a section's members in source order", () => {
    expect(parsed.nodes.children("").map((node) => node.key)).toEqual([
      "status",
      "$title",
      "$anchor",
      "$tags",
      "$body",
      "$sections",
    ]);
    expect(parsed.nodes.children("/$sections/0").map((node) => node.key)).toEqual(["$title", "runs", "$body", "$sections"]);
    expect(parsed.nodes.sections().map((section) => section.at)).toEqual([
      "",
      "/$sections/0",
      "/$sections/0/$sections/0",
      "/$sections/1",
    ]);
  });
});

describe("issues", () => {
  test("every code the Markdown parser raises has Appendix D's class", () => {
    const texts = [
      "---\na: 1\n",
      "---\n- 1\n---\n",
      "# R\n\n```yaml data\na: 1\n```\n",
      "## A\n```toml data\n```\n",
      '## A <a id="a">x</a>\n',
      '<a id="a"></a><a id="b"></a>x\n',
      "# A\n\n# B\n",
      "## A <u>x</u>\n",
      '## A <a class="x x"></a>\n',
      "A\nB\n---\n",
      'Text <a id="x"></a>.\n',
      '<a id="x" class="y"></a>Text.\n',
      `${">".repeat(MAX_NESTING + 1)} x\n`,
    ];
    const seen = new Map<IssueCode, string>();
    for (const text of texts) {
      const outcome = parse(text);
      for (const issue of outcome.ok ? outcome.value.issues : outcome.issues) seen.set(issue.code, issue.class);
    }
    expect([...seen.keys()].sort()).toEqual(
      [
        "anchor-element-ignored",
        "anchor-element-invalid",
        "block-anchor-class",
        "data-block-misplaced",
        "data-block-not-object",
        "duplicate-tag",
        "feature-unsupported",
        "heading-html",
        "multiple-h1",
        "not-representable",
        "syntax-error",
      ].sort(),
    );
    for (const [code, issueClass] of seen) expect([code, issueClass]).toEqual([code, ISSUE_CODES[code].classes[0]]);
  });

  test("issues carry the file position of what they are about", () => {
    const outcome = parse("# R\n\n## A\n\n```toml data\n```\n");
    expect(outcome.issues[0]?.position).toEqual({ offset: 11, line: 5, col: 1 });
  });
});
