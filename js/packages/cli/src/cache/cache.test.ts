// The local index over the per-user cache directory: where it is, its layout, its writes and its eviction. Every test works
// in a temporary directory; none reads or writes the user's own cache.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ENTRY_BYTES, SNAPSHOT_KEY } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { temporaryDirectory } from "../directories.testkit.js";
import { cacheMayServe, userCacheDirectory } from "./cache-directory.js";
import { createFilesystemIndexCache, evictCache } from "./filesystem-cache.js";

const VERSION = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const DIGEST = "a".repeat(64);
const DAY = 24 * 60 * 60 * 1000;
const bytes = (text: string) => new TextEncoder().encode(text);

describe("the per-user cache directory", () => {
  const home = "/home/u";
  test.each([
    ["linux", {}, "/home/u/.cache/vmd"],
    ["darwin", {}, "/home/u/Library/Caches/vmd"],
    ["linux", { XDG_CACHE_HOME: "/x/cache" }, "/x/cache/vmd"],
    // On macOS too, an XDG_CACHE_HOME that is set wins.
    ["darwin", { XDG_CACHE_HOME: "/x/cache" }, "/x/cache/vmd"],
    // A relative one is ignored, as the XDG Base Directory Specification says, and so is an empty one.
    ["linux", { XDG_CACHE_HOME: "cache" }, "/home/u/.cache/vmd"],
    ["darwin", { XDG_CACHE_HOME: "" }, "/home/u/Library/Caches/vmd"],
    ["win32", {}, "/home/u/.cache/vmd"],
  ] as const)("on %s with %j is %s", (platform, variables, expected) => {
    const set = (variables as { readonly XDG_CACHE_HOME?: string }).XDG_CACHE_HOME;
    const explicit = set?.startsWith("/") === true;
    expect(userCacheDirectory({ variables, home, platform })).toEqual({ directory: expected, explicit });
  });

  test("is unknown without a home and without XDG_CACHE_HOME", () => {
    expect(userCacheDirectory({ variables: {}, home: null, platform: "linux" })).toBeNull();
  });

  test("in these tests is a temporary directory, never the user's own", () => {
    // The tests' setup points XDG_CACHE_HOME at a temporary directory for every test file.
    const resolved = userCacheDirectory({ variables: process.env, home: null, platform: process.platform });
    expect(resolved?.directory.startsWith(tmpdir())).toBe(true);
    expect(resolved?.explicit).toBe(true);
  });
});

describe("a cache directory and the store it would serve", () => {
  test("is refused at the store root and below it, set or by default", async () => {
    const store = temporaryDirectory();
    for (const explicit of [true, false]) {
      expect(await cacheMayServe(store, store, explicit)).toBe(false);
      expect(await cacheMayServe(join(store, ".vmd", "cache"), store, explicit)).toBe(false);
      // Through a symbolic link that leads into the store.
      const outside = temporaryDirectory();
      symlinkSync(store, join(outside, "link"));
      expect(await cacheMayServe(join(outside, "link", "cache"), store, explicit)).toBe(false);
    }
  });

  test("set with XDG_CACHE_HOME, is refused below the working tree that holds the store, a .git file or directory", async () => {
    for (const git of ["directory", "file"] as const) {
      const tree = temporaryDirectory();
      if (git === "directory") mkdirSync(join(tree, ".git"));
      else writeFileSync(join(tree, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
      const store = join(tree, "docs");
      mkdirSync(store);
      expect(await cacheMayServe(join(tree, ".cache", "vmd"), store, true)).toBe(false);
    }
  });

  // From the independent review of #153; card AT, (c): every enclosing checkout, for a cache directory that is set.
  test("set with XDG_CACHE_HOME, is refused in the working tree that encloses a submodule or a nested clone", async () => {
    const outer = temporaryDirectory();
    mkdirSync(join(outer, ".git"));
    const inner = join(outer, "vendor", "notes");
    mkdirSync(inner, { recursive: true });
    // A submodule's working tree has a .git file; a nested clone a .git directory.
    writeFileSync(join(inner, ".git"), "gitdir: ../../.git/modules/notes\n");
    const store = join(inner, "docs");
    mkdirSync(store);
    // The near miss: a cache set beside the outer tree is used.
    expect(await cacheMayServe(join(temporaryDirectory(), "vmd"), store, true)).toBe(true);
    // A pull request on the outer repository can commit this directory.
    expect(await cacheMayServe(join(outer, ".cache", "vmd"), store, true)).toBe(false);
  });

  test("under a home directory that is a git working tree (dotfiles): the default is used, one set inside it is not", async () => {
    const home = temporaryDirectory();
    mkdirSync(join(home, ".git"));
    const store = join(home, "notes");
    mkdirSync(store);
    expect(await cacheMayServe(join(home, ".cache", "vmd"), store, false)).toBe(true);
    expect(await cacheMayServe(join(home, "Library", "Caches", "vmd"), store, false)).toBe(true);
    expect(await cacheMayServe(join(home, ".cache", "vmd"), store, true)).toBe(false);
  });

  test("set with XDG_CACHE_HOME beside the store, outside every working tree that encloses it, is used", async () => {
    const parent = temporaryDirectory();
    const store = join(parent, "store");
    mkdirSync(store);
    expect(await cacheMayServe(join(parent, "cache", "vmd"), store, true)).toBe(true);
    // A sibling whose name starts with the store's is not below it.
    expect(await cacheMayServe(join(parent, "store-cache"), store, true)).toBe(true);
  });
});

describe("the filesystem cache", () => {
  function cacheIn(directory: string, now = () => Date.UTC(2026, 9, 20), store = "/stores/one") {
    return createFilesystemIndexCache({ directory, implementation: "abc", storeRoot: store, now });
  }

  test("lays entries out by kind, version and key, shared by stores, with one snapshot per store", async () => {
    const directory = temporaryDirectory();
    const one = cacheIn(directory);
    const two = cacheIn(directory, undefined, "/stores/two");
    await one.write(`parse/${VERSION}.md`, bytes("p"));
    await one.write(`bind/${VERSION}.json.runs.${DIGEST}`, bytes("b"));
    await one.write(SNAPSHOT_KEY, bytes("s1"));
    await two.write(SNAPSHOT_KEY, bytes("s2"));
    const root = join(directory, "v1-abc");
    expect(readFileSync(join(root, "entries", "parse", "01", `${VERSION}.md.jsonl`), "utf8")).toBe("p");
    expect(readFileSync(join(root, "entries", "bind", "01", `${VERSION}.json.runs.${DIGEST}.jsonl`), "utf8")).toBe("b");
    const id = (path: string) => createHash("sha256").update(path).digest("hex");
    expect(readFileSync(join(root, "stores", id("/stores/one"), "snapshot.jsonl"), "utf8")).toBe("s1");
    expect(readFileSync(join(root, "stores", id("/stores/one"), "root"), "utf8")).toBe("/stores/one");
    expect(new TextDecoder().decode((await two.read(`parse/${VERSION}.md`)) ?? undefined)).toBe("p");
    expect(new TextDecoder().decode((await two.read(SNAPSHOT_KEY)) ?? undefined)).toBe("s2");
    expect(await one.read(`parse/${OTHER}.md`)).toBeNull();
  });

  test("reads and writes nothing for a key of another shape", async () => {
    const directory = temporaryDirectory();
    const cache = cacheIn(directory);
    for (const key of ["parse/../../x.md", `parse/${VERSION}.txt`, `bind/${VERSION}.md.a/b.${DIGEST}`, "other", ""]) {
      await cache.write(key, bytes("x"));
      expect(await cache.read(key)).toBeNull();
    }
    // The near miss: a key of the right shape is kept.
    await cache.write(`parse/${VERSION}.yaml`, bytes("x"));
    expect(await cache.read(`parse/${VERSION}.yaml`)).not.toBeNull();
    expect(readdirSync(join(directory, "v1-abc", "entries", "parse", "01"))).toEqual([`${VERSION}.yaml.jsonl`]);
  });

  test("refuses an entry larger than the bound by its size, without reading it", async () => {
    const directory = temporaryDirectory();
    const cache = cacheIn(directory);
    await cache.write(`parse/${VERSION}.md`, bytes("p"));
    const file = join(directory, "v1-abc", "entries", "parse", "01", `${VERSION}.md.jsonl`);
    // A sparse file, so that the test writes no 128 MiB.
    truncateSync(file, MAX_ENTRY_BYTES + 1);
    expect(await cache.read(`parse/${VERSION}.md`)).toBeNull();
    // The near miss: at the bound, it is read.
    truncateSync(file, MAX_ENTRY_BYTES);
    expect((await cache.read(`parse/${VERSION}.md`))?.length).toBe(MAX_ENTRY_BYTES);
  });

  test("does not read another build's entries", async () => {
    const directory = temporaryDirectory();
    await cacheIn(directory).write(`parse/${VERSION}.md`, bytes("p"));
    const other = createFilesystemIndexCache({ directory, implementation: "def", storeRoot: "/stores/one" });
    expect(await other.read(`parse/${VERSION}.md`)).toBeNull();
  });

  test("marks an entry read by its modification time", async () => {
    const directory = temporaryDirectory();
    let now = Date.UTC(2026, 0, 1);
    const cache = cacheIn(directory, () => now);
    await cache.write(`parse/${VERSION}.md`, bytes("p"));
    const file = join(directory, "v1-abc", "entries", "parse", "01", `${VERSION}.md.jsonl`);
    utimesSync(file, new Date(0), new Date(0));
    now = Date.UTC(2026, 5, 1);
    await cache.read(`parse/${VERSION}.md`);
    expect(statSync(file).mtimeMs).toBe(now);
  });

  test("writes a file whole, and two writers of one entry leave it whole, with no temporary file behind", async () => {
    const directory = temporaryDirectory();
    const content = bytes("x".repeat(1 << 20));
    const writers = Array.from({ length: 8 }, () => cacheIn(directory));
    await Promise.all(writers.map((cache) => cache.write(`parse/${VERSION}.md`, content)));
    const folder = join(directory, "v1-abc", "entries", "parse", "01");
    expect(readdirSync(folder)).toEqual([`${VERSION}.md.jsonl`]);
    expect(readFileSync(join(folder, `${VERSION}.md.jsonl`)).length).toBe(content.length);
  });

  test("ignores a write it cannot make, and counts it", async () => {
    const directory = temporaryDirectory();
    // A file where the directory of the entries would be.
    mkdirSync(join(directory, "v1-abc"), { recursive: true });
    writeFileSync(join(directory, "v1-abc", "entries"), "not a directory");
    const cache = cacheIn(directory);
    await cache.write(`parse/${VERSION}.md`, bytes("p"));
    expect(cache.failedWrites).toBe(1);
    expect(await cache.read(`parse/${VERSION}.md`)).toBeNull();
  });
});

describe("eviction", () => {
  /** Writes an entry file of `size` bytes, read last `age` milliseconds before `now`. */
  function entry(root: string, name: string, size: number, now: number, age: number): string {
    const folder = join(root, "entries", "parse", name.slice(0, 2));
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${name}.md.jsonl`);
    writeFileSync(file, "x".repeat(size));
    const time = new Date(now - age);
    utimesSync(file, time, time);
    return file;
  }

  test("removes entries unread for 30 days, then the least recently read until under the bound", async () => {
    const directory = temporaryDirectory();
    const root = join(directory, "v1-abc");
    const now = Date.UTC(2026, 9, 20);
    const stale = entry(root, "aa", 10, now, 31 * DAY);
    const old = entry(root, "bb", 100, now, 3 * DAY);
    const recent = entry(root, "cc", 100, now, 2 * DAY);
    const newest = entry(root, "dd", 100, now, DAY);
    expect(await evictCache({ directory, root, now, bound: 250 })).toBe(true);
    expect([stale, old, recent, newest].map((file) => existsSync(file))).toEqual([false, false, true, true]);
  });

  test("keeps everything under the bound that was read within 30 days", async () => {
    const directory = temporaryDirectory();
    const root = join(directory, "v1-abc");
    const now = Date.UTC(2026, 9, 20);
    const files = [entry(root, "aa", 100, now, 29 * DAY), entry(root, "bb", 100, now, DAY)];
    await evictCache({ directory, root, now, bound: 200 });
    expect(files.map((file) => existsSync(file))).toEqual([true, true]);
  });

  test("removes other implementations' directories and the snapshots of stores that are gone", async () => {
    const directory = temporaryDirectory();
    const root = join(directory, "v1-abc");
    const now = Date.UTC(2026, 9, 20);
    // Another build's cache, as it writes itself.
    await createFilesystemIndexCache({ directory, implementation: "old", storeRoot: "/s", now: () => now - 2 * DAY }).write(
      `parse/${VERSION}.md`,
      bytes("p"),
    );
    mkdirSync(join(directory, "notes"), { recursive: true });
    const living = temporaryDirectory();
    for (const [id, storeRoot] of [
      ["alive", living],
      ["gone", join(living, "removed")],
    ] as const) {
      mkdirSync(join(root, "stores", id), { recursive: true });
      writeFileSync(join(root, "stores", id, "root"), storeRoot);
    }
    await evictCache({ directory, root, now, bound: 1 << 30 });
    expect(existsSync(join(directory, "v1-old"))).toBe(false);
    // Not vmd's layout: left alone.
    expect(existsSync(join(directory, "notes"))).toBe(true);
    expect(existsSync(join(root, "stores", "alive"))).toBe(true);
    expect(existsSync(join(root, "stores", "gone"))).toBe(false);
  });

  test("runs at most once a day", async () => {
    const directory = temporaryDirectory();
    const root = join(directory, "v1-abc");
    const now = Date.UTC(2026, 9, 20);
    expect(await evictCache({ directory, root, now, bound: 1 })).toBe(true);
    const file = entry(root, "aa", 10, now, 31 * DAY);
    expect(await evictCache({ directory, root, now: now + DAY - 1, bound: 1 })).toBe(false);
    expect(existsSync(file)).toBe(true);
    expect(await evictCache({ directory, root, now: now + DAY + 1, bound: 1 })).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  test("runs whenever the last eviction ran when forced, as vmd index does, down to the bound", async () => {
    const directory = temporaryDirectory();
    const root = join(directory, "v1-abc");
    const now = Date.UTC(2026, 9, 20);
    expect(await evictCache({ directory, root, now, bound: 1 })).toBe(true);
    const older = entry(root, "aa", 100, now, 2 * DAY);
    const newer = entry(root, "bb", 100, now, DAY);
    expect(await evictCache({ directory, root, now: now + 1, bound: 150 })).toBe(false);
    expect(await evictCache({ directory, root, now: now + 1, bound: 150, force: true })).toBe(true);
    expect([older, newer].map((file) => existsSync(file))).toEqual([false, true]);
  });

  test("of a cache, forced, and its size, which counts what is left", async () => {
    const directory = temporaryDirectory();
    const now = Date.UTC(2026, 9, 20);
    const cache = createFilesystemIndexCache({ directory, implementation: "abc", storeRoot: "/s", now: () => now, bound: 150 });
    await cache.write(`parse/${VERSION}.md`, bytes("p"));
    const root = join(directory, "v1-abc");
    const older = entry(root, "aa", 100, now, 2 * DAY);
    entry(root, "bb", 100, now, DAY);
    const before = await cache.size();
    expect(before).toBeGreaterThan(200);
    await cache.evict();
    expect(existsSync(older)).toBe(false);
    expect(await cache.size()).toBeLessThan(before);
  });

  // From the independent review of #153.
  test("leaves a directory named like another implementation's that vmd did not write, such as a store", async () => {
    const directory = join(temporaryDirectory(), "vmd");
    const store = join(directory, "v2-notes");
    mkdirSync(join(store, ".vmd"), { recursive: true });
    writeFileSync(join(store, ".vmd", "config.yaml"), "vmd: 1\n");
    // Even with an entries directory, as a store may have.
    mkdirSync(join(store, "entries"));
    await evictCache({ directory, root: join(directory, "v1-current"), now: Date.now(), bound: 1 << 20 });
    expect(existsSync(join(store, ".vmd", "config.yaml"))).toBe(true);
  });

  test("runs on a cache's first write when the last eviction is more than a day old", async () => {
    const directory = temporaryDirectory();
    const now = Date.UTC(2026, 9, 20);
    const root = join(directory, "v1-abc");
    const stale = entry(root, "aa", 10, now, 31 * DAY);
    const cache = createFilesystemIndexCache({ directory, implementation: "abc", storeRoot: "/s", now: () => now });
    await cache.write(`parse/${VERSION}.md`, bytes("p"));
    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(join(directory, "last-eviction"), "utf8")).toBe(String(now));
  });
});
