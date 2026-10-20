/** Name of this package, for messages that identify which library produced them. */
export const CORE_PACKAGE_NAME = "@vollmond/core";

export {
  type Address,
  type AddressReading,
  encodeExactPath,
  encodeStep,
  type Fragment,
  formatAddress,
  formatFragment,
  parseAddress,
} from "./address/address.js";
export { proveSingular } from "./address/prove.js";
export {
  type AddressUse,
  blockAnchorAddress,
  canonicalAddress,
  type ParsedSubject,
  type RecordLookup,
  type ResolutionSubject,
  resolveAddress,
  resolveAddressSteps,
  resolveStoreAddress,
  type StepMatch,
  type StepResolution,
  type StoreResolution,
  type Target,
} from "./address/resolve.js";
export type { AnchorEntry, AnchorTable, BlockAnchorEntry, NodeAnchor, TagEntry } from "./anchor/anchor-table.js";
export { type UnicodeRuntimeProbe, unicodeRuntimeProbe } from "./anchor/unicode/probe.js";
export { type BindingFacts, bindRecord, bindStructure, type KeyedList, type RecordBinding } from "./binding/binding.js";
export type { CheckOptions, CheckSummary } from "./check/check.js";
export { collectionOfRecord, type PathClass, PathClassifier } from "./config/classify.js";
export {
  type Collection,
  type CollectionKey,
  MAX_CONFIGURATION_BYTES,
  readStoreConfiguration,
  type StoreConfiguration,
  SUPPORTED_FORMAT_VERSION,
} from "./config/configuration.js";
export { parseMarkdownRecord } from "./format/markdown/markdown.js";
export { parseRecord } from "./format/parse-record.js";
export { parseYamlRecord, parseYamlUnit, type YamlUnit, type YamlUnitNode, type YamlUnitPlace } from "./format/yaml.js";
export {
  createMemoryIndexCache,
  type IndexCache,
  MAX_ENTRY_BYTES,
  type MemoryIndexCache,
  SNAPSHOT_KEY,
} from "./index/cache.js";
export { ISSUE_CODES, type IssueClass, type IssueCode, type IssueCodeInfo, isIssueCode, type Severity } from "./issue/codes.js";
export { hasStructuralError, type Issue, type IssueInit, makeIssue, type NameOccurrence, repeatedNodes } from "./issue/issue.js";
export { fail, type Outcome, succeed } from "./issue/outcome.js";
export { applySeverities, type SeverityConfiguration, type SeveritySetting, settingsAllowed } from "./issue/severity.js";
export {
  COMPUTED_FIELD_NAMES,
  type ComputedAnchor,
  type ComputedFieldContext,
  type ComputedFieldName,
  type ComputedFields,
  type ComputedIssue,
  type ComputedReference,
  computeFields,
  type SourceLocation,
} from "./meta/computed-fields.js";
export { childPath } from "./record/exact-path.js";
export {
  type HeadingInfo,
  type HeadingInit,
  type NodeIndex,
  NodeIndexBuilder,
  type NodeInfo,
  type NodeInit,
  type NodeKind,
  type NodeSink,
  type SectionInfo,
  type ValueKind,
  type ValueNodeInfo,
} from "./record/node-index.js";
export { blockText, valueAt } from "./record/node-value.js";
export {
  isParsedRecord,
  isRestoredRecord,
  type ParsedRecord,
  parseOutcome,
  type RecordFormat,
  type RecordStructure,
  type RestoredRecord,
  recordFormatOf,
  type StructureFacts,
} from "./record/record.js";
export { checkShape, nodeLocator, type ShapeContext, type ShapeUnit } from "./record/shape.js";
export {
  type Alias,
  type AliasTable,
  type AnchorAlias,
  MAX_ALIAS_FILE_BYTES,
  type RecordAlias,
  readAliases,
} from "./reference/aliases.js";
export { occurrencesOf } from "./reference/extract.js";
export type {
  Reference,
  ReferenceForm,
  ReferenceOccurrence,
  ReferenceStatus,
  ReferenceTarget,
} from "./reference/reference.js";
export { resolveReferenceUri, type UriResolution } from "./reference/uri.js";
export { type CollectionSchema, type ListChecks, loadCollectionSchema, type SchemaLoading } from "./schema/collection-schema.js";
export { EXTENSION_KEYWORDS, type ListDeclaration, type RefDeclaration } from "./schema/keywords.js";
export {
  type DateParts,
  type DateTimeParts,
  type DecimalParts,
  type DurationParts,
  LOGICAL_TYPES,
  type LogicalType,
  readBigint,
  readDate,
  readDateTime,
  readDecimal,
  readDuration,
  readInt64,
  readLocalDateTime,
  readTime,
  type TimeParts,
} from "./schema/logical-types.js";
export { DRAFT_2020_12, type SchemaLocation, type SchemaReader } from "./schema/schema-set.js";
export type { SchemaShape, ShapeStep } from "./schema/spine.js";
export { closeValidatorUriSchemes } from "./schema/validator.js";
export type { NativeFailure } from "./schema/violations.js";
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
  OversizedFile,
  Page,
  ReadOptions,
  RemainingCount,
  StorageHistory,
  StorageReader,
} from "./storage/storage.js";
export { filenameMismatch, type ListedPath, pathRuleIssues } from "./store/path-rules.js";
export {
  type ConfigurationSource,
  type GetOptions,
  type GetResult,
  MAX_SCHEMA_BYTES,
  type NodeForm,
  type Outline,
  type OutlineEntry,
  openStore,
  type ReadMode,
  type ReferenceListing,
  type ReferencesQuery,
  type Store,
  type StoreEntry,
  type StoreListQuery,
  type StorePage,
  storeConfigurationSource,
  type UnreadableCount,
} from "./store/store.js";
export { IGNORED_PATH_GLOBS, type StorePathKind, storePathKind } from "./store/store-path.js";
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
