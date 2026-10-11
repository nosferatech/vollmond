import type { Writable } from "node:stream";
import { type CliEnvironment, runCli } from "./cli.js";

/** The parts of a process that `vmd` prints to and exits through. */
export interface ProcessIo {
  /** The arguments, without the node and script paths. */
  readonly args: readonly string[];
  readonly stdout: Writable;
  readonly stderr: Writable;
  /** Sets the exit code the process ends with. */
  setExitCode(code: number): void;
}

/**
 * Runs `vmd` in a process: prints what {@link runCli} returns, text or bytes as they are, and sets the exit code. A reader that closes the output early, as
 * `head` does, ends the output without an error: the broken pipe (`EPIPE`) is not reported, and the exit code stays the
 * command's. Another error writing an output sets exit code 1.
 */
export async function runProcess(io: ProcessIo, environment: Partial<CliEnvironment> = {}): Promise<void> {
  const result = await runCli(io.args, environment);
  for (const stream of [io.stdout, io.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") io.setExitCode(1);
    });
  }
  io.setExitCode(result.exitCode);
  if (result.stdout.length > 0) io.stdout.write(result.stdout);
  if (result.stderr.length > 0) io.stderr.write(result.stderr);
}
