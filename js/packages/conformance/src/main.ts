#!/usr/bin/env node
import { runConformance } from "./cli.js";

const result = await runConformance(process.argv.slice(2), process.cwd());
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
