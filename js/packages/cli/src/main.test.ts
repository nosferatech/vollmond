import { afterEach, beforeEach, expect, test, vi } from "vitest";

const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.argv = originalArgv;
  // Vitest would report the exit code of this process as its own, so clear what `main.ts` set.
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

/** Runs `main.ts` as the `vmd` entry point with the given arguments and returns what it wrote. */
async function runMain(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  process.argv = ["node", "vmd", ...args];
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  await import("./main.js");
  return { stdout, stderr, exitCode: process.exitCode as number | undefined };
}

test("main prints the version on stdout and leaves the exit code at 0", async () => {
  const result = await runMain(["--version"]);
  expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

test("main writes an error to stderr and sets exit code 2 for an unknown option", async () => {
  const result = await runMain(["--nope"]);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("--nope");
  expect(result.exitCode).toBe(2);
});
