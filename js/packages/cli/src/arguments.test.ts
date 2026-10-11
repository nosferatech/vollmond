import { describe, expect, test } from "vitest";
import { type OptionSpec, readCommandLine, readCommandLineHead } from "./arguments.js";

describe("readCommandLineHead", () => {
  test("finds the command after global options", () => {
    expect(readCommandLineHead(["--json", "--store", "docs", "ls", "-n", "5"])).toEqual({
      kind: "command",
      name: "ls",
      index: 3,
    });
  });

  test("does not take the value of a global option for the command", () => {
    expect(readCommandLineHead(["--store", "ls", "outline", "x.md"])).toEqual({ kind: "command", name: "outline", index: 2 });
    expect(readCommandLineHead(["--config=get", "ls"])).toEqual({ kind: "command", name: "ls", index: 1 });
  });

  test("takes the argument after -- as the command", () => {
    expect(readCommandLineHead(["--json", "--", "ls"])).toEqual({ kind: "command", name: "ls", index: 2 });
  });

  test("refuses a command's own option before the command's name", () => {
    const head = readCommandLineHead(["-n", "5", "ls"]);
    expect(head.kind).toBe("usage");
    expect(head.kind === "usage" && head.message).toContain("-n");
  });

  test("refuses a global option that needs a value and has none", () => {
    expect(readCommandLineHead(["--store"])).toEqual({ kind: "usage", message: "--store needs a value" });
  });

  test("refuses a value given to a flag", () => {
    expect(readCommandLineHead(["--json=yes", "ls"]).kind).toBe("usage");
  });

  test("says whether --version or --help was given without a command", () => {
    expect(readCommandLineHead(["--version"])).toEqual({ kind: "none", version: true, help: false });
    expect(readCommandLineHead(["--help"])).toEqual({ kind: "none", version: false, help: true });
    expect(readCommandLineHead([])).toEqual({ kind: "none", version: false, help: false });
  });

  test.each(["-v", "-h"])("has no short form %s, which a command such as grep may want", (option) => {
    expect(readCommandLineHead([option]).kind).toBe("usage");
  });
});

describe("readCommandLine", () => {
  const options: Record<string, OptionSpec> = { limit: { type: "string", short: "n" }, value: { type: "boolean" } };

  test("reads global options before and after the command's name, and the command's own after it", () => {
    const args = ["--store", "docs", "get", "x.md#a", "--json", "-n", "5", "--quiet", "--value", "--config", "c.yaml"];
    const line = readCommandLine(args, 2, options);
    expect(line).toEqual({
      ok: true,
      value: {
        globals: { store: "docs", config: "c.yaml", json: true, quiet: true },
        version: false,
        help: false,
        options: { limit: "5", value: true },
        positionals: ["x.md#a"],
      },
    });
  });

  test("gives the defaults of the flags when no global option is given", () => {
    const line = readCommandLine(["get"], 0, options);
    expect(line.ok && line.value.globals).toEqual({ json: false, quiet: false });
  });

  test("keeps an argument after -- as an argument, even one that looks like an option", () => {
    const line = readCommandLine(["grep", "--", "--json"], 0, options);
    expect(line.ok && line.value.positionals).toEqual(["--json"]);
    expect(line.ok && line.value.globals.json).toBe(false);
  });

  test("refuses an option the command does not take", () => {
    const line = readCommandLine(["get", "--fields", "a"], 0, options);
    expect(line.ok).toBe(false);
    expect(line.ok ? "" : line.message).toContain("--fields");
  });

  test("refuses an option value that starts with a dash, which could be a forgotten value", () => {
    expect(readCommandLine(["get", "-n", "--json"], 0, options).ok).toBe(false);
  });

  test("leaves -v and -h to a command that takes them", () => {
    const grep = { invert: { type: "boolean", short: "v" }, heading: { type: "boolean", short: "h" } } as const;
    const line = readCommandLine(["grep", "-v", "-h", "x"], 0, grep);
    expect(line.ok && line.value).toMatchObject({ version: false, help: false, options: { invert: true, heading: true } });
  });

  test("says whether --version or --help was given after the command", () => {
    const line = readCommandLine(["get", "--help"], 0, options);
    expect(line.ok && line.value.help).toBe(true);
  });
});
