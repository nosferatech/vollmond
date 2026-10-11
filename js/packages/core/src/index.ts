/** Name of this package, for messages that identify which library produced them. */
export const CORE_PACKAGE_NAME = "@vollmond/core";

export { parseRecord } from "./format/parse-record.js";
export { parseYamlRecord, parseYamlUnit, type YamlUnit, type YamlUnitNode, type YamlUnitPlace } from "./format/yaml.js";
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
export { createStorageReader, type FileSource, type StoredFile } from "./storage/file-source.js";
export { compileLineTest, type LineTest } from "./storage/grep.js";
export { createMemoryStorage, type MemoryFile, type MemoryStorageInit } from "./storage/memory.js";
export { checkStoragePath, compareUtf8, compileGlob, type GlobTest } from "./storage/path.js";
export { checkPortableRegex, portableRegexToJavaScript } from "./storage/portable-regex.js";
export type {
  ContentRange,
  CountedPage,
  FileChange,
  FileContent,
  FileInfo,
  GrepMatch,
  GrepQuery,
  ListQuery,
  LogEntry,
  Page,
  RemainingCount,
  StorageHistory,
  StorageReader,
} from "./storage/storage.js";
export { type ByteRange, decodeSource, type Position, type SourceText, type SourceTextIssueCode } from "./text/source-text.js";
export { readLineBreaksAsLf, sliceUnitText, type UnitText } from "./text/unit-text.js";
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
