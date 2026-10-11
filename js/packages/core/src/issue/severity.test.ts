import { describe, expect, test } from "vitest";
import { ISSUE_CODES, type IssueCode } from "./codes.js";
import { type Issue, makeIssue } from "./issue.js";
import { applySeverities, type SeverityConfiguration, settingsAllowed } from "./severity.js";

/** A configuration with the defaults, changed by `changes`. */
function configuration(changes: Partial<SeverityConfiguration> = {}): SeverityConfiguration {
  return { uniqueness: "strict", yamlQuoting: "compatible", issues: new Map(), ...changes };
}

/** An issue of a record `a.md`, at its root, with its code's default severity unless `severity` names another. */
function issue(code: IssueCode, severity?: "error" | "warning"): Issue {
  return makeIssue({ code, path: "a.md", at: "", message: code, ...(severity === undefined ? {} : { severity }) });
}

/** The code and severity of each issue. */
function shown(issues: readonly Issue[]): string[] {
  return issues.map((each) => `${each.code} ${each.severity}`);
}

describe("settingsAllowed", () => {
  test.each([
    ["a structural code", "syntax-error"],
    ["a code that is structural in a record and an operation issue elsewhere", "feature-unsupported"],
    ["an operation code", "config-invalid"],
    ["an operation warning", "unicode-runtime-older"],
  ] as const)("allows nothing for %s, which cannot be configured", (_name, code) => {
    expect(settingsAllowed(code)).toEqual([]);
  });

  test("allows only error for a validation code whose occurrences are always errors", () => {
    expect(settingsAllowed("schema-violation")).toEqual(["error"]);
    expect(settingsAllowed("ref-dangling")).toEqual(["error"]);
  });

  test("allows the three settings for a warning, and for a code that is an error or a warning by context", () => {
    for (const code of ["heading-html", "yaml-ambiguous-string", "duplicate-key", "path-invalid", "not-representable"] as const) {
      expect(settingsAllowed(code)).toEqual(["off", "warning", "error"]);
    }
  });

  test("allows some setting for every validation code, and none for any other", () => {
    for (const [code, info] of Object.entries(ISSUE_CODES) as [IssueCode, (typeof ISSUE_CODES)[IssueCode]][]) {
      const configurable = info.classes.every((each) => each !== "structural") && info.classes[0] === "validation";
      expect(settingsAllowed(code).length > 0, code).toBe(configurable);
    }
  });
});

describe("applySeverities", () => {
  test("keeps every issue as it is under the defaults", () => {
    const issues = [issue("duplicate-key"), issue("heading-html"), issue("syntax-error")];
    expect(applySeverities(issues, configuration())).toEqual(issues);
  });

  test("makes duplicate keys and anchors warnings under lenient uniqueness, and nothing else", () => {
    const issues = [issue("duplicate-key"), issue("duplicate-anchor"), issue("anchor-invalid"), issue("path-invalid")];
    expect(shown(applySeverities(issues, configuration({ uniqueness: "lenient" })))).toEqual([
      "duplicate-key warning",
      "duplicate-anchor warning",
      "anchor-invalid error",
      "path-invalid error",
    ]);
  });

  test("turns the YAML ambiguity warnings off under minimal quoting, and nothing else", () => {
    const issues = [issue("yaml-ambiguous-string"), issue("yaml-ambiguous-number"), issue("heading-html")];
    expect(shown(applySeverities(issues, configuration({ yamlQuoting: "minimal" })))).toEqual(["heading-html warning"]);
  });

  test("sets a warning's severity from an issues entry: off, kept, or raised to an error", () => {
    const issues = [issue("heading-html"), issue("multiple-h1"), issue("ref-derived-anchor")];
    const entries = new Map([
      ["heading-html", "error"],
      ["multiple-h1", "off"],
      ["ref-derived-anchor", "warning"],
    ] as const);
    expect(shown(applySeverities(issues, configuration({ issues: entries })))).toEqual([
      "heading-html error",
      "ref-derived-anchor warning",
    ]);
  });

  test("gives a raised warning its new severity and keeps everything else of it", () => {
    const [raised] = applySeverities([issue("heading-html")], configuration({ issues: new Map([["heading-html", "error"]]) }));
    expect(raised).toEqual({ ...issue("heading-html"), severity: "error" });
    expect(Object.isFrozen(raised)).toBe(true);
  });

  test("applies an entry for a code whose severity depends on context to its warnings only, never lowering an error", () => {
    const issues = [issue("path-invalid"), issue("path-invalid", "warning")];
    const quiet = configuration({ issues: new Map([["path-invalid", "off"]]) });
    expect(shown(applySeverities(issues, quiet))).toEqual(["path-invalid error"]);
    const loud = configuration({ issues: new Map([["path-invalid", "error"]]) });
    expect(shown(applySeverities(issues, loud))).toEqual(["path-invalid error", "path-invalid error"]);
  });

  test("applies an entry to the warnings lenient uniqueness gave, so that it wins over the mode", () => {
    const issues = [issue("duplicate-anchor")];
    const off = configuration({ uniqueness: "lenient", issues: new Map([["duplicate-anchor", "off"]]) });
    expect(applySeverities(issues, off)).toEqual([]);
    const raised = configuration({ uniqueness: "lenient", issues: new Map([["duplicate-anchor", "error"]]) });
    expect(shown(applySeverities(issues, raised))).toEqual(["duplicate-anchor error"]);
    // Under strict uniqueness the occurrence is an error, which an entry does not lower.
    const strictOff = configuration({ issues: new Map([["duplicate-anchor", "off"]]) });
    expect(shown(applySeverities(issues, strictOff))).toEqual(["duplicate-anchor error"]);
  });

  test("applies an entry over minimal quoting, which wins over the setting that turned the warning off", () => {
    const issues = [issue("yaml-ambiguous-string"), issue("yaml-ambiguous-number")];
    const entries = new Map([["yaml-ambiguous-string", "warning"]] as const);
    expect(shown(applySeverities(issues, configuration({ yamlQuoting: "minimal", issues: entries })))).toEqual([
      "yaml-ambiguous-string warning",
    ]);
  });

  test("leaves the issues of other codes, and the order, as they are", () => {
    const issues = [issue("heading-html"), issue("syntax-error"), issue("multiple-h1")];
    const entries = new Map([["multiple-h1", "error"]] as const);
    expect(shown(applySeverities(issues, configuration({ issues: entries })))).toEqual([
      "heading-html warning",
      "syntax-error error",
      "multiple-h1 error",
    ]);
  });
});
