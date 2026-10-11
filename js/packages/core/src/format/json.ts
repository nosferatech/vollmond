import {
  createScanner,
  type Node as JsonNode,
  type ParseError,
  type ParseErrorCode,
  parseTree,
  printParseErrorCode,
  type SyntaxKind,
  visit,
} from "jsonc-parser";
import type { IssueCode } from "../issue/codes.js";
import { type Issue, makeIssue, repeatedNodes } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import { NodeIndexBuilder, type ValueKind } from "../record/node-index.js";
import { type ParsedRecord, parseOutcome } from "../record/record.js";
import { checkShape, nodeLocator } from "../record/shape.js";
import type { ByteRange, Position, SourceText } from "../text/source-text.js";
import { readNumberLiteral } from "../value/number.js";
import { createValueObject, type Value, type ValueObject } from "../value/value.js";

// Deviation from the I1 design, recorded in issue #11: neither the proposal nor the design limits nesting, but jsonc-parser
// parses recursively and overflows the call stack at a few thousand levels, which would make a hostile file crash the reader.
/**
 * The deepest nesting of arrays and objects a JSON unit may have, the root counting as level 1. A deeper unit is a
 * `syntax-error`, the same on every runtime, whatever its call stack holds.
 */
export const JSON_NESTING_LIMIT = 1000;

/** One JSON parse unit: a slice of a decoded file, and where its value goes. */
export interface JsonUnit {
  /** The record's store path, for the issues. */
  readonly path: string;
  readonly source: SourceText;
  /** The unit's first and last index into `source.text`, `[start, end)`. */
  readonly start: number;
  readonly end: number;
  /**
   * The exact path of the node that the unit's object fills, which `nodes` already holds: `""` for a JSON file. Its members
   * are added under it, and issues about the unit as a whole are attached to it.
   */
  readonly at: string;
  /** The index the unit's nodes are added to. */
  readonly nodes: NodeIndexBuilder;
  /** The code for a unit that holds something other than an object: `root-not-object` for a file. */
  readonly notObjectCode: "root-not-object" | "data-block-not-object";
}

/**
 * The outcome of a JSON unit: the object it holds, or null when it holds none, and the issues of its walk. The shape of the
 * object, which depends on where the unit is, is the caller's to check.
 */
export interface JsonUnitResult {
  readonly value: ValueObject | null;
  readonly issues: readonly Issue[];
}

/**
 * Parses one JSON unit as RFC 8259 defines JSON, through one walk of jsonc-parser's syntax tree: comments, trailing commas
 * and empty content are refused. It adds a node to `unit.nodes` for every value of the unit's object, with its range and, for
 * a member, its member range, in UTF-8 bytes of the file, and reports:
 *
 * - `syntax-error` once for the unit, however many errors it holds, at `unit.at`, positioned at the first; its message names
 *   the first ten and counts the others, so its length is bounded. A unit nested deeper than {@link JSON_NESTING_LIMIT}, or
 *   with a bracket that closes another kind, is one, and only the text before that bracket is parsed, for earlier errors.
 *   Nothing else is reported for such a unit, and it has no value;
 * - `unit.notObjectCode` for a unit that holds no object, which then has no value and adds no node;
 * - `duplicate-member` at each member after the first of a name, compared after escapes are read, positioned at its key. The
 *   value keeps the first, and the repeat has no node and is not looked into;
 * - `unpaired-surrogate` once per string that holds one, at the string, or at the object for a member name;
 * - `number-not-representable` for a number a double cannot hold, which reads as 0.
 *
 * A number means its nearest double, read from its source text, and `-0` reads as `0`. Objects have a null prototype.
 */
export function parseJsonUnit(unit: JsonUnit): JsonUnitResult {
  const text = unit.source.text.slice(unit.start, unit.end);
  const walk = new JsonWalk(unit, text);
  const nesting = checkNesting(text, JSON_NESTING_LIMIT);
  if (nesting !== null) {
    // The text before the refused bracket nests within the limit, with its brackets paired, so it is safe to parse for the
    // errors that come before the bracket.
    walk.syntaxError(syntaxErrors(text.slice(0, nesting.offset), nesting.offset), nesting);
    return { value: null, issues: walk.issues };
  }
  const errors = syntaxErrors(text, text.length + 1);
  const tree = errors.count === 0 ? parseTree(text, undefined, PARSE_OPTIONS) : undefined;
  if (tree === undefined) {
    walk.syntaxError(errors, null);
    return { value: null, issues: walk.issues };
  }
  if (tree.type !== "object") {
    walk.raise(unit.notObjectCode, unit.at, tree.offset, "the value must be an object");
    // The errors inside the value are reported too, though no node is added for it.
    walk.value(tree, unit.at, false);
    return { value: null, issues: walk.issues };
  }
  return { value: walk.members(tree, unit.at, true), issues: walk.issues };
}

/**
 * Parses a JSON record file into its value view, or fails with its structural errors (see {@link parseJsonUnit}). The file
 * is one unit, which starts after a byte order mark at byte 0, if any. The root's range is the whole file, and the record's
 * shape is checked as a JSON record's.
 */
export function parseJsonRecord(path: string, source: SourceText): Outcome<ParsedRecord> {
  const builder = new NodeIndexBuilder({ range: { start: 0, end: source.bytes.length } });
  const unit = parseJsonUnit({
    path,
    source,
    start: source.hasBom ? 1 : 0,
    end: source.text.length,
    at: "",
    nodes: builder,
    notObjectCode: "root-not-object",
  });
  const nodes = builder.build();
  const issues = [...unit.issues];
  const value = unit.value;
  if (value !== null) issues.push(...checkShape("record", value, "", { path, locate: nodeLocator(nodes, source) }));
  return parseOutcome(issues, (recordIssues) => ({
    path,
    format: "json",
    value: value ?? createValueObject(),
    source,
    nodes,
    issues: recordIssues,
  }));
}

/** jsonc-parser in strict mode: RFC 8259 JSON, without comments, trailing commas or empty content. */
const PARSE_OPTIONS = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false } as const;

/** The value kind of each of jsonc-parser's node types that is a value. */
const VALUE_KINDS: { readonly [Type in JsonNode["type"]]?: ValueKind } = {
  object: "object",
  array: "array",
  string: "string",
  number: "number",
  boolean: "boolean",
  null: "null",
};

/** The message of `number-not-representable` for each reason a double cannot hold a number. */
const NOT_REPRESENTABLE_MESSAGES = {
  "integer-changed": "this integer is not exactly a double, and would read as another integer",
  overflow: "this number is too large for a double",
  underflow: "this number is not zero, but a double rounds it to zero",
} as const;

/** The walk of one unit's syntax tree, which builds the value and its nodes and collects the issues. */
class JsonWalk {
  readonly issues: Issue[] = [];
  readonly #unit: JsonUnit;
  readonly #text: string;

  /** Starts the walk of `unit`, whose text is `text`. */
  constructor(unit: JsonUnit, text: string) {
    this.#unit = unit;
    this.#text = text;
  }

  /** Reads the value of `node` at exact path `at`, adding the nodes below it to the index when `indexed`. */
  value(node: JsonNode, at: string, indexed: boolean): Value {
    switch (node.type) {
      case "object":
        return this.members(node, at, indexed);
      case "array":
        return (node.children ?? []).map((item, index) => {
          const itemAt = childPath(at, index);
          if (indexed) this.#unit.nodes.add(at, index, { kind: kindOf(item), range: this.#range(item.offset, item.length) });
          return this.value(item, itemAt, indexed);
        });
      case "string": {
        const string = node.value as string;
        if (!string.isWellFormed()) this.#unpairedSurrogate(at, node.offset);
        return string;
      }
      case "number":
        return this.#number(node, at);
      case "boolean":
        return node.value as boolean;
      default:
        return null;
    }
  }

  /** Reads the members of the object `node` at exact path `at`, adding them below `at` in the index when `indexed`. */
  members(node: JsonNode, at: string, indexed: boolean): ValueObject {
    const object = createValueObject();
    const properties = (node.children ?? []).map((property) => {
      const [key, value] = property.children as [JsonNode, JsonNode];
      return { name: key.value as string, node: { key, value } };
    });
    const repeats = new Set(repeatedNodes(properties));
    for (const { name, node: member } of properties) {
      if (!name.isWellFormed()) this.#unpairedSurrogate(at, member.key.offset);
      const memberAt = childPath(at, name);
      if (repeats.has(member)) {
        this.raise("duplicate-member", memberAt, member.key.offset, `the member ${JSON.stringify(name)} is repeated`);
        continue;
      }
      if (indexed) {
        const memberEnd = member.value.offset + member.value.length;
        this.#unit.nodes.add(at, name, {
          kind: kindOf(member.value),
          range: this.#range(member.value.offset, member.value.length),
          memberRange: this.#range(member.key.offset, memberEnd - member.key.offset),
        });
      }
      object[name] = this.value(member.value, memberAt, indexed);
    }
    return object;
  }

  /**
   * Reports the unit's one syntax error: the parser's `errors`, then the nesting check's `problem`, if any, which comes
   * after them. It is positioned at the first, and its message names each of the errors kept, and how many more there are.
   */
  syntaxError(errors: SyntaxErrors, problem: NestingProblem | null): void {
    const where = (offset: number) => {
      const position = this.#position(offset);
      return `${position.line}:${position.col}`;
    };
    const parts = errors.first.map((error) => `${printParseErrorCode(error.error)} at ${where(error.offset)}`);
    const more = errors.count - errors.first.length;
    if (more > 0) parts.push(`and ${more} more`);
    if (problem !== null) parts.push(`${problem.message} at ${where(problem.offset)}`);
    // Without errors there is always a tree, since empty content is refused; the message only keeps the type checker sound.
    const message = parts.length === 0 ? "not JSON" : `not JSON: ${parts.join(", ")}`;
    this.raise("syntax-error", this.#unit.at, errors.first[0]?.offset ?? problem?.offset ?? 0, message);
  }

  /** Reports an issue at exact path `at`, positioned at the unit's index `offset`. */
  raise(code: IssueCode, at: string, offset: number, message: string, hint?: string): void {
    const init = { code, path: this.#unit.path, at, message, position: this.#position(offset) };
    this.issues.push(makeIssue(hint === undefined ? init : { ...init, hint }));
  }

  /** Reads a number by its source text, reporting one that a double cannot hold. */
  #number(node: JsonNode, at: string): number {
    const reading = readNumberLiteral(this.#text.slice(node.offset, node.offset + node.length), "json");
    if (reading.kind === "number") return reading.value;
    this.raise(
      "number-not-representable",
      at,
      node.offset,
      NOT_REPRESENTABLE_MESSAGES[reading.reason],
      "write the number as a string, which the int64, bigint and decimal logical types read",
    );
    // The record fails, so the value only needs to be a number.
    return 0;
  }

  /** Reports a string with an unpaired surrogate at `at`, positioned at the unit's index `offset`. */
  #unpairedSurrogate(at: string, offset: number): void {
    this.raise("unpaired-surrogate", at, offset, "the string holds a surrogate that is not part of a pair");
  }

  /** The byte range of the unit's `[offset, offset + length)`. */
  #range(offset: number, length: number): ByteRange {
    return { start: this.#byte(offset), end: this.#byte(offset + length) };
  }

  /** The byte offset in the file of the unit's index `offset`. */
  #byte(offset: number): number {
    return this.#unit.source.byteOffset(this.#unit.start + offset);
  }

  /** The position in the file of the unit's index `offset`. */
  #position(offset: number): Position {
    return this.#unit.source.position(this.#byte(offset));
  }
}

/** The value kind of a value node of jsonc-parser's tree; a property node is a bug in the walk, and throws. */
function kindOf(node: JsonNode): ValueKind {
  const kind = VALUE_KINDS[node.type];
  if (kind === undefined) throw new RangeError(`a ${node.type} node is not a value`);
  return kind;
}

/** The number of syntax errors a message names; the others are counted. */
const SYNTAX_ERRORS_KEPT = 10;

/** The syntax errors of a text: the first few, in order, and how many there are. */
interface SyntaxErrors {
  readonly first: readonly ParseError[];
  readonly count: number;
}

/**
 * Collects the syntax errors that jsonc-parser reports for `text` before index `end`, keeping the first
 * {@link SYNTAX_ERRORS_KEPT}, so that a file of a million errors costs no more memory than one. `text` must have passed
 * {@link checkNesting}, since the parser recurses.
 */
function syntaxErrors(text: string, end: number): SyntaxErrors {
  const first: ParseError[] = [];
  let count = 0;
  const onError = (error: ParseErrorCode, offset: number, length: number) => {
    if (offset >= end) return;
    count += 1;
    if (first.length < SYNTAX_ERRORS_KEPT) first.push({ error, offset, length });
  };
  visit(text, { onError }, PARSE_OPTIONS);
  return { first, count };
}

/** A unit that the nesting check refuses: the index of the bracket where it stopped, and why. */
export interface NestingProblem {
  readonly offset: number;
  readonly message: string;
}

// jsonc-parser declares its token kinds as a const enum, which isolated modules cannot read.
const OPEN_BRACE = 1 as SyntaxKind;
const CLOSE_BRACE = 2 as SyntaxKind;
const OPEN_BRACKET = 3 as SyntaxKind;
const CLOSE_BRACKET = 4 as SyntaxKind;
const EOF = 17 as SyntaxKind;

/**
 * Checks, before jsonc-parser recurses into it, that `text` nests arrays and objects no deeper than `limit` and closes each
 * with its own bracket. It reads the tokens of jsonc-parser's own scanner, so the brackets it counts are those the parser
 * meets, and none inside a string or a comment. In JSON the brackets pair up, so a bracket that closes another kind, or
 * nothing, makes the text a syntax error, which is reported without parsing: jsonc-parser's recovery skips such brackets,
 * so that `[},` repeated nests ever deeper while the brackets balance. With the brackets paired, the parser's depth never
 * exceeds the depth counted here, and the text before a refused bracket is safe to parse. The cost is one scan of the text,
 * without recursion.
 */
export function checkNesting(text: string, limit: number): NestingProblem | null {
  const scanner = createScanner(text, true);
  const open: SyntaxKind[] = [];
  for (let token = scanner.scan(); token !== EOF; token = scanner.scan()) {
    if (token === OPEN_BRACE || token === OPEN_BRACKET) {
      open.push(token === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET);
      if (open.length > limit) {
        return { offset: scanner.getTokenOffset(), message: `arrays and objects nest more than ${limit} deep` };
      }
    } else if ((token === CLOSE_BRACE || token === CLOSE_BRACKET) && open.pop() !== token) {
      const bracket = token === CLOSE_BRACE ? "}" : "]";
      return { offset: scanner.getTokenOffset(), message: `${bracket} closes no array or object here` };
    }
  }
  return null;
}
