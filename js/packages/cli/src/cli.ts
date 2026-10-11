import { createRequire } from "node:module";
import {
  fail,
  type Issue,
  type IssueCode,
  makeIssue,
  type Outcome,
  openStore,
  type UnicodeRuntimeProbe,
  unicodeRuntimeProbe,
} from "@vollmond/core";
import { GLOBAL_OPTIONS, type GlobalOptions, type OptionSpec, readCommandLine, readCommandLineHead } from "./arguments.js";
import { createFilesystemStorage } from "./backend/filesystem.js";
import type { Command, IssueOutput, OpenedStore } from "./command/command.js";
import { BUILT_IN_COMMANDS } from "./command/index.js";
import { configurationFileSource, readConfigurationFile } from "./configuration-file.js";
import { ExitCode, exitCodeOf } from "./exit-code.js";
import { formatIssues, type IssueDetailsSource } from "./output/issues.js";
import { oneLine } from "./output/lines.js";
import { discoverStore } from "./store-discovery.js";

/** Outcome of one `vmd` invocation: what to print and the process exit code. */
export interface CliResult {
  /** Text, or bytes written as they are, such as a file's content, which may not be UTF-8. */
  readonly stdout: string | Uint8Array;
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
  /** Whether stdout is a terminal, which a command's text output may escape for; false when not said. */
  readonly stdoutIsTerminal: boolean;
}

/** Reads the version of the `@vollmond/cli` package from its `package.json`. */
function readPackageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("../package.json") as { version: string };
  return manifest.version;
}

/**
 * The environment of this process, with the parts `environment` gives replaced. The working directory is read only when a
 * command needs it, and throws there when it was deleted.
 */
function processEnvironment(environment: Partial<CliEnvironment>): CliEnvironment {
  return {
    get cwd() {
      return environment.cwd ?? process.cwd();
    },
    commands: environment.commands ?? BUILT_IN_COMMANDS,
    unicodeProbe: environment.unicodeProbe ?? unicodeRuntimeProbe,
    runtimeUnicodeVersion: "runtimeUnicodeVersion" in environment ? environment.runtimeUnicodeVersion : process.versions.unicode,
    stdoutIsTerminal: environment.stdoutIsTerminal ?? false,
  };
}

/**
 * Runs `vmd` with the given arguments (without the node and script paths) and returns what to print and the exit code, instead
 * of printing them. `environment` replaces parts of this process's environment.
 *
 * Every failure but a bug is an outcome with issues: a command line `vmd` cannot read is `usage-invalid`, a store it cannot find
 * `store-not-found`, a configuration it cannot read `config-invalid`. A command that reads a store first finds it, reads its
 * configuration, and checks the runtime's Unicode data, warning once (`unicode-runtime-older`) when it is older than the tables
 * of derived anchors.
 *
 * Exit codes: 0 for success, with warnings at most; 1 for a failure or a bug, which is caught here; 2 for `usage-invalid`; 3 for
 * a conflict; 4 for a success that found an issue of severity `error`.
 *
 * With `--json`, every outcome is one JSON object on stdout, `{"ok": true, "value": …, "issues": [...]}` or `{"ok": false,
 * "issues": [...]}`, whose issues start with the configuration's and the Unicode warning; a bug alone is reported on stderr.
 * Otherwise the value is printed as text on stdout and the issues on stderr, except that a command whose issues are its result
 * or part of its listing prints its own issues on stdout. `--quiet` leaves out warnings, except a command's whose issues are its
 * result.
 */
export async function runCli(args: readonly string[], environment: Partial<CliEnvironment> = {}): Promise<CliResult> {
  try {
    return await run(args, processEnvironment(environment));
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const lines = detail.split("\n").map(oneLine).join("\n");
    return { stdout: "", stderr: `vmd: internal error, which is a bug: ${lines}\n`, exitCode: ExitCode.error };
  }
}

/** What a run printed when it ended: the outcome, how to write its value, and the issues that are not the command's. */
interface Report {
  /** The outcome: the command's, or a failure of the CLI's own before the command ran. */
  readonly outcome: Outcome<unknown>;
  /** Writes a successful outcome's value; nothing is written for a failure. */
  readonly text: (value: unknown) => string | Uint8Array;
  /** The details of the outcome's issues. */
  readonly details?: IssueDetailsSource;
  /** What the outcome's issues are, which decides where they are printed. */
  readonly issueOutput: IssueOutput;
  /** Issues of the store rather than the command: the configuration's and the Unicode warning, printed on stderr. */
  readonly storeIssues: readonly Issue[];
  /** The details of the store's issues. */
  readonly storeDetails?: IssueDetailsSource;
}

/** Runs `vmd`, letting a bug's exception through. */
async function run(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  checkCommands(env.commands);
  // Until the command line is read, `--json` is looked for among the arguments, so that a usage error is printed as asked.
  const asked: GlobalOptions = { json: jsonAsked(args), quiet: false };
  const head = readCommandLineHead(args);
  if (head.kind === "usage") return render(usage(head.message, "try vmd --help"), asked);
  if (head.kind === "none") {
    if (head.version) return { stdout: `${readPackageVersion()}\n`, stderr: "", exitCode: ExitCode.ok };
    if (head.help) return { stdout: generalHelp(env.commands), stderr: "", exitCode: ExitCode.ok };
    return render(usage("no command given", "try vmd --help"), asked);
  }
  const command = env.commands.find((candidate) => candidate.name === head.name);
  if (command === undefined) return render(usage(`unknown command ${JSON.stringify(head.name)}`, "try vmd --help"), asked);
  const commandHint = `try vmd ${command.name} --help`;
  const line = readCommandLine(args, head.index, command.options);
  if (!line.ok) return render(usage(line.message, commandHint), asked);
  if (line.value.version) return { stdout: `${readPackageVersion()}\n`, stderr: "", exitCode: ExitCode.ok };
  if (line.value.help) return { stdout: commandHelp(command), stderr: "", exitCode: ExitCode.ok };
  const { globals } = line.value;
  const plan = command.prepare({
    positionals: line.value.positionals,
    options: line.value.options,
    globals,
    stdoutIsTerminal: env.stdoutIsTerminal,
  });
  if (plan.kind === "usage") return render(usage(plan.message, commandHint), globals);

  let store: OpenedStore | null = null;
  const storeIssues: Issue[] = [];
  let storeDetails: IssueDetailsSource | undefined;
  if (command.readsStore) {
    const opened = await openCommandStore(globals, env);
    if (opened.kind === "failed") return render(opened.report, globals);
    store = opened.store;
    storeIssues.push(...opened.issues);
    const configurationIssues = new Set(opened.issues);
    storeDetails = (issue) => (configurationIssues.has(issue) ? opened.details(issue) : undefined);
    const probe = env.unicodeProbe();
    if (!probe.agrees) storeIssues.push(unicodeWarning(probe, env.runtimeUnicodeVersion));
  }
  const output = await plan.run(store);
  const report: Report =
    output.kind === "usage"
      ? { ...usage(output.message, commandHint), storeIssues }
      : {
          outcome: output.outcome,
          text: output.text,
          issueOutput: command.issueOutput ?? "diagnostics",
          storeIssues,
          ...(output.details === undefined ? {} : { details: output.details }),
        };
  return render({ ...report, ...(storeDetails === undefined ? {} : { storeDetails }) }, globals);
}

/**
 * Whether JSON was asked for, for a command line that cannot be read and so has no options to look at: whether an argument
 * before a `--` is `--json`, or `--json=` followed by anything, which is itself a usage error. An argument is not known to be an
 * option's value until the command line is read, so `--store --json`, which names the store `--json`, also selects JSON here.
 */
function jsonAsked(args: readonly string[]): boolean {
  const end = args.indexOf("--");
  return (end === -1 ? args : args.slice(0, end)).some((arg) => arg === "--json" || arg.startsWith("--json="));
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

/** The report of a failure of the CLI's own, before or instead of the command's operation. */
function failure(code: IssueCode, message: string, hint?: string, details?: IssueDetailsSource): Report {
  const issue = makeIssue({ code, path: null, at: null, message, ...(hint === undefined ? {} : { hint }) });
  return {
    outcome: fail([issue]),
    text: () => "",
    issueOutput: "diagnostics",
    storeIssues: [],
    ...(details === undefined ? {} : { details }),
  };
}

/** The report of a command line `vmd` cannot read. */
function usage(message: string, hint: string): Report {
  return failure("usage-invalid", message, hint);
}

/** Finds the store, reads its configuration, and opens its files; or gives the report of the failure that ends the run. */
async function openCommandStore(
  globals: GlobalOptions,
  env: CliEnvironment,
): Promise<
  | {
      readonly kind: "store";
      readonly store: OpenedStore;
      readonly issues: readonly Issue[];
      readonly details: IssueDetailsSource;
    }
  | { readonly kind: "failed"; readonly report: Report }
> {
  let cwd: string;
  try {
    cwd = env.cwd;
  } catch (error) {
    const reason = (error as { code?: unknown }).code ?? String(error);
    const report = failure(
      "store-not-found",
      `cannot read the working directory: ${reason}`,
      "change to a directory that exists",
    );
    return { kind: "failed", report };
  }
  const discovered = await discoverStore({
    cwd,
    ...(globals.store === undefined ? {} : { store: globals.store }),
    ...(globals.config === undefined ? {} : { config: globals.config }),
  });
  if (!discovered.ok) {
    const { code, message, hint } = discovered.error;
    return { kind: "failed", report: failure(code, message, hint) };
  }
  const location = discovered.value;
  const name = location.configurationName;
  const details = () => ({ file: name });
  const reading = await readConfigurationFile(location.configurationFile);
  if (reading.kind === "unreadable") {
    const hint = globals.config === undefined ? "check its permissions" : "check the path given to --config";
    return {
      kind: "failed",
      report: failure("config-invalid", `cannot read the configuration ${name}: ${reading.reason}`, hint),
    };
  }
  if (reading.kind === "invalid") {
    return { kind: "failed", report: failure("config-invalid", `the configuration ${reading.reason}`, undefined, details) };
  }
  const storage = createFilesystemStorage(location.root);
  const opened = await openStore(storage, {
    configuration: configurationFileSource(location.configurationFile, name, reading.content),
  });
  if (!opened.ok) {
    return {
      kind: "failed",
      report: { outcome: opened, text: () => "", details, issueOutput: "diagnostics", storeIssues: [] },
    };
  }
  return {
    kind: "store",
    store: {
      location,
      configuration: opened.value.configuration,
      configurationContent: reading.content,
      storage,
      store: opened.value,
    },
    issues: opened.issues,
    details,
  };
}

/**
 * Writes a report for the terminal or as JSON, with its exit code. The exit code counts every issue, those `--quiet` leaves
 * out included.
 */
function render(report: Report, globals: GlobalOptions): CliResult {
  const { outcome } = report;
  const exitCode = exitCodeOf(outcome, report.storeIssues);
  const quiet = globals.quiet;
  const ownWarningsDropped = quiet && report.issueOutput !== "result";
  if (globals.json) {
    const issues = [
      ...(quiet ? report.storeIssues.filter(isError) : report.storeIssues),
      ...(ownWarningsDropped ? outcome.issues.filter(isError) : outcome.issues),
    ];
    const printed = outcome.ok ? { ok: true, value: outcome.value, issues } : { ok: false, issues };
    return { stdout: `${JSON.stringify(printed, jsonReplacer)}\n`, stderr: "", exitCode };
  }
  const value = outcome.ok ? report.text(outcome.value) : "";
  if (report.issueOutput === "diagnostics") {
    // One list on stderr, so that the cap and the line that counts every issue found, dropped warnings included, apply once.
    const storeIssues = new Set(report.storeIssues);
    const details: IssueDetailsSource = (issue) =>
      storeIssues.has(issue) ? report.storeDetails?.(issue) : report.details?.(issue);
    const stderr = formatIssues([...report.storeIssues, ...outcome.issues], { errorsOnly: quiet, details });
    return { stdout: value, stderr, exitCode };
  }
  // The store's issues go to stderr and the command's to stdout, each stream with its own cap and count.
  const storeText = formatIssues(report.storeIssues, { errorsOnly: quiet, ...withDetails(report.storeDetails) });
  const ownText = formatIssues(outcome.issues, { errorsOnly: ownWarningsDropped, ...withDetails(report.details) });
  return { stdout: concatenate(value, ownText), stderr: storeText, exitCode };
}

/** Whether an issue is an error, which `--quiet` keeps. */
function isError(issue: Issue): boolean {
  return issue.severity === "error";
}

/** The options of `formatIssues` with `details`, when there are any. */
function withDetails(details: IssueDetailsSource | undefined): { readonly details?: IssueDetailsSource } {
  return details === undefined ? {} : { details };
}

/** Joins a value written as text or bytes with text after it. */
function concatenate(value: string | Uint8Array, text: string): string | Uint8Array {
  if (typeof value === "string") return value + text;
  return text === "" ? value : Buffer.concat([value, Buffer.from(text, "utf8")]);
}

/** Writes a `Uint8Array` as `{ "base64": "…" }`, which JSON would otherwise write as an object of numbered bytes. */
function jsonReplacer(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array
    ? { base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") }
    : value;
}

/** The warning for a runtime whose Unicode data is older than the tables'. */
function unicodeWarning(probe: UnicodeRuntimeProbe, runtimeVersion: string | undefined): Issue {
  const runtime = runtimeVersion === undefined ? "this runtime's Unicode data" : `this runtime's Unicode ${runtimeVersion}`;
  return makeIssue({
    code: "unicode-runtime-older",
    path: null,
    at: null,
    message: `${runtime} is older than Unicode ${probe.version}, which derived anchors follow (${probe.failures.join("; ")})`,
    hint: "a heading with a character added since may get another anchor here than elsewhere; a newer Node avoids this",
  });
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
    "  --config FILE  a configuration used in place of the store's .vmd/config.yaml, with its schemas in schema/ beside it\n" +
    "  --json         print every outcome, a failure included, as one JSON object\n" +
    "  --quiet        leave out warnings\n"
  );
}

/** The help of one command. */
function commandHelp(command: Command): string {
  return `usage: vmd ${command.name} ${command.usage}\n${command.summary}\n${command.help === undefined ? "" : `\n${command.help}`}`;
}
