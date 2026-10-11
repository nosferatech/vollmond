import { join } from "node:path";
import { MAX_CONFIGURATION_BYTES, MAX_SCHEMA_BYTES } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { configurationFileSource, readConfigurationFile } from "./configuration-file.js";
import { makeDirectories, temporaryDirectory, writeFiles } from "./directories.testkit.js";

const THREE_MIB = "x".repeat(3 * 1024 * 1024);

describe("readConfigurationFile", () => {
  test("reads at most one byte more than the largest configuration, whatever the file holds", async () => {
    const root = writeFiles(temporaryDirectory(), { "big.yaml": THREE_MIB, "small.yaml": "vmd: 1\n" });
    const big = await readConfigurationFile(join(root, "big.yaml"));
    expect(big.kind === "read" && big.content.length).toBe(MAX_CONFIGURATION_BYTES + 1);
    const small = await readConfigurationFile(join(root, "small.yaml"));
    expect(small.kind === "read" && new TextDecoder().decode(small.content)).toBe("vmd: 1\n");
  });
});

describe("configurationFileSource", () => {
  /** The source of a configuration file `config.yaml` in a directory holding these files beside it. */
  function sourceIn(files: Readonly<Record<string, string>>) {
    const root = writeFiles(temporaryDirectory(), { "config.yaml": "vmd: 1\n", ...files });
    return { root, source: configurationFileSource(join(root, "config.yaml"), "config.yaml", new Uint8Array()) };
  }

  test("reads a schema from the schema/ directory beside the file, through its subdirectories", async () => {
    const { source } = sourceIn({ "schema/t.json": "{}", "schema/sub/u.json": "[]" });
    expect(await source.readSchema("t.json")).toEqual({ ok: true, value: new TextEncoder().encode("{}"), issues: [] });
    expect((await source.readSchema("sub/u.json")).ok).toBe(true);
  });

  test("reads at most one byte more than the largest schema, whatever the file holds", async () => {
    const { source } = sourceIn({ "schema/big.json": THREE_MIB });
    const read = await source.readSchema("big.json");
    expect(read.ok && read.value instanceof Uint8Array && read.value.length).toBe(MAX_SCHEMA_BYTES + 1);
  });

  test("fails with address-not-found for a schema that does not exist, and storage-failed for a directory", async () => {
    const { root, source } = sourceIn({});
    expect((await source.readSchema("none.json")).issues.map((issue) => issue.code)).toEqual(["address-not-found"]);
    makeDirectories(root, "schema/dir.json");
    expect((await source.readSchema("dir.json")).issues.map((issue) => issue.code)).toEqual(["storage-failed"]);
  });
});
