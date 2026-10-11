import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fail,
  type Issue,
  type IssueCode,
  MAX_CONFIGURATION_BYTES,
  makeIssue,
  type Outcome,
  succeed,
  type UnicodeRuntimeProbe,
} from "@vollmond/core";
import { describe, expect, test, vi } from "vitest";
import { type CliEnvironment, runCli } from "./cli.js";
import { type Command, type CommandInvocation, outcomeOutput, usageOutput } from "./command/command.js";
import { makeDirectories, temporaryDirectory, writeFiles } from "./directories.testkit.js";
import { formatColumns } from "./output/lines.js";
import { formatPageRemainder, PAGE_OPTIONS, readLimit } from "./output/paging.js";
import { formatTokens } from "./output/sizes.js";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const AGREES: UnicodeRuntimeProbe = Object.freeze({ version: "17.0.0", agrees: true, failures: [] });
const OLDER: UnicodeRuntimeProbe = Object.freeze({
  version: "17.0.0",
  agrees: false,
  failures: ["U+16EA0 is not a letter here"],
});

/** A command for these tests, which reads a store unless told otherwise and gives what `run` gives. */
function command(name: string, run: Command["run"], overrides: Partial<Command> = {}): Command {
  return { name, usage: "", summary: `the ${name} command of the tests`, options: {}, readsStore: true, run, ...overrides };
}

/** A command that gives `outcome`, with its value written as one line. */
function giving(outcome: Outcome<unknown>, overrides: Partial<Command> = {}): Command {
  return command("give", async () => outcomeOutput(outcome, (value) => `${JSON.stringify(value)}\n`), overrides);
}

/** Lists the store's files a page at a time, one line each with its path, size and tokens, as a listing does. */
const list = command(
  "list",
  async ({ store, options }: CommandInvocation) => {
    const limit = readLimit(options.limit as string | undefined, 3);
    if (!limit.ok) return usageOutput(limit.message);
    const cursor = options.cursor as string | undefined;
    const page = await (store?.storage ?? never()).list({
      prefix: "",
      limit: limit.limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    return outcomeOutput(page, (value) => {
      const rows = value.items.map((file) => ({ cells: [file.path, `${file.size} B`, formatTokens(file.size)] }));
      return formatColumns(rows) + (value.cursor === null ? "" : formatPageRemainder({ remaining: null, cursor: value.cursor }));
    });
  },
  { options: PAGE_OPTIONS, usage: "[-n N] [--cursor C]" },
);

/** Fails the test: a store was expected. */
function never(): never {
  throw new Error("the command ran without a store");
}

/** An environment in `cwd` with `commands`, whose runtime agrees with the Unicode tables unless `probe` says otherwise. */
function environment(cwd: string, commands: readonly Command[], probe: UnicodeRuntimeProbe = AGREES): Partial<CliEnvironment> {
  return { cwd, commands, unicodeProbe: () => probe, runtimeUnicodeVersion: "16.0" };
}

/** A temporary store with a configuration and three records. */
function store(files: Readonly<Record<string, string>> = {}): string {
  return writeFiles(temporaryDirectory(), {
    ".vmd/config.yaml": "vmd: 1\n",
    "a.md": "# A\n",
    "b.json": "{}",
    "tickets/0171-x.md": "x".repeat(4800),
    ...files,
  });
}

/** An issue of `code` with its default severity. */
function issue(code: IssueCode, at: string | null = null): Issue {
  return makeIssue({ code, path: "a.md", at, message: `the ${code} of the tests` });
}

/** Runs `vmd` as {@link runCli} does, for a command whose stdout is text. */
async function runText(
  args: readonly string[],
  env: Partial<CliEnvironment> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await runCli(args, env);
  if (typeof result.stdout !== "string") throw new Error("stdout holds bytes");
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

describe("without a command", () => {
  test("prints the package version for --version", async () => {
    expect(await runText(["--version"])).toEqual({ stdout: `${manifest.version}\n`, stderr: "", exitCode: 0 });
  });

  test("prints the version even when the working directory was deleted", async () => {
    /** `base` with a working directory that throws when read, as `process.cwd()` does once it was deleted. */
    const deleted = (base: Partial<CliEnvironment>): Partial<CliEnvironment> =>
      Object.defineProperty({ ...base }, "cwd", {
        get: () => {
          throw Object.assign(new Error("uv_cwd"), { code: "ENOENT" });
        },
      });
    expect((await runText(["--version"], deleted({}))).exitCode).toBe(0);
    const result = await runText(["give"], deleted(environment("/", [giving(succeed(1))])));
    expect(result).toEqual({
      stdout: "",
      stderr: "error: cannot read the working directory: ENOENT\n  hint change to a directory that exists\n",
      exitCode: 1,
    });
  });

  test.each(["-v", "-h"])("has no short form %s, leaving it to commands", async (option) => {
    expect((await runText([option])).exitCode).toBe(2);
  });

  test("escapes what the command line holds in a usage error", async () => {
    const result = await runText(["--a\u001b[2Jb"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("\\u001b[2J");
    expect(result.stderr).not.toContain("\u001b");
  });

  test("prints the help for --help, listing the commands", async () => {
    const result = await runText(["--help"], environment("/", [list]));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage: vmd [--store DIR] [--config FILE] [--json] [--quiet] COMMAND");
    expect(result.stdout).toContain("  list      the list command of the tests\n");
  });

  test("exits with code 2 and a hint when no command is given", async () => {
    expect(await runText([])).toEqual({ stdout: "", stderr: "vmd: no command given; try --help\n", exitCode: 2 });
  });

  test("rejects an unknown option with exit code 2", async () => {
    const result = await runText(["--nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--nope");
  });
});

describe("the command line", () => {
  test("rejects an unknown command with exit code 2", async () => {
    expect(await runText(["nope"], environment("/", [list]))).toEqual({
      stdout: "",
      stderr: 'vmd: unknown command "nope"; try --help\n',
      exitCode: 2,
    });
  });

  test("rejects an option the command does not take with exit code 2, without reading the store", async () => {
    const run = vi.fn();
    const result = await runText(["give", "--fields", "a"], environment(temporaryDirectory(), [command("give", run)]));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--fields");
    expect(run).not.toHaveBeenCalled();
  });

  test("gives the command its arguments and options, and the global options from before and after its name", async () => {
    const root = store();
    let seen: CommandInvocation | undefined;
    const echo = command(
      "echo",
      async (invocation) => {
        seen = invocation;
        return outcomeOutput(succeed(null), () => "");
      },
      { options: { value: { type: "boolean" } } },
    );
    await runText(["--quiet", "echo", "x.md#a", "--value", "--store", root], environment("/", [echo]));
    expect(seen?.positionals).toEqual(["x.md#a"]);
    expect(seen?.options).toEqual({ value: true });
    expect(seen?.globals).toEqual({ store: root, json: false, quiet: true });
    expect(seen?.store?.location.root).toBe(root);
    expect(seen?.store?.configuration).toEqual({ vmd: 1, declared: 1 });
  });

  test("prints a command's help for --help after its name, without running it", async () => {
    const result = await runText(["list", "--help"], environment("/", [list]));
    expect(result).toEqual({
      stdout: "usage: vmd list [-n N] [--cursor C]\nthe list command of the tests\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("gives exit code 2 for a usage error the command finds", async () => {
    const result = await runText(["list", "-n", "0"], environment(store(), [list]));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("-n takes a whole number");
  });

  test("calls a command whose option clashes with a global option a bug", async () => {
    const clash = command("clash", vi.fn(), { options: { json: { type: "boolean" } } });
    const result = await runText(["--help"], environment("/", [clash]));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("internal error");
  });
});

describe("line output, limits and cursors", () => {
  test("prints one line per item, with sizes and approximate tokens, and the cursor when more remain", async () => {
    const result = await runText(["list", "-n", "2"], environment(store(), [list]));
    expect(result).toEqual({
      stdout: ".vmd/config.yaml  7 B  ~2 tok\na.md              4 B  ~1 tok\n… more (--cursor a.md)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("continues from the cursor, and prints no cursor after the last page", async () => {
    const result = await runText(["list", "-n", "2", "--cursor", "a.md"], environment(store(), [list]));
    expect(result.stdout).toBe("b.json             2 B     ~1 tok\ntickets/0171-x.md  4800 B  ~1.2k tok\n");
  });

  test("applies the command's default limit without -n", async () => {
    const result = await runText(["list"], environment(store(), [list]));
    expect(result.stdout.split("\n").filter((line) => line !== "")).toHaveLength(4);
    expect(result.stdout).toContain("… more (--cursor b.json)\n");
  });

  test("fails with exit code 1 and the issue for a cursor that is not one", async () => {
    const result = await runText(["list", "--cursor", "../x"], environment(store(), [list]));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^error query-invalid: "\.\.\/x" is not a list cursor/);
  });
});

describe("--json", () => {
  test("prints the library's outcome unchanged, issues included, and keeps the exit code", async () => {
    const outcome = succeed({ items: ["a"] }, [issue("ref-dangling", "/a")]);
    const result = await runText(["--json", "give"], environment(store(), [giving(outcome)]));
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(JSON.stringify(outcome)));
    expect(result.stdout.endsWith("}\n")).toBe(true);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(4);
  });

  test("prints a failure as its outcome", async () => {
    const outcome = fail([issue("address-not-found")]);
    const result = await runText(["give", "--json"], environment(store(), [giving(outcome)]));
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, issues: [JSON.parse(JSON.stringify(outcome.issues[0]))] });
    expect(result.exitCode).toBe(1);
  });
});

describe("issues and exit codes", () => {
  test("prints the value on stdout and the issues on stderr in the issue format, with 0 for warnings", async () => {
    const result = await runText(["give"], environment(store(), [giving(succeed(1, [issue("heading-html", "/$sections/0")]))]));
    expect(result).toEqual({
      stdout: "1\n",
      stderr: "a.md warning heading-html: the heading-html of the tests\n  in   #/$sections/0\n",
      exitCode: 0,
    });
  });

  test("gives exit code 4 for a success with an error, and still prints the value", async () => {
    const result = await runText(["give"], environment(store(), [giving(succeed(1, [issue("ref-dangling", "/links")]))]));
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("1\n");
    expect(result.stderr).toContain("a.md error ref-dangling:");
  });

  test("gives exit code 1 for a failure, with nothing on stdout", async () => {
    const result = await runText(["give"], environment(store(), [giving(fail([issue("address-not-found")]))]));
    expect(result).toEqual({
      stdout: "",
      stderr: "a.md error address-not-found: the address-not-found of the tests\n",
      exitCode: 1,
    });
  });

  test("gives exit code 3 for a conflict", async () => {
    expect((await runText(["give"], environment(store(), [giving(fail([issue("conflict", "")]))]))).exitCode).toBe(3);
  });

  test("passes the command's details of each issue to the format", async () => {
    const dangling = issue("ref-dangling", "/$sections/1/$body");
    const detailed = command("detailed", async () =>
      outcomeOutput(
        succeed(null, [dangling]),
        () => "",
        () => ({ semantic: "#done/$body" }),
      ),
    );
    const result = await runText(["detailed"], environment(store(), [detailed]));
    expect(result.stderr).toContain("  in   #done/$body  (exact #/$sections/1/$body)\n");
  });

  test("leaves out warnings with --quiet, and keeps errors", async () => {
    const outcome = succeed(1, [issue("heading-html", "/h"), issue("ref-dangling", "/r")]);
    const result = await runText(["give", "--quiet"], environment(store(), [giving(outcome)]));
    expect(result.stderr).not.toContain("heading-html");
    expect(result.stderr).toContain("ref-dangling");
    expect(result.exitCode).toBe(4);
  });

  test("catches a command's exception as a bug, with exit code 1", async () => {
    const broken = command("broken", async () => {
      throw new TypeError("oops");
    });
    const result = await runText(["broken"], environment(store(), [broken]));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^vmd: internal error, which is a bug: TypeError: oops/);
  });

  test("escapes each line of a bug's message and stack", async () => {
    const broken = command("broken", async () => {
      throw new Error("bad \u001b[2J\u202e name");
    });
    const result = await runText(["broken"], environment(store(), [broken]));
    expect(result.stderr).toContain("bad \\u001b[2J\\u202e name");
    expect(result.stderr.includes("\u001b") || result.stderr.includes("\u202e")).toBe(false);
    expect(result.stderr.split("\n").length).toBeGreaterThan(2);
  });
});

describe("bytes on stdout", () => {
  const bytes = new Uint8Array([0x23, 0xff, 0xfe, 0x00, 0x80, 0x0a]);

  /** Reads a file of the store and gives its bytes, as `cat` does. */
  const cat = command("cat", async ({ store, positionals }) => {
    const content = await (store?.storage ?? never()).read(positionals[0] as string);
    return outcomeOutput(content, (value) => value.content);
  });

  test("prints a file that is not UTF-8 byte for byte", async () => {
    const root = store({});
    writeFileSync(join(root, "raw.bin"), bytes);
    const result = await runCli(["cat", "raw.bin"], environment(root, [cat]));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(bytes);
  });

  test("writes the bytes as base64 with --json", async () => {
    const root = store({});
    writeFileSync(join(root, "raw.bin"), bytes);
    const result = await runText(["cat", "raw.bin", "--json"], environment(root, [cat]));
    const printed = JSON.parse(result.stdout);
    expect(printed.value.content).toEqual({ base64: "I//+AIAK" });
    expect(Buffer.from(printed.value.content.base64, "base64")).toEqual(Buffer.from(bytes));
    expect(printed.value.path).toBe("raw.bin");
  });

  test("writes a part of a larger buffer as its own bytes", async () => {
    const part = new Uint8Array([9, 0x41, 0x42, 9]).subarray(1, 3);
    const result = await runText(["--json", "give"], environment(store(), [giving(succeed({ part }))]));
    expect(JSON.parse(result.stdout).value.part).toEqual({ base64: "QUI=" });
  });
});

describe("the store", () => {
  test("is found from a directory inside it", async () => {
    const root = store();
    const result = await runText(["list", "-n", "1"], environment(makeDirectories(root, "tickets"), [list]));
    expect(result.stdout).toContain(".vmd/config.yaml");
  });

  test("is not looked for by a command that reads none", async () => {
    const result = await runText(["give"], environment(temporaryDirectory(), [giving(succeed(1), { readsStore: false })]));
    expect(result).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
  });

  test("missing, fails with exit code 1, a message and a hint, before the command runs", async () => {
    const run = vi.fn();
    const cwd = temporaryDirectory();
    const result = await runText(["give"], environment(cwd, [command("give", run)]));
    expect(result).toEqual({
      stdout: "",
      stderr: `error: no vmd store here: neither ${cwd} nor a directory above it holds .vmd/config.yaml\n  hint run vmd inside a store, or name its root with --store\n`,
      exitCode: 1,
    });
    expect(run).not.toHaveBeenCalled();
  });

  test("with an invalid configuration, fails with exit code 1 and the issue at its position", async () => {
    const root = store({ ".vmd/config.yaml": "vmd: one\n" });
    const result = await runText(["give"], environment(root, [giving(succeed(1))]));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      '.vmd/config.yaml:1:1 error config-invalid: "vmd", the store\'s format version, must be a number from 1, not "one"\n',
    );
  });

  test("with an invalid configuration, prints its outcome with --json, without a path, since it is not a record", async () => {
    const root = store({ ".vmd/config.yaml": "collections: {}\n" });
    const result = await runText(["give", "--json"], environment(root, [giving(succeed(1))]));
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, issues: [{ code: "config-invalid", path: null }] });
    expect(result.exitCode).toBe(1);
  });

  test("names the --config file in a configuration's issue", async () => {
    const root = store({ "c.yaml": "vmd: [\n" });
    const result = await runText(["give", "--config", "c.yaml"], environment(root, [giving(succeed(1))]));
    expect(result.stderr).toMatch(/^c\.yaml:2:1 error config-invalid: not valid YAML/);
  });

  test("declaring a newer minor version, is read without a warning", async () => {
    const root = store({ ".vmd/config.yaml": "vmd: 1.2\n" });
    expect(await runText(["give"], environment(root, [giving(succeed(1))]))).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(process.platform === "win32")("with --config naming a FIFO, fails at once rather than waiting on it", async () => {
    const root = store();
    execFileSync("mkfifo", [join(root, "fifo.yaml")]);
    const result = await runText(["give", "--config", "fifo.yaml"], environment(root, [giving(succeed(1))]));
    expect(result).toEqual({
      stdout: "",
      stderr: "fifo.yaml error config-invalid: the configuration is a FIFO, not a regular file\n",
      exitCode: 1,
    });
  });

  test("with --config naming a directory, fails with config-invalid", async () => {
    const root = store();
    makeDirectories(root, "conf");
    const result = await runText(["give", "--config", "conf"], environment(root, [giving(succeed(1))]));
    expect(result.stderr).toBe("conf error config-invalid: the configuration is a directory, not a regular file\n");
    expect(result.exitCode).toBe(1);
  });

  test("with --config naming a file over a mebibyte, fails with config-invalid, and reads one of exactly a mebibyte", async () => {
    const big = `vmd: 1\n#${"x".repeat(MAX_CONFIGURATION_BYTES - 9)}\n`;
    const root = store({ "big.yaml": `${big}x`, "limit.yaml": big });
    const result = await runText(["give", "--config", "big.yaml"], environment(root, [giving(succeed(1))]));
    expect(result.stderr).toMatch(/^big\.yaml error config-invalid: the configuration is larger than 1048576 bytes/);
    expect((await runText(["give", "--config", "limit.yaml"], environment(root, [giving(succeed(1))]))).exitCode).toBe(0);
  });

  test("named with --store holding escape sequences, is named escaped in the failure", async () => {
    const result = await runText(["give", "--store", "a\u001b]0;x\u0007b"], environment(store(), [giving(succeed(1))]));
    expect(result.stderr).toBe(
      "error: --store a\\u001b]0;x\\u0007b is not a directory\n  hint name the store root, the directory that holds .vmd/\n",
    );
  });

  test("of a newer major format version, is refused with exit code 1", async () => {
    const root = store({ ".vmd/config.yaml": "vmd: 2\n" });
    const result = await runText(["give"], environment(root, [giving(succeed(1))]));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^\.vmd\/config\.yaml:1:1 error format-version-unsupported: /);
  });

  test("is read with a configuration kept outside it, through --store and --config, the store left unmodified", async () => {
    const home = writeFiles(temporaryDirectory(), {
      "vampiredb/docs/design/Minimal_Log.md": "# Minimal log\n",
      "vollmond/examples/vampiredb/config.yaml": "vmd: 1\n",
    });
    const args = ["list", "--store", "../vampiredb/docs", "--config", "examples/vampiredb/config.yaml"];
    const result = await runText(args, environment(join(home, "vollmond"), [list]));
    expect(result).toEqual({ stdout: "design/Minimal_Log.md  14 B  ~4 tok\n", stderr: "", exitCode: 0 });
  });

  test("with --config naming the store's own configuration's replacement, reads that one", async () => {
    const root = store({ ".vmd/config.yaml": "vmd: 2\n", "other.yaml": "vmd: 1\n" });
    expect((await runText(["give", "--config", "other.yaml"], environment(root, [giving(succeed(1))]))).exitCode).toBe(0);
  });

  test("with --config naming no file, fails with exit code 1", async () => {
    const result = await runText(["give", "--config", "missing.yaml"], environment(store(), [giving(succeed(1))]));
    expect(result).toEqual({
      stdout: "",
      stderr: "error: cannot read the configuration missing.yaml: it does not exist\n  hint check the path given to --config\n",
      exitCode: 1,
    });
  });
});

describe("the Unicode probe", () => {
  const warning = "warning: this runtime's Unicode 16.0 is older than Unicode 17.0.0";

  test("warns once, on a runtime whose Unicode data is older, and the command still runs", async () => {
    const probe = vi.fn(() => OLDER);
    const result = await runText(["list"], { ...environment(store(), [list]), unicodeProbe: probe });
    expect(result.stderr.split(warning)).toHaveLength(2);
    expect(result.stderr).toBe(
      `${warning}, which derived anchors follow (U+16EA0 is not a letter here)\n` +
        "  hint a heading with a character added since may get another anchor here than elsewhere; a newer Node avoids this\n",
    );
    expect(result.stdout).toContain("a.md");
    expect(result.exitCode).toBe(0);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test("warns once with the issues of the command after it", async () => {
    const outcome = succeed(1, [issue("heading-html", "/h"), issue("heading-html", "/i")]);
    const result = await runText(["give"], environment(store(), [giving(outcome)], OLDER));
    expect(result.stderr.split(warning)).toHaveLength(2);
    expect(result.stderr.indexOf(warning)).toBe(0);
  });

  test("does not warn on a runtime that agrees", async () => {
    expect((await runText(["list"], environment(store(), [list], AGREES))).stderr).toBe("");
  });

  test("does not warn with --quiet", async () => {
    expect((await runText(["list", "--quiet"], environment(store(), [list], OLDER))).stderr).toBe("");
  });

  test("does not run for a command without a store, for --version, or for a usage error", async () => {
    const probe = vi.fn(() => OLDER);
    for (const args of [["give"], ["--version"], ["list", "--nope"]]) {
      const commands = [giving(succeed(1), { readsStore: false }), list];
      const result = await runText(args, { ...environment(store(), commands), unicodeProbe: probe });
      expect(result.stderr).not.toContain("warning");
    }
    expect(probe).not.toHaveBeenCalled();
  });

  test("is core's probe by default", async () => {
    const { unicodeRuntimeProbe } = await import("@vollmond/core");
    const result = await runText(["list"], { cwd: store(), commands: [list] });
    expect(result.stderr.includes("warning: this runtime's Unicode")).toBe(!unicodeRuntimeProbe().agrees);
  });
});
