import { createRequire } from "node:module";
import { parseArgs } from "node:util";

/** Outcome of one `vmd` invocation: what to print and the process exit code. */
export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Reads the version of the `@vollmond/cli` package from its `package.json`. */
function readPackageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("../package.json") as { version: string };
  return manifest.version;
}

/**
 * Runs `vmd` with the given arguments (without the node and script paths) and returns the outcome
 * instead of printing it. An unknown option gives exit code 2 and a message on `stderr`.
 */
export function runCli(args: readonly string[]): CliResult {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: { version: { type: "boolean", short: "v" } },
      strict: true,
    });
    if (values.version) {
      return { stdout: `${readPackageVersion()}\n`, stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "vmd: no command given; try --version\n", exitCode: 2 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `vmd: ${message}\n`, exitCode: 2 };
  }
}
