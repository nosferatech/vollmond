import { describe, expect, test } from "vitest";
import { runCli } from "./cli.js";

describe("runCli", () => {
  test("prints the package version for --version", () => {
    const result = runCli(["--version"]);
    expect(result).toEqual({ stdout: "0.0.0\n", stderr: "", exitCode: 0 });
  });

  test("rejects an unknown option with exit code 2", () => {
    const result = runCli(["--nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--nope");
  });
});
