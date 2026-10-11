import { ISSUE_CODES, type IssueCode, type Severity } from "./codes.js";
import type { Issue } from "./issue.js";

/** What an `issues` entry of the configuration sets a code to: a severity, or `off`, which leaves its issues out. */
export type SeveritySetting = Severity | "off";

/** The settings of a store's configuration that decide the severity of its issues. */
export interface SeverityConfiguration {
  /** Under `lenient`, a repeated key or anchor is a warning rather than an error. */
  readonly uniqueness: "strict" | "lenient";
  /** Under `minimal`, the warnings about YAML 1.1 readers are off. */
  readonly yamlQuoting: "compatible" | "minimal";
  /** The `issues` entries, by code; each within what {@link settingsAllowed} gives for its code. */
  readonly issues: ReadonlyMap<IssueCode, SeveritySetting>;
}

/** Every setting, in the order {@link settingsAllowed} lists them. */
const ALL_SETTINGS: readonly SeveritySetting[] = Object.freeze(["off", "warning", "error"]);
const ERROR_ONLY: readonly SeveritySetting[] = Object.freeze(["error"]);
const NONE: readonly SeveritySetting[] = Object.freeze([]);

/** The codes that lenient uniqueness makes warnings, at the levels no schema declares. */
const UNIQUENESS_CODES: ReadonlySet<IssueCode> = new Set(["duplicate-key", "duplicate-anchor"]);

/** The codes that minimal quoting turns off. */
const QUOTING_CODES: ReadonlySet<IssueCode> = new Set(["yaml-ambiguous-string", "yaml-ambiguous-number"]);

/**
 * Gives the settings an `issues` entry may give a code: none for a code whose default class is structural or operation, which
 * cannot be configured (`feature-unsupported`, structural in a record, is one); only `error` for a validation code whose
 * occurrences are always errors, since a validation error stays an error; and `off`, `warning` and `error` for the others, the
 * warnings and the codes that are errors in some contexts and warnings in others (`not-representable`, an operation error
 * when the serializer refuses a value, is one: an entry only ever reaches its warnings).
 */
export function settingsAllowed(code: IssueCode): readonly SeveritySetting[] {
  const info = ISSUE_CODES[code];
  if (info.classes[0] !== "validation") return NONE;
  return info.severities.includes("warning") ? ALL_SETTINGS : ERROR_ONLY;
}

/**
 * Gives the issues as a store with this configuration reports them, in their order, leaving out those that are off. An issue
 * comes with the severity its raiser gave it, the default unless its context decided (a path rule broken by an asset is a
 * warning). Then, in order:
 *
 * 1. under lenient uniqueness, `duplicate-key` and `duplicate-anchor` are warnings;
 * 2. under minimal quoting, `yaml-ambiguous-string` and `yaml-ambiguous-number` are off;
 * 3. an `issues` entry sets the severity of every issue of its code that is a warning or off at that point, so that it wins
 *    over the setting that implied a severity, and never lowers an error.
 *
 * An issue whose severity changes is a frozen copy with the new severity; the others are returned as they are.
 */
// A duplicate key at a level a schema declares a map stays an error under lenient uniqueness. No level is declared until
// keyed lists come (TODO(#23)), so every duplicate is at an undeclared level here; the binding will mark the others.
export function applySeverities(issues: readonly Issue[], configuration: SeverityConfiguration): Issue[] {
  const reported: Issue[] = [];
  for (const issue of issues) {
    let severity: SeveritySetting = issue.severity;
    if (configuration.uniqueness === "lenient" && UNIQUENESS_CODES.has(issue.code)) severity = "warning";
    if (configuration.yamlQuoting === "minimal" && QUOTING_CODES.has(issue.code)) severity = "off";
    const entry = configuration.issues.get(issue.code);
    if (entry !== undefined && severity !== "error") severity = entry;
    if (severity === "off") continue;
    reported.push(severity === issue.severity ? issue : Object.freeze({ ...issue, severity }));
  }
  return reported;
}
