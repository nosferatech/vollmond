import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitBlobId, type Outcome } from "@vollmond/core";
import { describeStorageContract } from "@vollmond/core/testkit";
import { afterAll, describe, expect, test, vi } from "vitest";
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

/** Listens on a Unix domain socket at `path`, which puts a socket file there. */
function listenAt(path: string): Promise<Server> {
  const server = createServer();
  return new Promise((done, failed) => {
    server.once("error", failed);
    server.listen(path, () => done(server));
  });
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
  test("refuses a file over maxBytes by its size, without reading it: a 3 GiB sparse file, which no read could hold", async () => {
    const root = temporaryDirectory();
    writeFiles(root, { "big.md": "" });
    truncateSync(join(root, "big.md"), 3 * 1024 ** 3);
    const storage = createFilesystemStorage(root);
    // The reads of open files are counted rather than timed: a backend that read the whole file in parts before refusing it
    // takes a few hundred milliseconds on a laptop, since the file's blocks are holes, and makes thousands of reads.
    const opened = await open(join(root, "big.md"));
    const handlePrototype: FileHandle = Object.getPrototypeOf(opened);
    await opened.close();
    const reads = (["read", "readv", "readFile", "readLines", "createReadStream", "readableWebStream"] as const).map((method) =>
      vi.spyOn(handlePrototype, method),
    );
    const refused = await storage.read("big.md", { maxBytes: 1024 });
    const readCalls = reads.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    for (const spy of reads) spy.mockRestore();
    expect(successValue(refused)).toEqual({ path: "big.md", oversized: true, size: 3 * 1024 ** 3 });
    expect(readCalls).toBe(0);
    // A read within a bound the file is under reads it, so the spies would have seen it.
    writeFiles(root, { "small.md": "small\n" });
    const read = vi.spyOn(handlePrototype, "read");
    expect(successValue(await storage.read("small.md", { maxBytes: 1024 }))).toMatchObject({
      content: new TextEncoder().encode("small\n"),
    });
    const smallReads = read.mock.calls.length;
    read.mockRestore();
    expect(smallReads).toBeGreaterThan(0);
    // A read without the bound reads the whole file, which Node cannot hold in one buffer.
    expect((await storage.read("big.md")).issues.map((issue) => issue.code)).toEqual(["storage-failed"]);
  });

  test("says `cannot read <path>: <reason>` for an error that gives neither a code nor a message", async () => {
    const root = temporaryDirectory();
    writeFiles(root, { "a.md": "a\n" });
    const opened = await open(join(root, "a.md"));
    const handlePrototype: FileHandle = Object.getPrototypeOf(opened);
    await opened.close();
    const read = vi.spyOn(handlePrototype, "readFile").mockRejectedValue(new Error(""));
    try {
      const failed = await createFilesystemStorage(root).read("a.md");
      expect(failed.issues.map((issue) => [issue.code, issue.message])).toEqual([
        ["storage-failed", "cannot read a.md: no reason given"],
      ]);
    } finally {
      read.mockRestore();
    }
  });

  test.skipIf(process.platform === "win32")("does not follow symbolic links", async () => {
    const outside = temporaryDirectory();
    writeFiles(outside, { "secret.md": "outside the store\n" });
    const root = temporaryDirectory();
    writeFiles(root, { "a.md": "a\n" });
    symlinkSync(join(outside, "secret.md"), join(root, "link.md"));
    symlinkSync(outside, join(root, "linked"));
    const storage = createFilesystemStorage(root);
    const paths = async (prefix: string) =>
      successValue(await storage.list({ prefix, limit: 10 })).items.map((item) => item.path);
    expect(await paths("")).toEqual(["a.md"]);
    // Neither at the last segment nor through a directory, so no path leaves the store.
    expect((await storage.read("link.md")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
    expect((await storage.read("linked/secret.md")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
    expect((await storage.stat("linked/secret.md")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
    expect(await paths("linked/")).toEqual([]);
  });

  test.skipIf(process.platform === "win32")("reads a store whose root is reached through a symbolic link", async () => {
    const root = temporaryDirectory();
    writeFiles(root, { "d/a.md": "a\n" });
    const link = join(temporaryDirectory(), "root");
    symlinkSync(root, link);
    const storage = createFilesystemStorage(link);
    expect(successValue(await storage.list({ prefix: "d/", limit: 10 })).items.map((item) => item.path)).toEqual(["d/a.md"]);
    expect((await storage.read("d/a.md")).ok).toBe(true);
  });

  // A FIFO, a socket or a device does not belong in a store, so meeting one is a failure, not a missing file. Nothing
  // waits on the FIFO, which no writer ever opens: the test's timeout would end a read that blocked.
  test.skipIf(process.platform === "win32")(
    "fails at a FIFO with storage-failed, and lists and searches past it with the issue, without waiting for a writer",
    async () => {
      const root = temporaryDirectory();
      writeFiles(root, { "a.md": "a\n", "d/b.md": "b\n", "empty/.keep": "" });
      execFileSync("mkfifo", [join(root, "pipe.md")]);
      execFileSync("mkfifo", [join(root, "d", "pipe")]);
      const storage = createFilesystemStorage(root);
      const failure = (outcome: Outcome<unknown>) => [outcome.ok, outcome.issues.map((issue) => [issue.code, issue.message])];
      expect(failure(await storage.read("pipe.md"))).toEqual([
        false,
        [["storage-failed", "cannot read pipe.md: it is a FIFO, not a regular file"]],
      ]);
      expect(failure(await storage.read("pipe.md", { maxBytes: 10 }))).toEqual(failure(await storage.read("pipe.md")));
      expect(failure(await storage.stat("d/pipe"))).toEqual([
        false,
        [["storage-failed", "cannot read d/pipe: it is a FIFO, not a regular file"]],
      ]);
      // A directory is still no file, as is a path below a FIFO.
      expect((await storage.read("d")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
      expect((await storage.read("pipe.md/x")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
      const listed = await storage.list({ prefix: "", limit: 10 });
      expect(successValue(listed).items.map((item) => item.path)).toEqual(["a.md", "d/b.md", "empty/.keep"]);
      expect(listed.issues.map((issue) => [issue.code, issue.severity, issue.path])).toEqual([
        ["storage-failed", "error", "d/pipe"],
        ["storage-failed", "error", "pipe.md"],
      ]);
      // A glob or an exclude glob that leaves the FIFO out leaves its issue out too.
      expect((await storage.list({ prefix: "d/", limit: 10 })).issues.map((issue) => issue.path)).toEqual(["d/pipe"]);
      expect((await storage.list({ prefix: "", exclude: ["**/pipe*"], limit: 10 })).issues).toEqual([]);
      const searched = await storage.grep({ pattern: "b", mode: "literal", context: 0, limit: 10 });
      expect(successValue(searched).items.map((match) => match.path)).toEqual(["d/b.md"]);
      expect(searched.issues.map((issue) => [issue.code, issue.path])).toEqual([
        ["storage-failed", "d/pipe"],
        ["storage-failed", "pipe.md"],
      ]);
      expect((await storage.grep({ pattern: "b", mode: "literal", glob: "*.md", context: 0, limit: 10 })).issues).toEqual([
        expect.objectContaining({ code: "storage-failed", path: "pipe.md" }),
      ]);
    },
    2000,
  );

  test.skipIf(process.platform === "win32")(
    "fails at a socket with storage-failed, and lists past it with the issue",
    async () => {
      const root = temporaryDirectory();
      writeFiles(root, { "a.md": "a\n" });
      const server = await listenAt(join(root, "s.md"));
      try {
        const storage = createFilesystemStorage(root);
        expect((await storage.read("s.md")).issues.map((issue) => [issue.code, issue.message])).toEqual([
          ["storage-failed", "cannot read s.md: it is a socket, not a regular file"],
        ]);
        const listed = await storage.list({ prefix: "", limit: 10 });
        expect(successValue(listed).items.map((item) => item.path)).toEqual(["a.md"]);
        expect(listed.issues.map((issue) => [issue.code, issue.path])).toEqual([["storage-failed", "s.md"]]);
      } finally {
        await new Promise((done) => server.close(done));
      }
    },
    2000,
  );

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

  test("lists nothing under a root that does not exist, and gives it a null head", async () => {
    const storage = createFilesystemStorage(join(temporaryDirectory(), "missing"));
    expect(successValue(await storage.list({ prefix: "", limit: 10 })).items).toEqual([]);
    expect(await storage.head()).toEqual({ ok: true, value: null, issues: [] });
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

  test("leaves the .git directory out of listings, and finds no file in it", async () => {
    const root = repository();
    const storage = createFilesystemStorage(root);
    const paths = successValue(await storage.list({ prefix: "", limit: 100 })).items.map((item) => item.path);
    expect(paths.some((path) => path === ".git" || path.startsWith(".git/"))).toBe(false);
    expect(paths).toContain(".gitattributes");
    expect(successValue(await storage.list({ prefix: ".git/", limit: 100 })).items).toEqual([]);
    expect((await storage.read(".git/config")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
    expect((await storage.stat(".git/HEAD")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
    // Its near miss: a name that only starts with .git.
    expect((await storage.read(".gitattributes")).ok).toBe(true);
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
