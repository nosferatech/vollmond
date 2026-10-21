// The vampiredb trial configuration, `examples/vampiredb/config.yaml` and its schema, over a small store made up in the shape
// of vampiredb's `docs/`: each rule of the schema fires once, at the document planted for it, and its near miss passes.

import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { runCli } from "../cli.js";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";

/** The trial configuration in this repository, found from this file so that the working directory does not matter. */
const CONFIG = fileURLToPath(new URL("../../../../../examples/vampiredb/config.yaml", import.meta.url));

interface Issue {
  readonly code: string;
  readonly path?: string;
  readonly at?: string;
  readonly message: string;
  readonly position?: { readonly line: number };
}

/** A document's header table, as vampiredb's documents open, with the rows given. */
function header(rows: Readonly<Record<string, string>>): string {
  return `| | |\n| --- | --- |\n${Object.entries(rows)
    .map(([name, value]) => `| **${name}** | ${value} |`)
    .join("\n")}\n`;
}

const DESIGN = header({ Type: "Design", Status: "Draft — not implemented", Component: "log-v3" });
const GUIDELINE = header({ Type: "Guideline", Status: "Accepted", Scope: "all work in this repository" });

/** A design document with that header and body, under a title. */
const doc = (title: string, head: string, body = "\nText.\n"): string => `# ${title}\n\n${head}${body}`;

/** The documents that break nothing, each a near miss of a rule. */
const NEAR_MISSES: Record<string, string> = {
  // anchored, every numbered heading at every depth carrying its anchor; unnumbered headings need none
  "design/Anchored.md": doc(
    "Anchored",
    DESIGN,
    '\n## 1. One <a id="one"></a>\n\n### 1.1 Sub <a id="sub"></a>\n\n## Appendix A Notes <a id="appendix-a"></a>\n\n## Notes\n',
  ),
  // no anchor anywhere, so its numbered headings need none, as docs.sh asks only of a document with anchors
  "design/Plain.md": doc("Plain", DESIGN, "\n## 1. One\n\n### 1.1 Sub\n\n## Appendix A Notes\n"),
  "design/Backticked.md": doc("Backticked", header({ Type: "`Design`", Status: "`Implemented` — in vmpr-log", Component: "db" })),
  "draft/Convention.md": doc("Convention", header({ Type: "Convention", Status: "Draft", Scope: "every component" })),
  "guidelines/Guideline.md": doc("Guideline", GUIDELINE),
  // outside the collection: a README of a shelf, and a document beside the shelves
  "design/README.md": "# Design\n\n## 1. Inventory\n",
  "TODO.md": "# TODO\n\n## 1. Later\n",
};

/** One document per Type keyword and per Status keyword, each with the rows its Type asks for: each keyword is a near miss. */
const KEYWORD_NEAR_MISSES: Record<string, string> = {
  ...Object.fromEntries(
    ["Design", "Investigation", "Analysis", "Report", "Convention", "Guideline", "Record"].map((type) => [
      `design/Type-${type}.md`,
      doc(type, header({ Type: type, Status: "Draft", Component: "db", Scope: "every component" })),
    ]),
  ),
  ...Object.fromEntries(
    ["Draft", "Accepted", "Implemented", "Deprecated"].map((status) => [
      `design/Status-${status}.md`,
      doc(status, header({ Type: "Design", Status: `${status} — prose`, Component: "db" })),
    ]),
  ),
  // ten components, the most docs.sh allows, and commas in the prose after the keyword, which are not components
  "design/Ten.md": doc("Ten", header({ Type: "Design", Status: "Draft", Component: Array(10).fill("db").join(", ") })),
  "design/Prose.md": doc(
    "Prose",
    header({ Type: "Design", Status: "Draft", Component: "db, perf — a, b, c, d, e, f, g, h, i, j, k" }),
  ),
};

/** The documents that each break one rule, with the line of the issue and the schema location that its message names. */
const FAULTS: Record<string, { readonly file: string; readonly line: number; readonly rule: string }> = {
  "a numbered heading without an anchor, two levels down, in a document with anchors": {
    file: doc("Missing", DESIGN, '\n## 1. One <a id="one"></a>\n\n### 1.1 Sub\n'),
    line: 11,
    rule: "#/$defs/numbered-headings-anchored/then/required",
  },
  "a numbered heading without an anchor, in a document whose only anchor is an element in a subsection's body": {
    file: doc("Block", DESIGN, '\n## 1. One\n\n### Notes\n\n<a id="room"></a>**Room.** Text.\n'),
    line: 9,
    rule: "#/$defs/numbered-headings-anchored/then/required",
  },
  "an appendix heading without an anchor, in a document with anchors": {
    file: doc("Appendix", DESIGN, '\n## 1. One <a id="one"></a>\n\n## Appendix B More\n'),
    line: 11,
    rule: "#/$defs/numbered-headings-anchored/then/required",
  },
  "an A.n heading without an anchor, in a document with anchors": {
    file: doc("Annex", DESIGN, '\n## 1. One <a id="one"></a>\n\n## A.3 More\n'),
    line: 11,
    rule: "#/$defs/numbered-headings-anchored/then/required",
  },
  "a Type row that does not start its line": {
    file: doc("Midline", "| | |\n| --- | --- |\nSee | **Type** | Design |\n| **Status** | Draft |\n| **Component** | db |\n"),
    line: 3,
    rule: "#/properties/$body/allOf/0/pattern",
  },
  "a Type that is not a keyword": {
    file: doc("Designs", header({ Type: "Designs", Status: "Draft", Component: "db" })),
    line: 3,
    rule: "#/properties/$body/allOf/0/pattern",
  },
  "a Type of two keywords": {
    file: doc("Two", header({ Type: "Design, Report", Status: "Draft", Component: "db" })),
    line: 3,
    rule: "#/properties/$body/allOf/0/pattern",
  },
  "no Status row": {
    file: doc("Statusless", header({ Type: "Design", Component: "db" })),
    line: 3,
    rule: "#/properties/$body/allOf/1/pattern",
  },
  "a Status that is not a keyword": {
    file: doc("Done", header({ Type: "Design", Status: "Done — shipped", Component: "db" })),
    line: 3,
    rule: "#/properties/$body/allOf/1/pattern",
  },
  "a Status row with a cell after the keyword": {
    file: doc("Cells", "| | |\n| --- | --- |\n| **Type** | Design |\n| **Status** | Draft | extra |\n| **Component** | db |\n"),
    line: 3,
    rule: "#/properties/$body/allOf/1/pattern",
  },
  "Implemented on a Guideline": {
    file: doc("Implemented", header({ Type: "Guideline", Status: "Implemented", Scope: "all code" })),
    line: 3,
    rule: "#/properties/$body/allOf/2/then/pattern",
  },
  "a Design without a Component": {
    file: doc("Componentless", header({ Type: "Design", Status: "Draft" })),
    line: 3,
    rule: "#/properties/$body/allOf/3/then/pattern",
  },
  "a Report without a Component": {
    file: doc("Report", header({ Type: "Report", Status: "Draft" })),
    line: 3,
    rule: "#/properties/$body/allOf/3/then/pattern",
  },
  "eleven Components, more than docs.sh allows": {
    file: doc("Eleven", header({ Type: "Design", Status: "Draft", Component: Array(11).fill("db").join(", ") })),
    line: 3,
    rule: "#/properties/$body/allOf/5/not",
  },
  "a Record without a Scope": {
    file: doc("Record", header({ Type: "Record", Status: "Accepted" })),
    line: 3,
    rule: "#/properties/$body/allOf/4/then/pattern",
  },
  "a Guideline without a Scope": {
    file: doc("Scopeless", header({ Type: "Guideline", Status: "Accepted" })),
    line: 3,
    rule: "#/properties/$body/allOf/4/then/pattern",
  },
  "two level-1 headings, so no title and no header to check": {
    file: `${doc("Parts", DESIGN)}\n# Part 2\n\nText.\n`,
    line: 1,
    rule: "#/required",
  },
};

/** The fault documents, each at a path of its own: the guidelines shelf for the Guideline faults, a nested draft for one. */
function faultPath(index: number, name: string): string {
  if (name.includes("Guideline")) return `guidelines/Fault${index}.md`;
  if (name.startsWith("no Status")) return `draft/nested/Fault${index}.md`;
  return `design/Fault${index}.md`;
}

async function check(root: string): Promise<{ exitCode: number; issues: Issue[]; stderr: string }> {
  const result = await runCli(["--json", "--store", root, "--config", CONFIG, "check", "--all"], {
    cwd: root,
    cache: null,
    unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }),
  });
  const output = JSON.parse(String(result.stdout)) as { ok: boolean; issues: Issue[] };
  expect(output.ok).toBe(true);
  return { exitCode: result.exitCode, issues: output.issues, stderr: String(result.stderr) };
}

describe("the vampiredb trial configuration", () => {
  test("loads with its schema, and passes every near miss", async () => {
    const root = writeFiles(temporaryDirectory(), { ...NEAR_MISSES, ...KEYWORD_NEAR_MISSES });
    const result = await check(root);
    expect(result).toEqual({ exitCode: 0, issues: [], stderr: "" });
  });

  test("puts the shelves' documents in its collection, at any depth, and leaves the READMEs and the rest out", async () => {
    const root = writeFiles(temporaryDirectory(), { ...NEAR_MISSES, "draft/nested/Deep.md": doc("Deep", DESIGN) });
    const result = await runCli(["--store", root, "--config", CONFIG, "ls"], { cwd: root, cache: null });
    const collections = Object.fromEntries(
      String(result.stdout)
        .trimEnd()
        .split("\n")
        .map((line) => {
          const [path, ...rest] = line.split(/\s+/);
          return [path, rest.at(-1) === "documents"];
        }),
    );
    expect(collections).toEqual({
      "TODO.md": false,
      "design/Anchored.md": true,
      "design/Backticked.md": true,
      "design/Plain.md": true,
      "design/README.md": false,
      "draft/Convention.md": true,
      "draft/nested/Deep.md": true,
      "guidelines/Guideline.md": true,
    });
  });

  test("reports each fault once, at its document, by the rule it breaks", async () => {
    const names = Object.keys(FAULTS);
    const files = Object.fromEntries(names.map((name, i) => [faultPath(i, name), (FAULTS[name] as { file: string }).file]));
    const root = writeFiles(temporaryDirectory(), { ...NEAR_MISSES, ...files });
    const result = await check(root);
    const violations = result.issues.filter((issue) => issue.code === "schema-violation");
    const found = Object.fromEntries(
      violations.map((issue) => [issue.path, { line: issue.position?.line, message: issue.message }]),
    );
    expect(violations).toHaveLength(names.length);
    names.forEach((name, i) => {
      const fault = FAULTS[name] as { line: number; rule: string };
      const issue = found[faultPath(i, name)];
      expect({ name, line: issue?.line }).toEqual({ name, line: fault.line });
      expect(issue?.message, name).toContain(`(anchored-document.schema.yaml${fault.rule})`);
      expect(issue?.message.match(/\(anchored-document\.schema\.yaml#/g), name).toHaveLength(1);
    });
    expect(result.issues.filter((issue) => issue.code !== "schema-violation").map((issue) => issue.code)).toEqual([
      "multiple-h1",
    ]);
    expect(result.exitCode).toBe(4);
  });
});
