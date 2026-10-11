import { type Checked, invalid, isStringList, unknownMembers } from "./checked.js";
import { PROFILES } from "./contract.js";
import { isJsonObject, type JsonReading } from "./json.js";

/**
 * An entry of the declaration's skip list: exactly one selector, `id` or `operation`, and the reason reported for each case it
 * skips. An `id` is a global id, or a prefix ending in `/` that matches every case below it.
 */
export type SkipEntry =
  | { readonly id: string; readonly reason: string }
  | { readonly operation: string; readonly reason: string };

/** What an implementation declares to its runner: who it is, the profiles it claims, and the cases it skips on purpose. */
export interface Declaration {
  readonly name: string;
  readonly version: string;
  readonly profiles: readonly string[];
  readonly skip: readonly SkipEntry[];
}

/**
 * Checks the contents of a declaration file. `name`, `version` and `profiles` are required and `skip` is optional; any other
 * member, a profile the suite does not define, or a skip entry without exactly one selector and a reason makes it invalid.
 */
export function checkDeclaration(reading: JsonReading): Checked<Declaration> {
  if (!reading.ok) {
    return invalid(`the declaration cannot be read: ${reading.detail}`);
  }
  const [problem] = reading.problems;
  if (problem !== undefined) {
    return invalid(`the declaration cannot be read: ${problem.detail}`);
  }
  const declaration = reading.value;
  if (!isJsonObject(declaration)) {
    return invalid("the declaration must hold an object");
  }
  const unknown = unknownMembers(declaration, ["name", "version", "profiles", "skip"], "the declaration");
  if (unknown !== undefined) {
    return invalid(unknown);
  }
  const { name, version, profiles, skip = [] } = declaration;
  if (typeof name !== "string" || typeof version !== "string") {
    return invalid("the declaration must give name and version as strings");
  }
  if (!isStringList(profiles) || profiles.some((profile) => !PROFILES.includes(profile))) {
    return invalid(`the declaration's profiles must be a list of ${PROFILES.join(", ")}`);
  }
  if (!Array.isArray(skip)) {
    return invalid("the declaration's skip must be a list");
  }
  const entries: SkipEntry[] = [];
  for (const [index, entry] of skip.entries()) {
    const where = `skip entry ${index}`;
    if (!isJsonObject(entry)) {
      return invalid(`${where} must be an object`);
    }
    const selectors = ["id", "operation"].filter((selector) => Object.hasOwn(entry, selector));
    const unknownInEntry = unknownMembers(entry, ["id", "operation", "reason"], where);
    if (unknownInEntry !== undefined) {
      return invalid(unknownInEntry);
    }
    if (selectors.length !== 1 || typeof entry.reason !== "string" || entry.reason === "") {
      return invalid(`${where} must have exactly one of id and operation, and a reason`);
    }
    const { id, operation, reason } = entry;
    if (typeof id === "string" && id !== "") {
      entries.push({ id, reason });
    } else if (typeof operation === "string" && operation !== "") {
      entries.push({ operation, reason });
    } else {
      return invalid(`${where} must give its selector as a string`);
    }
  }
  return { ok: true, value: { name, version, profiles, skip: entries } };
}

/** Whether a skip entry's selector matches a case. */
export function skipMatches(entry: SkipEntry, id: string, operation: string): boolean {
  return "id" in entry ? idMatches(entry.id, id) : entry.operation === operation;
}

/** Whether a global id equals `pattern`, or starts with it when `pattern` ends in `/`. */
export function idMatches(pattern: string, id: string): boolean {
  return pattern.endsWith("/") ? id.startsWith(pattern) : id === pattern;
}
