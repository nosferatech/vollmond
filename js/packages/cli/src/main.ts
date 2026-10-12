#!/usr/bin/env node
import { closeValidatorUriSchemes } from "@vollmond/core";
import { runProcess } from "./process-io.js";

// Core keeps the schema validator from retrieving anything; as a second line of defense, the process removes the validator's
// URI schemes that would read the network or the disk.
closeValidatorUriSchemes();

await runProcess({
  args: process.argv.slice(2),
  stdout: process.stdout,
  stderr: process.stderr,
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
