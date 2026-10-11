import { fail, type IssueCode, makeIssue, succeed } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { ExitCode, exitCodeOf } from "./exit-code.js";

/** An issue of `code` with its default severity. */
const issue = (code: IssueCode) => makeIssue({ code, path: "a.md", at: null, message: "m" });

test("the exit codes are 0 ok, 1 error, 2 usage, 3 conflict and 4 validation failed", () => {
  expect(ExitCode).toEqual({ ok: 0, error: 1, usage: 2, conflict: 3, validationFailed: 4 });
});

describe("exitCodeOf", () => {
  test("is 0 for a success without issues", () => {
    expect(exitCodeOf(succeed(1))).toBe(0);
  });

  test("is 0 for a success with warnings only", () => {
    expect(exitCodeOf(succeed(1, [issue("heading-html"), issue("ref-derived-anchor")]))).toBe(0);
  });

  test("is 4 for a success with an issue of severity error, among warnings", () => {
    expect(exitCodeOf(succeed(1, [issue("heading-html"), issue("ref-dangling")]))).toBe(4);
  });

  test("is 4 for a success with a warning whose severity was raised to error", () => {
    const raised = makeIssue({ code: "duplicate-key", severity: "error", path: "a.md", at: "/a", message: "m" });
    expect(exitCodeOf(succeed(1, [raised]))).toBe(4);
  });

  test("is 1 for a failure, whatever the severities of its issues", () => {
    expect(exitCodeOf(fail([issue("address-not-found")]))).toBe(1);
    expect(exitCodeOf(fail([issue("syntax-error"), issue("heading-html")]))).toBe(1);
  });

  test("is 3 for a failure with a conflict among its issues", () => {
    expect(exitCodeOf(fail([issue("storage-failed"), issue("conflict")]))).toBe(3);
  });
});
