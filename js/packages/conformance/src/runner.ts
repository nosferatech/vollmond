import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type LoadedCase, loadCases, type SuiteCase } from "./cases.js";
import type { Checked } from "./checked.js";
import { type Comparison, standardComparison } from "./compare.js";
import { OPERATIONS, takesStore } from "./contract.js";
import { checkDeclaration, type Declaration, type SkipEntry, skipMatches } from "./declaration.js";
import { type JsonValue, readJson } from "./json.js";
import type { FixtureStore, OperationContext, OperationOutcome, OperationRegistry } from "./operation.js";
import { checkSelection, isSelected, type Selection, type SelectionCriteria } from "./selection.js";
import { FixtureStores } from "./store.js";
import { checkSuiteVersion, type SuiteVersion } from "./suite.js";

/** How to run the suite. */
export interface RunOptions {
  /** The absolute path of the suite's directory, the one holding `suite.json` and `cases/`. */
  readonly suiteDirectory: string;
  /** The path of the implementation's declaration file. */
  readonly declarationFile: string;
  /** The operations the runner performs. A case whose operation is missing is an `error` unless the declaration skips it. */
  readonly operations: OperationRegistry;
  /** The criteria that narrow the run; without any, the run is a full run. */
  readonly selection?: SelectionCriteria;
  /** The comparison of results and issues, which `compare` exposes; the suite's own by default. */
  readonly comparison?: Comparison;
  /** The git commit the suite was checked out at, when it is known and the suite has no uncommitted change. */
  readonly commit?: string | undefined;
  /** How long an operation may take, in milliseconds, before the runner counts it as a crash; 10 s by default. */
  readonly timeoutMs?: number;
}

/** The verdict on one case, by its global id. `detail` on a `fail` or an `error` is free text for people. */
export type CaseResult =
  | { readonly id: string; readonly verdict: "pass" }
  | { readonly id: string; readonly verdict: "fail" | "error"; readonly detail: string }
  | { readonly id: string; readonly verdict: "skip"; readonly reason: string };

/**
 * The report of a run, in the suite's common format. `results` are in the byte order of their ids. `unused_skips`, the skip
 * entries whose selector matched no case, is given for a full run only, since a selection leaves entries unused by design.
 */
export interface Report {
  readonly suite: SuiteVersion & { readonly commit?: string };
  readonly implementation: { readonly name: string; readonly version: string; readonly profiles: readonly string[] };
  readonly selection: Selection | null;
  readonly results: readonly CaseResult[];
  readonly unused_skips?: readonly SkipEntry[];
}

/**
 * The outcome of a run. Exit status 0 means no case failed or was in error, and 1 that some did. Exit status 2 means the run
 * could not start, and there is no report: `suite.json` or the declaration cannot be read or is invalid, the selection is
 * invalid, `cases/` cannot be listed, or a case gives an input member that its operation does not take.
 */
export type RunResult =
  | { readonly exitCode: 0 | 1; readonly report: Report }
  | { readonly exitCode: 2; readonly message: string };

const DEFAULT_TIMEOUT_MS = 10_000;

/** The prefix of the global ids of the self-test's cases. */
const SELF_TEST = "selftest/";

/**
 * Runs the conformance suite: reads it, selects and skips cases, checks the stores the remaining cases read against their
 * versions manifests, performs each case's operation, and compares what it gave with what the case expects. Never rejects on
 * a problem with the suite or an operation; such problems are verdicts, or exit status 2 before any case runs.
 */
export async function runSuite(options: RunOptions): Promise<RunResult> {
  const { suiteDirectory, declarationFile, operations, comparison = standardComparison } = options;
  const suite = checkSuiteVersion(await readJsonFile(join(suiteDirectory, "suite.json")));
  if (!suite.ok) {
    return { exitCode: 2, message: suite.detail };
  }
  const declaration = checkDeclaration(await readJsonFile(declarationFile));
  if (!declaration.ok) {
    return { exitCode: 2, message: declaration.detail };
  }
  const selection = checkSelection(options.selection ?? {});
  if (!selection.ok) {
    return { exitCode: 2, message: selection.detail };
  }
  let loaded: Awaited<ReturnType<typeof loadCases>>;
  try {
    loaded = await loadCases(suiteDirectory);
  } catch (error) {
    return { exitCode: 2, message: `the suite's cases cannot be listed: ${describeError(error)}` };
  }
  if (loaded.inputsNotTaken.length > 0) {
    return {
      exitCode: 2,
      message: `these cases give input members that their operations do not take: ${loaded.inputsNotTaken.join(", ")}`,
    };
  }

  const stores = new FixtureStores(suiteDirectory);
  const used = new Set<SkipEntry>();
  const results: CaseResult[] = [];
  for (const loadedCase of sortById(loaded.cases)) {
    if (!selects(selection.value, loadedCase)) {
      continue;
    }
    for (const entry of declaration.value.skip) {
      if (entryMatches(entry, loadedCase)) {
        used.add(entry);
      }
    }
    if (!loadedCase.ok) {
      results.push({ id: loadedCase.id, verdict: "error", detail: loadedCase.detail });
      continue;
    }
    const suiteCase = loadedCase.case;
    const skip = skipReason(suiteCase, declaration.value);
    if (skip !== undefined) {
      results.push({ id: suiteCase.id, verdict: "skip", reason: skip.reason });
      continue;
    }
    results.push(
      await runCase(suiteCase, { operations, comparison, stores, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }),
    );
  }

  const { name, version, profiles } = declaration.value;
  const report: Report = {
    suite: { ...suite.value, ...(options.commit === undefined ? {} : { commit: options.commit }) },
    implementation: { name, version, profiles },
    selection: selection.value,
    results,
    ...(selection.value === null ? { unused_skips: declaration.value.skip.filter((entry) => !used.has(entry)) } : {}),
  };
  const failed = results.some((result) => result.verdict === "fail" || result.verdict === "error");
  return { exitCode: failed ? 1 : 0, report };
}

/** Reads a JSON file of the suite or the runner, a file that cannot be read giving a reading that is not `ok`. */
async function readJsonFile(path: string): Promise<ReturnType<typeof readJson>> {
  try {
    return readJson(await readFile(path));
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  }
}

/** Returns the cases in the byte order of their global ids' UTF-8 encodings, keeping the file order of equal ids. */
function sortById(cases: readonly LoadedCase[]): LoadedCase[] {
  const key = (loadedCase: LoadedCase) => Buffer.from(loadedCase.ok ? loadedCase.case.id : loadedCase.id, "utf8");
  return [...cases].sort((a, b) => Buffer.compare(key(a), key(b)));
}

/** Whether a selection selects a case. The self-test, the topic `selftest/`, is always selected, also a malformed case in it. */
function selects(selection: Selection | null, loadedCase: LoadedCase): boolean {
  const selectable = loadedCase.ok ? loadedCase.case : loadedCase;
  return selectable.id.startsWith(SELF_TEST) || isSelected(selection, selectable);
}

/**
 * Why a case is skipped, or `undefined` when it runs. A pending case is skipped first, then a case that needs a profile the
 * declaration does not claim, then a case that a skip entry matches, the first such entry giving the reason.
 */
function skipReason(suiteCase: SuiteCase, declaration: Declaration): { reason: string } | undefined {
  if (suiteCase.pending !== undefined) {
    return { reason: `pending: ${suiteCase.pending}` };
  }
  const undeclared = suiteCase.profiles.find((profile) => !declaration.profiles.includes(profile));
  if (undeclared !== undefined) {
    return { reason: `profile ${undeclared} not declared` };
  }
  const entry = declaration.skip.find((candidate) => skipMatches(candidate, suiteCase.id, suiteCase.operation));
  return entry === undefined ? undefined : { reason: entry.reason };
}

/**
 * Whether a skip entry's selector matches a case, which makes the entry used, whether or not it gave the case's reason. A
 * malformed case has no reliable operation, so only an `id` entry can match it.
 */
function entryMatches(entry: SkipEntry, loadedCase: LoadedCase): boolean {
  return loadedCase.ok
    ? skipMatches(entry, loadedCase.case.id, loadedCase.case.operation)
    : "id" in entry && skipMatches(entry, loadedCase.id, "");
}

/** What `runCase` needs besides the case. */
interface CaseRun {
  readonly operations: OperationRegistry;
  readonly comparison: Comparison;
  readonly stores: FixtureStores;
  readonly timeoutMs: number;
}

/**
 * Runs one case that is neither skipped nor malformed, and judges what its operation gave. Never rejects: a problem with the
 * case's store or input is an `error`, and anything the adapter throws while running or comparing is a crash, so a `fail`.
 */
async function runCase(suiteCase: SuiteCase, run: CaseRun): Promise<CaseResult> {
  const { id, operation, input } = suiteCase;
  const contract = OPERATIONS.get(operation);
  let store: FixtureStore | undefined;
  if (contract !== undefined && takesStore(contract)) {
    let opened: Checked<FixtureStore>;
    try {
      opened = await run.stores.open(suiteCase.directory, input.store, input.config);
    } catch (error) {
      return { id, verdict: "error", detail: `the store cannot be read: ${describeError(error)}` };
    }
    if (!opened.ok) {
      return { id, verdict: "error", detail: opened.detail };
    }
    store = copyStore(opened.value);
  }
  const adapter = run.operations.get(operation);
  if (adapter === undefined) {
    return { id, verdict: "error", detail: `the runner does not implement the operation ${operation}` };
  }
  let malformed: string | undefined;
  try {
    malformed = adapter.validate?.(input);
  } catch (error) {
    return { id, verdict: "error", detail: `the input cannot be checked: ${describeError(error)}` };
  }
  if (malformed !== undefined) {
    return { id, verdict: "error", detail: malformed };
  }
  const abort = new AbortController();
  const context: OperationContext = {
    comparison: run.comparison,
    signal: abort.signal,
    ...(store === undefined ? {} : { store }),
  };
  try {
    const outcome = await withTimeout(adapter.run(input, context), run.timeoutMs, abort);
    const equalResults = adapter.equalResults ?? ((expected, actual) => run.comparison.equal(expected, actual));
    const mismatch = judge(suiteCase, outcome, run.comparison, (expected, actual) =>
      equalResults(expected, actual, input, context),
    );
    return mismatch === undefined ? { id, verdict: "pass" } : { id, verdict: "fail", detail: mismatch };
  } catch (error) {
    return { id, verdict: "fail", detail: `the operation crashed: ${describeError(error)}` };
  }
}

/** Returns a store whose file bytes are copies, so that what one case does to them reaches no other case. */
function copyStore(store: FixtureStore): FixtureStore {
  const files = new Map([...store.files].map(([path, bytes]) => [path, bytes.slice()]));
  return store.config === undefined ? { files } : { files, config: store.config.slice() };
}

/**
 * Compares an operation's outcome with the case's expectation: whether it failed, its result where the case expects one, and
 * its issues as an unordered list of their four stable members. Returns how they differ, or `undefined` when they agree.
 */
function judge(
  suiteCase: SuiteCase,
  outcome: OperationOutcome,
  comparison: Comparison,
  equalResults: (expected: JsonValue, actual: JsonValue) => boolean,
): string | undefined {
  if ("mismatch" in outcome) {
    return outcome.mismatch;
  }
  const { expect } = suiteCase;
  const issues = outcome.issues.map(({ code, severity, path, at }) => ({ code, severity, path, at }));
  if (expect.fails && outcome.ok) {
    return "the operation succeeded, and the case expects it to fail";
  }
  if (!expect.fails && !outcome.ok) {
    return `the operation failed with the issues ${abridge(issues)}`;
  }
  if (outcome.ok && expect.result !== undefined) {
    if (outcome.result === undefined) {
      return "the operation gave no result";
    }
    if (!equalResults(expect.result, outcome.result)) {
      return `expected the result ${abridge(expect.result)}, got ${abridge(outcome.result)}`;
    }
  }
  if (!comparison.equalUnordered(expect.issues, issues)) {
    return `expected the issues ${abridge(expect.issues)}, got ${abridge(issues)}`;
  }
  return undefined;
}

/**
 * Settles as `promise` does, or rejects once `milliseconds` have passed without it settling, aborting `abort` first so that
 * the operation can stop.
 */
async function withTimeout<T>(promise: Promise<T>, milliseconds: number, abort: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error(`no outcome after ${milliseconds} ms`));
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns an error's message, or the thrown value as text. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns a value as JSON text, cut to a length that a report line can carry. */
function abridge(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length <= 400 ? text : `${text.slice(0, 400)}...`;
}
