// `vmd check --changed REV` in temporary git repositories: the records that changed since REV and those that cite a changed
// path, a move with `git mv` among them, and the changes that make it a check of the whole store.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type CliEnvironment, runCli } from "../cli.js";
import { makeDirectories, temporaryDirectory, writeFiles } from "../directories.testkit.js";

const IMPLEMENTATION = "0".repeat(64);

/** This process's environment without the variables that point git at another repository than the one around a directory. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) if (name.startsWith("GIT_")) delete environment[name];
  return environment;
}

/** Runs git in `directory`, with an identity for commits and no signing, and gives its output. */
function git(directory: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", directory, "-c", "user.name=vmd", "-c", "user.email=vmd@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8", env: gitEnvironment() },
  );
}

/** Creates a repository holding `files`, committed, and returns its root. */
function repository(files: Readonly<Record<string, string>>): string {
  const root = writeFiles(temporaryDirectory(), files);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

/** A record that no test changes or cites, with a dangling link: only a check of the whole store reports it. */
const BYSTANDER = { "z.md": "# Z\n\n[z](nowhere.md)\n" };

function env(cwd: string, cache: string | null): Partial<CliEnvironment> {
  return {
    cwd,
    cache: cache === null ? null : { directory: cache, explicit: true, implementation: IMPLEMENTATION },
    unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }),
  };
}

async function vmd(cwd: string, cache: string | null, ...args: string[]) {
  const result = await runCli(args, env(cwd, cache));
  return { ...result, stdout: String(result.stdout) };
}

/** The paths and codes of the issue lines of a text output, in order. */
function reported(text: string): string[] {
  return [...text.matchAll(/^(\S+?)(?::\d+:\d+)? (?:error|warning) ([a-z-]+): /gm)].map((match) => `${match[1]} ${match[2]}`);
}

describe("check --changed", () => {
  test("reports the records changed since REV, tracked or not, and leaves the others out", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", ...BYSTANDER, "a.md": "# A\n" });
    writeFiles(root, { "a.md": "# A\n\n[x](x.md)\n", "new.md": "# N\n\n[y](y.md)\n" });
    const result = await vmd(root, null, "check", "--changed", "HEAD");
    expect(reported(result.stdout)).toEqual(["a.md ref-dangling", "new.md ref-dangling"]);
    expect(result.stdout).toMatch(/\n2 records, 2 references: 2 errors, 0 warnings\n$/);
    expect(result.exitCode).toBe(4);
    // The near miss: the whole store reports the bystander too.
    expect(reported((await vmd(root, null, "check")).stdout)).toContain("z.md ref-dangling");
  });

  test("after git mv a.md b.md, reports the reference to a.md as dangling, with the index and without it", async () => {
    const files = { ".vmd/config.yaml": "vmd: 1\n", ...BYSTANDER, "a.md": "# A\n", "c.md": "# C\n\n[a](a.md)\n" };
    for (const cached of [true, false]) {
      const root = repository(files);
      const cache = cached ? temporaryDirectory() : null;
      if (cache !== null) await vmd(root, cache, "check");
      git(root, "mv", "a.md", "b.md");
      const result = await vmd(root, cache, "check", "--changed", "HEAD");
      expect(reported(result.stdout)).toEqual(["c.md ref-dangling"]);
      expect(result.stdout).toMatch(/\n2 records(?: \(\d+ from the index\))?, 1 reference: 1 error, 0 warnings\n$/);
    }
  });

  test("reports a record whose target was deleted, and one that cites a path added since", async () => {
    const root = repository({
      ".vmd/config.yaml": "vmd: 1\n",
      ...BYSTANDER,
      "a.md": "# A\n",
      "c.md": "# C\n\n[a](a.md#intro)\n",
      "d.md": "# D\n\n[e](e.md#two)\n",
    });
    rmSync(join(root, "a.md"));
    writeFiles(root, { "e.md": "# E\n\n## Two\n\n## Two\n" });
    const result = await vmd(root, temporaryDirectory(), "check", "--changed", "HEAD");
    expect(reported(result.stdout)).toEqual(["c.md ref-dangling", "d.md ref-ambiguous", "e.md duplicate-key"]);
  });

  test("checks the whole store when the configuration, a schema or the alias file changed", async () => {
    const files = {
      ".vmd/config.yaml": 'vmd: 1\ncollections:\n  notes:\n    match: ["notes/*.json"]\n    schema: note.schema.json\n',
      ".vmd/schema/note.schema.json": "{}",
      ...BYSTANDER,
      "a.md": "# A\n",
    };
    const changes: Record<string, string>[] = [
      { ".vmd/config.yaml": `${files[".vmd/config.yaml"]}ignore: ["drafts/**"]\n` },
      { ".vmd/schema/note.schema.json": '{"type": "object"}' },
      { ".vmd/aliases.jsonl": "" },
    ];
    for (const change of changes) {
      const root = repository(files);
      // The near miss: before the change, nothing is reported.
      expect((await vmd(root, null, "check", "--changed", "HEAD")).stdout).toBe(
        "0 records, 0 references: 0 errors, 0 warnings\n",
      );
      writeFiles(root, change);
      expect(reported((await vmd(root, null, "check", "--changed", "HEAD")).stdout)).toEqual(["z.md ref-dangling"]);
    }
  });

  test("maps a repository's paths below the store root, and leaves out those outside it", async () => {
    const top = repository({ "docs/.vmd/config.yaml": "vmd: 1\n", "docs/a.md": "# A\n", "other/x.md": "# X\n" });
    const root = join(top, "docs");
    writeFiles(top, { "docs/a.md": "# A\n\n[x](x.md)\n", "other/x.md": "# X\n\n[y](y.md)\n" });
    const result = await vmd(root, null, "check", "--changed", "HEAD");
    expect(reported(result.stdout)).toEqual(["a.md ref-dangling"]);
    expect(result.stdout).toMatch(/\n1 record, /);
  });

  test("counts a change to a configuration given with --config in the same repository, and to its schemas", async () => {
    const files = {
      "conf/config.yaml": 'vmd: 1\ncollections:\n  notes:\n    match: ["*.json"]\n    schema: note.schema.json\n',
      "conf/schema/note.schema.json": "{}",
      "docs/z.md": BYSTANDER["z.md"],
      "docs/a.md": "# A\n",
    };
    for (const change of [
      { "conf/config.yaml": `${files["conf/config.yaml"]}ignore: ["x/**"]\n` },
      { "conf/schema/note.schema.json": "true" },
    ]) {
      const top = repository(files);
      makeDirectories(top, "docs/.vmd");
      const args = ["--store", "docs", "--config", "conf/config.yaml", "check", "--changed", "HEAD"];
      expect(reported((await vmd(top, null, ...args)).stdout)).toEqual([]);
      writeFiles(top, change);
      expect(reported((await vmd(top, null, ...args)).stdout)).toEqual(["z.md ref-dangling"]);
    }
  });
});

describe("check --changed's failures and guards", () => {
  test("fails with storage-failed outside a git repository, and for a revision git does not know", async () => {
    const plain = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" });
    const outside = await vmd(plain, null, "check", "--changed", "HEAD");
    expect(outside.stderr).toMatch(/^error storage-failed: --changed needs the store to be in a git repository: /);
    expect(outside.exitCode).toBe(1);
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" });
    const unknown = await vmd(root, null, "check", "--changed", "no-such-revision");
    expect(unknown.stderr).toMatch(/^error storage-failed: git cannot compare the store with no-such-revision: /);
    expect(unknown.exitCode).toBe(1);
  });

  test("refuses a revision that git would read as an option, which could write a file", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" });
    const target = join(root, "written.txt");
    const result = await vmd(root, null, "check", `--changed=--output=${target}`);
    expect(result.stderr).toMatch(/^error usage-invalid: --changed takes a revision/);
    expect(result.exitCode).toBe(2);
    expect(existsSync(target)).toBe(false);
    // The near miss: a revision that starts otherwise is taken.
    expect((await vmd(root, null, "check", "--changed", "HEAD~0")).exitCode).toBe(0);
  });

  test("refuses PATHS with --changed", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" });
    const result = await vmd(root, null, "check", "a.md", "--changed", "HEAD");
    expect(result.stderr).toMatch(/^error usage-invalid: PATHS and --changed cannot be given together/);
    expect(result.exitCode).toBe(2);
  });

  test("ignores GIT_DIR, which would name another repository than the store's", async () => {
    const other = repository({ "x.md": "# X\n" });
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", ...BYSTANDER, "a.md": "# A\n" });
    writeFiles(root, { "a.md": "# A\n\n[x](x.md)\n" });
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(other, ".git");
    try {
      expect(reported((await vmd(root, null, "check", "--changed", "HEAD")).stdout)).toEqual(["a.md ref-dangling"]);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });
});
