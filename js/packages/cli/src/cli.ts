import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { type Outcome, readStoreConfiguration, type UnicodeRuntimeProbe, unicodeRuntimeProbe } from "@vollmond/core";
import { GLOBAL_OPTIONS, type GlobalOptions, type OptionSpec, readCommandLine, readCommandLineHead } from "./arguments.js";
import { createFilesystemStorage } from "./backend/filesystem.js";
import type { Command, CommandOutput, OpenedStore } from "./command/command.js";
import { BUILT_IN_COMMANDS } from "./command/index.js";
import { ExitCode, exitCodeOf } from "./exit-code.js";
import { formatIssues, type IssueDetailsSource } from "./output/issues.js";
import { oneLine } from "./output/lines.js";
import { discoverStore } from "./store-discovery.js";

/** Outcome of one `vmd` invocation: what to print and the process exit code. */
export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** What `vmd` takes from its process, which tests replace. */
export interface CliEnvironment {
  /** The working directory, an absolute path, from which the store is found and relative paths are read. */
  readonly cwd: string;
  /** The commands offered. */
  readonly commands: readonly Command[];
  /** Checks the runtime's Unicode data against the tables of derived anchors. */
  readonly unicodeProbe: () => UnicodeRuntimeProbe;
  /** The runtime's Unicode version, for the probe's warning, when the runtime says it. */
  readonly runtimeUnicodeVersion: string | undefined;
}

/** Reads the version of the `@vollmond/cli` package from its `package.json`. */
function readPackageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("../package.json") as { version: string };
  return manifest.version;
}

/** The environment of this process. */
function processEnvironment(): CliEnvironment {
  return {
    cwd: process.cwd(),
    commands: BUILT_IN_COMMANDS,
    unicodeProbe: unicodeRuntimeProbe,
    runtimeUnicodeVersion: process.versions.unicode,
  };
}

/**
 * Runs `vmd` with the given arguments (without the node and script paths) and returns what to print and the exit code, instead
 * of printing them. `environment` replaces parts of this process's environment.
 *
 * Exit codes: 0 for success, with warnings at most; 1 for a failure, a store not found, or a bug, which is caught here; 2 for a
 * command line `vmd` does not accept; 3 for a conflict; 4 for a success that found an issue of severity `error`. A command that
 * reads a store first finds it, reads its configuration, and checks the runtime's Unicode data, warning once when it is older
 * than the tables of derived anchors.
 *
 * With `--json`, a command's outcome is printed on stdout as JSON, issues included; otherwise its value is printed as text on
 * stdout and its issues on stderr. `--quiet` leaves out warnings, the probe's included.
 */
export async function runCli(args: readonly string[], environment: Partial<CliEnvironment> = {}): Promise<CliResult> {
  const env = { ...processEnvironment(), ...environment };
  try {
    return await run(args, env);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return { stdout: "", stderr: `vmd: internal error, which is a bug: ${detail}\n`, exitCode: ExitCode.error };
  }
}

/** Runs `vmd`, letting a bug's exception through. */
async function run(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  checkCommands(env.commands);
  const head = readCommandLineHead(args);
  if (head.kind === "usage") return usage(head.message);
  if (head.kind === "none") {
    if (head.version) return { stdout: `${readPackageVersion()}\n`, stderr: "", exitCode: ExitCode.ok };
    if (head.help) return { stdout: generalHelp(env.commands), stderr: "", exitCode: ExitCode.ok };
    return usage("no command given; try --help");
  }
  const command = env.commands.find((candidate) => candidate.name === head.name);
  if (command === undefined) return usage(`unknown command ${JSON.stringify(head.name)}; try --help`);
  const line = readCommandLine(args, head.index, command.options);
  if (!line.ok) return usage(line.message);
  if (line.value.version) return { stdout: `${readPackageVersion()}\n`, stderr: "", exitCode: ExitCode.ok };
  if (line.value.help) return { stdout: commandHelp(command), stderr: "", exitCode: ExitCode.ok };
  const { globals } = line.value;

  let stderr = "";
  let store: OpenedStore | null = null;
  if (command.readsStore) {
    const opened = await openCommandStore(globals, env.cwd);
    if (opened.kind === "result") return opened.result;
    store = opened.store;
    stderr += opened.stderr;
    const probe = env.unicodeProbe();
    if (!probe.agrees && !globals.quiet) stderr += unicodeWarning(probe, env.runtimeUnicodeVersion);
  }
  const output = await command.run({ positionals: line.value.positionals, options: line.value.options, globals, store });
  const result = render(output, globals);
  return { ...result, stderr: stderr + result.stderr };
}

/** Throws an `Error` when a command's option has the name, or the short form, of a global option, or two commands one name. */
function checkCommands(commands: readonly Command[]): void {
  const globalShorts = new Set(Object.values(GLOBAL_OPTIONS).map((spec) => spec.short));
  const names = new Set<string>();
  for (const command of commands) {
    if (names.has(command.name)) throw new Error(`two commands are named ${command.name}`);
    names.add(command.name);
    for (const [name, spec] of Object.entries(command.options) as [string, OptionSpec][]) {
      if (Object.hasOwn(GLOBAL_OPTIONS, name) || (spec.short !== undefined && globalShorts.has(spec.short))) {
        throw new Error(`the option ${name} of ${command.name} clashes with a global option`);
      }
    }
  }
}

/** The result of a command line `vmd` does not accept. */
function usage(message: string): CliResult {
  return { stdout: "", stderr: `vmd: ${oneLine(message)}\n`, exitCode: ExitCode.usage };
}

/** Finds the store, reads its configuration, and opens its files; or gives the result that ends the run. */
async function openCommandStore(
  globals: GlobalOptions,
  cwd: string,
): Promise<
  | { readonly kind: "store"; readonly store: OpenedStore; readonly stderr: string }
  | { readonly kind: "result"; readonly result: CliResult }
> {
  const discovered = await discoverStore({
    cwd,
    ...(globals.store === undefined ? {} : { store: globals.store }),
    ...(globals.config === undefined ? {} : { config: globals.config }),
  });
  if (!discovered.ok) return { kind: "result", result: failure(discovered.error.message, discovered.error.hint) };
  const location = discovered.value;
  let content: Uint8Array;
  try {
    content = await readFile(location.configurationFile);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const reason = code === "ENOENT" ? "it does not exist" : code === "EISDIR" ? "it is a directory" : String(code ?? error);
    return {
      kind: "result",
      result: failure(
        `cannot read the configuration ${location.configurationName}: ${reason}`,
        globals.config === undefined ? "check its permissions" : "check the path given to --config",
      ),
    };
  }
  const configuration = readStoreConfiguration(location.configurationName, content);
  if (!configuration.ok) return { kind: "result", result: render(issuesOnly(configuration), globals) };
  return {
    kind: "store",
    store: {
      location,
      configuration: configuration.value,
      configurationContent: content,
      storage: createFilesystemStorage(location.root),
    },
    stderr: formatIssues(configuration.issues, { errorsOnly: globals.quiet }),
  };
}

/** The output of an outcome whose value, if any, is not printed. */
function issuesOnly(outcome: Outcome<unknown>): CommandOutput {
  return { kind: "outcome", outcome, text: () => "" };
}

/** The result of a failure that has no issue code: a message and a hint, on stderr, in the issue format's layout. */
function failure(message: string, hint: string): CliResult {
  return { stdout: "", stderr: `error: ${oneLine(message)}\n  hint ${oneLine(hint)}\n`, exitCode: ExitCode.error };
}

/** Writes a command's output for the terminal or as JSON, with its exit code. */
function render(output: CommandOutput, globals: GlobalOptions): CliResult {
  if (output.kind === "usage") return usage(output.message);
  const { outcome } = output;
  const exitCode = exitCodeOf(outcome);
  if (globals.json) return { stdout: `${JSON.stringify(outcome)}\n`, stderr: "", exitCode };
  const details: IssueDetailsSource | undefined = output.details;
  const stderr = formatIssues(outcome.issues, { errorsOnly: globals.quiet, ...(details === undefined ? {} : { details }) });
  return { stdout: outcome.ok ? output.text(outcome.value) : "", stderr, exitCode };
}

/** The warning for a runtime whose Unicode data is older than the tables'. */
function unicodeWarning(probe: UnicodeRuntimeProbe, runtimeVersion: string | undefined): string {
  const runtime = runtimeVersion === undefined ? "this runtime's Unicode data" : `this runtime's Unicode ${runtimeVersion}`;
  return (
    `warning: ${runtime} is older than Unicode ${probe.version}, which derived anchors follow (${probe.failures.join("; ")})\n` +
    "  hint a heading with a character added since may get another anchor here than elsewhere; a newer Node avoids this\n"
  );
}

/** The help of `vmd` as a whole. */
function generalHelp(commands: readonly Command[]): string {
  const list =
    commands.length === 0
      ? "  (none yet)\n"
      : commands.map((command) => `  ${command.name.padEnd(10)}${command.summary}\n`).join("");
  return (
    "usage: vmd [--store DIR] [--config FILE] [--json] [--quiet] COMMAND [ARGS]\n" +
    "       vmd --version | --help\n\n" +
    `commands:\n${list}\n` +
    "  --store DIR    the store root; by default the nearest directory upwards that holds .vmd/config.yaml\n" +
    "  --config FILE  a configuration used in place of the store's .vmd/config.yaml\n" +
    "  --json         print the library's result objects as JSON\n" +
    "  --quiet        leave out warnings\n"
  );
}

/** The help of one command. */
function commandHelp(command: Command): string {
  return `usage: vmd ${command.name} ${command.usage}\n${command.summary}\n`;
}
