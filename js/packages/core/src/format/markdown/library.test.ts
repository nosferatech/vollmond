import { describe, expect, test } from "vitest";
import { MAX_EMPHASIS_RUNS, MAX_NESTING } from "../limits.js";
import { definitionLabelsIn, inlineLimitPassedIn, parseInlineContent, parseMarkdownTree } from "./library.js";

describe("definitionLabelsIn", () => {
  test("finds the labels of definitions at any depth, as written", () => {
    expect(definitionLabelsIn("[A b]: /x\n\n> - [c]: /y\n")).toEqual(["A b", "c"]);
  });

  test("finds none in a text beyond a resource limit, and near miss, finds one at the deepest level allowed", () => {
    expect(definitionLabelsIn(`${">".repeat(MAX_NESTING + 1)} [a]: /x\n`)).toEqual([]);
    expect(definitionLabelsIn(`${">".repeat(MAX_NESTING)} [a]: /x\n`)).toEqual(["a"]);
  });
});

describe("parseMarkdownTree", () => {
  test("applies GFM's autolink literals, which the library finds partly after the parse", () => {
    // The literal after a character reference is the transform's, not the parser's.
    const tree = parseMarkdownTree("Mail x@example.com or see &#42;www.example.com.\n");
    if (!tree.ok) throw new Error("too deep");
    const paragraph = tree.root.children[0];
    const links = paragraph?.type === "paragraph" ? paragraph.children.filter((node) => node.type === "link") : [];
    expect(links.map((link) => link.url)).toEqual(["mailto:x@example.com", "http://www.example.com"]);
  });

  test("has no footnotes, which GFM 0.29 lacks: [^1]: is a link reference definition", () => {
    const tree = parseMarkdownTree("[^1]: target.md\n");
    expect(tree.ok && tree.root.children.map((node) => node.type)).toEqual(["definition"]);
  });

  test("reads tables, strikethrough and task list items", () => {
    const tree = parseMarkdownTree("| a |\n|---|\n| ~~b~~ |\n\n- [x] done\n");
    if (!tree.ok) throw new Error("too deep");
    expect(tree.root.children.map((node) => node.type)).toEqual(["table", "list"]);
    const list = tree.root.children[1];
    expect(list?.type === "list" && list.children[0]?.checked).toBe(true);
  });
});

describe("inlineLimitPassedIn", () => {
  const runs = (count: number, run = "*a* ") => run.repeat(count);

  test("finds the first run beyond the limit, at its index, and none at the limit", () => {
    expect(inlineLimitPassedIn(runs(MAX_EMPHASIS_RUNS / 2))).toBeNull();
    const title = `${runs(MAX_EMPHASIS_RUNS / 2)}_b_`;
    expect(inlineLimitPassedIn(title)?.at).toBe(title.indexOf("_b_"));
  });

  test("counts all the lines of a title together, however a blank line splits them", () => {
    // Each unit holds two runs.
    const quarter = runs(MAX_EMPHASIS_RUNS / 8);
    expect(inlineLimitPassedIn(`${quarter}\n${quarter}\n\n${quarter}\n\n${quarter}`)).toBeNull();
    expect(inlineLimitPassedIn(`${quarter}\n${quarter}\n\n${quarter}\n\n${quarter}*`)).not.toBeNull();
  });

  test("counts nothing in a title without a character of a run", () => {
    expect(inlineLimitPassedIn("a plain title ".repeat(10_000))).toBeNull();
  });

  test("near miss: many characters of runs are not many runs: an escaped one, one in a code span or a long run is none or one", () => {
    expect(inlineLimitPassedIn("\\* ".repeat(MAX_EMPHASIS_RUNS + 1))).toBeNull();
    expect(inlineLimitPassedIn(`\`${"* ".repeat(MAX_EMPHASIS_RUNS + 1)}\``)).toBeNull();
    expect(inlineLimitPassedIn(`${"*".repeat(MAX_EMPHASIS_RUNS * 2)}a`)).toBeNull();
    expect(inlineLimitPassedIn("~~~ ".repeat(MAX_EMPHASIS_RUNS))).toBeNull();
  });

  test("finds an inline node nested deeper than the limit, at its start, and none at the limit", () => {
    const nested = (levels: number) => `${"*a ".repeat(levels)}b${" a*".repeat(levels)}`;
    expect(inlineLimitPassedIn(nested(MAX_NESTING))).toBeNull();
    const passed = inlineLimitPassedIn(nested(MAX_NESTING + 1));
    expect(passed?.message).toContain("nest");
    // At the start of the 257th level's opener.
    expect(passed?.at).toBe(MAX_NESTING * 3);
    // A link inside 256 levels of emphasis is the 257th level; one inside 255 is the 256th.
    const link = (levels: number) => `${"*a ".repeat(levels)}[b](/x)${" a*".repeat(levels)}`;
    expect(inlineLimitPassedIn(link(MAX_NESTING - 1))).toBeNull();
    expect(inlineLimitPassedIn(link(MAX_NESTING))?.at).toBe(link(MAX_NESTING).indexOf("[b]"));
    // Strikethrough and single-character runs count as levels too.
    expect(inlineLimitPassedIn(`${"~a ".repeat(MAX_NESTING + 1)}b${" a~".repeat(MAX_NESTING + 1)}`)).not.toBeNull();
  });

  test("near miss: many characters of nesting are not deep nesting: a long list of siblings, or brackets that are text", () => {
    expect(inlineLimitPassedIn("*a* ".repeat(MAX_NESTING * 4))).toBeNull();
    expect(inlineLimitPassedIn("[a](/x) ".repeat(MAX_NESTING * 2))).toBeNull();
    expect(inlineLimitPassedIn("[".repeat(MAX_NESTING * 2))).toBeNull();
  });

  // The count is the one a paragraph gets, whichever way the emphasis would be resolved: each unit holds the given runs.
  test.each([
    ["emphasis", "*a* ", 2],
    ["underscores", "_a_ ", 2],
    ["strikethrough", "~a~ ", 2],
    ["long runs", "**** a ", 1],
    ["tildes that are no strikethrough", "x~~~ ", 1],
    ["mixed runs", "*_a ", 2],
    ["escaped delimiters", "\\**a* ", 2],
    ["code spans", "`*` *a* ", 2],
    ["links", "[*a*](/x*) ", 2],
    ["autolinks", "<https://x.org/*_> *a* ", 2],
  ])("passes the limit at the same count as a paragraph: %s", (_name, unit, runsPerUnit) => {
    const beyond = Math.ceil((MAX_EMPHASIS_RUNS + 1) / runsPerUnit);
    expect(parseMarkdownTree(unit.repeat(beyond - 1)).ok).toBe(true);
    expect(parseMarkdownTree(unit.repeat(beyond)).ok).toBe(false);
    expect(inlineLimitPassedIn(unit.repeat(beyond - 1))).toBeNull();
    expect(inlineLimitPassedIn(unit.repeat(beyond))).not.toBeNull();
  });
});

describe("parseInlineContent", () => {
  test("is null for a title with more runs than the limit, and reads one at the limit", () => {
    expect(parseInlineContent("*a* ".repeat(MAX_EMPHASIS_RUNS / 2), [])).not.toBeNull();
    expect(parseInlineContent("*a* ".repeat(MAX_EMPHASIS_RUNS / 2 + 1), [])).toBeNull();
  });

  test("counts the runs of all the lines together, however a blank line splits them", () => {
    const quarter = "*a* ".repeat(MAX_EMPHASIS_RUNS / 8);
    expect(parseInlineContent(`${quarter}\n\n${quarter}\n\n${quarter}\n\n${quarter}`, [])).not.toBeNull();
    expect(parseInlineContent(`${quarter}\n\n${quarter}\n\n${quarter}\n\n${quarter}*`, [])).toBeNull();
  });
});
