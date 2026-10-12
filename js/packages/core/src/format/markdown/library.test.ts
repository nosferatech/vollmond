import { describe, expect, test } from "vitest";
import { MAX_EMPHASIS_RUNS, MAX_NESTING } from "../limits.js";
import {
  definitionLabelsIn,
  inlineLimitPassedIn,
  markdownLimitPassedIn,
  parseInlineContent,
  parseMarkdownTree,
} from "./library.js";

describe("definitionLabelsIn", () => {
  test("finds the labels of definitions at any depth, as their identifiers", () => {
    expect(definitionLabelsIn("[A  b]: /x\n\n> - [c]: /y\n")).toEqual(["a b", "c"]);
  });

  test("finds none in a text beyond a resource limit, and near miss, finds one at the deepest level allowed", () => {
    expect(definitionLabelsIn(`${">".repeat(MAX_NESTING + 1)} [a]: /x\n`)).toEqual([]);
    expect(definitionLabelsIn(`${">".repeat(MAX_NESTING)} [a]: /x\n`)).toEqual(["a"]);
  });

  test("finds them in a text past an inline limit, which definitions elsewhere in its record may bring within it", () => {
    const runs = "*a* ".repeat(20000);
    const nested = `${"*a ".repeat(10000)}b${" a*".repeat(10000)}`;
    const strikethrough = "~a~ ".repeat(20000);
    expect(definitionLabelsIn(`[a]: /x\n\n${runs}\n\n${nested}\n\n${strikethrough}\n\n[b]: /y\n`)).toEqual(["a", "b"]);
    expect(definitionLabelsIn(`${"[".repeat(20000)}\n\n[a]: /x\n`)).toEqual(["a"]);
  });

  test("finds none without a `]:`, which every definition holds, and one whose label holds an escaped bracket", () => {
    expect(definitionLabelsIn("[a] : /x\n")).toEqual([]);
    expect(definitionLabelsIn("[a\\]]: /x\n")).toEqual(["a\\]"]);
  });
});

describe("the record's definitions in a Markdown parse", () => {
  test("are in scope beside the text's own, for the runs, the inline nesting and the tree", () => {
    const references = "[a][*b*] ".repeat(2049);
    expect(markdownLimitPassedIn(references)?.message).toBe(`more than ${MAX_EMPHASIS_RUNS} runs`);
    expect(markdownLimitPassedIn(references, ["*b*"])).toBeNull();
    expect(markdownLimitPassedIn(`[*b*]: /x\n\n${references}`, ["c"])).toBeNull();
    const around = `${"*a ".repeat(MAX_NESTING)}[b][r]${" a*".repeat(MAX_NESTING)}`;
    expect(markdownLimitPassedIn(around)).toBeNull();
    expect(markdownLimitPassedIn(around, ["R"])?.message).toBe(`inline nodes nest more than ${MAX_NESTING} deep`);
    const tree = parseMarkdownTree("[a][b](c.md) on\none line\nand more", ["b"]);
    const paragraph = tree.ok ? tree.root.children[0] : undefined;
    const kinds = paragraph?.type === "paragraph" ? paragraph.children.map((node) => node.type) : [];
    expect(kinds).toEqual(["linkReference", "text"]);
    const alone = parseMarkdownTree("[a][b](c.md)");
    expect(
      alone.ok && alone.root.children[0]?.type === "paragraph" && alone.root.children[0].children.map((n) => n.type),
    ).toEqual(["text", "link"]);
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
  const limitPassedIn = (text: string, labels: readonly string[] = []) => inlineLimitPassedIn(text, () => labels);

  test("stops at the first run beyond the limit, however many follow, so that the emphasis is never resolved", () => {
    // 20,000 `*a*` hold 40,000 runs; the 4,097th is the first of the 2,049th `*a*`.
    expect(limitPassedIn(runs(20_000))).toEqual({ at: 4 * 2048, message: `more than ${MAX_EMPHASIS_RUNS} runs` });
  });

  test("reads a reference label as the definitions in scope say, whose characters are then no runs", () => {
    const title = "[a][*b*] ".repeat(2049);
    expect(limitPassedIn(title, ["*b*"])).toBeNull();
    expect(limitPassedIn(title, ["B"])).not.toBeNull();
    expect(limitPassedIn(title)).not.toBeNull();
    const around = (levels: number) => `${"*a ".repeat(levels)}[b][r]${" a*".repeat(levels)}`;
    expect(limitPassedIn(around(MAX_NESTING - 1), ["r"])).toBeNull();
    expect(limitPassedIn(around(MAX_NESTING), ["r"])?.at).toBe(around(MAX_NESTING).indexOf("[b]"));
    expect(limitPassedIn(around(MAX_NESTING), ["s"])).toBeNull();
  });

  test("asks for the labels only of a title that has a [ and is not shown within the limits without the library", () => {
    let asked = 0;
    const labels = () => {
      asked += 1;
      return [];
    };
    inlineLimitPassedIn(runs(MAX_EMPHASIS_RUNS), labels);
    inlineLimitPassedIn("[a][b] *a*", labels);
    expect(asked).toBe(0);
    inlineLimitPassedIn(`[a] ${runs(MAX_EMPHASIS_RUNS)}`, labels);
    expect(asked).toBe(1);
  });

  test("finds the first run beyond the limit, at its index, and none at the limit", () => {
    expect(limitPassedIn(runs(MAX_EMPHASIS_RUNS / 2))).toBeNull();
    const title = `${runs(MAX_EMPHASIS_RUNS / 2)}_b_`;
    expect(limitPassedIn(title)?.at).toBe(title.indexOf("_b_"));
  });

  test("counts all the lines of a title together, however a blank line splits them", () => {
    // Each unit holds two runs.
    const quarter = runs(MAX_EMPHASIS_RUNS / 8);
    expect(limitPassedIn(`${quarter}\n${quarter}\n\n${quarter}\n\n${quarter}`)).toBeNull();
    expect(limitPassedIn(`${quarter}\n${quarter}\n\n${quarter}\n\n${quarter}*`)).not.toBeNull();
  });

  test("counts nothing in a title without a character of a run", () => {
    expect(limitPassedIn("a plain title ".repeat(10_000))).toBeNull();
  });

  test("near miss: many characters of runs are not many runs: an escaped one, one in a code span or a long run is none or one", () => {
    expect(limitPassedIn("\\* ".repeat(MAX_EMPHASIS_RUNS + 1))).toBeNull();
    expect(limitPassedIn(`\`${"* ".repeat(MAX_EMPHASIS_RUNS + 1)}\``)).toBeNull();
    expect(limitPassedIn(`${"*".repeat(MAX_EMPHASIS_RUNS * 2)}a`)).toBeNull();
    expect(limitPassedIn("~~~ ".repeat(MAX_EMPHASIS_RUNS))).toBeNull();
  });

  test("finds an inline node nested deeper than the limit, at its start, and none at the limit", () => {
    const nested = (levels: number) => `${"*a ".repeat(levels)}b${" a*".repeat(levels)}`;
    expect(limitPassedIn(nested(MAX_NESTING))).toBeNull();
    const passed = limitPassedIn(nested(MAX_NESTING + 1));
    expect(passed?.message).toContain("nest");
    // At the start of the 257th level's opener.
    expect(passed?.at).toBe(MAX_NESTING * 3);
    // A link inside 256 levels of emphasis is the 257th level; one inside 255 is the 256th.
    const link = (levels: number) => `${"*a ".repeat(levels)}[b](/x)${" a*".repeat(levels)}`;
    expect(limitPassedIn(link(MAX_NESTING - 1))).toBeNull();
    expect(limitPassedIn(link(MAX_NESTING))?.at).toBe(link(MAX_NESTING).indexOf("[b]"));
    // Strikethrough and single-character runs count as levels too.
    expect(limitPassedIn(`${"~a ".repeat(MAX_NESTING + 1)}b${" a~".repeat(MAX_NESTING + 1)}`)).not.toBeNull();
  });

  test("near miss: many characters of nesting are not deep nesting: a long list of siblings, or brackets that are text", () => {
    expect(limitPassedIn("*a* ".repeat(MAX_NESTING * 4))).toBeNull();
    expect(limitPassedIn("[a](/x) ".repeat(MAX_NESTING * 2))).toBeNull();
    expect(limitPassedIn("[".repeat(MAX_NESTING * 2))).toBeNull();
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
    expect(limitPassedIn(unit.repeat(beyond - 1))).toBeNull();
    expect(limitPassedIn(unit.repeat(beyond))).not.toBeNull();
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
