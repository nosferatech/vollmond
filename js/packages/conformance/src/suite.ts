import { type Checked, invalid, unknownMembers } from "./checked.js";
import { isJsonObject, type JsonReading } from "./json.js";

/** The members of `suite.json`: the suite's version, and the version of the case format its cases are written in. */
export interface SuiteVersion {
  readonly version: string;
  readonly case_format: number;
}

/** The case formats this runner reads. A suite in another one would be misread, so the runner refuses it. */
export const CASE_FORMATS: readonly number[] = [1];

/** Checks the contents of `suite.json`: both members present, no other member, and a case format this runner reads. */
export function checkSuiteVersion(reading: JsonReading): Checked<SuiteVersion> {
  if (!reading.ok) {
    return invalid(`suite.json cannot be read: ${reading.detail}`);
  }
  const [problem] = reading.problems;
  if (problem !== undefined) {
    return invalid(`suite.json cannot be read: ${problem.detail}`);
  }
  const suite = reading.value;
  if (!isJsonObject(suite)) {
    return invalid("suite.json must hold an object");
  }
  const unknown = unknownMembers(suite, ["version", "case_format"], "suite.json");
  if (unknown !== undefined) {
    return invalid(unknown);
  }
  if (typeof suite.version !== "string" || typeof suite.case_format !== "number") {
    return invalid("suite.json must give version as a string and case_format as a number");
  }
  if (!CASE_FORMATS.includes(suite.case_format)) {
    return invalid(`suite.json has case_format ${suite.case_format}, and this runner reads only ${CASE_FORMATS.join(", ")}`);
  }
  return { ok: true, value: { version: suite.version, case_format: suite.case_format } };
}
