// The global options `--no-cache`, which neither reads nor writes the local index, and `--strict`, the strict read mode.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createMemoryIndexCache, gitBlobId, openStore } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { createFilesystemStorage } from "./backend/filesystem.js";
import { type CliEnvironment, runCli } from "./cli.js";
import { checkStoreFiles } from "./command/check-store.testkit.js";
import { temporaryDirectory, writeFiles } from "./directories.testkit.js";

const IMPLEMENTATION = "0".repeat(64);

function env(root: string, cache: string | null): Partial<CliEnvironment> {
  return {
    cwd: root,
    cache: cache === null ? null : { directory: cache, explicit: true, implementation: IMPLEMENTATION },
    unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }),
  };
}

async function vmd(root: string, cache: string | null, ...args: string[]) {
  const result = await runCli(args, env(root, cache));
  return { ...result, stdout: String(result.stdout) };
}

/** Every file below a directory, by relative path, with its bytes and modification time. */
function treeOf(root: string): Record<string, string> {
  const found: Record<string, string> = {};
  const pending = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const entry of readdirSync(next, { withFileTypes: true })) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else found[relative(root, path)] = `${statSync(path).mtimeMs} ${readFileSync(path).toString("base64")}`;
    }
  }
  return found;
}

describe("--no-cache", () => {
  test("reads no entry: a forged one that says a broken record is readable is used without it, and not with it", async () => {
    const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n", "a.md": "# A\n", "c.json": "{" });
    const cache = temporaryDirectory();
    // The entry of a readable c.json, made by core over a memory cache, planted under the broken c.json's version.
    const memory = createMemoryIndexCache();
    const fine = await openStore(
      createFilesystemStorage(writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n", "c.json": "{}" })),
      { index: memory },
    );
    if (!fine.ok) expect.fail("the store opens");
    await fine.value.list({ limit: 10 });
    const forged = [...memory.entries.values()][0] as Uint8Array;
    const version = await gitBlobId(new TextEncoder().encode("{"));
    writeFiles(cache, {
      [`v1-${IMPLEMENTATION}/entries/parse/${version.slice(0, 2)}/${version}.json.jsonl`]: forged,
    });
    // The near miss: without --no-cache the plant is read, and c.json passes for readable.
    expect((await vmd(root, cache, "ls")).stdout).not.toContain("unreadable");
    const before = treeOf(cache);
    const listed = await vmd(root, cache, "--no-cache", "ls");
    expect(listed.stdout).toMatch(/^c\.json .* unreadable$/m);
    for (const args of [["check"], ["outline", "a.md"], ["ls"]]) await vmd(root, cache, "--no-cache", ...args);
    expect(treeOf(cache)).toEqual(before);
  });

  test("reads no snapshot: outline gives no refs-in counts, and writes nothing", async () => {
    const root = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": "vmd: 1\n",
      "a.md": "# A\n",
      "b.md": "# B\n\n[a](a.md)\n",
    });
    const cache = temporaryDirectory();
    await vmd(root, cache, "check");
    expect((await vmd(root, cache, "outline", "a.md")).stdout).toContain("1 refs-in");
    const before = treeOf(cache);
    expect((await vmd(root, cache, "--no-cache", "outline", "a.md")).stdout).not.toContain("refs-in");
    expect(treeOf(cache)).toEqual(before);
  });
});

describe("--strict", () => {
  test("refuses a record that breaks its schema in get, outline and ls, and reads it without the option", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    for (const command of [
      ["get", "tasks/t.json"],
      ["outline", "tasks/t.json"],
    ]) {
      const strict = await vmd(root, null, "--strict", ...command);
      expect(strict.stderr).toMatch(/tasks\/t\.json:1:2 error schema-violation: /);
      expect(strict.exitCode).toBe(1);
      expect((await vmd(root, null, ...command)).exitCode).toBe(0);
    }
    const listed = await vmd(root, null, "--strict", "ls", "tasks/*");
    expect(listed.stdout).toMatch(/^tasks\/t\.json .* unreadable$/m);
    expect((await vmd(root, null, "ls", "tasks/*")).stdout).not.toContain("unreadable");
  });

  test("reads a record whose only fault is a typed reference outside its targets", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const result = await vmd(root, null, "--strict", "get", "tasks/u.json");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("changes nothing in check, which reports the same in either mode", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    expect(await vmd(root, null, "--strict", "check")).toEqual(await vmd(root, null, "check"));
  });
});
