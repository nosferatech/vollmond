// The tree of a git revision, read with git's plumbing in temporary repositories.

import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { gitBlobId } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { writeFiles } from "../directories.testkit.js";
import { git, isolateGit, repository } from "../git.testkit.js";
import { revisionTree } from "./git-changes.js";

isolateGit();

describe("revisionTree", () => {
  test("gives each regular file's blob id by its path from the top level, wherever below it it is asked", async () => {
    const root = repository({ "docs/a.md": "a", "other/b.md": "b" });
    symlinkSync("a.md", join(root, "docs", "link.md"));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "link");
    writeFiles(root, { "other/b.md": "changed", "other/new.md": "n" });
    const tree = await revisionTree(join(root, "docs"), "HEAD");
    if (!tree.ok) expect.fail(JSON.stringify(tree.issues));
    expect(tree.value.top).toBe(root);
    expect([...tree.value.blobs]).toEqual([
      ["docs/a.md", await gitBlobId(new TextEncoder().encode("a"))],
      ["other/b.md", await gitBlobId(new TextEncoder().encode("b"))],
    ]);
  });

  test("gives an earlier revision's tree, not the working tree's", async () => {
    const root = repository({ "a.md": "one" });
    writeFiles(root, { "a.md": "two" });
    git(root, "commit", "-q", "-am", "two");
    const tree = await revisionTree(root, "HEAD~1");
    expect(tree.ok && tree.value.blobs.get("a.md")).toBe(await gitBlobId(new TextEncoder().encode("one")));
  });

  test("fails with storage-failed for a revision the repository does not have", async () => {
    const root = repository({ "a.md": "a" });
    const tree = await revisionTree(root, "nope");
    expect(tree.ok).toBe(false);
    expect(tree.issues[0]?.message).toBe("git has no revision nope in the store's repository");
  });

  test("never lets git read the revision as an option, which could write a file", async () => {
    const root = repository({ "a.md": "a" });
    const target = join(root, "written.txt");
    const tree = await revisionTree(root, `--output=${target}`);
    expect(tree.ok).toBe(false);
    expect(tree.issues[0]?.code).toBe("storage-failed");
    expect(existsSync(target)).toBe(false);
  });
});
