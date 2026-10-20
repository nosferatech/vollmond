// What a store's configuration changes in the read commands: collections in `ls`, ignored paths, and where schemas are.

import { execFileSync } from "node:child_process";
import { chmodSync, rmSync, symlinkSync, truncateSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join, sep } from "node:path";
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

/** Listens on a Unix domain socket at `path`, which puts a socket file there. */
function listenAt(path: string): Promise<Server> {
  const server = createServer();
  return new Promise((done, failed) => {
    server.once("error", failed);
    server.listen(path, () => done(server));
  });
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
    expect(result.stderr).toContain(`hint schemas are in ${join("examples", "store", "schema")}${sep}`);
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

  test("refuses a schema that is a directory, a FIFO, or one it cannot read, as storage-failed, naming why", async () => {
    const home = checkout({});
    makeDirectories(home, "examples/store/schema/ticket.schema.json");
    const directory = await vmd(home, "--store", "store", "--config", "examples/store/config.yaml", "get", "tickets/0001.md");
    expect(directory.exitCode).toBe(1);
    expect(directory.stderr).toMatch(
      /storage-failed: .*ticket\.schema\.json .* cannot be read: it is a directory, not a regular/,
    );
    if (process.platform !== "win32") {
      const piped = checkout({});
      makeDirectories(piped, "examples/store/schema");
      execFileSync("mkfifo", [join(piped, "examples/store/schema/ticket.schema.json")]);
      const fifo = await vmd(piped, "--store", "store", "--config", "examples/store/config.yaml", "get", "tickets/0001.md");
      expect(fifo.stderr).toMatch(/storage-failed: .*ticket\.schema\.json .* cannot be read: it is a FIFO, not a regular file/);
      const socketed = checkout({});
      makeDirectories(socketed, "examples/store/schema");
      const server = await listenAt(join(socketed, "examples/store/schema/ticket.schema.json"));
      try {
        const args = ["--store", "store", "--config", "examples/store/config.yaml", "get", "tickets/0001.md"];
        const socket = await vmd(socketed, ...args);
        expect(socket.stderr).toMatch(/storage-failed: .*ticket\.schema\.json .* cannot be read: it is a socket, not a regular/);
      } finally {
        await new Promise((done) => server.close(done));
      }
    }
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
      expect(unreadable.stderr).toMatch(/storage-failed: .*ticket\.schema\.json .* cannot be read: EACCES, so/);
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

describe("a store's own schema that is not a regular file", () => {
  const CONFIG = 'vmd: 1\ncollections:\n  t: {match: ["t/*.md"], schema: t.json}\n';

  test("is storage-failed for a directory, which files below it show to be there", async () => {
    const root = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": CONFIG,
      ".vmd/schema/t.json/x.json": "{}",
      "t/a.md": "# A\n",
    });
    const result = await vmd(root, "get", "t/a.md");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/storage-failed: .*t\.json .* cannot be read: it is a directory, not a regular file/);
  });

  // A FIFO, a socket or a device does not belong in a store, so one among the store's own schemas is a failure, as one beside a
  // --config file is. The test's timeout would end a read that waited on the FIFO, which no writer opens.
  test.skipIf(process.platform === "win32")(
    "is storage-failed for a FIFO, without waiting on it",
    async () => {
      const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": CONFIG, "t/a.md": "# A\n" });
      makeDirectories(root, ".vmd/schema");
      execFileSync("mkfifo", [join(root, ".vmd/schema/t.json")]);
      const result = await vmd(root, "get", "t/a.md");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/storage-failed: .*t\.json .* cannot be read: it is a FIFO, not a regular file/);
    },
    5000,
  );

  test.skipIf(process.platform === "win32")("is storage-failed for a socket", async () => {
    const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": CONFIG, "t/a.md": "# A\n" });
    makeDirectories(root, ".vmd/schema");
    const server = await listenAt(join(root, ".vmd/schema/t.json"));
    try {
      const result = await vmd(root, "get", "t/a.md");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/storage-failed: .*t\.json .* cannot be read: it is a socket, not a regular file/);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  test.skipIf(process.platform === "win32")(
    "is missing, schema-invalid, for a directory whose only file is a FIFO, which a listing leaves out",
    async () => {
      const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": CONFIG, "t/a.md": "# A\n" });
      makeDirectories(root, ".vmd/schema/t.json");
      execFileSync("mkfifo", [join(root, ".vmd/schema/t.json/x.json")]);
      const result = await vmd(root, "get", "t/a.md");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/schema-invalid: the schema t\.json of the collection t does not exist/);
    },
    5000,
  );

  test("is missing, schema-invalid, for an empty directory", async () => {
    const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": CONFIG, "t/a.md": "# A\n" });
    makeDirectories(root, ".vmd/schema/t.json");
    const result = await vmd(root, "get", "t/a.md");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/schema-invalid: the schema t\.json of the collection t does not exist/);
  });
});

// The message of a schema that cannot be read names the file once, as the schema of its collection, and the two places schemas
// are read from, the store's .vmd/schema/ and the schema/ beside a --config file, word one failure alike, with a hint that
// names the directory.
describe("a schema that cannot be read", () => {
  const runsAsRoot = process.getuid?.() === 0;
  const CONFIG = 'vmd: 1\ncollections:\n  t: {match: ["t/*.md"], schema: t.json}\n';
  const STORE_HINT = "  hint schemas are in .vmd/schema/\n";
  // The command line names the directory beside --config with the platform's separator, as it names paths it was given.
  const CONFIG_HINT = `  hint schemas are in ${join("examples", "schema")}${sep}\n`;
  const FIFO = "the schema t.json of the collection t cannot be read: it is a FIFO, not a regular file, so";
  const LOCKED = "the schema t.json of the collection t cannot be read: EACCES, so the collection's records cannot be read";
  const MISSING = "the schema t.json of the collection t does not exist, so the collection's records cannot be read";

  /** A store whose collection `t` has the schema `t.json`, kept in `.vmd/schema/`, or beside `examples/config.yaml`. */
  function schemaStore(where: "store" | "config"): { root: string; schemas: string; args: string[] } {
    const root = writeFiles(temporaryDirectory(), {
      [where === "store" ? ".vmd/config.yaml" : "examples/config.yaml"]: CONFIG,
      ...(where === "config" ? { ".vmd/config.yaml": "vmd: 1\n" } : {}),
      "t/a.md": "# A\n",
    });
    const schemas = where === "store" ? ".vmd/schema" : "examples/schema";
    makeDirectories(root, schemas);
    const args = where === "store" ? ["get", "t/a.md"] : ["--config", "examples/config.yaml", "get", "t/a.md"];
    return { root, schemas: join(root, schemas), args };
  }

  for (const [where, hint] of [
    ["store", STORE_HINT],
    ["config", CONFIG_HINT],
  ] as const) {
    test.skipIf(process.platform === "win32")(
      `that is a FIFO names it once, in ${where === "store" ? "the store's .vmd/schema/" : "the schema/ beside --config"}`,
      async () => {
        const store = schemaStore(where);
        execFileSync("mkfifo", [join(store.schemas, "t.json")]);
        const result = await vmd(store.root, ...store.args);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`error storage-failed: ${FIFO} the collection's records cannot be read\n${hint}`);
      },
      5000,
    );

    test.skipIf(process.platform === "win32" || runsAsRoot)(
      `that the filesystem refuses names it once, in ${where === "store" ? "the store" : "--config's directory"}`,
      async () => {
        const store = schemaStore(where);
        const file = join(store.schemas, "t.json");
        writeFiles(store.schemas, { "t.json": "{}" });
        chmodSync(file, 0o000);
        try {
          const result = await vmd(store.root, ...store.args);
          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain(`error storage-failed: ${LOCKED}\n${hint}`);
        } finally {
          chmodSync(file, 0o644);
        }
      },
    );

    test(`that does not exist names it once, in ${where === "store" ? "the store" : "--config's directory"}`, async () => {
      const store = schemaStore(where);
      const result = await vmd(store.root, ...store.args);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`error schema-invalid: ${MISSING}\n${hint.slice(0, -1)}`);
    });
  }
});

describe("a FIFO or a socket in the store", () => {
  /** The collections store, with FIFOs at a record path, in an ignored directory and below a dot segment. */
  function pipedStore(): string {
    const root = collectionsStore();
    makeDirectories(root, ".hidden");
    for (const path of ["notes/pipe.md", "drafts/pipe.md", ".hidden/pipe.md"]) execFileSync("mkfifo", [join(root, path)]);
    return root;
  }

  test.skipIf(process.platform === "win32")(
    "fails a read of one by name with storage-failed, without waiting on it",
    async () => {
      const result = await vmd(pipedStore(), "get", "notes/pipe.md");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/storage-failed: cannot read notes\/pipe\.md: it is a FIFO, not a regular file/);
    },
    5000,
  );

  test.skipIf(process.platform === "win32")(
    "is left out of ls and grep with a storage-failed error, which still succeed, unless vmd ignores its path",
    async () => {
      const root = pipedStore();
      const listed = await vmd(root, "ls");
      expect(listed.stdout).toContain("notes/a.md ");
      expect(listed.stdout).not.toContain("pipe");
      expect(listed.stderr).toBe(
        "notes/pipe.md error storage-failed: cannot read notes/pipe.md: it is a FIFO, not a regular file\n",
      );
      expect(listed.exitCode).toBe(4);
      const searched = await vmd(root, "grep", "# A");
      expect(searched.stdout).toContain("notes/a.md");
      expect(searched.stderr).toBe(listed.stderr);
      expect(searched.exitCode).toBe(4);
      // The ignored FIFOs alone: in a directory the configuration ignores, and below a segment that starts with a dot.
      rmSync(join(root, "notes/pipe.md"));
      expect((await vmd(root, "ls")).stderr).toBe("");
      expect(await vmd(root, "grep", "# A")).toEqual(expect.objectContaining({ stderr: "", exitCode: 0 }));
    },
    5000,
  );
});

describe("files over their bound, 3 GiB sparse files that a read of the whole file could not hold", () => {
  const BIG = 3 * 1024 ** 3;
  const CONFIG = 'vmd: 1\ncollections:\n  t: {match: ["t/*.md"], schema: t.json}\n';

  test("a store's own configuration is config-invalid, refused by its size", async () => {
    const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "", "a.md": "# A\n" });
    truncateSync(join(root, ".vmd/config.yaml"), BIG);
    const result = await vmd(root, "get", "a.md");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/config-invalid: the configuration is larger than 1048576 bytes/);
  });

  test("a store's own schema is schema-invalid, and a record is a syntax-error, each refused by its size", async () => {
    const root = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": CONFIG,
      ".vmd/schema/t.json": "",
      "t/a.md": "# A\n",
      "big.md": "",
    });
    truncateSync(join(root, ".vmd/schema/t.json"), BIG);
    truncateSync(join(root, "big.md"), BIG);
    const schema = await vmd(root, "get", "t/a.md");
    expect(schema.stderr).toMatch(/schema-invalid: the schema t\.json of the collection t is larger than 1048576 bytes/);
    const record = await vmd(root, "--json", "get", "big.md");
    expect(JSON.parse(record.stdout).issues).toEqual([
      expect.objectContaining({ code: "syntax-error", path: "big.md", at: "", message: expect.stringContaining("larger than") }),
    ]);
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

  // Review of #97, O7: a file that a schema's $ref names is read through the backend too, so a committed link cannot read outside.
  test.skipIf(process.platform === "win32")(
    "refuse a file that a store's own schema refers to, reached through one",
    async () => {
      const { home, store } = linkedStore();
      writeFiles(store, { ".vmd/config.yaml": CONFIG_T, ".vmd/schema/t.json": '{"$ref": "linked.json"}' });
      symlinkSync(join(home, "outside/t.json"), join(store, ".vmd/schema/linked.json"));
      const linked = await vmd(store, "get", "t/a.md");
      expect(linked.exitCode).toBe(1);
      expect(linked.stderr).toMatch(/^error schema-invalid: the schema t\.json of the collection t cannot be used/);
      expect(linked.stderr).toContain("linked.json does not exist");
      expect(linked.stderr).toMatch(/hint .*symbolic link/);
    },
  );

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
      expect(linked.stderr).toMatch(/hint schemas are in \.vmd\/schema\/; .*symbolic link/);
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
