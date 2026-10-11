/** How grave an issue is. */
export type Severity = "error" | "warning";

/**
 * What an issue does. A structural error makes a record unreadable: it has no value view. A validation issue attaches to a
 * readable record. An operation issue fails, or warns about, the operation that raised it, and is not about one record's
 * content.
 */
export type IssueClass = "structural" | "validation" | "operation";

/**
 * The severities and classes an issue code can have. The first of each is the default: the severity under strict uniqueness
 * and without configuration, and the class in the most common context. The others are those that the store's uniqueness mode
 * or the context (a record or a schema, `check` or the serializer) give it.
 */
export interface IssueCodeInfo {
  readonly severities: readonly [Severity, ...Severity[]];
  readonly classes: readonly [IssueClass, ...IssueClass[]];
}

/** Creates a frozen entry, its lists frozen too. */
function info(severities: IssueCodeInfo["severities"], classes: IssueCodeInfo["classes"]): IssueCodeInfo {
  return Object.freeze({ severities: Object.freeze(severities), classes: Object.freeze(classes) });
}

const structural = info(["error"], ["structural"]);
const validationError = info(["error"], ["validation"]);
const validationWarning = info(["warning"], ["validation"]);
const validationErrorOrWarning = info(["error", "warning"], ["validation"]);
const operationError = info(["error"], ["operation"]);

const codes = {
  "syntax-error": structural,
  "duplicate-member": structural,
  "unpaired-surrogate": structural,
  "number-not-representable": structural,
  "yaml-non-finite": structural,
  "yaml-non-string-key": structural,
  "yaml-alias": structural,
  "yaml-merge-key": structural,
  "yaml-tag": structural,
  "yaml-multiple-documents": structural,
  "yaml-version-unsupported": structural,
  "root-not-object": structural,
  "data-block-misplaced": structural,
  "data-block-not-object": structural,
  "reserved-member-type": structural,
  "section-title-missing": structural,
  "anchor-element-invalid": structural,
  "dollar-member": structural,
  // Structural in a record, an operation issue in a schema.
  "feature-unsupported": info(["error"], ["structural", "operation"]),
  "ref-malformed": structural,
  // An error at a level a schema declares a map; elsewhere the store's uniqueness mode decides.
  "duplicate-key": validationErrorOrWarning,
  "duplicate-anchor": validationErrorOrWarning,
  "duplicate-tag": validationWarning,
  "anchor-element-ignored": validationWarning,
  "anchor-invalid": validationError,
  "schema-violation": validationError,
  // A warning for an asset outside collections.
  "path-invalid": validationErrorOrWarning,
  "path-case-conflict": validationErrorOrWarning,
  "filename-mismatch": validationError,
  "ref-dangling": validationError,
  "ref-target-unreadable": validationWarning,
  "ref-ambiguous": validationError,
  "ref-target-not-allowed": validationError,
  // A validation warning in `check`, an operation error when the serializer refuses a value.
  "not-representable": info(["warning", "error"], ["validation", "operation"]),
  "yaml-ambiguous-string": validationWarning,
  "yaml-ambiguous-number": validationWarning,
  "multiple-h1": validationWarning,
  "heading-html": validationWarning,
  "ref-derived-anchor": validationWarning,
  "ref-derived-repeat": validationWarning,
  "ref-retargeted": validationWarning,
  "ref-aliased": validationWarning,
  "alias-shadowed": validationWarning,
  "config-invalid": operationError,
  "schema-invalid": operationError,
  "alias-file-invalid": operationError,
  "format-version-unsupported": operationError,
  "format-version-older": info(["warning"], ["operation"]),
  "address-malformed": operationError,
  "address-not-singular": operationError,
  "address-not-found": operationError,
  "address-ambiguous": operationError,
  "query-invalid": operationError,
  "usage-invalid": operationError,
  "store-not-found": operationError,
  "unicode-runtime-older": info(["warning"], ["operation"]),
  "unreadable-records": operationError,
  "storage-failed": operationError,
  conflict: operationError,
} satisfies Record<string, IssueCodeInfo>;

/** An issue code. */
export type IssueCode = keyof typeof codes;

/** Every issue code vmd reports, with its severities and classes. */
export const ISSUE_CODES: Readonly<Record<IssueCode, IssueCodeInfo>> = Object.freeze(codes);

/** Whether `code` is an issue code vmd knows. */
export function isIssueCode(code: string): code is IssueCode {
  return Object.hasOwn(ISSUE_CODES, code);
}
