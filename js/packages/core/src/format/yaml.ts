import {
  type Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Node,
  parseDocument,
  type Scalar,
  visit,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import type { IssueCode } from "../issue/codes.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import { NodeIndexBuilder, type NodeInit, type ValueKind } from "../record/node-index.js";
import { type ParsedRecord, parseOutcome } from "../record/record.js";
import { checkShape, type ShapeUnit } from "../record/shape.js";
import type { ByteRange, Position, SourceText } from "../text/source-text.js";
import { readLineBreaksAsLf, sliceUnitText, type UnitText } from "../text/unit-text.js";
import { readNumberLiteral } from "../value/number.js";
import { createValueObject, hasMember, type MutableValueObject, type Value, type ValueObject } from "../value/value.js";

/** Where a YAML unit sits in its record, which decides the rules for its mapping. */
export interface YamlUnitPlace {
  /** The record's store path, for the issues. */
  readonly path: string;
  /**
   * The exact path of the object whose members the unit's mapping holds: `""` for a YAML record and for front matter, and the
   * section's for a data block. The unit's nodes and issues are under it.
   */
  readonly at: string;
  /**
   * What the unit is: a YAML record, whose mapping is the root section, or a Markdown record's front matter or a section's
   * data block, whose mapping holds fields. It decides the shape rules and the code for a unit that holds no mapping
   * (`root-not-object` for a record, `data-block-not-object` for the others).
   */
  readonly unit: ShapeUnit;
}

/** A node of a unit's value as a record's {@link NodeIndexBuilder} takes it: `builder.add(parent, key, init)`. */
export interface YamlUnitNode {
  readonly parent: string;
  readonly key: string | number;
  readonly init: NodeInit;
}

/** What a YAML unit holds. */
export interface YamlUnit {
  /**
   * The members of the unit's mapping, frozen, with null prototypes; the empty object for a unit with no document or an empty
   * one. Absent when the unit has no value to give: a syntax error, an unsupported `%YAML` version, or a document that is not a
   * mapping. With other structural errors, it is what the walk read, and the record has no value view.
   */
  readonly value?: ValueObject;
  /**
   * The nodes under the unit's `at`, every parent before its children and siblings in source order, so that adding them in
   * order builds the record's index. A repeated member has none. Their ranges are UTF-8 bytes of the file.
   */
  readonly nodes: readonly YamlUnitNode[];
  /** Every issue the unit raised, structural or not, in document order and then the shape's. */
  readonly issues: readonly Issue[];
}

// The `yaml` package's reading of YAML 1.2 with the core schema. Merge keys are off so that `<<` stays a key the walk can see,
// and duplicate keys are not the library's error so that the walk reports each repeat at its member.
const PARSE_OPTIONS = {
  version: "1.2",
  schema: "core",
  merge: false,
  uniqueKeys: false,
  keepSourceTokens: true,
  prettyErrors: false,
} as const;

/** The library's codes for a problem with a tag, which the walk reports as `yaml-tag` at the tagged node. */
const TAG_CODES: ReadonlySet<string> = new Set(["TAG_RESOLVE_FAILED", "BAD_COLLECTION_TYPE"]);

/** The core schema's infinities and not-a-number (YAML 1.2.2, section 10.3.2). */
const NON_FINITE = /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/;

/** A line that holds only white space or a comment, which may stand before and between directives. */
const BLANK_OR_COMMENT = /^[ \t]*(?:#.*)?$/;

/** The most positions a `syntax-error`'s message lists. */
const MAX_LISTED = 10;

/**
 * Parses one YAML unit, a YAML record or a Markdown record's front matter or data block, into the members of its mapping, the
 * nodes for the record's index, and its issues. `unit` is the unit's text as a slice of the file, with its line breaks as they
 * are in the file: CRLF and a lone CR are read as LF here, and offsets go back to the file through `unit`.
 *
 * - A unit that is not YAML, holds a character YAML does not allow where it stands (a C0 control, U+FFFE or U+FFFF anywhere;
 *   U+FEFF, DEL or a C1 control outside a quoted scalar), has a directive in front matter, or a `%YAML` directive repeated or
 *   without one version, raises one `syntax-error` at `at`, which lists every problem's position, and nothing else.
 * - A `%YAML` directive other than 1.2 raises `yaml-version-unsupported` at `at`, and nothing else.
 * - Otherwise, the walk raises `yaml-multiple-documents`, `yaml-tag`, `yaml-alias`, `yaml-merge-key`, `yaml-non-string-key`,
 *   `yaml-non-finite`, `number-not-representable`, `unpaired-surrogate` and `duplicate-member`, each where it occurs; then
 *   `root-not-object` or `data-block-not-object` for a document that is not a mapping, or the shape checker's issues.
 *
 * Throws a `RangeError` when `unit` maps an index outside `source`, and an `Error` for a node the library gives that the
 * reading does not expect, which is a bug.
 */
export function parseYamlUnit(source: SourceText, unit: UnitText, place: YamlUnitPlace): YamlUnit {
  // The yaml package reads only LF as a line break, where YAML 1.2.2 (section 5.4) also has CRLF and a lone CR.
  return new YamlUnitReader(source, readLineBreaksAsLf(unit), place).read();
}

/**
 * Parses a YAML record from its decoded file: the whole file after a byte order mark at byte 0 is one unit, whose mapping is
 * the root section. Fails exactly when the record has a structural error.
 */
export function parseYamlRecord(path: string, source: SourceText): Outcome<ParsedRecord> {
  const start = source.hasBom ? 1 : 0;
  const unit = parseYamlUnit(source, sliceUnitText(source.text, start, source.text.length), { path, at: "", unit: "record" });
  return parseOutcome(unit.issues, (issues) => {
    const value = unit.value;
    if (value === undefined) throw new Error("a YAML unit without a value raised no structural error");
    const builder = new NodeIndexBuilder({ range: { start: 0, end: source.bytes.length } });
    for (const node of unit.nodes) builder.add(node.parent, node.key, node.init);
    return { path, format: "yaml", value, source, nodes: builder.build(), issues };
  });
}

/** One problem of a unit's syntax: where it starts in the unit text, and what it is. */
interface SyntaxProblem {
  readonly index: number;
  readonly message: string;
}

/** Reads one unit: its text, then its document, in one walk. */
class YamlUnitReader {
  readonly #source: SourceText;
  readonly #unit: UnitText;
  readonly #text: string;
  readonly #place: YamlUnitPlace;
  readonly #issues: Issue[] = [];
  readonly #nodes: YamlUnitNode[] = [];
  /** The first byte of each emitted node's member range, or of its range, by exact path, for the shape checker's positions. */
  readonly #starts = new Map<string, number>();
  /** Nodes whose explicit tag the library could not resolve, and so left without `tag`; found from its error's position. */
  readonly #unresolvedTagNodes = new Set<unknown>();

  constructor(source: SourceText, unit: UnitText, place: YamlUnitPlace) {
    this.#source = source;
    this.#unit = unit;
    this.#text = unit.text;
    this.#place = place;
  }

  read(): YamlUnit {
    const at = this.#place.at;
    const problems = [...this.#charactersNotYaml()];
    const doc = parseDocument(this.#text, PARSE_OPTIONS);
    let multipleDocumentsAt: number | null = null;
    const tagProblemEnds: number[] = [];
    for (const error of doc.errors) {
      if (error.code === "MULTIPLE_DOCS") {
        multipleDocumentsAt = error.pos[0];
      } else if (TAG_CODES.has(error.code)) {
        tagProblemEnds.push(error.pos[1]);
      } else {
        problems.push({ index: error.pos[0], message: firstLine(error.message) });
      }
    }
    for (const warning of doc.warnings) {
      // Tags and anchors are the walk's to report, and `%YAML` lines the directive scan's. A reserved directive, such as
      // `%FOO`, is ignored, as YAML 1.2.2 (section 6.8) says.
      if (TAG_CODES.has(warning.code) || warning.code === "BAD_ALIAS" || warning.code === "BAD_DIRECTIVE") continue;
      problems.push({ index: warning.pos[0], message: firstLine(warning.message) });
    }
    const directives = this.#directives(doc);
    problems.push(...directives.problems);
    if (problems.length === 0) problems.push(...this.#charactersOutsideQuotes(doc));
    if (problems.length > 0) return this.#syntaxError(problems);
    if (directives.unsupportedAt !== null) {
      this.#raise("yaml-version-unsupported", at, "vmd reads YAML 1.2 only", directives.unsupportedAt);
      return { nodes: this.#nodes, issues: this.#issues };
    }

    if (multipleDocumentsAt !== null) {
      const message = "a YAML unit holds one document; another starts here";
      this.#raise("yaml-multiple-documents", at, message, multipleDocumentsAt);
    }
    this.#findUnresolvedTagNodes(doc, tagProblemEnds);
    const contents = doc.contents;
    let value: ValueObject | undefined;
    if (contents === null || isEmptyNode(contents)) {
      value = Object.freeze(createValueObject());
    } else if (isMap(contents)) {
      this.#props(contents, at);
      this.#starts.set(at, this.#byteAt(contents.range?.[0] ?? 0));
      value = this.#mapping(contents, at, true);
    } else {
      this.#props(contents, at);
      const code = this.#place.unit === "record" ? "root-not-object" : "data-block-not-object";
      this.#raise(code, at, "the document must be a mapping", startOf(contents));
    }
    if (value !== undefined) {
      const locate = (path: string): Position | undefined => {
        const start = this.#starts.get(path);
        return start === undefined ? undefined : this.#source.position(start);
      };
      this.#issues.push(...checkShape(this.#place.unit, value, at, { path: this.#place.path, locate }));
    }
    return value === undefined
      ? { nodes: this.#nodes, issues: this.#issues }
      : { value, nodes: this.#nodes, issues: this.#issues };
  }

  /**
   * Reads the directive lines before the first document, which the library keeps to itself: a `%YAML` directive is one
   * version, at most once, and vmd reads only 1.2; front matter holds none, since its `---` would close the front matter.
   * Other directives, `%TAG` and the reserved ones, are the library's. A version the library read as other than 1.2, or warned
   * about, counts as unsupported too, so a line the scan misread cannot let one through.
   */
  #directives(doc: Document.Parsed): { readonly problems: SyntaxProblem[]; readonly unsupportedAt: number | null } {
    const text = this.#text;
    const problems: SyntaxProblem[] = [];
    const yamlLines: [number, number][] = [];
    let unsupportedAt: number | null = null;
    for (let start = 0; start <= text.length; ) {
      const newline = text.indexOf("\n", start);
      const end = newline < 0 ? text.length : newline;
      const line = text.slice(start, end);
      if (!BLANK_OR_COMMENT.test(line)) {
        if (!line.startsWith("%")) break;
        if (this.#place.unit === "front-matter") {
          problems.push({
            index: start,
            message: "front matter holds no directive: the --- after it would close the front matter",
          });
        }
        const parts = line.replace(/[ \t]+#.*$/, "").split(/[ \t]+/);
        if (parts[0] === "%YAML") {
          yamlLines.push([start, end]);
          const version = parts[1];
          if (yamlLines.length > 1) {
            problems.push({ index: start, message: "a document has at most one %YAML directive" });
          } else if (parts.length !== 2 || version === undefined || !/^[0-9]+\.[0-9]+$/.test(version)) {
            problems.push({ index: start, message: "a %YAML directive gives one version, as in %YAML 1.2" });
          } else if (version !== "1.2") {
            unsupportedAt = start + line.indexOf(version);
          }
        }
      }
      start = end + 1;
    }
    const read = doc.directives?.yaml;
    const warnedAt = doc.warnings.find(
      (warning) =>
        warning.code === "BAD_DIRECTIVE" && yamlLines.some(([start, end]) => warning.pos[0] >= start && warning.pos[0] < end),
    )?.pos[0];
    if (read?.explicit === true && read.version !== "1.2") unsupportedAt ??= 0;
    if (warnedAt !== undefined) unsupportedAt ??= warnedAt;
    return { problems, unsupportedAt };
  }

  /** Finds the characters YAML allows nowhere: C0 controls other than tab and LF, and U+FFFE and U+FFFF. */
  *#charactersNotYaml(): Generator<SyntaxProblem> {
    const text = this.#text;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0xfffe || code === 0xffff) {
        yield { index: i, message: `${codePoint(code)} is not allowed in YAML; write it as an escape in a double-quoted string` };
      }
    }
  }

  /**
   * Finds the characters YAML allows only inside a quoted scalar: U+FEFF, which elsewhere is a byte order mark or not allowed,
   * and DEL and the C1 controls other than NEL, which are outside its printable set.
   */
  #charactersOutsideQuotes(doc: Document.Parsed): SyntaxProblem[] {
    const quoted: [number, number][] = [];
    visit(doc, {
      Scalar: (_key, node) => {
        if ((node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE") && node.range) {
          quoted.push([node.range[0], node.range[1]]);
        }
      },
    });
    quoted.sort((a, b) => a[0] - b[0]);
    const problems: SyntaxProblem[] = [];
    const text = this.#text;
    let next = 0;
    for (let i = 0; i < text.length; i++) {
      while (next < quoted.length && (quoted[next] as [number, number])[1] <= i) next += 1;
      const range = quoted[next];
      if (range !== undefined && range[0] <= i) {
        i = range[1] - 1;
        continue;
      }
      const code = text.charCodeAt(i);
      if (code === 0xfeff || code === 0x7f || (code >= 0x80 && code <= 0x9f && code !== 0x85)) {
        const where = code === 0xfeff ? "a byte order mark is allowed only at the start of the file" : "it is not printable";
        problems.push({ index: i, message: `${codePoint(code)} is allowed only inside a quoted scalar: ${where}` });
      }
    }
    return problems;
  }

  /** Marks the node each unresolved tag stands before: the first node in document order that starts after the tag. */
  #findUnresolvedTagNodes(doc: Document.Parsed, tagEnds: readonly number[]): void {
    if (tagEnds.length === 0) return;
    const nodes: Node[] = [];
    visit(doc, (_key, node) => {
      if (isNode(node)) nodes.push(node);
    });
    for (const end of tagEnds) {
      const tagged = nodes.find((node) => (node.range?.[0] ?? -1) >= end);
      if (tagged === undefined) throw new Error(`no node after the tag that ends at ${end}`);
      this.#unresolvedTagNodes.add(tagged);
    }
  }

  /** Raises the one `syntax-error` of the unit, listing its problems in order. */
  #syntaxError(problems: SyntaxProblem[]): YamlUnit {
    problems.sort((a, b) => a.index - b.index);
    const listed = problems.slice(0, MAX_LISTED).map((problem) => {
      const position = this.#source.position(this.#byteAt(problem.index));
      return `${problem.message} (${position.line}:${position.col})`;
    });
    const more = problems.length > MAX_LISTED ? `; and ${problems.length - MAX_LISTED} more` : "";
    const first = problems[0] as SyntaxProblem;
    this.#raise("syntax-error", this.#place.at, `not valid YAML: ${listed.join("; ")}${more}`, first.index);
    return { nodes: [], issues: this.#issues };
  }

  /** Reads a mapping's members, raising the issues of its keys at the mapping. */
  #mapping(map: YAMLMap.Parsed, at: string, emit: boolean): ValueObject {
    const object: MutableValueObject = createValueObject();
    for (const pair of map.items) {
      const name = this.#memberName(pair.key, at);
      if (name === null) continue;
      const memberAt = childPath(at, name);
      const key = pair.key as Node;
      const keyRange: [number, number] = [startOf(key) ?? 0, valueEnd(key)];
      const repeated = hasMember(object, name);
      if (repeated) this.#raise("duplicate-member", memberAt, `the member ${JSON.stringify(name)} is repeated`, keyRange[0]);
      const member = this.#member(pair.value, keyRange, at, name, emit && !repeated);
      if (!repeated) object[name] = member;
    }
    return Object.freeze(object);
  }

  /** Reads a key: its name, or null for a key that is not a string, raising its issues at the mapping `at`. */
  #memberName(key: unknown, at: string): string | null {
    if (isAlias(key)) {
      this.#raise("yaml-alias", at, `the key is an alias, *${key.source}`, startOf(key));
      return null;
    }
    if (!isNode(key)) {
      this.#raise("yaml-non-string-key", at, "a key must be a string; this one is missing", undefined);
      return null;
    }
    const tagged = this.#props(key, at);
    if (!isScalar(key) || typeof key.value !== "string") {
      this.#raise("yaml-non-string-key", at, "a key must be a string", startOf(key));
      return null;
    }
    const name = key.value;
    if (key.type === "PLAIN" && !tagged && name === "<<") {
      const message = "<< is a merge key, which vmd does not read; quote it for a member named <<";
      this.#raise("yaml-merge-key", at, message, startOf(key));
    }
    if (!name.isWellFormed()) {
      this.#raise("unpaired-surrogate", at, "a key holds a surrogate that is not part of a pair", startOf(key));
    }
    return name;
  }

  /**
   * Reads a member's value, or an item, as the node `key` under `parent`, and when `emit` adds its node before its children's.
   * `keyRange` is a member's key in the unit text, null for an item. A member without a value, as `a` in `{a, b: 1}`, is null,
   * with an empty range where its key ends.
   */
  #member(node: unknown, keyRange: [number, number] | null, parent: string, key: string | number, emit: boolean): Value {
    const at = childPath(parent, key);
    if (emit) {
      const start = isNode(node) ? startOf(node) : null;
      const end = isNode(node) ? valueEnd(node) : null;
      const valueStart = start ?? keyRange?.[1];
      if (valueStart === undefined) throw new Error("the YAML library gave an item without a range");
      const range = this.#bytes(valueStart, end ?? valueStart);
      const kind = kindOf(node, this.#isTagged(node));
      const init: NodeInit =
        keyRange === null ? { kind, range } : { kind, range, memberRange: this.#bytes(keyRange[0], end ?? keyRange[1]) };
      this.#nodes.push({ parent, key, init });
      this.#starts.set(at, (init.memberRange ?? range).start);
    }
    return this.#value(node, at, emit);
  }

  /** Reads a node's value, raising its issues at `at`; an alias and a tagged scalar read as null. */
  #value(node: unknown, at: string, emit: boolean): Value {
    if (node === null) return null;
    if (isAlias(node)) {
      this.#raise("yaml-alias", at, `*${node.source} is an alias, which vmd does not read`, startOf(node));
      return null;
    }
    if (!isNode(node)) throw new Error("the YAML library gave a node of an unknown type");
    const tagged = this.#props(node, at);
    if (isMap(node)) return this.#mapping(node as YAMLMap.Parsed, at, emit);
    if (isSeq(node)) {
      const items = (node as YAMLSeq.Parsed).items.map((item, index) => this.#member(item, null, at, index, emit));
      return Object.freeze(items);
    }
    if (!isScalar(node)) throw new Error("the YAML library gave a node of an unknown type");
    // A tagged scalar's value is the tag's reading, which vmd does not have: the tag is the error.
    return tagged ? null : this.#scalar(node, at);
  }

  #scalar(scalar: Scalar, at: string): Value {
    const value = scalar.value;
    switch (typeof value) {
      case "string":
        if (!value.isWellFormed()) {
          this.#raise("unpaired-surrogate", at, "the string holds a surrogate that is not part of a pair", startOf(scalar));
        }
        return value;
      case "boolean":
        return value;
      case "number":
        return this.#number(scalar, at);
      default:
        if (value === null) return null;
        throw new Error(`the YAML library read a scalar as a ${typeof value}`);
    }
  }

  /** Reads a number from its literal, as the core schema reads a plain scalar; 0 for one the value view cannot hold. */
  #number(scalar: Scalar, at: string): number {
    const range = scalar.range as [number, number, number];
    const literal = this.#text.slice(range[0], range[1]);
    if (NON_FINITE.test(literal)) {
      this.#raise("yaml-non-finite", at, `${literal} is not a finite number, which the value view holds`, range[0]);
      return 0;
    }
    const reading = readNumberLiteral(literal, "yaml");
    if (reading.kind === "number") return reading.value;
    const why = {
      "integer-changed": "a double changes this integer",
      overflow: "it is too large",
      underflow: "a double rounds it to zero",
    };
    this.#raise("number-not-representable", at, `${literal} is not representable: ${why[reading.reason]}`, range[0], {
      hint: "write it as a string, which the int64, bigint and decimal types read",
    });
    return 0;
  }

  /** Raises the issues of a node's anchor and tag at `at`, and returns whether it has a tag. */
  #props(node: Node, at: string): boolean {
    if (node.anchor !== undefined) {
      this.#raise("yaml-alias", at, `&${node.anchor} is an anchor, which vmd does not read`, startOf(node));
    }
    const tagged = this.#isTagged(node);
    if (tagged) {
      const tag = node.tag === undefined ? "a tag" : `the tag ${node.tag}`;
      this.#raise("yaml-tag", at, `${tag} is explicit; vmd reads no tags, and quoting makes a string`, startOf(node));
    }
    return tagged;
  }

  #isTagged(node: unknown): boolean {
    return isNode(node) && (node.tag !== undefined || this.#unresolvedTagNodes.has(node));
  }

  #raise(code: IssueCode, at: string, message: string, index: number | null | undefined, extra?: { hint: string }): void {
    const position = index === null || index === undefined ? undefined : this.#source.position(this.#byteAt(index));
    const init = { code, path: this.#place.path, at, message, ...extra };
    this.#issues.push(makeIssue(position === undefined ? init : { ...init, position }));
  }

  /** Converts an index into the unit text to a byte offset into the file. */
  #byteAt(index: number): number {
    return this.#source.byteOffset(this.#unit.fileIndex(index));
  }

  #bytes(start: number, end: number): ByteRange {
    return { start: this.#byteAt(start), end: this.#byteAt(end) };
  }
}

/** The kind of a node's value as the walk reads it; a tagged scalar and an alias read as null. */
function kindOf(node: unknown, tagged: boolean): ValueKind {
  if (node === null || isAlias(node)) return "null";
  if (isMap(node)) return "object";
  if (isSeq(node)) return "array";
  if (!isScalar(node) || tagged) return "null";
  switch (typeof node.value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "null";
  }
}

/**
 * Where a node's value ends in the unit text: a scalar's or a flow collection's own end, and a block collection's last
 * value's, so that the line break and the comments after it are not part of it.
 */
function valueEnd(node: Node): number {
  const range = node.range as [number, number, number];
  if (isScalar(node) || isAlias(node) || (node as YAMLMap | YAMLSeq).flow === true) return range[1];
  if (isSeq(node)) {
    const last = node.items.at(-1);
    return isNode(last) ? valueEnd(last) : range[1];
  }
  if (isMap(node)) {
    const last = node.items.at(-1);
    if (last === undefined) return range[1];
    if (isNode(last.value)) return valueEnd(last.value);
    return isNode(last.key) ? valueEnd(last.key) : range[1];
  }
  return range[1];
}

/** Where a node starts in the unit text, after its anchor and tag; null for a node the library gave no range. */
function startOf(node: unknown): number | null {
  return isNode(node) && node.range ? node.range[0] : null;
}

/** Whether the document's contents are the empty node: an empty plain scalar without an anchor or a tag, as `---` alone. */
function isEmptyNode(contents: Node): boolean {
  return isScalar(contents) && contents.type === "PLAIN" && contents.source === "" && !contents.anchor && !contents.tag;
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0] as string;
}

function codePoint(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}
