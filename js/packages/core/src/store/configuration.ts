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
  /** The format version as the configuration declares it, a minor version included: `1`, or `1.2`. */
  readonly declared: number;
}

/** The major format version of the stores this vmd reads. */
export const SUPPORTED_FORMAT_VERSION = 1;

/** The largest configuration file, in bytes, that vmd reads: a mebibyte, far more than any configuration needs. */
export const MAX_CONFIGURATION_BYTES = 1024 * 1024;

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
 * format version, `vmd`. A configuration file is not a record, so every issue has no `path` and no node (`at` is null); a
 * caller names the file where it prints them.
 *
 * - Fails with `config-invalid` for a file larger than {@link MAX_CONFIGURATION_BYTES}; for one that is not UTF-8, not YAML,
 *   or holds what vmd's YAML refuses (an anchor, a tag, several documents, a repeated member...), once for each problem and
 *   at its position; for a document that is not a mapping; and for a configuration without `vmd`, or whose `vmd` is not a
 *   number from 1.
 * - Reads `vmd` as a major version, followed by a minor one after a point: `1.2` is major version 1, read without a warning.
 *   How a store writes a minor version is not decided yet, so only the major version is relied on.
 * - Fails with `format-version-unsupported` for a major version other than {@link SUPPORTED_FORMAT_VERSION}.
 *
 * The other members are not read.
 */
export function readStoreConfiguration(content: Uint8Array): Outcome<StoreConfiguration> {
  if (content.length > MAX_CONFIGURATION_BYTES) {
    return fail([invalid(`the configuration is larger than ${MAX_CONFIGURATION_BYTES} bytes`, undefined)]);
  }
  const decoded = decodeSource("", content, "config-invalid");
  if (!decoded.ok) return fail(decoded.issues.map(configInvalid));
  const source = decoded.value;
  const start = source.hasBom ? 1 : 0;
  const unit = parseYamlUnit(source, sliceUnitText(source.text, start, source.text.length), {
    path: "",
    at: "",
    unit: "front-matter",
  });
  const problems = unit.issues.filter((issue) => !RECORD_SHAPE_CODES.has(issue.code)).map(configInvalid);
  if (problems.length > 0 || unit.value === undefined) {
    return fail(problems.length > 0 ? problems : [invalid("the configuration has no value", undefined)]);
  }
  const member = unit.nodes.find((node) => node.parent === "" && node.key === "vmd");
  const position = member === undefined ? undefined : source.position((member.init.memberRange ?? member.init.range).start);
  const declared = Object.hasOwn(unit.value, "vmd") ? unit.value.vmd : undefined;
  if (declared === undefined) {
    return fail([invalid('the configuration has no "vmd", the store\'s format version; write "vmd: 1"', undefined)]);
  }
  if (typeof declared !== "number" || !Number.isFinite(declared) || declared < 1) {
    return fail([invalid(`"vmd", the store's format version, must be a number from 1, not ${describe(declared)}`, position)]);
  }
  const vmd = Math.trunc(declared);
  if (vmd !== SUPPORTED_FORMAT_VERSION) {
    return fail([
      makeIssue({
        code: "format-version-unsupported",
        path: null,
        at: null,
        message: `the store's format version is ${declared}, and this vmd reads major version ${SUPPORTED_FORMAT_VERSION} only`,
        hint: "use a vmd that supports the store's version",
        ...(position === undefined ? {} : { position }),
      }),
    ]);
  }
  return succeed(Object.freeze({ vmd, declared }));
}

/** Turns an issue of the decoder or the YAML reader into a `config-invalid` with the same message and position. */
function configInvalid(issue: Issue): Issue {
  return invalid(issue.message, issue.position);
}

/** A `config-invalid` issue. */
function invalid(message: string, position: Position | undefined): Issue {
  return makeIssue({ code: "config-invalid", path: null, at: null, message, ...(position === undefined ? {} : { position }) });
}

/** Describes a value for a message: its JSON text, or its kind for a collection. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return "a list";
  if (value !== null && typeof value === "object") return "a mapping";
  return JSON.stringify(value);
}
