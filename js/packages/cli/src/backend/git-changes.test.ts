// The files that differ from a revision in a git working tree, read with git in temporary repositories.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";
import { changedSince } from "./git-changes.js";

function git(directory: string, ...args: string[]): void {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
  execFileSync(
    "git",
    ["-C", directory, "-c", "user.name=vmd", "-c", "user.email=vmd@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { env },
  );
}

function repository(files: Readonly<Record<string, string>>): string {
  const root = writeFiles(temporaryDirectory(), files);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

describe("changedSince", () => {
  test("gives both sides of a move, deleted and modified files, and untracked files git does not ignore", async () => {
    const root = repository({ "a.md": "a", "b.md": "b", "c.md": "c", ".gitignore": "*.log\n" });
    git(root, "mv", "a.md", "moved.md");
    rmSync(join(root, "b.md"));
    writeFiles(root, { "c.md": "changed", "new.md": "n", "noise.log": "x" });
    const changed = await changedSince(root, "HEAD");
    expect(changed.ok && [...changed.value].sort()).toEqual(
      ["a.md", "b.md", "c.md", "moved.md", "new.md"].map((path) => join(root, path)),
    );
  });

  test("names the paths from the repository's top level, wherever below it it is asked", async () => {
    const root = repository({ "docs/a.md": "a", "other/b.md": "b" });
    writeFiles(root, { "other/b.md": "changed", "other/new.md": "n" });
    const changed = await changedSince(join(root, "docs"), "HEAD");
    expect(changed.ok && changed.value).toEqual([join(root, "other/b.md"), join(root, "other/new.md")]);
  });

  test("never lets git read the revision as an option, which could write a file", async () => {
    const root = repository({ "a.md": "a" });
    const target = join(root, "written.txt");
    const changed = await changedSince(root, `--output=${target}`);
    expect(changed.ok).toBe(false);
    expect(changed.issues[0]?.code).toBe("storage-failed");
    expect(existsSync(target)).toBe(false);
  });
});
