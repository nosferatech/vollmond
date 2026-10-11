// The command line: the global options, the command's name, and the command's own options and arguments, read with
// `util.parseArgs`. Global options may stand before or after the command's name; the command's own options only after it.

import { parseArgs } from "node:util";

/** An option as `util.parseArgs` takes it: a flag, or an option with a value, given once or repeatable. */
export interface OptionSpec {
  readonly type: "boolean" | "string";
  readonly short?: string;
  readonly multiple?: boolean;
}

/** The value of an option after parsing: absent, a flag, a value, or the values of a repeatable option. */
export type OptionValue = boolean | string | readonly (boolean | string)[] | undefined;

/** The options every command takes, and `--version` and `--help`, which take the place of a command. */
export const GLOBAL_OPTIONS: Readonly<Record<string, OptionSpec>> = Object.freeze({
  store: Object.freeze({ type: "string" }),
  config: Object.freeze({ type: "string" }),
  json: Object.freeze({ type: "boolean" }),
  quiet: Object.freeze({ type: "boolean" }),
  version: Object.freeze({ type: "boolean", short: "v" }),
  help: Object.freeze({ type: "boolean", short: "h" }),
});

/** The global options as a command sees them. */
export interface GlobalOptions {
  /** The store root, as given (relative to the working directory or absolute), when `--store` names one. */
  readonly store?: string;
  /** The store's configuration file, as given, when `--config` names one in place of the store's `.vmd/config.yaml`. */
  readonly config?: string;
  /** Whether to print the library's result objects as JSON in place of lines. */
  readonly json: boolean;
  /** Whether to leave out warnings. */
  readonly quiet: boolean;
}

/** The command line read up to the command's name: the global options found before it, and where the name is. */
export type CommandLineHead =
  | { readonly kind: "command"; readonly name: string; readonly index: number }
  | { readonly kind: "none"; readonly version: boolean; readonly help: boolean }
  | { readonly kind: "usage"; readonly message: string };

/**
 * Finds the command's name: the first argument that is neither an option nor the value of a global option. An option before
 * the name must be a global one, since a command's own options are not known until its name is: `vmd -n 5 ls` is a usage
 * error. Without a name, says whether `--version` or `--help` was given.
 */
export function readCommandLineHead(args: readonly string[]): CommandLineHead {
  let parsed: ReturnType<
    typeof parseArgs<{ options: typeof GLOBAL_OPTIONS; strict: false; tokens: true; allowPositionals: true }>
  >;
  try {
    parsed = parseArgs({ args: [...args], options: GLOBAL_OPTIONS, strict: false, tokens: true, allowPositionals: true });
  } catch (error) {
    return { kind: "usage", message: errorMessage(error) };
  }
  for (const token of parsed.tokens) {
    if (token.kind === "positional") return { kind: "command", name: token.value, index: token.index };
    if (token.kind === "option-terminator") {
      const next = token.index + 1;
      return next < args.length ? { kind: "command", name: args[next] as string, index: next } : noCommand(parsed.values);
    }
    if (!Object.hasOwn(GLOBAL_OPTIONS, token.name)) {
      return { kind: "usage", message: `unknown option ${token.rawName}; a command's own options come after its name` };
    }
    const spec = GLOBAL_OPTIONS[token.name] as OptionSpec;
    if (spec.type === "string" && token.value === undefined) return { kind: "usage", message: `${token.rawName} needs a value` };
    if (spec.type === "boolean" && token.inlineValue === true) {
      return { kind: "usage", message: `${token.rawName} does not take a value` };
    }
  }
  return noCommand(parsed.values);
}

/** The head of a command line without a command. */
function noCommand(values: Record<string, unknown>): CommandLineHead {
  return { kind: "none", version: values.version === true, help: values.help === true };
}

/** A command's arguments and options, global and its own, read from the whole command line. */
export interface CommandLine {
  readonly globals: GlobalOptions;
  /** Whether `--version` was given, which prints the version in place of running the command. */
  readonly version: boolean;
  /** Whether `--help` was given, which prints the command's usage in place of running it. */
  readonly help: boolean;
  readonly options: Readonly<Record<string, OptionValue>>;
  readonly positionals: readonly string[];
}

/**
 * Reads the command line of the command whose name is at `index`, with the global options and the command's own `options`,
 * strictly: an unknown option, a missing value or a value given to a flag fails with a message for the user.
 *
 * Precondition: no name in `options` is the name of a global option, nor its short form.
 */
export function readCommandLine(
  args: readonly string[],
  index: number,
  options: Readonly<Record<string, OptionSpec>>,
): { readonly ok: true; readonly value: CommandLine } | { readonly ok: false; readonly message: string } {
  const rest = [...args.slice(0, index), ...args.slice(index + 1)];
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: rest, options: { ...GLOBAL_OPTIONS, ...options }, strict: true, allowPositionals: true });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
  const { store, config, json, quiet, version, help, ...own } = parsed.values;
  const globals: { -readonly [K in keyof GlobalOptions]: GlobalOptions[K] } = { json: json === true, quiet: quiet === true };
  if (typeof store === "string") globals.store = store;
  if (typeof config === "string") globals.config = config;
  return {
    ok: true,
    value: { globals, version: version === true, help: help === true, options: own, positionals: parsed.positionals },
  };
}

/** The message of a thrown value, for the user. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
