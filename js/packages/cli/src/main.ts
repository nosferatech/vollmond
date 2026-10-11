#!/usr/bin/env node
import { runProcess } from "./process-io.js";

await runProcess({
  args: process.argv.slice(2),
  stdout: process.stdout,
  stderr: process.stderr,
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
