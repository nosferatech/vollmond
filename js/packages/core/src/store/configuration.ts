import { parseYamlUnit } from "../format/yaml.js";
import type { IssueCode } from "../issue/codes.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { decodeSource, type Position } from "../text/source-text.js";
import { sliceUnitText } from "../text/unit-text.js";

// Deviation from the specification, recorded in issue #17: only `vmd` is read, and the configuration's other members are not
// checked, until the whole configuration is read. A member the specification does not define is therefore not refused yet.

/** What vmd reads of a store's configuration. */
export interface StoreConfiguration {
  /** The store's major format version: {@link SUPPORTED_FORMAT_VERSION}, since a configuration with another one is refused. */
  readonly vmd: number;
}

/** The major format version of the stores this vmd reads. */
export const SUPPORTED_FORMAT_VERSION = 1;

/**
 * Codes that the YAML reader raises for the shape of a record, which a configuration does not have: its members are not
 * sections or fields, so a `$` member is not refused here.
 */
const RECORD_SHAPE_CODES: ReadonlySet<IssueCode> = new Set([
  "dollar-member",
  "feature-unsupported",
  "reserved-member-type",
  "ref-malformed",
  "section-title-missing",
  "duplicate-tag",
]);

/**
 * Reads a store's configuration file: decodes it as UTF-8, parses it as one YAML document with vmd's YAML rules, and reads its
 * format version, `vmd`. `name` names the file in the issues' `path`, such as `.vmd/config.yaml`.
 *
 * Fails with `config-invalid` for a file that is not UTF-8, not YAML, or holds what vmd's YAML refuses (an anchor, a tag,
 * several documents, a repeated member...), once for each problem and at its position; for a document that is not a mapping;
 * and for a configuration without `vmd`, or whose `vmd` is not a whole number from 1. Fails with `format-version-unsupported`
 * for a major version other than {@link SUPPORTED_FORMAT_VERSION}. Each issue is attached to no node (`at` is null). The other
 * members are not read.
 */
export function readStoreConfiguration(name: string, content: Uint8Array): Outcome<StoreConfiguration> {
  const decoded = decodeSource(name, content, "config-invalid");
  if (!decoded.ok) return decoded;
  const source = decoded.value;
  const start = source.hasBom ? 1 : 0;
  const unit = parseYamlUnit(source, sliceUnitText(source.text, start, source.text.length), {
    path: name,
    at: "",
    unit: "front-matter",
  });
  const problems = unit.issues.filter((issue) => !RECORD_SHAPE_CODES.has(issue.code)).map((issue) => configInvalid(name, issue));
  if (problems.length > 0 || unit.value === undefined) {
    return fail(problems.length > 0 ? problems : [invalid(name, "the configuration has no value", undefined)]);
  }
  const member = unit.nodes.find((node) => node.parent === "" && node.key === "vmd");
  const position = member === undefined ? undefined : source.position((member.init.memberRange ?? member.init.range).start);
  const vmd = Object.hasOwn(unit.value, "vmd") ? unit.value.vmd : undefined;
  if (vmd === undefined) {
    return fail([invalid(name, 'the configuration has no "vmd", the store\'s format version; write "vmd: 1"', undefined)]);
  }
  if (typeof vmd !== "number" || !Number.isInteger(vmd) || vmd < 1) {
    return fail([
      invalid(name, `"vmd", the store's format version, must be a whole number from 1, not ${describe(vmd)}`, position),
    ]);
  }
  if (vmd !== SUPPORTED_FORMAT_VERSION) {
    return fail([
      makeIssue({
        code: "format-version-unsupported",
        path: name,
        at: null,
        message: `the store's format version is ${vmd}, and this vmd reads version ${SUPPORTED_FORMAT_VERSION} only`,
        hint: "use a vmd that supports the store's version",
        ...(position === undefined ? {} : { position }),
      }),
    ]);
  }
  return succeed(Object.freeze({ vmd }));
}

/** Turns an issue of the YAML reader into a `config-invalid` with the same message and position. */
function configInvalid(name: string, issue: Issue): Issue {
  return invalid(name, issue.message, issue.position);
}

/** A `config-invalid` issue. */
function invalid(name: string, message: string, position: Position | undefined): Issue {
  return makeIssue({ code: "config-invalid", path: name, at: null, message, ...(position === undefined ? {} : { position }) });
}

/** Describes a value for a message: its JSON text, or its kind for a collection. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return "a list";
  if (value !== null && typeof value === "object") return "a mapping";
  return JSON.stringify(value);
}
