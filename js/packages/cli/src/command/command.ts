// What a command is to the CLI: its name, options and whether it reads a store, and a function from its invocation to its
// output. The CLI does the rest the same way for every command: the command line, the store, `--json`, the issues and the
// exit code.

import type { Outcome, StorageReader, Store, StoreConfiguration } from "@vollmond/core";
import type { GlobalOptions, OptionSpec, OptionValue } from "../arguments.js";
import type { IssueDetailsSource } from "../output/issues.js";
import type { StoreLocation } from "../store-discovery.js";

/** The store a command reads, found and opened before the command runs. */
export interface OpenedStore {
  readonly location: StoreLocation;
  /** What vmd reads of the configuration. */
  readonly configuration: StoreConfiguration;
  /** The store's files, over the filesystem below its root. */
  readonly storage: StorageReader;
  /** The store's records and assets over `storage`, each record read and parsed once for the run. */
  readonly store: Store;
}

/** A command's command line, read: its arguments and options, and the global options. */
export interface CommandArguments {
  /** The arguments after the command's name that are not options, in order. */
  readonly positionals: readonly string[];
  /** The command's own options, by the names its {@link Command.options} gives them; absent when not given. */
  readonly options: Readonly<Record<string, OptionValue>>;
  readonly globals: GlobalOptions;
  /** Whether stdout is a terminal, for text output that is escaped there and written raw to a pipe or a file. */
  readonly stdoutIsTerminal: boolean;
}

/** One run of a command: its command line and its store. */
export interface CommandInvocation extends CommandArguments {
  /** The store, for a command that reads one; null for the others. */
  readonly store: OpenedStore | null;
}

/**
 * What a command makes of its command line before any store is opened: a usage error, or the run it will do once the store,
 * for a command that reads one, is open.
 */
export type CommandPlan =
  | { readonly kind: "usage"; readonly message: string }
  | { readonly kind: "run"; readonly run: (store: OpenedStore | null) => Promise<CommandOutput> };

/** Plans the run of `run` with the command line as it was read, for a command that checks nothing before its store opens. */
export function runWith(line: CommandArguments, run: (invocation: CommandInvocation) => Promise<CommandOutput>): CommandPlan {
  return { kind: "run", run: (store) => run({ ...line, store }) };
}

/** Plans a usage error: the command line is not one the command accepts. */
export function usagePlan(message: string): CommandPlan {
  return { kind: "usage", message };
}

/** What a command gives back: the outcome of its operation, or a usage error found in its arguments. */
export type CommandOutput =
  | {
      readonly kind: "outcome";
      /**
       * The library's outcome, which `--json` prints as `{"ok", "value", "issues"}`, with the store's issues (the
       * configuration's, the Unicode warning) before its own, and a `Uint8Array` anywhere in it written as
       * `{ "base64": "…" }`, its bytes in base64 (RFC 4648, with padding).
       */
      readonly outcome: Outcome<unknown>;
      /**
       * Writes a successful outcome's value for stdout: text, one line per item, each line ending with a line break; or bytes,
       * written as they are, for content such as a file's.
       */
      readonly text: (value: unknown) => string | Uint8Array;
      /** Gives what the command knows of each issue beyond the issue itself, such as the semantic path of its node. */
      readonly details?: IssueDetailsSource;
    }
  /** A command line the command cannot read: printed as `usage-invalid`, with exit code 2. */
  | { readonly kind: "usage"; readonly message: string };

/**
 * Gives the output of a command whose operation gave `outcome`: its value is written with `text` on success, and its issues,
 * success or failure, are printed with their `details`.
 */
export function outcomeOutput<T>(
  outcome: Outcome<T>,
  text: (value: T) => string | Uint8Array,
  details?: IssueDetailsSource,
): CommandOutput {
  return {
    kind: "outcome",
    outcome,
    text: text as (value: unknown) => string | Uint8Array,
    ...(details === undefined ? {} : { details }),
  };
}

/** Gives the output of a command whose arguments are not ones it accepts, with a message for the user. */
export function usageOutput(message: string): CommandOutput {
  return { kind: "usage", message };
}

/** What a command's issues are: see {@link Command.issueOutput}. */
export type IssueOutput = "diagnostics" | "listing" | "result";

/** A `vmd` command. */
export interface Command {
  /** The name that selects it: `ls`. */
  readonly name: string;
  /** Its arguments and options as its usage line writes them, after its name: `[GLOB] [-n N] [--cursor C]`. */
  readonly usage: string;
  /** One line that says what it does. */
  readonly summary: string;
  /** What its help says beyond its usage and summary: its options, each line ending with a line break. */
  readonly help?: string;
  /**
   * Its own options, by name. No name, and no short form, may be that of a global option; the CLI checks this before it reads
   * any command line, and throws an `Error` when one is.
   */
  readonly options: Readonly<Record<string, OptionSpec>>;
  /** Whether it reads a store, which the CLI then finds, and whose configuration it reads, before it runs the command. */
  readonly readsStore: boolean;
  /**
   * What the issues of its outcome are, which decides where they are printed without `--json`; the configuration's issues and
   * the warning about the runtime's Unicode data go to stderr whatever this says.
   *
   * - `diagnostics` (the default): about the result, on stderr; `--quiet` leaves out the warnings.
   * - `listing`: part of what the command lists, as `refs` lists references with their status, on stdout after the value;
   *   `--quiet` leaves out the warnings.
   * - `result`: the result itself, as `check`'s are, on stdout after the value; `--quiet` keeps the warnings, here and in the
   *   JSON object.
   */
  readonly issueOutput?: IssueOutput;
  /**
   * Reads the command's arguments and options, before the CLI looks for the store, so that a command line the command cannot
   * read is `usage-invalid` wherever it runs; and plans the run. The run's expected failures are in its output's outcome; a
   * thrown exception, here or in the run, is a bug, which the CLI reports with exit code 1.
   */
  prepare(line: CommandArguments): CommandPlan;
}
