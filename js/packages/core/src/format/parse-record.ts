import { fail, type Outcome } from "../issue/outcome.js";
import { type ParsedRecord, type RecordFormat, recordFormatOf } from "../record/record.js";
import { decodeSource, type SourceText } from "../text/source-text.js";
import { parseJsonRecord } from "./json.js";
import { parseYamlRecord } from "./yaml.js";

/** Parses a decoded record file of one format into its value view, or fails with its structural errors. */
type FormatParser = (path: string, source: SourceText) => Outcome<ParsedRecord>;

// Deviation from the I1 design, recorded in issue #11: Markdown records have no parser yet, since its pull request adds
// its entry here.
/** The parser of each record format. */
const FORMAT_PARSERS: { readonly [Format in RecordFormat]?: FormatParser } = {
  json: parseJsonRecord,
  yaml: parseYamlRecord,
};

/**
 * Parses a record file: decodes it as UTF-8 and parses it as its extension's format says. The outcome fails exactly when the
 * record has a structural error, with every structural error found, and is otherwise the record, whose `issues` hold the
 * validation issues found while parsing. A file that is not UTF-8 fails with one `syntax-error` at the root.
 *
 * Throws a `RangeError` when `path` does not end in a record's extension, or names a format that has no parser yet: callers
 * pass the paths of records.
 */
export function parseRecord(path: string, content: Uint8Array): Outcome<ParsedRecord> {
  const format = recordFormatOf(path);
  if (format === null) throw new RangeError(`${JSON.stringify(path)} is not the path of a record`);
  const parser = FORMAT_PARSERS[format];
  if (parser === undefined) throw new RangeError(`records in the ${format} format cannot be parsed yet`);
  const source = decodeSource(path, content);
  return source.ok ? parser(path, source.value) : fail(source.issues);
}
