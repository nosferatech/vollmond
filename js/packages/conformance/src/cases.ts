import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { isStringList, unknownMembers } from "./checked.js";
import { INPUT_MEMBERS, OPERATIONS, PROFILES } from "./contract.js";
import { isJsonObject, type JsonObject, type JsonProblem, type JsonValue, readJson } from "./json.js";
import type { ComparedIssue } from "./operation.js";

/** What a case expects: its result, if its operation returns one and must succeed, whether it must fail, and its issues. */
export interface Expectation {
  readonly result?: JsonValue;
  readonly fails: boolean;
  readonly issues: readonly ComparedIssue[];
}

/** A case of the suite with its defaults applied, checked against the case format. */
export interface SuiteCase {
  /** The global id: the case file's path under `cases/` without `.cases.json`, `/`, and the case's own id. */
  readonly id: string;
  /** The absolute path of the directory holding the case file, against which `store` resolves. */
  readonly directory: string;
  readonly description: string;
  readonly spec: readonly string[];
  readonly profiles: readonly string[];
  readonly operation: string;
  readonly input: JsonObject;
  readonly expect: Expectation;
  /** The open question or issue that blocks the case, which is then reported as skipped. */
  readonly pending?: string;
}

/**
 * A case that cannot be run as written, reported as `error` with `detail`. `id` is its global id, or, when the case gives no
 * usable id, the case file's id followed by `/#` and the case's index; when the file cannot be read at all, the file's id
 * followed by `/`. The case's profiles and sections are kept when they could be read, for the selection.
 */
export interface MalformedCase {
  readonly id: string;
  readonly detail: string;
  readonly profiles?: readonly string[] | undefined;
  readonly spec?: readonly string[] | undefined;
}

/** A case as read from its file: runnable, or malformed. */
export type LoadedCase = { readonly ok: true; readonly case: SuiteCase } | ({ readonly ok: false } & MalformedCase);

/**
 * The cases of a suite, and every input member that a case's operation does not take, as `<global id>: <member>`. Any such
 * member is a mistake in the suite, and the runner then stops without a report.
 */
export interface SuiteCases {
  readonly cases: readonly LoadedCase[];
  readonly inputsNotTaken: readonly string[];
}

const CASE_FILE_SUFFIX = ".cases.json";
const CASE_FILE_MEMBERS = ["defaults", "cases"];
const DEFAULTS_MEMBERS = ["spec", "profiles", "operation", "input"];
const CASE_MEMBERS = ["id", "description", "spec", "profiles", "operation", "input", "expect", "pending"];
const REQUIRED_CASE_MEMBERS = CASE_MEMBERS.filter((name) => name !== "pending");
const EXPECT_MEMBERS = ["result", "fails", "issues", "bytes"];
const ISSUE_MEMBERS = ["code", "severity", "path", "at"];
const LOCAL_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Reads every case file under `<suite>/cases/`, without descending into fixture stores, and checks each case against the case
 * format. A case or a case file that breaks it gives malformed cases, never an exception. Rejects only when `cases/` itself
 * cannot be listed.
 */
export async function loadCases(suiteDirectory: string): Promise<SuiteCases> {
  const casesDirectory = join(suiteDirectory, "cases");
  const files = await findCaseFiles(casesDirectory);
  const cases: LoadedCase[] = [];
  const inputsNotTaken: string[] = [];
  for (const file of files) {
    const fileId = relative(casesDirectory, file).split(sep).join("/").slice(0, -CASE_FILE_SUFFIX.length);
    const loaded = readCaseFile(await readFile(file), fileId, join(file, ".."));
    cases.push(...loaded.cases);
    inputsNotTaken.push(...loaded.inputsNotTaken);
  }
  return { cases, inputsNotTaken };
}

/** Lists the case files under a directory, leaving out fixture stores, which are directories holding `.vmd/config.yaml`. */
async function findCaseFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!(await isFile(join(path, ".vmd", "config.yaml")))) {
        found.push(...(await findCaseFiles(path)));
      }
    } else if (entry.isFile() && entry.name.endsWith(CASE_FILE_SUFFIX)) {
      found.push(path);
    }
  }
  return found;
}

/** Whether a path names a regular file. */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads the cases of one case file, given its bytes, its id (its path under `cases/` without the suffix) and the absolute path
 * of its directory.
 */
export function readCaseFile(bytes: Uint8Array, fileId: string, directory: string): SuiteCases {
  const reading = readJson(bytes);
  if (!reading.ok) {
    return {
      cases: [{ ok: false, id: `${fileId}/`, detail: `the case file cannot be read: ${reading.detail}` }],
      inputsNotTaken: [],
    };
  }
  const file = reading.value;
  if (!isJsonObject(file) || !Array.isArray(file.cases)) {
    return {
      cases: [{ ok: false, id: `${fileId}/`, detail: "the case file must be an object with a list of cases" }],
      inputsNotTaken: [],
    };
  }
  const items: readonly JsonValue[] = file.cases;
  const fileProblems = reading.problems.filter((problem) => caseIndex(problem) === undefined);
  const fileError =
    fileProblems[0]?.detail ?? unknownMembers(file, CASE_FILE_MEMBERS, "the case file") ?? checkDefaults(file.defaults);
  const defaults = isJsonObject(file.defaults) ? file.defaults : {};
  const cases: LoadedCase[] = [];
  const inputsNotTaken: string[] = [];
  const ids = items.map((item) =>
    isJsonObject(item) && typeof item.id === "string" && LOCAL_ID.test(item.id) ? item.id : undefined,
  );
  items.forEach((item, index) => {
    const localId = ids[index];
    const id = localId === undefined ? `${fileId}/#${index}` : `${fileId}/${localId}`;
    const merged = isJsonObject(item) ? applyDefaults(defaults, item) : undefined;
    const selectable = {
      profiles: isStringList(merged?.profiles) ? merged.profiles : undefined,
      spec: isStringList(merged?.spec) ? merged.spec : undefined,
    };
    if (merged !== undefined && typeof merged.operation === "string" && isJsonObject(merged.input)) {
      const operation = OPERATIONS.get(merged.operation);
      for (const name of Object.keys(merged.input)) {
        if (
          operation !== undefined &&
          INPUT_MEMBERS.has(name) &&
          !operation.required.includes(name) &&
          !operation.optional.includes(name)
        ) {
          inputsNotTaken.push(`${id}: ${name}`);
        }
      }
    }
    const problem = reading.problems.find((candidate) => caseIndex(candidate) === index);
    const repeated = localId !== undefined && ids.filter((other) => other === localId).length > 1;
    const checked =
      fileError ??
      problem?.detail ??
      (merged === undefined ? "the case must be an object" : undefined) ??
      (repeated ? `the id ${localId} is used by another case of the file` : undefined) ??
      checkCase(merged ?? {}, id, directory);
    cases.push(typeof checked === "string" ? { ok: false, id, detail: checked, ...selectable } : { ok: true, case: checked });
  });
  return { cases, inputsNotTaken };
}

/** The index of the case a problem lies in, or `undefined` for a problem outside every case. */
function caseIndex(problem: JsonProblem): number | undefined {
  const [first, second] = problem.path;
  return first === "cases" && typeof second === "number" ? second : undefined;
}

/** Returns why a case file's `defaults` is invalid, or `undefined`. */
function checkDefaults(defaults: JsonValue | undefined): string | undefined {
  if (defaults === undefined) {
    return undefined;
  }
  if (!isJsonObject(defaults)) {
    return "defaults must be an object";
  }
  if (defaults.input !== undefined && !isJsonObject(defaults.input)) {
    return "defaults.input must be an object";
  }
  return unknownMembers(defaults, DEFAULTS_MEMBERS, "defaults");
}

/** Applies a case file's defaults to a case: its own members replace the defaults, except `input`, merged one level deep. */
function applyDefaults(defaults: JsonObject, item: JsonObject): JsonObject {
  const merged = { ...defaults, ...item };
  return isJsonObject(defaults.input) && isJsonObject(item.input)
    ? { ...merged, input: { ...defaults.input, ...item.input } }
    : merged;
}

/** Checks a case with its defaults applied, and returns it, or why it is malformed. */
function checkCase(item: JsonObject, id: string, directory: string): SuiteCase | string {
  const unknown = unknownMembers(item, CASE_MEMBERS, "the case");
  if (unknown !== undefined) {
    return unknown;
  }
  const missing = REQUIRED_CASE_MEMBERS.filter((name) => !Object.hasOwn(item, name));
  if (missing.length > 0) {
    return `the case lacks ${missing.join(", ")}`;
  }
  const { id: localId, description, spec, profiles, operation, input, expect, pending } = item;
  if (typeof localId !== "string" || !LOCAL_ID.test(localId)) {
    return "id must be a string of lower-case letters, digits and hyphens, beginning with a letter or digit";
  }
  if (typeof description !== "string") {
    return "description must be a string";
  }
  if (!isStringList(spec)) {
    return "spec must be a list of non-empty strings";
  }
  if (!isStringList(profiles) || profiles.some((profile) => !PROFILES.includes(profile))) {
    return `profiles must be a list of ${PROFILES.join(", ")}`;
  }
  if (typeof operation !== "string" || operation === "") {
    return "operation must be a non-empty string";
  }
  if (pending !== undefined && (typeof pending !== "string" || pending === "")) {
    return "pending must be a non-empty string";
  }
  if (!isJsonObject(input)) {
    return "input must be an object";
  }
  const inputError = checkInput(input, operation);
  if (inputError !== undefined) {
    return inputError;
  }
  if (!isJsonObject(expect)) {
    return "expect must be an object";
  }
  const expectation = checkExpectation(expect, operation);
  if (typeof expectation === "string") {
    return expectation;
  }
  return {
    id,
    directory,
    description,
    spec,
    profiles,
    operation,
    input,
    expect: expectation,
    ...(pending === undefined ? {} : { pending }),
  };
}

/**
 * Returns why a case's input is malformed, or `undefined`. A member that no operation takes is unknown. For an operation of the
 * suite, the members it requires must be present, and the members it does not take were collected before this check.
 */
function checkInput(input: JsonObject, operation: string): string | undefined {
  const unknown = Object.keys(input).filter((name) => !INPUT_MEMBERS.has(name));
  if (unknown.length > 0) {
    return `input has the unknown member${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`;
  }
  const contract = OPERATIONS.get(operation);
  const missing = contract?.required.filter((name) => !Object.hasOwn(input, name)) ?? [];
  if (missing.length > 0) {
    return `input lacks ${missing.join(", ")}, which ${operation} requires`;
  }
  return undefined;
}

/**
 * Checks a case's `expect` against its operation. An operation with a result needs exactly one of `result` and `fails`, one
 * without a result takes no `result`, and `check` takes no `fails`. `fails` can only be `true`. `bytes` belongs to operations
 * the suite reserves and does not define yet. Returns the expectation, or why it is malformed.
 */
function checkExpectation(expect: JsonObject, operation: string): Expectation | string {
  const unknown = unknownMembers(expect, EXPECT_MEMBERS, "expect");
  if (unknown !== undefined) {
    return unknown;
  }
  const { result, fails, issues = [] } = expect;
  if (fails !== undefined && fails !== true) {
    return "expect.fails must be true when it is given";
  }
  const contract = OPERATIONS.get(operation);
  if (contract !== undefined) {
    if (Object.hasOwn(expect, "bytes")) {
      return `expect.bytes is reserved for operations that compare bytes, and ${operation} does not`;
    }
    if (contract.result && (result === undefined) === (fails === undefined)) {
      return `expect must have exactly one of result and fails for ${operation}`;
    }
    if (!contract.result && result !== undefined) {
      return `${operation} has no result to expect`;
    }
    if (!contract.fails && fails !== undefined) {
      return `${operation} cannot be expected to fail`;
    }
  }
  if (!Array.isArray(issues)) {
    return "expect.issues must be a list";
  }
  const expected: ComparedIssue[] = [];
  for (const [index, issue] of issues.entries()) {
    const checked = checkIssue(issue);
    if (typeof checked === "string") {
      return `expect.issues[${index}] ${checked}`;
    }
    expected.push(checked);
  }
  return { ...(result === undefined ? {} : { result }), fails: fails === true, issues: expected };
}

/** Checks an expected issue: its four members and nothing else. Returns it, or why it is malformed. */
function checkIssue(issue: JsonValue): ComparedIssue | string {
  if (!isJsonObject(issue)) {
    return "must be an object";
  }
  const unknown = unknownMembers(issue, ISSUE_MEMBERS, "the issue");
  if (unknown !== undefined) {
    return unknown;
  }
  const { code, severity, path, at } = issue;
  if (typeof code !== "string" || code === "") {
    return "must give code as a non-empty string";
  }
  if (severity !== "error" && severity !== "warning") {
    return "must give severity as error or warning";
  }
  if (!(typeof path === "string" || path === null) || !(typeof at === "string" || at === null)) {
    return "must give path and at, each a string or null";
  }
  return { code, severity, path, at };
}
