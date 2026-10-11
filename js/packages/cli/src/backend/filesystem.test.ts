import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitBlobId, type Outcome } from "@vollmond/core";
import { afterAll, describe, expect, test } from "vitest";
import { describeStorageContract } from "../../../core/src/storage/storage-contract.testkit.js";
import { createFilesystemStorage } from "./filesystem.js";

/** Whether the tests run as root, who can read a file whatever its mode. */
const runsAsRoot = process.getuid?.() === 0;
const canChmod = process.platform !== "win32" && !runsAsRoot;

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) {
    // Restores the modes the tests took away, so that the tree can be removed.
    execFileSync("chmod", ["-R", "u+rwx", directory]);
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Creates an empty temporary directory, removed after the tests. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "vmd-storage-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Writes files below `root`, by store path, creating their directories. */
function writeFiles(root: string, files: Readonly<Record<string, Uint8Array | string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split("/"));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

describeStorageContract({
  name: "filesystem",
  canMakeUnreadable: canChmod,
  async create(fixture) {
    const root = temporaryDirectory();
    writeFiles(root, fixture.files);
    for (const path of fixture.unreadable ?? []) chmodSync(join(root, ...path.split("/")), 0o000);
    return createFilesystemStorage(root);
  },
});

describe("createFilesystemStorage", () => {
  test.skipIf(process.platform === "win32")("does not follow symbolic links", async () => {
    const outside = temporaryDirectory();
    writeFiles(outside, { "secret.md": "outside the store\n" });
    const root = temporaryDirectory();
    writeFiles(root, { "a.md": "a\n" });
    symlinkSync(join(outside, "secret.md"), join(root, "link.md"));
    symlinkSync(outside, join(root, "linked"));
    const storage = createFilesystemStorage(root);
    expect(successValue(await storage.list({ prefix: "", limit: 10 })).items.map((item) => item.path)).toEqual(["a.md"]);
    const read = await storage.read("link.md");
    expect(read.issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
  });

  test.skipIf(!canChmod)("lists the readable files when a directory cannot be read, with a storage-failed issue", async () => {
    const root = temporaryDirectory();
    writeFiles(root, { "a.md": "a\n", "closed/b.md": "b\n", "open/c.md": "c\n" });
    chmodSync(join(root, "closed"), 0o000);
    const storage = createFilesystemStorage(root);
    const outcome = await storage.list({ prefix: "", limit: 10 });
    expect(successValue(outcome).items.map((item) => item.path)).toEqual(["a.md", "open/c.md"]);
    expect(outcome.issues.map((issue) => [issue.code, issue.path])).toEqual([["storage-failed", "closed"]]);
    // A file below it cannot be opened either, which is not the same as its absence.
    expect((await storage.read("closed/b.md")).issues.map((issue) => issue.code)).toEqual(["storage-failed"]);
    expect((await storage.read("open/d.md")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
  });

  test.skipIf(!canChmod)("fails a listing whose own directory cannot be read with storage-failed", async () => {
    const root = temporaryDirectory();
    writeFiles(root, { "closed/b.md": "b\n" });
    chmodSync(join(root, "closed"), 0o000);
    const outcome = await createFilesystemStorage(root).list({ prefix: "closed/", limit: 10 });
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.map((issue) => [issue.code, issue.path])).toEqual([["storage-failed", "closed"]]);
  });

  test("lists nothing under a root that does not exist", async () => {
    const storage = createFilesystemStorage(join(temporaryDirectory(), "missing"));
    expect(successValue(await storage.list({ prefix: "", limit: 10 })).items).toEqual([]);
  });

  test("gives a null head outside a git working copy", async () => {
    const root = temporaryDirectory();
    // Keeps git from finding a repository above the temporary directory.
    process.env.GIT_CEILING_DIRECTORIES = dirname(root);
    try {
      expect(await createFilesystemStorage(root).head()).toEqual({ ok: true, value: null, issues: [] });
    } finally {
      delete process.env.GIT_CEILING_DIRECTORIES;
    }
  });
});

describe("createFilesystemStorage in a git working copy", () => {
  const gitEnv: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_WORK_TREE;
  const git = (root: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", root, "-c", "user.name=vmd", "-c", "user.email=vmd@example.com", "-c", "commit.gpgsign=false", ...args],
      { env: gitEnv, encoding: "utf8" },
    ).trim();

  /** Creates a repository whose `.gitattributes` gives `*.crlf.md` CRLF line endings and `*.upper` a clean filter. */
  function repository(): string {
    const root = temporaryDirectory();
    git(root, "init", "--quiet", "--initial-branch=main");
    git(root, "config", "filter.upper.clean", "tr a-z A-Z");
    git(root, "config", "filter.upper.smudge", "cat");
    writeFiles(root, {
      ".gitattributes": "*.crlf.md text eol=crlf\n*.upper filter=upper\n",
      "plain.md": "# Plain\n\nNo filter.\n",
      "notes.crlf.md": "# Notes\r\n\r\nCRLF in the working copy, LF in the repository.\r\n",
      "shout.upper": "lower case, which the clean filter raises\n",
    });
    git(root, "add", "--all");
    return root;
  }

  test("gives each file the git blob id of its bytes, which ls-files does not for a file a clean filter changes", async () => {
    const root = repository();
    const storage = createFilesystemStorage(root);
    const items = successValue(await storage.list({ prefix: "", limit: 10 })).items;
    expect(items.map((item) => item.path)).toEqual([".gitattributes", "notes.crlf.md", "plain.md", "shout.upper"]);
    for (const item of items) {
      expect(item.version).toBe(git(root, "hash-object", "--no-filters", item.path));
      expect(successValue(await storage.stat(item.path)).version).toBe(item.version);
      expect(successValue(await storage.read(item.path)).version).toBe(item.version);
    }
    // What git stores is the cleaned content: it equals the bytes for an unfiltered file, and differs for a filtered one.
    const staged = (path: string) => git(root, "ls-files", "-s", "--", path).split(/\s+/)[1];
    const version = (path: string) => items.find((item) => item.path === path)?.version;
    expect(staged("plain.md")).toBe(version("plain.md"));
    expect(staged("notes.crlf.md")).not.toBe(version("notes.crlf.md"));
    expect(staged("shout.upper")).not.toBe(version("shout.upper"));
    expect(staged("notes.crlf.md")).toBe(
      await gitBlobId(new TextEncoder().encode("# Notes\n\nCRLF in the working copy, LF in the repository.\n")),
    );
  });

  test("leaves the .git directory out of listings", async () => {
    const root = repository();
    const paths = successValue(await createFilesystemStorage(root).list({ prefix: "", limit: 100 })).items.map(
      (item) => item.path,
    );
    expect(paths.some((path) => path === ".git" || path.startsWith(".git/"))).toBe(false);
    expect(paths).toContain(".gitattributes");
  });

  test("gives the commit of HEAD as the head, also from a subdirectory, and null before the first commit", async () => {
    const root = repository();
    expect(await createFilesystemStorage(root).head()).toEqual({ ok: true, value: null, issues: [] });
    git(root, "commit", "--quiet", "-m", "first");
    const commit = git(root, "rev-parse", "HEAD");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await createFilesystemStorage(root).head()).toEqual({ ok: true, value: commit, issues: [] });
    mkdirSync(join(root, "docs"));
    expect(await createFilesystemStorage(join(root, "docs")).head()).toEqual({ ok: true, value: commit, issues: [] });
  });
});
