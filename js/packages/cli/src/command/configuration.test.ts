// What a store's configuration changes in the read commands: collections in `ls`, ignored paths, and where schemas are.

import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { MAX_SCHEMA_BYTES } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { type CliEnvironment, type CliResult, runCli } from "../cli.js";
import { makeDirectories, temporaryDirectory, writeFiles } from "../directories.testkit.js";

const COLLECTIONS = [
  "vmd: 1",
  "collections:",
  "  tickets:",
  '    match: ["tickets/*.md"]',
  "    schema: ticket.schema.json",
  "  notes:",
  '    match: ["notes/*.md"]',
  'ignore: ["drafts/**"]',
  "",
].join("\n");

/** The environment of a run in `cwd`, with a runtime whose Unicode data agrees. */
function env(cwd: string): Partial<CliEnvironment> {
  return { cwd, unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }) };
}

/** Runs `vmd` in `cwd` and returns its result, with stdout as text. */
async function vmd(cwd: string, ...args: string[]): Promise<CliResult & { readonly stdout: string }> {
  const result = await runCli(args, env(cwd));
  return { ...result, stdout: typeof result.stdout === "string" ? result.stdout : new TextDecoder().decode(result.stdout) };
}

/** A store with two collections, a schema for one of them in `.vmd/schema/`, and an ignored directory. */
function collectionsStore(schemas: Readonly<Record<string, string>> = { "ticket.schema.json": "{}" }): string {
  const files: Record<string, string> = {
    ".vmd/config.yaml": COLLECTIONS,
    "tickets/0001.md": "# One\n",
    "notes/a.md": "# A\n",
    "drafts/d.md": "# D\n",
    "loose.md": "# L\n",
    "image.png": "x",
  };
  for (const [name, schema] of Object.entries(schemas)) files[`.vmd/schema/${name}`] = schema;
  return writeFiles(temporaryDirectory(), files);
}

describe("ls", () => {
  test("gives each record's collection in a column, and leaves out the ignored paths", async () => {
    const result = await vmd(collectionsStore(), "ls");
    expect(result).toEqual({
      stdout:
        "image.png        1 B  ~0 tok           asset\n" +
        "loose.md         4 B  ~1 tok\n" +
        "notes/a.md       4 B  ~1 tok  notes\n" +
        "tickets/0001.md  6 B  ~2 tok  tickets\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("leaves the column out of a page with no record in a collection", async () => {
    expect((await vmd(collectionsStore(), "ls", "loose.md")).stdout).toBe("loose.md  4 B  ~1 tok\n");
  });

  test("gives the collection under --json", async () => {
    const result = await vmd(collectionsStore(), "--json", "ls", "tickets/*");
    expect(JSON.parse(result.stdout).value.items).toEqual([
      expect.objectContaining({ path: "tickets/0001.md", collection: "tickets" }),
    ]);
  });

  test("counts the records of a collection whose schema is missing as unreadable, and says why once", async () => {
    const result = await vmd(collectionsStore({}), "ls");
    expect(result.stdout).toContain("tickets/0001.md  6 B  ~2 tok  tickets  unreadable\n");
    expect(result.stdout).toContain("1 record on this page could not be read\n");
    expect(result.stderr).toMatch(
      /^error schema-invalid: the schema ticket\.schema\.json of the collection tickets does not exist/,
    );
    expect(result.exitCode).toBe(4);
  });
});

describe("get", () => {
  test("gives @collection, and refuses a record whose collection's schema is missing", async () => {
    expect((await vmd(collectionsStore(), "get", "tickets/0001.md", "--meta", "collection")).stdout).toBe(
      "@collection  tickets\n\n# One\n",
    );
    const refused = await vmd(collectionsStore({}), "--json", "get", "tickets/0001.md");
    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout).issues.map((issue: { code: string }) => issue.code)).toEqual(["schema-invalid"]);
  });

  test("finds no record at an ignored path", async () => {
    const result = await vmd(collectionsStore(), "--json", "get", "drafts/d.md");
    expect(JSON.parse(result.stdout).issues.map((issue: { code: string }) => issue.code)).toEqual(["address-not-found"]);
  });
});

describe("--config", () => {
  /** A checkout holding a store without a configuration, and a configuration kept beside it. */
  function checkout(schemas: Readonly<Record<string, string>>): string {
    const files: Record<string, string> = {
      "store/tickets/0001.md": "# One\n",
      "store/.vmd/schema/ticket.schema.json": "{}",
      "examples/store/config.yaml": COLLECTIONS,
    };
    for (const [name, schema] of Object.entries(schemas)) files[`examples/store/schema/${name}`] = schema;
    return writeFiles(temporaryDirectory(), files);
  }

  test("reads the schemas in the schema/ directory beside the configuration it names", async () => {
    const home = checkout({ "ticket.schema.json": "{}" });
    const result = await vmd(home, "--store", "store", "--config", "examples/store/config.yaml", "get", "tickets/0001.md");
    expect(result).toEqual({ stdout: "# One\n", stderr: "", exitCode: 0 });
  });

  test("does not read the store's own .vmd/schema/ for a configuration given with --config", async () => {
    const home = checkout({});
    const result = await vmd(home, "--store", "store", "--config", "examples/store/config.yaml", "get", "tickets/0001.md");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/schema-invalid: the schema ticket\.schema\.json of the collection tickets does not exist/);
    expect(result.stderr).toContain("hint schemas are in the schema/ directory beside examples/store/config.yaml");
  });

  test("refuses a schema larger than a mebibyte, and reads one of exactly a mebibyte", async () => {
    const schema = (size: number) => `{"description": "${"x".repeat(size - 19)}"}`;
    expect(schema(MAX_SCHEMA_BYTES)).toHaveLength(MAX_SCHEMA_BYTES);
    const args = ["--store", "store", "--config", "examples/store/config.yaml", "get", "tickets/0001.md"];
    expect((await vmd(checkout({ "ticket.schema.json": schema(MAX_SCHEMA_BYTES) }), ...args)).exitCode).toBe(0);
    const larger = await vmd(checkout({ "ticket.schema.json": schema(MAX_SCHEMA_BYTES + 1) }), ...args);
    expect(larger.exitCode).toBe(1);
    expect(larger.stderr).toContain(`ticket.schema.json of the collection tickets is larger than ${MAX_SCHEMA_BYTES} bytes`);
  });

  test("refuses a schema that is a directory, or one it cannot read, naming why", async () => {
    const home = checkout({});
    makeDirectories(home, "examples/store/schema/ticket.schema.json");
    const directory = await vmd(home, "--store", "store", "--config", "examples/store/config.yaml", "get", "tickets/0001.md");
    expect(directory.stderr).toContain("schema/ticket.schema.json is a directory, not a regular file");
    const locked = checkout({ "ticket.schema.json": "{}" });
    const file = join(locked, "examples/store/schema/ticket.schema.json");
    chmodSync(file, 0o000);
    try {
      const unreadable = await vmd(
        locked,
        "--store",
        "store",
        "--config",
        "examples/store/config.yaml",
        "get",
        "tickets/0001.md",
      );
      expect(unreadable.stderr).toMatch(/schema-invalid: .* cannot be read: cannot read schema\/ticket\.schema\.json: EACCES/);
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test("refuses a configuration with a member this version does not define, with exit code 1", async () => {
    const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\njsonc: true\n", "a.md": "# A\n" });
    const result = await vmd(root, "ls");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^\.vmd\/config\.yaml:2:1 error feature-unsupported: the configuration has the member "jsonc"/);
  });
});

describe("symbolic links", () => {
  const CONFIG_T = 'vmd: 1\ncollections:\n  t: {match: ["t/*.md"], schema: t.json}\n';

  /** A store holding `t/a.md`, beside a configuration and a schema outside it, which the store's files may link to. */
  function linkedStore(): { readonly home: string; readonly store: string } {
    const home = writeFiles(temporaryDirectory(), {
      "outside/secret.yaml": CONFIG_T,
      "outside/t.json": "{}",
      "store/t/a.md": "# A\n",
    });
    return { home, store: join(home, "store") };
  }

  test.skipIf(process.platform === "win32")("refuse a store's own .vmd/config.yaml reached through one", async () => {
    const { home, store } = linkedStore();
    makeDirectories(store, ".vmd");
    symlinkSync(join(home, "outside/secret.yaml"), join(store, ".vmd/config.yaml"));
    const result = await vmd(store, "get", "t/a.md");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      /^\.vmd\/config\.yaml error config-invalid: the store has no \.vmd\/config\.yaml\n {2}hint .*symbolic link/,
    );
  });

  test.skipIf(process.platform === "win32")(
    "refuse a store's own schema reached through one, and read one that is a file",
    async () => {
      const { home, store } = linkedStore();
      writeFiles(store, { ".vmd/config.yaml": CONFIG_T });
      makeDirectories(store, ".vmd/schema");
      symlinkSync(join(home, "outside/t.json"), join(store, ".vmd/schema/t.json"));
      const linked = await vmd(store, "get", "t/a.md");
      expect(linked.exitCode).toBe(1);
      expect(linked.stderr).toMatch(/^error schema-invalid: the schema t\.json of the collection t does not exist/);
      const plain = writeFiles(temporaryDirectory(), {
        ".vmd/config.yaml": CONFIG_T,
        ".vmd/schema/t.json": "{}",
        "t/a.md": "# A\n",
      });
      expect(await vmd(plain, "get", "t/a.md")).toEqual({ stdout: "# A\n", stderr: "", exitCode: 0 });
    },
  );

  test.skipIf(process.platform === "win32")("are followed to a --config file and to the schema/ beside it", async () => {
    const { home, store } = linkedStore();
    makeDirectories(home, "config/schema");
    symlinkSync(join(home, "outside/secret.yaml"), join(home, "config/config.yaml"));
    symlinkSync(join(home, "outside/t.json"), join(home, "config/schema/t.json"));
    const result = await vmd(home, "--store", store, "--config", "config/config.yaml", "get", "t/a.md");
    expect(result).toEqual({ stdout: "# A\n", stderr: "", exitCode: 0 });
  });
});
