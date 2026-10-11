/** Name of this package, for messages that identify which library produced them. */
export const CORE_PACKAGE_NAME = "@vollmond/core";

export { ISSUE_CODES, type IssueClass, type IssueCode, type IssueCodeInfo, isIssueCode, type Severity } from "./issue/codes.js";
export { hasStructuralError, type Issue, type IssueInit, makeIssue, type NameOccurrence, repeatedNodes } from "./issue/issue.js";
export { fail, type Outcome, succeed } from "./issue/outcome.js";
export { childPath } from "./record/exact-path.js";
export {
  type HeadingInfo,
  type HeadingInit,
  type NodeIndex,
  NodeIndexBuilder,
  type NodeInfo,
  type NodeInit,
  type NodeKind,
  type SectionInfo,
  type ValueKind,
  type ValueNodeInfo,
} from "./record/node-index.js";
export { type ParsedRecord, parseOutcome, type RecordFormat, recordFormatOf } from "./record/record.js";
export { checkShape, nodeLocator, type ShapeContext, type ShapeUnit } from "./record/shape.js";
export { type ByteRange, decodeSource, type Position, type SourceText, type SourceTextIssueCode } from "./text/source-text.js";
export { gitBlobId, nodeVersion } from "./value/digest.js";
export { jcs } from "./value/jcs.js";
export { type NotRepresentableReason, type NumberLiteralReading, type NumberSyntax, readNumberLiteral } from "./value/number.js";
export {
  createValueObject,
  hasMember,
  isValue,
  type MutableValueObject,
  type Value,
  type ValueObject,
  valuesEqual,
} from "./value/value.js";
