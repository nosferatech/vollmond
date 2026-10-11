import { type Issue, makeIssue } from "../issue/issue.js";
import type { ParsedRecord } from "../record/record.js";
import type { Value, ValueObject } from "../value/value.js";
import { LOGICAL_TYPES } from "./logical-types.js";
import type { SchemaSet } from "./schema-set.js";
import { FALSE_SCHEMA_KEYWORD, type ValidatorError } from "./validator.js";
import { isObject, pointerTokens, valueAtPointer } from "./walk.js";

/**
 * Turns the validator's failures for a record into `schema-violation` issues: one per failing value, at the value's exact
 * path, whose message lists what each failing keyword requires, positioned at the value in the record's file. A failure of
 * `required` is at the object, and a member that `additionalProperties` or `unevaluatedProperties` refuses, or whose name a
 * `propertyNames` refuses, at the member. Issues come in the order of the values' first failures.
 */
export function violationIssues(record: ParsedRecord, set: SchemaSet, errors: readonly ValidatorError[]): Issue[] {
  const messages = new Map<string, string[]>();
  for (const error of errors) {
    const message = describeError(record, set, error);
    const found = messages.get(error.at) ?? [];
    if (!found.includes(message)) found.push(message);
    messages.set(error.at, found);
  }
  const issues: Issue[] = [];
  for (const [at, found] of messages) {
    const node = record.nodes.node(at);
    const position = node === undefined ? undefined : record.source.position((node.memberRange ?? node.range).start);
    issues.push(
      makeIssue({
        code: "schema-violation",
        path: record.path,
        at,
        message: found.join("; "),
        ...(position === undefined ? {} : { position }),
      }),
    );
  }
  return issues;
}

/** Describes what one failing keyword requires of the value, from the keyword and the schema's value for it. */
function describeError(record: ParsedRecord, set: SchemaSet, error: ValidatorError): string {
  const file = set.files.get(error.file);
  const keywordValue = file === undefined ? undefined : valueAtPointer(file.value, error.pointer);
  const tokens = pointerTokens(error.pointer) ?? [];
  const parentPointer = tokens.length === 0 ? "" : error.pointer.slice(0, error.pointer.lastIndexOf("/"));
  const parent = file === undefined ? undefined : valueAtPointer(file.value, parentPointer);
  const instance = error.name ? undefined : valueAtPointer(record.value, error.at);
  const keyword = error.keyword === FALSE_SCHEMA_KEYWORD ? "false" : error.keyword.slice(error.keyword.lastIndexOf("/") + 1);
  const where = `${error.file}#${error.pointer}`;
  const text = describeKeyword(keyword, keywordValue, isObject(parent) ? parent : undefined, instance, tokens);
  return `${error.name ? "its name " : ""}${text ?? `fails ${keyword}`} (${where})`;
}

function describeKeyword(
  keyword: string,
  value: Value | undefined,
  parent: ValueObject | undefined,
  instance: Value | undefined,
  tokens: readonly string[],
): string | null {
  switch (keyword) {
    case "false": {
      const holder = tokens.at(-1);
      return holder === "additionalProperties" || holder === "unevaluatedProperties"
        ? "is a member the schema does not allow"
        : holder === "items" || holder === "unevaluatedItems"
          ? "is an item the schema does not allow"
          : "is not allowed here";
    }
    case "type":
      return `must be ${list(Array.isArray(value) ? value : [value as Value], "or", (type) => article(String(type)))}`;
    case "enum":
      return Array.isArray(value) ? `must be one of ${value.map(show).join(", ")}` : null;
    case "const":
      return value === undefined ? null : `must be ${show(value)}`;
    case "required": {
      if (!Array.isArray(value)) return null;
      const missing = value.filter((name) => typeof name === "string" && !(isObject(instance) && Object.hasOwn(instance, name)));
      return `lacks the required member${missing.length === 1 ? "" : "s"} ${list(missing, "and", String)}`;
    }
    case "dependentRequired":
      return "lacks members that another member of it requires";
    case "format": {
      const type = typeof value === "string" ? LOGICAL_TYPES.get(value) : undefined;
      return type === undefined ? null : `must be ${type.description}`;
    }
    case "minimum":
      return `must be at least ${show(value)}`;
    case "maximum":
      return `must be at most ${show(value)}`;
    case "exclusiveMinimum":
      return `must be greater than ${show(value)}`;
    case "exclusiveMaximum":
      return `must be less than ${show(value)}`;
    case "multipleOf":
      return `must be a multiple of ${show(value)}`;
    case "minLength":
      return `must be at least ${show(value)} characters long`;
    case "maxLength":
      return `must be at most ${show(value)} characters long`;
    case "pattern":
      return `must match the pattern ${show(value)}`;
    case "minItems":
      return `must have at least ${show(value)} items`;
    case "maxItems":
      return `must have at most ${show(value)} items`;
    case "uniqueItems":
      return "must not repeat an item";
    case "minProperties":
      return `must have at least ${show(value)} members`;
    case "maxProperties":
      return `must have at most ${show(value)} members`;
    case "contains": {
      const min = typeof parent?.minContains === "number" ? parent.minContains : 1;
      const max = typeof parent?.maxContains === "number" ? parent.maxContains : null;
      const matches = max === null ? `at least ${min}` : min === max ? `exactly ${min}` : `from ${min} to ${max}`;
      return `must have ${matches} item${min === 1 && max === null ? "" : "s"} that match the schema of contains`;
    }
    case "not":
      return "must not match the schema of not";
    case "anyOf":
      return "must match at least one of the schemas of anyOf";
    case "oneOf":
      return "must match exactly one of the schemas of oneOf";
    default:
      return null;
  }
}

/** Writes a value as a message shows it: a string as it is, anything else as JSON. */
function show(value: Value | undefined): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Writes a JSON type with its article: `a string`, `an object`, `null`. */
function article(type: string): string {
  if (type === "null") return "null";
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

/** Joins items as prose: `a`, `a or b`, `a, b or c`. */
function list<T>(items: readonly T[], conjunction: string, write: (item: T) => string): string {
  const written = items.map(write);
  if (written.length <= 1) return written.join("");
  return `${written.slice(0, -1).join(", ")} ${conjunction} ${written.at(-1)}`;
}
