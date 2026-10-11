import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { runProcess } from "./process-io.js";

/** A stream for the tests, which collects what is written to it or fails every write. */
interface TestStream extends Writable {
  /** What was written. */
  text: string;
  /** Whether the stream emitted an error that nothing listened to, which would end a process with an uncaught exception. */
  unhandledError: boolean;
}

/** Creates a {@link TestStream} that collects what is written to it, or that fails every write with `code` when given. */
function stream(code?: string): TestStream {
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      if (code !== undefined) {
        callback(Object.assign(new Error(`write ${code}`), { code }));
        return;
      }
      sink.text += String(chunk);
      callback();
    },
  }) as TestStream;
  sink.text = "";
  sink.unhandledError = false;
  const emit = sink.emit.bind(sink);
  sink.emit = (event: string | symbol, ...args: unknown[]) => {
    if (event === "error" && sink.listenerCount("error") === 0) {
      sink.unhandledError = true;
      return false;
    }
    return emit(event, ...args);
  };
  return sink;
}

/** Runs `vmd` with `args` on the given streams, waits for the writes to settle, and returns the exit code it set. */
async function run(args: string[], stdout: Writable, stderr: Writable): Promise<number | undefined> {
  let exitCode: number | undefined;
  await runProcess({ args, stdout, stderr, setExitCode: (code) => (exitCode = code) });
  await setImmediate();
  return exitCode;
}

describe("runProcess", () => {
  test("prints what the command gives and sets its exit code", async () => {
    const stdout = stream();
    const stderr = stream();
    expect(await run(["--version"], stdout, stderr)).toBe(0);
    expect(stdout.text).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(stderr.text).toBe("");
  });

  test("ends quietly, keeping the command's exit code, when the reader closes the pipe early", async () => {
    const stdout = stream("EPIPE");
    expect(await run(["--version"], stdout, stream())).toBe(0);
    expect(stdout.unhandledError).toBe(false);
  });

  test("sets exit code 1 when an output cannot be written for another reason", async () => {
    expect(await run(["--version"], stream("EIO"), stream())).toBe(1);
  });
});
