import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { OperationRegistry } from "./operation.js";
import { operations as defaultOperations } from "./operations/index.js";
import { type RunOptions, runSuite } from "./runner.js";

/** Outcome of one run of the command: what to print and the process exit code. */
export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The suite of this repository, `conformance/` at its root. */
const DEFAULT_SUITE = fileURLToPath(new URL("../../../../conformance/", import.meta.url));
/** The declaration of the TypeScript implementation, kept in this package. */
const DEFAULT_DECLARATION = fileURLToPath(new URL("../declaration.json", import.meta.url));

const USAGE = `usage: vmd-conformance [--suite DIR] [--declaration FILE] [--report FILE]
  [--profile NAME]... [--section SECTION]... [--id ID]... [--ids-failing]`;

/**
 * Runs the conformance suite with the given arguments (without the node and script paths), writes the report and returns what
 * to print instead of printing it. Relative paths resolve against `cwd`. The report goes to `conformance-report.json` unless
 * `--report` names another file. `--profile`, `--section` and `--id` narrow the run, each repeatable, and `--ids-failing`
 * prints the ids of the cases that failed or were in error. Exit code 2 means the run could not start, and then no report is
 * written; an unknown option gives it too.
 */
export async function runConformance(
  args: readonly string[],
  cwd: string,
  operations: OperationRegistry = defaultOperations,
  options: Pick<RunOptions, "comparison" | "timeoutMs"> = {},
): Promise<CliResult> {
  let values: ReturnType<typeof parse>["values"];
  try {
    values = parse(args).values;
  } catch (error) {
    return {
      stdout: "",
      stderr: `vmd-conformance: ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`,
      exitCode: 2,
    };
  }
  const suiteDirectory = values.suite === undefined ? DEFAULT_SUITE : resolve(cwd, values.suite);
  const reportFile = resolve(cwd, values.report ?? "conformance-report.json");
  const run = await runSuite({
    ...options,
    suiteDirectory,
    declarationFile: values.declaration === undefined ? DEFAULT_DECLARATION : resolve(cwd, values.declaration),
    operations,
    selection: { profiles: values.profile, sections: values.section, ids: values.id },
    commit: suiteCommit(suiteDirectory),
  });
  if (run.exitCode === 2) {
    return { stdout: "", stderr: `vmd-conformance: ${run.message}\n`, exitCode: 2 };
  }
  try {
    await writeFile(reportFile, `${JSON.stringify(run.report, null, 2)}\n`);
  } catch (error) {
    return { stdout: "", stderr: `vmd-conformance: the report cannot be written: ${String(error)}\n`, exitCode: 2 };
  }
  const counts = new Map<string, number>([
    ["pass", 0],
    ["fail", 0],
    ["error", 0],
    ["skip", 0],
  ]);
  for (const { verdict } of run.report.results) {
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  const summary = [...counts].map(([verdict, count]) => `${count} ${verdict}`).join(", ");
  const failing = values["ids-failing"]
    ? run.report.results.filter(({ verdict }) => verdict === "fail" || verdict === "error").map(({ id }) => `${id}\n`)
    : [];
  return { stdout: `conformance: ${summary}; report in ${reportFile}\n${failing.join("")}`, stderr: "", exitCode: run.exitCode };
}

/** Parses the command's arguments, throwing on an unknown option or a missing value. */
function parse(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    options: {
      suite: { type: "string" },
      declaration: { type: "string" },
      report: { type: "string" },
      profile: { type: "string", multiple: true },
      section: { type: "string", multiple: true },
      id: { type: "string", multiple: true },
      "ids-failing": { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
}

/**
 * Returns the git commit that the suite at `directory` is checked out at, or `undefined` when it is not in a git working copy,
 * when git cannot be run, or when the suite has a change or an untracked file, since the commit would then misname the suite.
 * Runs `git` twice, synchronously.
 */
export function suiteCommit(directory: string): string | undefined {
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (git("status", "--porcelain", "--", ".") !== "") {
      return undefined;
    }
    return git("rev-parse", "HEAD").trim();
  } catch {
    return undefined;
  }
}
