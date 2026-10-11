import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runConformance, suiteCommit } from "./cli.js";
import { caseFile, compareCase, makeSuite } from "./testing/temp-suite.js";

/** Writes a suite with one passing and one failing self-test case, and returns its path. */
async function suiteWithFailure(): Promise<string> {
  return makeSuite({ "cases/self.cases.json": caseFile([compareCase("pass", 1, 1, true), compareCase("fail", 1, 1, false)]) });
}

describe("runConformance", () => {
  test("runs the real suite with the defaults, writes the report and exits with 0", async () => {
    const directory = await makeSuite({});
    const result = await runConformance([], directory);
    expect(result).toEqual({
      stdout: expect.stringMatching(/^conformance: 14 pass, 0 fail, 0 error, \d+ skip; report in /),
      stderr: "",
      exitCode: 0,
    });
    expect(result.stdout).toContain(join(directory, "conformance-report.json"));
    const report = JSON.parse(await readFile(join(directory, "conformance-report.json"), "utf8"));
    expect(report.implementation).toEqual({ name: "vollmond-ts", version: "0.0.0", profiles: ["read"] });
    expect(report.selection).toBeNull();
  });

  test("exits with 1 on a failing case, and prints the failing ids when asked", async () => {
    const suite = await suiteWithFailure();
    const args = ["--suite", suite, "--declaration", "declaration.json", "--report", "out.json", "--ids-failing"];
    const result = await runConformance(args, suite);
    expect(result).toEqual({
      stdout: `conformance: 1 pass, 1 fail, 0 error, 0 skip; report in ${join(suite, "out.json")}\nself/fail\n`,
      stderr: "",
      exitCode: 1,
    });
  });

  test("passes the selection on, each criterion repeatable", async () => {
    const suite = await suiteWithFailure();
    const args = [
      "--suite",
      suite,
      "--declaration",
      "declaration.json",
      "--profile",
      "read",
      "--profile",
      "query",
      "--section",
      "5",
      "--id",
      "self/",
    ];
    expect((await runConformance(args, suite)).exitCode).toBe(1);
    const report = JSON.parse(await readFile(join(suite, "conformance-report.json"), "utf8"));
    expect(report.selection).toEqual({ profiles: ["read", "query"], sections: ["5"], ids: ["self/"] });
  });

  test("exits with 2 and writes no report when the run cannot start", async () => {
    const suite = await suiteWithFailure();
    await writeFile(join(suite, "suite.json"), '{"version": "1", "case_format": 9}');
    const result = await runConformance(["--suite", suite, "--declaration", "declaration.json"], suite);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("case_format 9");
    await expect(access(join(suite, "conformance-report.json"))).rejects.toThrow();
  });

  test("exits with 2 on an unknown option", async () => {
    const result = await runConformance(["--nope"], await makeSuite({}));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--nope");
  });
});

describe("suiteCommit", () => {
  test("gives the commit of a clean suite, and nothing once it has a change or outside git", async () => {
    const suite = await suiteWithFailure();
    expect(suiteCommit(suite)).toBeUndefined();
    const git = (...args: string[]) => execFileSync("git", ["-C", suite, ...args], { encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "suite");
    expect(suiteCommit(suite)).toBe(git("rev-parse", "HEAD"));
    await writeFile(join(suite, "new.cases.json"), "{}");
    expect(suiteCommit(suite)).toBeUndefined();
  });
});
