// `vmd index`: brings the local index up to date for the whole store, writes the snapshot, and evicts at once; and the line
// that `outline` prints when the snapshot is not current.

import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type CliEnvironment, runCli } from "../cli.js";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";

const IMPLEMENTATION = "0".repeat(64);

/** A store whose records link to each other, with one that cannot be read. */
function storeFiles(): Record<string, string> {
  return {
    ".vmd/config.yaml": "vmd: 1\n",
    "a.md": '# A\n\n## Intro <a id="intro"></a>\n\nText.\n',
    "b.md": "# B\n\n[1](a.md#intro) [2](a.md#missing)\n",
    "c.json": "{",
  };
}

function env(root: string, cache: string | null, now?: () => number): Partial<CliEnvironment> {
  return {
    cwd: root,
    cache:
      cache === null
        ? null
        : { directory: cache, explicit: true, implementation: IMPLEMENTATION, ...(now === undefined ? {} : { now }) },
    unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }),
  };
}

async function vmd(root: string, cache: string | null, ...args: string[]) {
  const result = await runCli(args, env(root, cache));
  return { ...result, stdout: String(result.stdout) };
}

const NOTE = "no refs-in counts: the local index is not current; vmd index brings it up to date\n";

describe("vmd index", () => {
  test("indexes the whole store, reports none of its validation issues, and prints the counts and the cache's size", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const cache = temporaryDirectory();
    const first = await vmd(root, cache, "index");
    expect(first.stdout).toMatch(/^3 records \(3 parsed, 0 from the index\), 2 references; cache [0-9.]+ [kM]?B\n$/);
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    const second = await vmd(root, cache, "index");
    expect(second.stdout).toMatch(/^3 records \(0 parsed, 3 from the index\), 2 references; cache /);
    const json = JSON.parse((await vmd(root, cache, "--json", "index")).stdout);
    expect(json.value).toMatchObject({ records: 3, parsed: 0, fromIndex: 3, references: 2, failedWrites: 0 });
    expect(json.value.cacheBytes).toBeGreaterThan(0);
    expect(json.issues).toEqual([]);
  });

  test("writes the snapshot that gives outline its refs-in counts, and outline says so until then", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const cache = temporaryDirectory();
    const before = await vmd(root, cache, "outline", "a.md");
    expect(before.stdout).not.toMatch(/\d refs-in/);
    expect(before.stdout.endsWith(NOTE)).toBe(true);
    await vmd(root, cache, "index");
    const after = await vmd(root, cache, "outline", "a.md");
    expect(after.stdout).toMatch(/#intro .* 1 refs-in\n/);
    expect(after.stdout).not.toContain(NOTE);
    // Without a local index, vmd index would not help: no line.
    expect((await vmd(root, null, "outline", "a.md")).stdout).not.toContain("refs-in");
    expect((await vmd(root, cache, "--no-cache", "outline", "a.md")).stdout).not.toContain("refs-in");
    // Not in the JSON output.
    expect((await vmd(root, cache, "--json", "outline", "b.md")).stdout).not.toContain("vmd index");
  });

  test("evicts at once: another build's directory is removed although the last eviction is an hour old", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const cache = temporaryDirectory();
    const now = Date.now();
    const other = join(cache, `v1-${"1".repeat(64)}`);
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "vmd-cache"), "the local index of vmd, which vmd may remove\n");
    const lookalike = join(cache, `v1-${"2".repeat(64)}`);
    mkdirSync(lookalike, { recursive: true });
    writeFileSync(join(cache, "last-eviction"), String(now - 60 * 60 * 1000));
    // The near miss: a command that writes the cache leaves both while the last eviction is recent.
    await runCli(
      ["ls"],
      env(root, cache, () => now),
    );
    expect(existsSync(other)).toBe(true);
    await runCli(
      ["index"],
      env(root, cache, () => now),
    );
    expect(existsSync(other)).toBe(false);
    expect(existsSync(lookalike)).toBe(true);
  });

  test("exits with 4 when a file cannot be read, and reports that alone", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const file = join(root, "b.md");
    chmodSync(file, 0o000);
    try {
      const cache = temporaryDirectory();
      const result = await vmd(root, cache, "index");
      expect(result.stderr).toMatch(/^b\.md error storage-failed: /);
      expect(result.stderr.match(/ error /g)).toHaveLength(1);
      expect(result.exitCode).toBe(4);
      // The counts add up: the record the backend could not read is neither parsed nor from the index.
      expect(result.stdout).toMatch(/^3 records \(2 parsed, 0 from the index, 1 not read\), /);
      const again = JSON.parse((await vmd(root, cache, "--json", "index")).stdout);
      expect(again.value).toMatchObject({ records: 3, parsed: 0, fromIndex: 2 });
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test("without a usable cache, gives the counts and says that nothing was kept", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const result = await vmd(root, null, "index");
    expect(result.stdout).toMatch(/^3 records \(3 parsed, 0 from the index\), 2 references\nno local index was kept: /);
    expect(result.exitCode).toBe(0);
    // A cache directory inside the store is refused, and that is the reason given.
    const inside = await vmd(root, join(root, ".cache"), "index");
    expect(inside.stdout).toMatch(/no local index was kept: .*inside the store/);
    expect(readdirSync(root)).not.toContain(".cache");
  });

  test("refuses --no-cache and --publish, each as a usage error", async () => {
    const root = writeFiles(temporaryDirectory(), storeFiles());
    const cache = temporaryDirectory();
    const off = await vmd(root, cache, "--no-cache", "index");
    expect(off.stderr).toMatch(/^error usage-invalid: vmd index writes the local index, which --no-cache turns off\n/);
    expect(off.exitCode).toBe(2);
    const publish = await vmd(root, cache, "index", "--publish", "out");
    expect(publish.stderr).toMatch(/^error usage-invalid: .*I7/);
    expect(publish.exitCode).toBe(2);
    expect(readdirSync(cache)).toEqual([]);
  });
});
