// `vmd check [PATHS..] [-n N | --all]`: the issues of the store or of some records on stdout, capped, then the counts per code
// and a summary line; the store's own issues on stderr; exit 4 with an error issue.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type CliEnvironment, runCli } from "../cli.js";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";
import { checkStoreFiles } from "./check-store.testkit.js";

const IMPLEMENTATION = "0".repeat(64);

/** The environment of a run in `root`, with a local index in `cache` when one is given. */
function env(root: string, cache: string | null = null, agrees = true): Partial<CliEnvironment> {
  return {
    cwd: root,
    cache: cache === null ? null : { directory: cache, explicit: true, implementation: IMPLEMENTATION },
    unicodeProbe: () => ({ version: "17.0.0", agrees, failures: agrees ? [] : ["U+0041"] }),
  };
}

async function vmd(root: string, ...args: string[]) {
  const result = await runCli(args, env(root));
  return { ...result, stdout: String(result.stdout) };
}

async function vmdCached(root: string, cache: string, ...args: string[]) {
  const result = await runCli(args, env(root, cache));
  return { ...result, stdout: String(result.stdout) };
}

/** The codes of the issue lines of a text output, in order. */
function codes(text: string): string[] {
  return [...text.matchAll(/^\S.* (?:error|warning) ([a-z-]+): /gm)].map((match) => match[1] as string);
}

describe("check over the whole store", () => {
  test("prints every issue on stdout, sorted by path, then the summary, and exits with 4 for an error", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const result = await vmd(root, "check");
    expect(codes(result.stdout)).toEqual([
      "ref-dangling",
      "anchor-element-ignored",
      "schema-violation",
      "ref-target-not-allowed",
      "ref-target-not-allowed",
    ]);
    expect(result.stdout).toMatch(/^a\.md:5:20 error ref-dangling: /m);
    expect(result.stdout.endsWith("5 records, 4 references: 4 errors, 1 warning\n")).toBe(true);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(4);
  });

  test("names each issue's node by its semantic path beside its exact path", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const result = await vmd(root, "check");
    expect(result.stdout).toContain("  in   #intro/$body  (exact #/$sections/0/$body)\n");
  });

  test("exits with 0 for warnings only, and with nothing to report prints the summary alone", async () => {
    const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n", "a.md": '# A\n\nA <a id="x"></a> word.\n' });
    const warned = await vmd(root, "check");
    expect(codes(warned.stdout)).toEqual(["anchor-element-ignored"]);
    expect(warned.exitCode).toBe(0);
    writeFiles(root, { "a.md": "# A\n\nFine.\n" });
    expect(await vmd(root, "check")).toEqual({
      stdout: "1 record, 0 references: 0 errors, 0 warnings\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("prints the store's issues on stderr, apart from its own", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const result = await runCli(["check"], env(root, null, false));
    expect(result.stderr).toMatch(/^warning unicode-runtime-older: /);
    expect(codes(String(result.stdout))).toHaveLength(5);
  });

  test("keeps its warnings under --quiet, since they are its result", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const result = await vmd(root, "--quiet", "check");
    expect(codes(result.stdout)).toContain("anchor-element-ignored");
  });

  test("fails with 1 for an alias file that cannot be read", async () => {
    const root = writeFiles(temporaryDirectory(), { ...checkStoreFiles(), ".vmd/aliases.jsonl": "not json\n" });
    const result = await vmd(root, "check");
    expect(result.stderr).toMatch(/error alias-file-invalid: /);
    expect(result.exitCode).toBe(1);
  });
});

describe("check's cap on issues", () => {
  /** A store with 25 dangling links in one record. */
  function manyIssues(): string {
    const links = Array.from({ length: 25 }, (_, index) => `[${index}](missing-${index}.md)`).join("\n\n");
    return writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n", "a.md": `# A\n\n${links}\n` });
  }

  test("prints 20 issues by default, then the counts per code, then the summary", async () => {
    const result = await vmd(manyIssues(), "check");
    expect(codes(result.stdout)).toHaveLength(20);
    expect(result.stdout).toMatch(/\n25 issues, 5 not shown: 25 ref-dangling\n1 record, 25 references: 25 errors, 0 warnings\n$/);
  });

  test("prints N with -n N, and all of them with --all", async () => {
    const root = manyIssues();
    expect(codes((await vmd(root, "check", "-n", "3")).stdout)).toHaveLength(3);
    const all = await vmd(root, "check", "--all");
    expect(codes(all.stdout)).toHaveLength(25);
    expect(all.stdout).not.toContain("not shown");
  });

  test("refuses -n with --all, and a count that is not one", async () => {
    const root = manyIssues();
    for (const args of [
      ["-n", "3", "--all"],
      ["-n", "0"],
      ["-n", "x"],
    ]) {
      const result = await vmd(root, "check", ...args);
      expect(result.stderr).toMatch(/^error usage-invalid: /);
      expect(result.exitCode).toBe(2);
    }
  });

  test("gives every issue under --json, uncut, with the summary as the value", async () => {
    const result = await vmd(manyIssues(), "--json", "check");
    const outcome = JSON.parse(result.stdout);
    expect(outcome.ok).toBe(true);
    expect(outcome.issues).toHaveLength(25);
    expect(outcome.value).toEqual({ records: 1, unreadable: 0, references: 25, parsed: 1, fromIndex: 0 });
    expect(result.exitCode).toBe(4);
  });
});

describe("check of some records", () => {
  test("reports only the records PATHS name, by path or glob, while their references resolve into the whole store", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const one = await vmd(root, "check", "b.md");
    expect(codes(one.stdout)).toEqual(["anchor-element-ignored"]);
    expect(one.stdout).toMatch(/1 record, 1 reference: 0 errors, 1 warning\n$/);
    expect(one.exitCode).toBe(0);
    const glob = await vmd(root, "check", "tasks/*", "a.md");
    expect(codes(glob.stdout)).toEqual(["ref-dangling", "schema-violation", "ref-target-not-allowed", "ref-target-not-allowed"]);
  });

  test("fails with address-not-found for a path or a glob that matches no record, and names a directory's glob", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const missing = await vmd(root, "check", "a.md", "nothing.md", "none/*");
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toMatch(/^error address-not-found: no record matches nothing\.md, none\/\*\n/);
    expect(missing.exitCode).toBe(1);
    const directory = await vmd(root, "check", "tasks");
    expect(directory.stderr).toContain("hint tasks is a directory: vmd check 'tasks/**' checks the records below it\n");
    expect(directory.exitCode).toBe(1);
    // The near miss: the glob it suggests checks them.
    expect((await vmd(root, "check", "tasks/**")).exitCode).toBe(4);
  });

  test("refuses a path that is not a store path as get does, and gives a directory written with a slash its glob", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    for (const path of ["./a.md", "../a.md"]) {
      const result = await vmd(root, "check", path);
      expect(result.stderr).toMatch(/^error address-malformed: /);
      expect(result.exitCode).toBe(1);
      expect((await vmd(root, "get", path)).stderr).toMatch(/^error address-malformed: /);
    }
    const slashed = await vmd(root, "check", "tasks/");
    expect(slashed.stderr).toContain("hint tasks/ is a directory: vmd check 'tasks/**' checks the records below it\n");
  });

  test("refuses an asset, which is no record", async () => {
    const root = writeFiles(temporaryDirectory(), { ...checkStoreFiles(), "image.png": "x" });
    const result = await vmd(root, "check", "image.png");
    expect(result.stderr).toMatch(/^error address-not-found: no record matches image\.png\n/);
  });

  test("refuses --fix, which comes with phase I5", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const result = await vmd(root, "check", "--fix");
    expect(result.stderr).toMatch(/^error usage-invalid: .*I5/);
    expect(result.exitCode).toBe(2);
  });
});

describe("check over the local index", () => {
  test("says how many records came from the index, every one on a second run", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const cache = temporaryDirectory();
    const first = await vmdCached(root, cache, "check");
    expect(first.stdout).toMatch(/\n5 records \(0 from the index\), 4 references: 4 errors, 1 warning\n$/);
    const second = await vmdCached(root, cache, "check");
    expect(second.stdout).toMatch(/\n5 records \(5 from the index\), 4 references: 4 errors, 1 warning\n$/);
    // The same issues either way.
    expect(codes(second.stdout)).toEqual(codes(first.stdout));
    writeFiles(root, { "b.md": "# B\n\nChanged.\n" });
    const third = await vmdCached(root, cache, "--json", "check");
    expect(JSON.parse(third.stdout).value).toMatchObject({ records: 5, parsed: 1, fromIndex: 4 });
  });

  test("with --no-cache, neither reads nor writes the cache", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const cache = join(temporaryDirectory(), "vmd");
    const result = await vmdCached(root, cache, "--no-cache", "check");
    expect(result.stdout).toMatch(/\n5 records, 4 references: /);
    expect(() => readdirSync(cache)).toThrow();
  });
});
