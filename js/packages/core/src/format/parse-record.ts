import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome } from "../issue/outcome.js";
import { type ParsedRecord, type RecordFormat, recordFormatOf } from "../record/record.js";
import { decodeSource, type SourceText } from "../text/source-text.js";
import { parseJsonRecord } from "./json.js";
import { MAX_RECORD_BYTES } from "./limits.js";
import { parseMarkdownRecord } from "./markdown/markdown.js";
import { parseYamlRecord } from "./yaml.js";

/** Parses a decoded record file of one format into its value view, or fails with its structural errors. */
type FormatParser = (path: string, source: SourceText) => Outcome<ParsedRecord>;

/** The parser of each record format. */
const FORMAT_PARSERS: { readonly [Format in RecordFormat]: FormatParser } = {
  json: parseJsonRecord,
  md: parseMarkdownRecord,
  yaml: parseYamlRecord,
};

/**
 * Parses a record file: decodes it as UTF-8 and parses it as its extension's format says. The outcome fails exactly when the
 * record has a structural error, with every structural error found, and is otherwise the record, whose `issues` hold the
 * validation issues found while parsing. A file that is not UTF-8, or larger than {@link MAX_RECORD_BYTES}, fails with one
 * `syntax-error` at the root; a larger file is not decoded.
 *
 * Throws a `RangeError` when `path` does not end in a record's extension: callers pass the paths of records.
 */
export function parseRecord(path: string, content: Uint8Array): Outcome<ParsedRecord> {
  const format = recordFormatOf(path);
  if (format === null) throw new RangeError(`${JSON.stringify(path)} is not the path of a record`);
  if (content.length > MAX_RECORD_BYTES) return fail([recordTooLarge(path)]);
  const parser = FORMAT_PARSERS[format];
  const source = decodeSource(path, content);
  return source.ok ? parser(path, source.value) : fail(source.issues);
}

/** The `syntax-error` of a record larger than {@link MAX_RECORD_BYTES}, at its root. */
export function recordTooLarge(path: string): Issue {
  return makeIssue({
    code: "syntax-error",
    path,
    at: "",
    message: `${path} is larger than ${MAX_RECORD_BYTES} bytes, the largest record`,
  });
}
