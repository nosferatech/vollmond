import { describe, expect, test } from "vitest";
import { MAX_EMPHASIS_RUNS, MAX_NESTING } from "../limits.js";
import { definitionLabelsIn, inlineRunsBeyondLimit, parseInlineContent, parseMarkdownTree } from "./library.js";

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

describe("inlineRunsBeyondLimit", () => {
  const runs = (count: number, run = "*a* ") => run.repeat(count);

  test("finds the first run beyond the limit, at its index, and none at the limit", () => {
    expect(inlineRunsBeyondLimit(runs(MAX_EMPHASIS_RUNS / 2))).toBeNull();
    const title = `${runs(MAX_EMPHASIS_RUNS / 2)}_b_`;
    expect(inlineRunsBeyondLimit(title)).toBe(title.indexOf("_b_"));
  });

  test("counts all the lines of a title together, however a blank line splits them", () => {
    // Each unit holds two runs.
    const quarter = runs(MAX_EMPHASIS_RUNS / 8);
    expect(inlineRunsBeyondLimit(`${quarter}\n${quarter}\n\n${quarter}\n\n${quarter}`)).toBeNull();
    expect(inlineRunsBeyondLimit(`${quarter}\n${quarter}\n\n${quarter}\n\n${quarter}*`)).not.toBeNull();
  });

  test("counts nothing in a title without a character of a run", () => {
    expect(inlineRunsBeyondLimit("a plain title ".repeat(10_000))).toBeNull();
  });

  test("near miss: many characters of runs are not many runs: an escaped one, one in a code span or a long run is none or one", () => {
    expect(inlineRunsBeyondLimit("\\* ".repeat(MAX_EMPHASIS_RUNS + 1))).toBeNull();
    expect(inlineRunsBeyondLimit(`\`${"* ".repeat(MAX_EMPHASIS_RUNS + 1)}\``)).toBeNull();
    expect(inlineRunsBeyondLimit(`${"*".repeat(MAX_EMPHASIS_RUNS * 2)}a`)).toBeNull();
    expect(inlineRunsBeyondLimit("~~~ ".repeat(MAX_EMPHASIS_RUNS))).toBeNull();
  });

  // The count is the one a paragraph gets, whichever way the emphasis would be resolved.
  test.each([
    ["emphasis", "*a* "],
    ["underscores", "_a_ "],
    ["strikethrough", "~a~ "],
    ["long runs", "**** a "],
    ["tildes that are no strikethrough", "x~~~ "],
    ["mixed runs", "*_ "],
    ["escaped delimiters", "\\**a* "],
    ["code spans", "`*` *a* "],
    ["links", "[*a*](/x*) "],
    ["autolinks", "<https://x.org/*_> *a* "],
  ])("passes the limit at the same count as a paragraph: %s", (_name, unit) => {
    const paragraphPasses = (count: number) => !parseMarkdownTree(unit.repeat(count)).ok;
    let low = 1;
    let high = MAX_EMPHASIS_RUNS + 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (paragraphPasses(middle)) high = middle;
      else low = middle + 1;
    }
    // Every unit holds a run, so a paragraph of MAX_EMPHASIS_RUNS + 1 units is beyond the limit.
    expect(paragraphPasses(MAX_EMPHASIS_RUNS + 1)).toBe(true);
    expect(inlineRunsBeyondLimit(unit.repeat(low - 1))).toBeNull();
    expect(inlineRunsBeyondLimit(unit.repeat(low))).not.toBeNull();
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
