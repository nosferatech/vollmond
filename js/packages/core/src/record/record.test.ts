import { describe, expect, test } from "vitest";
import { makeIssue } from "../issue/issue.js";
import { decodeSource } from "../text/source-text.js";
import { createValueObject } from "../value/value.js";
import { NodeIndexBuilder } from "./node-index.js";
import { type ParsedRecord, parseOutcome, recordFormatOf } from "./record.js";

describe("recordFormatOf", () => {
  test.each([
    ["tickets/0171-x.md", "md"],
    ["a.yaml", "yaml"],
    ["dir.v2/a.yml", "yaml"],
    ["a.b.json", "json"],
  ])("%s is %s", (path, format) => {
    expect(recordFormatOf(path)).toBe(format);
  });

  test.each(["a.MD", "a.txt", "README", "dir.md/file", ".md", "docs/.json", "a.md.bak"])("%s is not a record", (path) => {
    expect(recordFormatOf(path)).toBeNull();
  });
});

describe("parseOutcome", () => {
  const decoded = decodeSource("a.json", new TextEncoder().encode("{}"));
  if (!decoded.ok) throw new Error("not decoded");
  const build = (issues: readonly ReturnType<typeof makeIssue>[]): ParsedRecord => ({
    path: "a.json",
    format: "json",
    value: createValueObject(),
    source: decoded.value,
    nodes: new NodeIndexBuilder({ range: { start: 0, end: 2 } }).build(),
    issues,
  });
  const structural = makeIssue({ code: "duplicate-member", path: "a.json", at: "/a", message: "m" });
  const validation = makeIssue({ code: "duplicate-tag", path: "a.json", at: "", message: "m" });

  test("fails with the structural errors alone when there is one", () => {
    expect(parseOutcome([validation, structural], build)).toEqual({ ok: false, issues: [structural] });
  });

  test("succeeds otherwise, with the validation issues on the record", () => {
    const outcome = parseOutcome([validation], build);
    expect(outcome.ok).toBe(true);
    expect(outcome.issues).toEqual([]);
    expect(outcome.ok && outcome.value.issues).toEqual([validation]);
  });
});
