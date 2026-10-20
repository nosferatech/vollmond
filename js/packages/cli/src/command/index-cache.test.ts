// The commands over the local index in the per-user cache directory: `ls`'s store-wide count of unreadable records and
// `outline`'s refs-in counts, and that nothing in the store or its checkout is ever read or written as cache.

import { readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { createMemoryIndexCache, gitBlobId, openStore, parseRecord } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { createFilesystemStorage } from "../backend/filesystem.js";
import { createFilesystemIndexCache } from "../cache/filesystem-cache.js";
import { type CacheSettings, type CliEnvironment, runCli } from "../cli.js";
import { makeDirectories, temporaryDirectory, writeFiles } from "../directories.testkit.js";

const IMPLEMENTATION = "0".repeat(64);

/** A store whose records link to each other, with two that cannot be read. */
function storeFiles(): Record<string, string> {
  return {
    ".vmd/config.yaml": "vmd: 1\n",
    "a.md": '# A\n\n## Intro <a id="intro"></a>\n\nText.\n\n### Deep <a id="deep"></a>\n\nMore.\n',
    "b.md": "# B\n\n[1](a.md#intro) [2](a.md#deep) [3](a.md)\n",
    "c.json": "{",
    "d.md": "# D\n\n[4](a.md#deep)\n",
    "e.json": "[",
  };
}

/** The environment of a run in `root` with a cache in `directory`, set with XDG_CACHE_HOME unless `explicit` is false. */
function env(root: string, directory: string | null, explicit = true): Partial<CliEnvironment> {
  const cache: CacheSettings | null = directory === null ? null : { directory, explicit, implementation: IMPLEMENTATION };
  return { cwd: root, cache, unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }) };
}

async function vmd(root: string, directory: string | null, ...args: string[]) {
  const result = await runCli(args, env(root, directory));
  return { ...result, stdout: String(result.stdout) };
}

/** Every file below a directory, by relative path, with its bytes and modification time. */
function treeOf(root: string): Record<string, string> {
  const found: Record<string, string> = {};
  const pending = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const entry of readdirSync(next, { withFileTypes: true })) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else {
        found[relative(root, path)] = `${statSync(path).mtimeMs} ${readFileSync(path).toString("base64")}`;
      }
    }
  }
  return found;
}

/** Runs a full check of the store through core with the same cache the commands use, which writes the snapshot. */
async function checkWith(root: string, directory: string): Promise<void> {
  const index = createFilesystemIndexCache({ directory, implementation: IMPLEMENTATION, storeRoot: root });
  const opened = await openStore(createFilesystemStorage(root), { index });
  if (!opened.ok) expect.fail(JSON.stringify(opened.issues));
  await opened.value.check();
}

describe("ls over the local index", () => {
  test("counts the unreadable records of the whole store, not only the page's", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const cache = temporaryDirectory();
    const result = await vmd(root, cache, "ls", "-n", "2");
    expect(result.stdout).toContain("2 records could not be read\n");
    expect(result.stdout).not.toContain("on this page");
    // Without a cache, the page's only, as before.
    const page = await vmd(root, null, "ls", "-n", "2");
    expect(page.stdout).not.toContain("could not be read");
    expect((await vmd(root, null, "ls", "-n", "3")).stdout).toContain("1 record on this page could not be read\n");
  });
});

describe("outline over the local index", () => {
  test("gives each line's refs-in count while the snapshot of the last full check is current", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const cache = temporaryDirectory();
    expect((await vmd(root, cache, "outline", "a.md")).stdout).not.toMatch(/\d refs-in/);
    await checkWith(root, cache);
    const outline = await vmd(root, cache, "outline", "a.md");
    expect(outline.stdout).toMatch(/^a\.md {2}.* {2}4 refs-in\n/);
    expect(outline.stdout).toMatch(/#intro .* 3 refs-in\n/);
    expect(outline.stdout).toMatch(/#deep .* 2 refs-in\n/);
    const json = JSON.parse((await vmd(root, cache, "--json", "outline", "a.md")).stdout);
    expect(json.value.node.refsIn).toBe(4);
    // A changed file makes the snapshot stale: no counts, and a line that says vmd index gives them.
    writeFiles(root, { "d.md": "# D\n" });
    const stale = await vmd(root, cache, "outline", "a.md");
    expect(stale.stdout).not.toMatch(/\d refs-in/);
    expect(stale.stdout).toContain("no refs-in counts: the local index is not current; vmd index brings it up to date\n");
    expect(stale.stderr).toBe("");
  });
});

describe("nothing in the checkout is cache", () => {
  test("a forged entry committed in the store's .vmd/cache/ is never read, and the store is not written", async () => {
    const files = storeFiles();
    const root = writeFiles(temporaryDirectory(), files);
    // An entry for c.json's bytes, laid out as the real cache lays it out, that claims c.json is a readable record.
    const version = await gitBlobId(new TextEncoder().encode(files["c.json"] as string));
    const memory = createMemoryIndexCache();
    const forgedStore = await openStore(
      createFilesystemStorage(writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n", "c.json": "{}" })),
      { index: memory },
    );
    if (!forgedStore.ok) expect.fail("the forging store opens");
    await forgedStore.value.list({ limit: 10 });
    const forged = [...memory.entries.values()][0] as Uint8Array;
    expect(parseRecord("c.json", new TextEncoder().encode("{}")).ok).toBe(true);
    for (const directory of [".vmd/cache", ".cache/vmd"]) {
      writeFiles(root, {
        [`${directory}/v1-${IMPLEMENTATION}/entries/parse/${version.slice(0, 2)}/${version}.json.jsonl`]:
          new TextDecoder().decode(forged),
      });
    }
    const before = treeOf(root);
    const cache = temporaryDirectory();
    const listed = await vmd(root, cache, "ls");
    expect(listed.stdout).toMatch(/^c\.json .* unreadable$/m);
    expect(listed.stdout).toContain("2 records could not be read\n");
    await vmd(root, cache, "outline", "a.md");
    expect(treeOf(root)).toEqual(before);
    // The near miss: the cache outside the store was used.
    expect(readdirSync(join(cache, `v1-${IMPLEMENTATION}`, "entries", "parse")).length).toBeGreaterThan(0);
  });

  test("a cache directory inside the store, or inside its git working tree, is not used; one beside it is", async () => {
    const tree = temporaryDirectory();
    makeDirectories(tree, ".git");
    const root = writeFiles(join(tree, "docs"), storeFiles());
    for (const inside of [join(root, ".vmd", "cache"), join(tree, ".cache", "vmd")]) {
      const before = treeOf(tree);
      const listed = await vmd(root, inside, "ls", "-n", "2");
      // No cache: the page's count, and nothing written in the checkout.
      expect(listed.stdout).not.toContain("could not be read");
      expect(treeOf(tree)).toEqual(before);
    }
    const beside = join(temporaryDirectory(), "vmd");
    const listed = await vmd(root, beside, "ls", "-n", "2");
    expect(listed.stdout).toContain("2 records could not be read\n");
    expect(readdirSync(join(beside, `v1-${IMPLEMENTATION}`))).toContain("entries");
  });

  test("a store reached through a symbolic link is compared by its real path, so a cache inside it is refused", async () => {
    const real = writeFiles(temporaryDirectory(), storeFiles());
    const link = join(temporaryDirectory(), "store");
    symlinkSync(real, link);
    const inside = join(real, ".cache");
    const listed = await vmd(link, inside, "ls", "-n", "2");
    expect(listed.stdout).not.toContain("could not be read");
    expect(readdirSync(real)).not.toContain(".cache");
    // The near miss: a cache beside the real store is used through the link.
    const beside = temporaryDirectory();
    expect((await vmd(link, beside, "ls", "-n", "2")).stdout).toContain("2 records could not be read\n");
    // And one store has one snapshot, by its real path: a check through the link gives an outline by the real path its counts.
    await vmd(link, beside, "check");
    expect((await vmd(real, beside, "outline", "a.md")).stdout).toMatch(/#intro .* 3 refs-in\n/);
  });

  test("the default cache directory is used inside a working tree that encloses the store, such as a dotfiles home", async () => {
    const home = temporaryDirectory();
    makeDirectories(home, ".git");
    const root = writeFiles(join(home, "notes"), storeFiles());
    const listed = await runCli(["ls", "-n", "2"], env(root, join(home, ".cache", "vmd"), false));
    expect(String(listed.stdout)).toContain("2 records could not be read\n");
    // The near miss: the same place set with XDG_CACHE_HOME is refused.
    const set = await runCli(["ls", "-n", "2"], env(root, join(home, ".cache", "set"), true));
    expect(String(set.stdout)).not.toContain("could not be read");
  });

  test("get, cat and grep neither read nor write the cache", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const cache = join(temporaryDirectory(), "vmd");
    // With @refs, which resolves references through the store, the only path by which get could reach entries.
    expect((await vmd(root, cache, "get", "b.md", "--meta", "all")).exitCode).toBe(0);
    await vmd(root, cache, "cat", "a.md");
    await vmd(root, cache, "grep", "Text");
    expect(() => readdirSync(cache)).toThrow();
  });
});
