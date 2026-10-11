import { describe, expect, test } from "vitest";
import { ISSUE_CODES, isIssueCode } from "./codes.js";
import { hasStructuralError, makeIssue, repeatedNodes } from "./issue.js";
import { fail, succeed } from "./outcome.js";

describe("makeIssue", () => {
  test("takes the code's default severity and class", () => {
    expect(makeIssue({ code: "duplicate-key", path: "a.md", at: "/$sections/1", message: "m" })).toEqual({
      code: "duplicate-key",
      severity: "error",
      class: "validation",
      path: "a.md",
      at: "/$sections/1",
      message: "m",
    });
    expect(makeIssue({ code: "duplicate-tag", path: "a.md", at: "", message: "m" }).severity).toBe("warning");
    expect(makeIssue({ code: "address-not-found", path: "a.md", at: null, message: "m" }).class).toBe("operation");
  });

  test("keeps the optional members only when given, and freezes the issue", () => {
    const plain = makeIssue({ code: "syntax-error", path: "a.json", at: "", message: "m" });
    expect(Object.keys(plain)).toEqual(["code", "severity", "class", "path", "at", "message"]);
    expect(Object.isFrozen(plain)).toBe(true);
    const full = makeIssue({
      code: "syntax-error",
      path: "a.json",
      at: "",
      message: "m",
      hint: "h",
      position: { offset: 3, line: 1, col: 4 },
      offset: 0,
    });
    expect(full).toMatchObject({ hint: "h", position: { offset: 3, line: 1, col: 4 }, offset: 0 });
  });

  test("accepts a severity or class that the code has in another context", () => {
    const refused = makeIssue({
      code: "not-representable",
      path: "a.md",
      at: "/$title",
      message: "m",
      class: "operation",
      severity: "error",
    });
    expect([refused.class, refused.severity]).toEqual(["operation", "error"]);
    expect(makeIssue({ code: "duplicate-key", path: "a.md", at: "/x", message: "m", severity: "warning" }).severity).toBe(
      "warning",
    );
    expect(makeIssue({ code: "feature-unsupported", path: null, at: null, message: "m", class: "operation" }).class).toBe(
      "operation",
    );
  });

  test("refuses a severity or class that the code never has", () => {
    expect(() => makeIssue({ code: "syntax-error", path: "a.json", at: "", message: "m", severity: "warning" })).toThrow(
      RangeError,
    );
    expect(() => makeIssue({ code: "duplicate-key", path: "a.md", at: "/x", message: "m", class: "structural" })).toThrow(
      RangeError,
    );
  });
});

describe("issue codes", () => {
  test("a structural code is always an error", () => {
    for (const [code, info] of Object.entries(ISSUE_CODES)) {
      if (info.classes.includes("structural")) expect([code, info.severities]).toEqual([code, ["error"]]);
    }
  });

  test("isIssueCode knows the table's codes and nothing inherited", () => {
    expect(isIssueCode("syntax-error")).toBe(true);
    expect(isIssueCode("conflict")).toBe(true);
    expect(isIssueCode("toString")).toBe(false);
    expect(isIssueCode("storage-failed")).toBe(true);
    expect(isIssueCode("storage-error")).toBe(false);
  });

  test("the table is frozen all the way down", () => {
    expect(Object.isFrozen(ISSUE_CODES)).toBe(true);
    for (const info of Object.values(ISSUE_CODES)) {
      expect([Object.isFrozen(info), Object.isFrozen(info.severities), Object.isFrozen(info.classes)]).toEqual([
        true,
        true,
        true,
      ]);
    }
  });
});

describe("hasStructuralError", () => {
  test("is true exactly when one issue is structural", () => {
    const warning = makeIssue({ code: "multiple-h1", path: "a.md", at: "", message: "m" });
    const structural = makeIssue({ code: "ref-malformed", path: "a.md", at: "/x", message: "m" });
    const operation = makeIssue({ code: "feature-unsupported", path: null, at: null, message: "m", class: "operation" });
    expect(hasStructuralError([])).toBe(false);
    expect(hasStructuralError([warning, operation])).toBe(false);
    expect(hasStructuralError([warning, structural])).toBe(true);
  });
});

// The counting rule: one issue per occurrence after the first.
describe("repeatedNodes", () => {
  test("a name given three times gives two repeats", () => {
    const members = [
      { name: "a", node: "/a#1" },
      { name: "b", node: "/b" },
      { name: "a", node: "/a#2" },
      { name: "a", node: "/a#3" },
    ];
    expect(repeatedNodes(members)).toEqual(["/a#2", "/a#3"]);
  });

  test("a node whose two names both repeat is reported once", () => {
    // A block anchor `done` and a section `notes`, then a heading whose two anchors are `done` and `notes`.
    const anchors = [
      { name: "done", node: "/$body" },
      { name: "notes", node: "/$sections/0" },
      { name: "done", node: "/$sections/1" },
      { name: "notes", node: "/$sections/1" },
    ];
    expect(repeatedNodes(anchors)).toEqual(["/$sections/1"]);
  });

  test("a node that carries one name twice does not repeat itself", () => {
    const anchors = [
      { name: "done", node: "/$sections/0" },
      { name: "done", node: "/$sections/0" },
    ];
    expect(repeatedNodes(anchors)).toEqual([]);
  });

  test("no names, no repeats", () => {
    expect(repeatedNodes([])).toEqual([]);
  });
});

describe("Outcome", () => {
  const issue = makeIssue({ code: "address-not-found", path: "a.md", at: null, message: "m" });

  test("succeed carries the value and any warnings", () => {
    expect(succeed(1)).toEqual({ ok: true, value: 1, issues: [] });
    expect(succeed("v", [issue])).toEqual({ ok: true, value: "v", issues: [issue] });
  });

  test("fail carries the issues that explain it", () => {
    expect(fail([issue])).toEqual({ ok: false, issues: [issue] });
  });

  test("fail refuses to fail without an issue", () => {
    expect(() => fail([])).toThrow(RangeError);
  });
});
