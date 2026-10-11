import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { succeed } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import type { CliEnvironment } from "./cli.js";
import { type Command, outcomeOutput } from "./command/command.js";
import { runProcess } from "./process-io.js";

/** A stream for the tests, which collects what is written to it or fails every write. */
interface TestStream extends Writable {
  /** What was written. */
  text: string;
  /** The bytes written. */
  bytes: Buffer;
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
      sink.bytes = Buffer.concat([sink.bytes, Buffer.from(chunk)]);
      callback();
    },
  }) as TestStream;
  sink.text = "";
  sink.bytes = Buffer.alloc(0);
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
async function run(
  args: string[],
  stdout: Writable,
  stderr: Writable,
  environment: Partial<CliEnvironment> = {},
): Promise<number | undefined> {
  let exitCode: number | undefined;
  await runProcess({ args, stdout, stderr, setExitCode: (code) => (exitCode = code) }, environment);
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

  test("writes bytes that are not UTF-8 as they are", async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0xc3, 0x28, 0x0a]);
    const give: Command = {
      name: "give",
      usage: "",
      summary: "gives bytes",
      options: {},
      readsStore: false,
      run: async () => outcomeOutput(succeed(bytes), (value) => value),
    };
    const stdout = stream();
    expect(await run(["give"], stdout, stream(), { commands: [give] })).toBe(0);
    expect(stdout.bytes).toEqual(Buffer.from(bytes));
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
