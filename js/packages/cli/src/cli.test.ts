import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { runCli } from "./cli.js";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("runCli", () => {
  test("prints the package version for --version", () => {
    expect(runCli(["--version"])).toEqual({ stdout: `${manifest.version}\n`, stderr: "", exitCode: 0 });
  });

  test("prints the package version for -v", () => {
    expect(runCli(["-v"])).toEqual({ stdout: `${manifest.version}\n`, stderr: "", exitCode: 0 });
  });

  test("exits with code 2 and a hint when no command is given", () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no command given");
  });

  test("rejects an unknown option with exit code 2", () => {
    const result = runCli(["--nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--nope");
  });
});
