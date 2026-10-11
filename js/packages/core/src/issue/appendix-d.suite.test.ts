// Reads the proposal from the repository, so it needs Node's `fs`, and is type checked by tsconfig.suite.json, away from core.
// Deviation from the I1 design, recorded in issue #10: the design puts this test in the conformance runner's package, which
// does not exist yet; it can move there.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ISSUE_CODES } from "./codes.js";

const proposal = readFileSync(new URL("../../../../../docs/draft/vollmond-proposal.md", import.meta.url), "utf8");

interface AppendixRow {
  readonly code: string;
  readonly severities: string[];
  readonly classes: string[];
}

/** The rows of Appendix D's table: each code with the severities and classes its columns name, in the order they name them. */
function appendixRows(): AppendixRow[] {
  const start = proposal.indexOf("\n## Appendix D. Issue codes");
  expect(start).toBeGreaterThan(0);
  const next = proposal.indexOf("\n## ", start + 1);
  const appendix = proposal.slice(start, next < 0 ? undefined : next);
  const rows: AppendixRow[] = [];
  for (const line of appendix.split("\n")) {
    const match = /^\| `([a-z0-9-]+)` \| ([^|]+) \| ([^|]+) \|/.exec(line);
    if (match === null) continue;
    const [, code, severity, issueClass] = match as unknown as [string, string, string, string];
    rows.push({
      code,
      severities: [...new Set(severity.match(/\b(error|warning)\b/g) ?? [])],
      classes: [...new Set(issueClass.match(/\b(structural|validation|operation)\b/g) ?? [])],
    });
  }
  return rows;
}

describe("Appendix D", () => {
  const rows = appendixRows();

  test("the table was found and read", () => {
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.map((row) => row.code)).toContain("syntax-error");
  });

  test("every code in the appendix is in core's table, and every code in core's table is in the appendix", () => {
    const appendixCodes = rows.map((row) => row.code).sort();
    expect(Object.keys(ISSUE_CODES).sort()).toEqual(appendixCodes);
    expect(new Set(appendixCodes).size).toBe(appendixCodes.length);
  });

  test("each code has the appendix's severities and classes, with the default first", () => {
    for (const row of rows) {
      const info = ISSUE_CODES[row.code as keyof typeof ISSUE_CODES];
      expect({ code: row.code, severities: info.severities, classes: info.classes }).toEqual({
        code: row.code,
        severities: row.severities,
        classes: row.classes,
      });
    }
  });
});
