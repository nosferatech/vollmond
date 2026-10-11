#!/usr/bin/env node
import { removeUriSchemePlugin } from "@hyperjump/browser";
import { runProcess } from "./process-io.js";

// Core checks that every reference of a schema names a file of the schema directory before the validator compiles it, so the
// validator never retrieves a schema. As a second line of defense, the process removes the validator's URI schemes that
// would read the network or the disk; registered schemas are served from its registry without them.
for (const scheme of ["http", "https", "file"]) removeUriSchemePlugin(scheme);

await runProcess({
  args: process.argv.slice(2),
  stdout: process.stdout,
  stderr: process.stderr,
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
