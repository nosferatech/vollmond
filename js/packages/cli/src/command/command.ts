// What a command is to the CLI: its name, options and whether it reads a store, and a function from its invocation to its
// output. The CLI does the rest the same way for every command: the command line, the store, `--json`, the issues and the
// exit code.

import type { Outcome, StorageReader, StoreConfiguration } from "@vollmond/core";
import type { GlobalOptions, OptionSpec, OptionValue } from "../arguments.js";
import type { IssueDetailsSource } from "../output/issues.js";
import type { StoreLocation } from "../store-discovery.js";

/** The store a command reads, found and opened before the command runs. */
export interface OpenedStore {
  readonly location: StoreLocation;
  /** What vmd reads of the configuration. */
  readonly configuration: StoreConfiguration;
  /** The configuration file's bytes, as read. */
  readonly configurationContent: Uint8Array;
  /** The store's files, over the filesystem below its root. */
  readonly storage: StorageReader;
}

/** One run of a command: its arguments and options, the global options, and its store. */
export interface CommandInvocation {
  /** The arguments after the command's name that are not options, in order. */
  readonly positionals: readonly string[];
  /** The command's own options, by the names its {@link Command.options} gives them; absent when not given. */
  readonly options: Readonly<Record<string, OptionValue>>;
  readonly globals: GlobalOptions;
  /** The store, for a command that reads one; null for the others. */
  readonly store: OpenedStore | null;
}

/** What a command gives back: the outcome of its operation, or a usage error found in its arguments. */
export type CommandOutput =
  | {
      readonly kind: "outcome";
      /** The library's outcome, which `--json` prints unchanged. */
      readonly outcome: Outcome<unknown>;
      /** Writes a successful outcome's value as text, one line per item, each line ending with a line break. */
      readonly text: (value: unknown) => string;
      /** Gives what the command knows of each issue beyond the issue itself, such as the semantic path of its node. */
      readonly details?: IssueDetailsSource;
    }
  | { readonly kind: "usage"; readonly message: string };

/**
 * Gives the output of a command whose operation gave `outcome`: its value is written with `text` on success, and its issues,
 * success or failure, are printed with their `details`.
 */
export function outcomeOutput<T>(outcome: Outcome<T>, text: (value: T) => string, details?: IssueDetailsSource): CommandOutput {
  return {
    kind: "outcome",
    outcome,
    text: text as (value: unknown) => string,
    ...(details === undefined ? {} : { details }),
  };
}

/** Gives the output of a command whose arguments are not ones it accepts, with a message for the user. */
export function usageOutput(message: string): CommandOutput {
  return { kind: "usage", message };
}

/** A `vmd` command. */
export interface Command {
  /** The name that selects it: `ls`. */
  readonly name: string;
  /** Its arguments and options as its usage line writes them, after its name: `[GLOB] [-n N] [--cursor C]`. */
  readonly usage: string;
  /** One line that says what it does. */
  readonly summary: string;
  /**
   * Its own options, by name. No name, and no short form, may be that of a global option; the CLI checks this before it reads
   * any command line, and throws an `Error` when one is.
   */
  readonly options: Readonly<Record<string, OptionSpec>>;
  /** Whether it reads a store, which the CLI then finds, and whose configuration it reads, before it runs the command. */
  readonly readsStore: boolean;
  /**
   * Runs the command. Expected failures are in the output's outcome; a thrown exception is a bug, which the CLI reports with
   * exit code 1.
   */
  run(invocation: CommandInvocation): Promise<CommandOutput>;
}
