import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, type Issue, type IssueCode, makeIssue, type Outcome, succeed, type UnicodeRuntimeProbe } from "@vollmond/core";
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

describe("without a command", () => {
  test.each([["--version"], ["-v"]])("prints the package version for %s", async (option) => {
    expect(await runCli([option])).toEqual({ stdout: `${manifest.version}\n`, stderr: "", exitCode: 0 });
  });

  test("prints the help for --help, listing the commands", async () => {
    const result = await runCli(["--help"], environment("/", [list]));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage: vmd [--store DIR] [--config FILE] [--json] [--quiet] COMMAND");
    expect(result.stdout).toContain("  list      the list command of the tests\n");
  });

  test("exits with code 2 and a hint when no command is given", async () => {
    expect(await runCli([])).toEqual({ stdout: "", stderr: "vmd: no command given; try --help\n", exitCode: 2 });
  });

  test("rejects an unknown option with exit code 2", async () => {
    const result = await runCli(["--nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--nope");
  });
});

describe("the command line", () => {
  test("rejects an unknown command with exit code 2", async () => {
    expect(await runCli(["nope"], environment("/", [list]))).toEqual({
      stdout: "",
      stderr: 'vmd: unknown command "nope"; try --help\n',
      exitCode: 2,
    });
  });

  test("rejects an option the command does not take with exit code 2, without reading the store", async () => {
    const run = vi.fn();
    const result = await runCli(["give", "--fields", "a"], environment(temporaryDirectory(), [command("give", run)]));
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
    await runCli(["--quiet", "echo", "x.md#a", "--value", "--store", root], environment("/", [echo]));
    expect(seen?.positionals).toEqual(["x.md#a"]);
    expect(seen?.options).toEqual({ value: true });
    expect(seen?.globals).toEqual({ store: root, json: false, quiet: true });
    expect(seen?.store?.location.root).toBe(root);
    expect(seen?.store?.configuration).toEqual({ vmd: 1 });
  });

  test("prints a command's help for --help after its name, without running it", async () => {
    const result = await runCli(["list", "--help"], environment("/", [list]));
    expect(result).toEqual({
      stdout: "usage: vmd list [-n N] [--cursor C]\nthe list command of the tests\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("gives exit code 2 for a usage error the command finds", async () => {
    const result = await runCli(["list", "-n", "0"], environment(store(), [list]));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("-n takes a whole number");
  });

  test("calls a command whose option clashes with a global option a bug", async () => {
    const clash = command("clash", vi.fn(), { options: { json: { type: "boolean" } } });
    const result = await runCli(["--help"], environment("/", [clash]));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("internal error");
  });
});

describe("line output, limits and cursors", () => {
  test("prints one line per item, with sizes and approximate tokens, and the cursor when more remain", async () => {
    const result = await runCli(["list", "-n", "2"], environment(store(), [list]));
    expect(result).toEqual({
      stdout: ".vmd/config.yaml  7 B  ~2 tok\na.md              4 B  ~1 tok\n… more (--cursor a.md)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("continues from the cursor, and prints no cursor after the last page", async () => {
    const result = await runCli(["list", "-n", "2", "--cursor", "a.md"], environment(store(), [list]));
    expect(result.stdout).toBe("b.json             2 B     ~1 tok\ntickets/0171-x.md  4800 B  ~1.2k tok\n");
  });

  test("applies the command's default limit without -n", async () => {
    const result = await runCli(["list"], environment(store(), [list]));
    expect(result.stdout.split("\n").filter((line) => line !== "")).toHaveLength(4);
    expect(result.stdout).toContain("… more (--cursor b.json)\n");
  });

  test("fails with exit code 1 and the issue for a cursor that is not one", async () => {
    const result = await runCli(["list", "--cursor", "../x"], environment(store(), [list]));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^error query-invalid: "\.\.\/x" is not a list cursor/);
  });
});

describe("--json", () => {
  test("prints the library's outcome unchanged, issues included, and keeps the exit code", async () => {
    const outcome = succeed({ items: ["a"] }, [issue("ref-dangling", "/a")]);
    const result = await runCli(["--json", "give"], environment(store(), [giving(outcome)]));
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(JSON.stringify(outcome)));
    expect(result.stdout.endsWith("}\n")).toBe(true);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(4);
  });

  test("prints a failure as its outcome", async () => {
    const outcome = fail([issue("address-not-found")]);
    const result = await runCli(["give", "--json"], environment(store(), [giving(outcome)]));
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, issues: [JSON.parse(JSON.stringify(outcome.issues[0]))] });
    expect(result.exitCode).toBe(1);
  });
});

describe("issues and exit codes", () => {
  test("prints the value on stdout and the issues on stderr in the issue format, with 0 for warnings", async () => {
    const result = await runCli(["give"], environment(store(), [giving(succeed(1, [issue("heading-html", "/$sections/0")]))]));
    expect(result).toEqual({
      stdout: "1\n",
      stderr: "a.md warning heading-html: the heading-html of the tests\n  in   #/$sections/0\n",
      exitCode: 0,
    });
  });

  test("gives exit code 4 for a success with an error, and still prints the value", async () => {
    const result = await runCli(["give"], environment(store(), [giving(succeed(1, [issue("ref-dangling", "/links")]))]));
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("1\n");
    expect(result.stderr).toContain("a.md error ref-dangling:");
  });

  test("gives exit code 1 for a failure, with nothing on stdout", async () => {
    const result = await runCli(["give"], environment(store(), [giving(fail([issue("address-not-found")]))]));
    expect(result).toEqual({
      stdout: "",
      stderr: "a.md error address-not-found: the address-not-found of the tests\n",
      exitCode: 1,
    });
  });

  test("gives exit code 3 for a conflict", async () => {
    expect((await runCli(["give"], environment(store(), [giving(fail([issue("conflict", "")]))]))).exitCode).toBe(3);
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
    const result = await runCli(["detailed"], environment(store(), [detailed]));
    expect(result.stderr).toContain("  in   #done/$body  (exact #/$sections/1/$body)\n");
  });

  test("leaves out warnings with --quiet, and keeps errors", async () => {
    const outcome = succeed(1, [issue("heading-html", "/h"), issue("ref-dangling", "/r")]);
    const result = await runCli(["give", "--quiet"], environment(store(), [giving(outcome)]));
    expect(result.stderr).not.toContain("heading-html");
    expect(result.stderr).toContain("ref-dangling");
    expect(result.exitCode).toBe(4);
  });

  test("catches a command's exception as a bug, with exit code 1", async () => {
    const broken = command("broken", async () => {
      throw new TypeError("oops");
    });
    const result = await runCli(["broken"], environment(store(), [broken]));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^vmd: internal error, which is a bug: TypeError: oops/);
  });
});

describe("the store", () => {
  test("is found from a directory inside it", async () => {
    const root = store();
    const result = await runCli(["list", "-n", "1"], environment(makeDirectories(root, "tickets"), [list]));
    expect(result.stdout).toContain(".vmd/config.yaml");
  });

  test("is not looked for by a command that reads none", async () => {
    const result = await runCli(["give"], environment(temporaryDirectory(), [giving(succeed(1), { readsStore: false })]));
    expect(result).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
  });

  test("missing, fails with exit code 1, a message and a hint, before the command runs", async () => {
    const run = vi.fn();
    const cwd = temporaryDirectory();
    const result = await runCli(["give"], environment(cwd, [command("give", run)]));
    expect(result).toEqual({
      stdout: "",
      stderr: `error: no vmd store here: neither ${cwd} nor a directory above it holds .vmd/config.yaml\n  hint run vmd inside a store, or name its root with --store\n`,
      exitCode: 1,
    });
    expect(run).not.toHaveBeenCalled();
  });

  test("with an invalid configuration, fails with exit code 1 and the issue at its position", async () => {
    const root = store({ ".vmd/config.yaml": "vmd: one\n" });
    const result = await runCli(["give"], environment(root, [giving(succeed(1))]));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      '.vmd/config.yaml:1:1 error config-invalid: "vmd", the store\'s format version, must be a whole number from 1, not "one"\n',
    );
  });

  test("with an invalid configuration, prints its outcome with --json", async () => {
    const root = store({ ".vmd/config.yaml": "collections: {}\n" });
    const result = await runCli(["give", "--json"], environment(root, [giving(succeed(1))]));
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      issues: [{ code: "config-invalid", path: ".vmd/config.yaml" }],
    });
    expect(result.exitCode).toBe(1);
  });

  test("of a newer major format version, is refused with exit code 1", async () => {
    const root = store({ ".vmd/config.yaml": "vmd: 2\n" });
    const result = await runCli(["give"], environment(root, [giving(succeed(1))]));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^\.vmd\/config\.yaml:1:1 error format-version-unsupported: /);
  });

  test("is read with a configuration kept outside it, through --store and --config, the store left unmodified", async () => {
    const home = writeFiles(temporaryDirectory(), {
      "vampiredb/docs/design/Minimal_Log.md": "# Minimal log\n",
      "vollmond/examples/vampiredb/config.yaml": "vmd: 1\n",
    });
    const args = ["list", "--store", "../vampiredb/docs", "--config", "examples/vampiredb/config.yaml"];
    const result = await runCli(args, environment(join(home, "vollmond"), [list]));
    expect(result).toEqual({ stdout: "design/Minimal_Log.md  14 B  ~4 tok\n", stderr: "", exitCode: 0 });
  });

  test("with --config naming the store's own configuration's replacement, reads that one", async () => {
    const root = store({ ".vmd/config.yaml": "vmd: 2\n", "other.yaml": "vmd: 1\n" });
    expect((await runCli(["give", "--config", "other.yaml"], environment(root, [giving(succeed(1))]))).exitCode).toBe(0);
  });

  test("with --config naming no file, fails with exit code 1", async () => {
    const result = await runCli(["give", "--config", "missing.yaml"], environment(store(), [giving(succeed(1))]));
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
    const result = await runCli(["list"], { ...environment(store(), [list]), unicodeProbe: probe });
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
    const result = await runCli(["give"], environment(store(), [giving(outcome)], OLDER));
    expect(result.stderr.split(warning)).toHaveLength(2);
    expect(result.stderr.indexOf(warning)).toBe(0);
  });

  test("does not warn on a runtime that agrees", async () => {
    expect((await runCli(["list"], environment(store(), [list], AGREES))).stderr).toBe("");
  });

  test("does not warn with --quiet", async () => {
    expect((await runCli(["list", "--quiet"], environment(store(), [list], OLDER))).stderr).toBe("");
  });

  test("does not run for a command without a store, for --version, or for a usage error", async () => {
    const probe = vi.fn(() => OLDER);
    for (const args of [["give"], ["--version"], ["list", "--nope"]]) {
      const commands = [giving(succeed(1), { readsStore: false }), list];
      const result = await runCli(args, { ...environment(store(), commands), unicodeProbe: probe });
      expect(result.stderr).not.toContain("warning");
    }
    expect(probe).not.toHaveBeenCalled();
  });

  test("is core's probe by default", async () => {
    const { unicodeRuntimeProbe } = await import("@vollmond/core");
    const result = await runCli(["list"], { cwd: store(), commands: [list] });
    expect(result.stderr.includes("warning: this runtime's Unicode")).toBe(!unicodeRuntimeProbe().agrees);
  });
});
