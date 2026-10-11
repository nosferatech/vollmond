import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeDirectories, temporaryDirectory, writeFiles } from "./directories.testkit.js";
import { discoverStore, type StoreLocation } from "./store-discovery.js";

const runsAsRoot = process.getuid?.() === 0;
const canChmod = process.platform !== "win32" && !runsAsRoot;

const STORE_CONFIG = { ".vmd/config.yaml": "vmd: 1\n" };

/** Finds the store and expects to find one. */
async function found(request: Parameters<typeof discoverStore>[0]): Promise<StoreLocation> {
  const discovered = await discoverStore(request);
  if (!discovered.ok) throw new Error(`no store: ${discovered.error.message}`);
  return discovered.value;
}

/** Finds the store and expects not to find one; returns the message and the hint. */
async function notFound(request: Parameters<typeof discoverStore>[0]): Promise<{ message: string; hint: string }> {
  const discovered = await discoverStore(request);
  if (discovered.ok) throw new Error(`a store at ${discovered.value.root}`);
  return discovered.error;
}

describe("from the working directory", () => {
  test("finds the store whose root is the working directory", async () => {
    const root = writeFiles(temporaryDirectory(), STORE_CONFIG);
    expect(await found({ cwd: root })).toEqual({
      root,
      configurationFile: join(root, ".vmd", "config.yaml"),
      configurationName: ".vmd/config.yaml",
      workingPrefix: "",
    });
  });

  test("finds the store from a directory inside it, and gives that directory as a store path", async () => {
    const root = writeFiles(temporaryDirectory(), STORE_CONFIG);
    const cwd = makeDirectories(root, "docs/design");
    const location = await found({ cwd });
    expect(location.root).toBe(root);
    expect(location.workingPrefix).toBe("docs/design");
  });

  test("finds a store that is a subdirectory of a repository, not the repository", async () => {
    const repository = writeFiles(temporaryDirectory(), { "README.md": "# r\n", "docs/.vmd/config.yaml": "vmd: 1\n" });
    makeDirectories(repository, ".git");
    expect((await found({ cwd: makeDirectories(repository, "docs/design") })).root).toBe(join(repository, "docs"));
    expect((await notFound({ cwd: repository })).message).toContain("no vmd store here");
  });

  test("finds the nearest of two nested stores", async () => {
    const outer = writeFiles(temporaryDirectory(), { ...STORE_CONFIG, "inner/.vmd/config.yaml": "vmd: 1\n" });
    expect((await found({ cwd: makeDirectories(outer, "inner/a") })).root).toBe(join(outer, "inner"));
    expect((await found({ cwd: makeDirectories(outer, "b") })).root).toBe(outer);
  });

  test("does not take a .vmd directory without config.yaml, or a config.yaml that is a directory, for a store", async () => {
    const outer = writeFiles(temporaryDirectory(), STORE_CONFIG);
    makeDirectories(outer, "a/.vmd/schema", "a/b/.vmd/config.yaml");
    expect((await found({ cwd: makeDirectories(outer, "a/b/c") })).root).toBe(outer);
  });

  test("takes a symbolic link to a configuration file for one", async () => {
    const directory = writeFiles(temporaryDirectory(), { "elsewhere.yaml": "vmd: 1\n" });
    makeDirectories(directory, "store/.vmd");
    symlinkSync(join(directory, "elsewhere.yaml"), join(directory, "store", ".vmd", "config.yaml"));
    expect((await found({ cwd: join(directory, "store") })).root).toBe(join(directory, "store"));
  });

  test("fails outside any store, saying where it looked and how to name a store", async () => {
    const cwd = temporaryDirectory();
    const error = await notFound({ cwd });
    expect(error.message).toBe(`no vmd store here: neither ${cwd} nor a directory above it holds .vmd/config.yaml`);
    expect(error.hint).toContain("--store");
  });

  test.skipIf(!canChmod)("fails when a directory on the way cannot be read, rather than skipping it", async () => {
    const outer = writeFiles(temporaryDirectory(), STORE_CONFIG);
    const locked = makeDirectories(outer, "locked/inside");
    chmodSync(join(outer, "locked"), 0o000);
    try {
      expect((await notFound({ cwd: locked })).message).toContain("EACCES");
    } finally {
      chmodSync(join(outer, "locked"), 0o755);
    }
  });
});

describe("with --store", () => {
  test("takes the directory as the root, relative to the working directory, without looking upwards", async () => {
    const directory = writeFiles(temporaryDirectory(), { ...STORE_CONFIG, "docs/.vmd/config.yaml": "vmd: 1\n" });
    const location = await found({ cwd: directory, store: "docs" });
    expect(location.root).toBe(join(directory, "docs"));
    expect(location.workingPrefix).toBeNull();
  });

  test("takes an absolute path", async () => {
    const root = writeFiles(temporaryDirectory(), STORE_CONFIG);
    expect((await found({ cwd: temporaryDirectory(), store: root })).root).toBe(root);
  });

  test("gives the working directory as a store path when it is inside the named store", async () => {
    const root = writeFiles(temporaryDirectory(), STORE_CONFIG);
    expect((await found({ cwd: makeDirectories(root, "tickets"), store: root })).workingPrefix).toBe("tickets");
  });

  test("fails for a directory that is not a store, even inside one", async () => {
    const outer = writeFiles(temporaryDirectory(), STORE_CONFIG);
    makeDirectories(outer, "plain");
    const error = await notFound({ cwd: outer, store: "plain" });
    expect(error.message).toBe("--store plain is not a vmd store: it has no .vmd/config.yaml");
    expect(error.hint).toContain("--config");
  });

  test("fails for a path that is not a directory", async () => {
    const directory = writeFiles(temporaryDirectory(), { "file.md": "# a\n" });
    expect((await notFound({ cwd: directory, store: "file.md" })).message).toBe("--store file.md is not a directory");
    expect((await notFound({ cwd: directory, store: "missing" })).message).toBe("--store missing is not a directory");
  });
});

describe("with --config", () => {
  test("reads a store with no configuration of its own, named with --store, from a configuration kept elsewhere", async () => {
    // vampiredb's shape: the store is the docs directory of a checkout that has no .vmd/, and its configuration is in vollmond.
    const home = writeFiles(temporaryDirectory(), {
      "vampiredb/docs/design/Minimal_Log.md": "# Minimal log\n",
      "vollmond/examples/vampiredb/config.yaml": "vmd: 1\n",
    });
    const cwd = join(home, "vollmond");
    const location = await found({ cwd, store: "../vampiredb/docs", config: "examples/vampiredb/config.yaml" });
    expect(location).toEqual({
      root: join(home, "vampiredb", "docs"),
      configurationFile: join(home, "vollmond", "examples", "vampiredb", "config.yaml"),
      configurationName: "examples/vampiredb/config.yaml",
      workingPrefix: null,
    });
  });

  test("reads the configuration's path relative to the working directory, not to the store root", async () => {
    const directory = writeFiles(temporaryDirectory(), { "c.yaml": "vmd: 1\n", "docs/c.yaml": "vmd: 1\n" });
    makeDirectories(directory, "docs");
    expect((await found({ cwd: directory, store: "docs", config: "c.yaml" })).configurationFile).toBe(join(directory, "c.yaml"));
  });

  test("replaces the configuration of a store found upwards", async () => {
    const root = writeFiles(temporaryDirectory(), { ...STORE_CONFIG, "other.yaml": "vmd: 1\n" });
    const location = await found({ cwd: makeDirectories(root, "a"), config: "../other.yaml" });
    expect(location.root).toBe(root);
    expect(location.configurationFile).toBe(join(root, "other.yaml"));
  });

  test("does not take the working directory for the root of a store without a configuration file", async () => {
    const directory = writeFiles(temporaryDirectory(), { "c.yaml": "vmd: 1\n", "docs/a.md": "# a\n" });
    const error = await notFound({ cwd: join(directory, "docs"), config: "../c.yaml" });
    expect(error.hint).toBe("with --config, name the store root with --store");
  });
});
