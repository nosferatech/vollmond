// Runs the patterns the portable regex checker accepts through Python's `re`, the second of the three engines the subset is
// for. It needs Node's child processes, so it is a suite test, type checked apart from `core`, and it is skipped where no
// `python3` runs. RE2 is not run.
import { spawnSync } from "node:child_process";
import fc from "fast-check";
import { expect, test } from "vitest";
import { checkPortableRegex } from "./portable-regex.js";
import { candidatePatterns } from "./portable-regex.testkit.js";

const pythonRuns = spawnSync("python3", ["--version"]).status === 0;

/** Compiles each pattern of a JSON array on standard input, with warnings as errors, and prints those that fail. */
const COMPILE_ALL = `
import json, re, sys, warnings
failures = []
for pattern in json.load(sys.stdin):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            re.compile(pattern)
    except Exception as error:
        failures.append([pattern, str(error)])
json.dump(failures, sys.stdout)
`;

test.skipIf(!pythonRuns)("accepts only patterns that Python's re compiles without a warning", () => {
  const accepted = [
    ...new Set(fc.sample(candidatePatterns, { numRuns: 50000, seed: 1 }).filter((p) => checkPortableRegex(p).length === 0)),
  ];
  // The sample is useful only if it holds many patterns the checker accepts.
  expect(accepted.length).toBeGreaterThan(1000);
  const run = spawnSync("python3", ["-I", "-c", COMPILE_ALL], { input: JSON.stringify(accepted), encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual([]);
});
