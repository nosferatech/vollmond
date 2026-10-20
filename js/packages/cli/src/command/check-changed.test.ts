// `vmd check --changed REV` in temporary git repositories: the records that changed since REV and those that cite a changed
// path, a move with `git mv` among them, and the changes that make it a check of the whole store.

import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type CliEnvironment, runCli } from "../cli.js";
import { makeDirectories, temporaryDirectory, writeFiles } from "../directories.testkit.js";
import { git, isolateGit, repository } from "../git.testkit.js";

const IMPLEMENTATION = "0".repeat(64);

isolateGit();

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
    expect(unknown.stderr).toMatch(/^error storage-failed: git has no revision no-such-revision in the store's repository\n/);
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

  test("runs no command from the repository's configuration: no fsmonitor, no clean filter, no external diff", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", ...BYSTANDER, "a.md": "# A\n" });
    const marker = join(temporaryDirectory(), "ran");
    git(root, "config", "core.fsmonitor", `touch ${marker}-fsmonitor; false`);
    git(root, "config", "filter.evil.clean", `sh -c 'touch ${marker}-clean; cat'`);
    git(root, "config", "diff.external", `sh -c 'touch ${marker}-diff'`);
    mkdirSync(join(root, ".git", "info"), { recursive: true });
    writeFileSync(join(root, ".git", "info", "attributes"), "*.md filter=evil\n");
    writeFiles(root, { "a.md": "# A\n\n[x](x.md)\n" });
    const result = await vmd(root, null, "check", "--changed", "HEAD");
    expect(reported(result.stdout)).toEqual(["a.md ref-dangling"]);
    for (const kind of ["fsmonitor", "clean", "diff"]) expect(existsSync(`${marker}-${kind}`)).toBe(false);
    // The near miss: git's own working-tree commands in that repository run each of them, so the plants are live.
    git(root, "status", "--short");
    git(root, "diff");
    git(root, "add", "a.md");
    for (const kind of ["fsmonitor", "clean", "diff"]) expect(existsSync(`${marker}-${kind}`)).toBe(true);
  });

  test("refuses a git older than 2.30, which cannot be told where its options end, and says so", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" });
    const bin = temporaryDirectory();
    writeFileSync(join(bin, "git"), "#!/bin/sh\necho 'git version 2.29.2'\n", { mode: 0o755 });
    const saved = process.env.PATH;
    process.env.PATH = `${bin}:${saved ?? ""}`;
    try {
      const result = await vmd(root, null, "check", "--changed", "HEAD");
      expect(result.stderr).toMatch(/^error storage-failed: --changed needs git 2\.30 or later, and this git is 2\.29\.2\n/);
      expect(result.exitCode).toBe(1);
    } finally {
      process.env.PATH = saved;
    }
    // The near miss: the git on PATH, newer, is taken.
    expect((await vmd(root, null, "check", "--changed", "HEAD")).exitCode).toBe(0);
  });

  test("checks records that git ignores or that a nested repository holds, which differ from REV by not being there", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", ...BYSTANDER, ".gitignore": "drafts/\n", "a.md": "# A\n" });
    writeFiles(root, { "drafts/d.md": "# D\n\n[x](x.md)\n" });
    const nested = writeFiles(join(root, "sub"), { "n.md": "# N\n\n[y](y.md)\n" });
    git(nested, "init", "-q");
    git(nested, "add", "-A");
    git(nested, "commit", "-q", "-m", "nested");
    const result = await vmd(root, null, "check", "--changed", "HEAD");
    expect(reported(result.stdout)).toEqual(["drafts/d.md ref-dangling", "sub/n.md ref-dangling"]);
  });

  test("selects a record that links to an ignored file that was removed, whatever its name starts with", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", ...BYSTANDER, "..x.md": "x", "c.md": "# C\n\n[x](..x.md)\n" });
    rmSync(join(root, "..x.md"));
    expect(reported((await vmd(root, null, "check", "--changed", "HEAD")).stdout)).toEqual(["c.md ref-dangling"]);
  });

  test("finds the changes of a store reached through a symbolic link, and of a configuration named through one", async () => {
    const top = repository({
      "conf/config.yaml": "vmd: 1\n",
      "docs/.vmd/config.yaml": "vmd: 1\n",
      "docs/z.md": BYSTANDER["z.md"],
      "docs/a.md": "# A\n",
    });
    const links = temporaryDirectory();
    symlinkSync(join(top, "docs"), join(links, "docs"));
    symlinkSync(join(top, "conf"), join(links, "conf"));
    writeFiles(top, { "docs/a.md": "# A\n\n[x](x.md)\n" });
    expect(reported((await vmd(join(links, "docs"), null, "check", "--changed", "HEAD")).stdout)).toEqual(["a.md ref-dangling"]);
    const args = ["--store", join(links, "docs"), "--config", join(links, "conf", "config.yaml"), "check", "--changed", "HEAD"];
    expect(reported((await vmd(links, null, ...args)).stdout)).toEqual(["a.md ref-dangling"]);
    writeFiles(top, { "conf/config.yaml": "vmd: 1\nignore: ['x/**']\n" });
    expect(reported((await vmd(links, null, ...args)).stdout)).toEqual(["a.md ref-dangling", "z.md ref-dangling"]);
  });

  test("checks a file the backend cannot read, whose version it cannot know", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", ...BYSTANDER, "a.md": "# A\n" });
    const file = join(root, "a.md");
    chmodSync(file, 0o000);
    try {
      expect(reported((await vmd(root, null, "check", "--changed", "HEAD")).stdout)).toEqual(["a.md storage-failed"]);
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test("counts a configuration file whose name starts with two dots, and a schema file removed", async () => {
    const files = {
      ".vmd/config.yaml": "vmd: 1\n",
      "..c.yaml": "vmd: 1\n",
      ...BYSTANDER,
      "conf/config.yaml": 'vmd: 1\ncollections:\n  notes:\n    match: ["n/*.json"]\n    schema: note.schema.json\n',
      "conf/schema/note.schema.json": "{}",
      "conf/schema/extra.schema.json": "{}",
    };
    const root = repository(files);
    const dotted = ["--config", "..c.yaml", "check", "--changed", "HEAD"];
    expect(reported((await vmd(root, null, ...dotted)).stdout)).toEqual([]);
    writeFiles(root, { "..c.yaml": "vmd: 1\nignore: ['x/**']\n" });
    expect(reported((await vmd(root, null, ...dotted)).stdout)).toEqual(["z.md ref-dangling"]);
    const conf = ["--config", "conf/config.yaml", "check", "--changed", "HEAD"];
    expect(reported((await vmd(root, null, ...conf)).stdout)).toEqual([]);
    rmSync(join(root, "conf/schema/extra.schema.json"));
    expect(reported((await vmd(root, null, ...conf)).stdout)).toEqual(["z.md ref-dangling"]);
  });

  test("refuses a range of revisions, which names no one tree", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" });
    for (const range of ["HEAD~1..HEAD", "main...HEAD"]) {
      const result = await vmd(root, null, "check", "--changed", range);
      expect(result.stderr).toMatch(/^error usage-invalid: --changed takes one revision, not the range /);
      expect(result.exitCode).toBe(2);
    }
  });

  test("says so plainly when git cannot be run", async () => {
    const root = repository({ ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n" });
    const saved = process.env.PATH;
    process.env.PATH = temporaryDirectory();
    try {
      const result = await vmd(root, null, "check", "--changed", "HEAD");
      expect(result.stderr).toMatch(/^error storage-failed: --changed needs git, which cannot be run here: it is not on PATH\n/);
      expect(result.exitCode).toBe(1);
    } finally {
      process.env.PATH = saved;
    }
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
