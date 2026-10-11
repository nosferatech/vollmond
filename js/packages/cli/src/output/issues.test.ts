import { type Issue, type IssueInit, makeIssue } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { DEFAULT_ISSUE_LIMIT, formatIssue, formatIssues } from "./issues.js";

/** An issue at a record's node, with a position, a hint, or neither. */
function issue(init: Partial<IssueInit> & Pick<IssueInit, "code">): Issue {
  return makeIssue({ path: "tickets/0171-x.md", at: "", message: "a message", ...init });
}

const ambiguity = issue({
  code: "ref-ambiguous",
  at: "/$sections/1/$body",
  message: "#notes matches 2 sections",
  hint: 'add <a id="..."></a> to the heading you mean, and link to that anchor',
  position: { offset: 300, line: 14, col: 3 },
});

describe("formatIssue", () => {
  test("writes the example of the specification, given the semantic path and the candidates", () => {
    const text = formatIssue(ambiguity, {
      semantic: "#what-was-done/$body",
      candidates: [
        { address: "#/$sections/2", line: 20, derived: "#notes" },
        { address: "#/$sections/4", line: 31, derived: "#notes-1" },
      ],
    });
    expect(text).toBe(
      [
        "tickets/0171-x.md:14:3 error ref-ambiguous: #notes matches 2 sections",
        "  in   #what-was-done/$body  (exact #/$sections/1/$body)",
        "  candidates  #/$sections/2 (line 20, derived #notes)",
        "              #/$sections/4 (line 31, derived #notes-1)",
        '  hint add <a id="..."></a> to the heading you mean, and link to that anchor',
        "",
      ].join("\n"),
    );
  });

  test("names the node by its exact path alone without a semantic path", () => {
    expect(formatIssue(ambiguity)).toContain("\n  in   #/$sections/1/$body\n");
  });

  test("names it once when the semantic path is the exact path", () => {
    expect(formatIssue(ambiguity, { semantic: "#/$sections/1/$body" })).toContain("\n  in   #/$sections/1/$body\n");
  });

  test("writes a candidate without a line or a derived anchor as its address alone", () => {
    expect(formatIssue(ambiguity, { candidates: [{ address: "#/a" }, { address: "#/b", derived: "#b" }] })).toContain(
      "  candidates  #/a\n              #/b (derived #b)\n",
    );
  });

  test("writes the path without a position when the issue has none", () => {
    expect(formatIssue(issue({ code: "ref-dangling", at: "/links" }))).toBe(
      "tickets/0171-x.md error ref-dangling: a message\n  in   #/links\n",
    );
  });

  test("leaves out the in line for an issue about the whole record", () => {
    expect(formatIssue(issue({ code: "syntax-error", position: { offset: 0, line: 1, col: 1 } }))).toBe(
      "tickets/0171-x.md:1:1 error syntax-error: a message\n",
    );
  });

  test("starts with the severity for an issue with no path and no node", () => {
    const text = formatIssue(makeIssue({ code: "address-malformed", path: null, at: null, message: "bad", hint: "quote it" }));
    expect(text).toBe("error address-malformed: bad\n  hint quote it\n");
  });

  test("names the file details give in place of the path", () => {
    const text = formatIssue(
      makeIssue({ code: "config-invalid", path: null, at: null, message: "m", position: { offset: 0, line: 2, col: 1 } }),
      { file: "examples/vampiredb/config.yaml" },
    );
    expect(text).toBe("examples/vampiredb/config.yaml:2:1 error config-invalid: m\n");
  });

  test("writes a warning as one", () => {
    expect(formatIssue(issue({ code: "heading-html", at: "/$sections/0" }))).toMatch(
      /^tickets\/0171-x\.md warning heading-html:/,
    );
  });

  test("keeps each part on its line when a message or a hint holds a line break or an escape sequence", () => {
    const text = formatIssue(issue({ code: "ref-dangling", message: "no #a\nb", hint: "\u001b[31mred" }));
    expect(text).toBe("tickets/0171-x.md error ref-dangling: no #a\\nb\n  hint \\u001b[31mred\n");
  });
});

describe("formatIssues", () => {
  /** `count` issues of `code`, each at its own member. */
  function many(code: IssueInit["code"], count: number): Issue[] {
    return Array.from({ length: count }, (_, i) => issue({ code, at: `/m${i}` }));
  }

  test("prints every issue, in order, when there are at most 20, and no count", () => {
    const issues = [...many("ref-dangling", 19), issue({ code: "heading-html", at: "/h" })];
    const text = formatIssues(issues);
    expect(text.split("\n").filter((line) => !line.startsWith(" ") && line !== "")).toHaveLength(20);
    expect(text).not.toContain("not shown");
  });

  test("prints 20 by default, then counts every issue by code, the most frequent first", () => {
    expect(DEFAULT_ISSUE_LIMIT).toBe(20);
    const issues = [...many("heading-html", 15), ...many("ref-dangling", 30)];
    const text = formatIssues(issues);
    const firstLines = text.split("\n").filter((line) => line.startsWith("tickets/"));
    expect(firstLines).toHaveLength(20);
    expect(text.endsWith("45 issues, 25 not shown: 30 ref-dangling, 15 heading-html\n")).toBe(true);
  });

  test("orders codes of equal count by name", () => {
    const text = formatIssues([...many("ref-dangling", 2), ...many("heading-html", 2)], { limit: 1 });
    expect(text.endsWith("4 issues, 3 not shown: 2 heading-html, 2 ref-dangling\n")).toBe(true);
  });

  test("takes another limit", () => {
    expect(formatIssues(many("ref-dangling", 3), { limit: 0 })).toBe("3 issues, 3 not shown: 3 ref-dangling\n");
  });

  test("leaves out warnings when asked, still counting them, without a count line for them alone", () => {
    const issues = [issue({ code: "heading-html", at: "/h" }), issue({ code: "ref-dangling", at: "/r" })];
    expect(formatIssues(issues, { errorsOnly: true })).toBe("tickets/0171-x.md error ref-dangling: a message\n  in   #/r\n");
    expect(formatIssues([issue({ code: "heading-html", at: "/h" })], { errorsOnly: true })).toBe("");
  });

  test("gives each issue the details its source gives", () => {
    const text = formatIssues([ambiguity], { details: (i) => (i === ambiguity ? { semantic: "#done/$body" } : undefined) });
    expect(text).toContain("  in   #done/$body  (exact #/$sections/1/$body)\n");
  });

  test("gives the empty string for no issue", () => {
    expect(formatIssues([])).toBe("");
  });
});
