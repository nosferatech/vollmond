import { childPath } from "../record/exact-path.js";
import { compileGlob } from "../storage/path.js";
import type { Value, ValueObject } from "../value/value.js";
import type { SchemaLocation } from "./schema-set.js";
import { isObject, isSchemaValue, pointerTokens } from "./walk.js";

/** The extension keywords this version defines (§9.3). */
export const EXTENSION_KEYWORDS: ReadonlySet<string> = new Set(["x-vmd-list", "x-vmd-ref", "x-vmd-summary", "x-vmd-ordered"]);

/** A keyed list's declaration, as `x-vmd-list` gives it. */
export interface ListDeclaration {
  readonly type: "map" | "multimap";
  /** What keys the items: the section key, or a member by its name. */
  readonly key: "@key" | { readonly member: string };
  readonly required: readonly string[];
  /** The JSON Pointer of each per-key schema in its file, by key. */
  readonly items: ReadonlyMap<string, string>;
  /** Whether items with other keys are allowed, or the pointer of their schema. */
  readonly additional: boolean | { readonly pointer: string };
}

/** A typed reference's declaration, as `x-vmd-ref` gives it. */
export interface RefDeclaration {
  /** The collections and globs a target must be in; null for any target. */
  readonly targets: readonly string[] | null;
  readonly cardinality: "one" | "many";
  readonly anchors: "any" | "explicit";
}

/** A problem with an extension keyword: where it is, and what is wrong. */
export interface KeywordProblem {
  readonly pointer: string;
  readonly message: string;
  /**
   * True for a construct this version does not define, which may come from a newer minor version: an `x-vmd-*` keyword, or a
   * member or a value inside `x-vmd-list` or `x-vmd-ref`.
   */
  readonly unsupported?: boolean;
}

/** A problem inside the value of `x-vmd-list` or `x-vmd-ref`, without the keyword's place. */
type MemberProblem = Omit<KeywordProblem, "pointer">;

const LIST_MEMBERS: ReadonlySet<string> = new Set(["type", "keys", "required", "items", "additional"]);
const REF_MEMBERS: ReadonlySet<string> = new Set(["targets", "cardinality", "anchors"]);

/**
 * Checks the extension keywords of one schema object at `pointer`, as far as the object alone can tell: a construct this
 * version does not define (`unsupported`), which is an `x-vmd-*` keyword, a member of `x-vmd-list` or `x-vmd-ref`, or a string
 * value of `type`, `cardinality` or `anchors` outside the set the member defines; and the form of each defined one, whose
 * problems are not `unsupported`. Where a keyword stands, which only the schema's spine shows, is checked elsewhere.
 *
 * - `x-vmd-list`: a mapping of `type` (`map` or `multimap`) and `keys`, both required, and optionally `required`, `items` and
 *   `additional`. `keys` holds exactly one entry, a key member: `@key`, a JSON Pointer of one reference token, or a member
 *   name. `required` is a list of strings, `items` a mapping from keys to schemas, `additional` a boolean or a schema.
 * - `x-vmd-ref`: a mapping of optional `targets`, a list of collection names and globs, `cardinality` (`one` or `many`) and
 *   `anchors` (`any` or `explicit`).
 * - `x-vmd-summary`: a boolean. `x-vmd-ordered`: `asc` or `desc`, beside an `enum`.
 */
export function checkExtensionKeywords(object: ValueObject, pointer: string): KeywordProblem[] {
  const problems: KeywordProblem[] = [];
  const problem = (at: string, message: string) => problems.push({ pointer: at, message });
  const inside = (at: string, keyword: string, found: readonly MemberProblem[]) => {
    for (const { message, unsupported } of found)
      problems.push({ pointer: at, message: `${keyword} ${message}`, ...(unsupported === true ? { unsupported } : {}) });
  };
  for (const [keyword, value] of Object.entries(object)) {
    if (!keyword.startsWith("x-vmd-")) continue;
    const at = childPath(pointer, keyword);
    switch (keyword) {
      case "x-vmd-list":
        inside(at, keyword, listProblems(value));
        break;
      case "x-vmd-ref":
        inside(at, keyword, refProblems(value));
        break;
      case "x-vmd-summary":
        if (typeof value !== "boolean") problem(at, `x-vmd-summary must be true or false, not ${JSON.stringify(value)}`);
        break;
      case "x-vmd-ordered":
        if (value !== "asc" && value !== "desc") problem(at, `x-vmd-ordered must be asc or desc, not ${JSON.stringify(value)}`);
        if (!Object.hasOwn(object, "enum")) problem(at, "x-vmd-ordered stands beside an enum, whose order it gives");
        break;
      default:
        problems.push({
          pointer: at,
          message: `${keyword} is an extension keyword this version of vmd does not define`,
          unsupported: true,
        });
    }
  }
  return problems;
}

/** Reads an `x-vmd-list` that {@link checkExtensionKeywords} accepted, at the schema object at `location`. */
export function readListDeclaration(value: ValueObject, location: SchemaLocation): ListDeclaration {
  const at = childPath(location.pointer, "x-vmd-list");
  const key = (value.keys as readonly string[])[0] as string;
  const items = new Map<string, string>();
  if (isObject(value.items))
    for (const name of Object.keys(value.items)) items.set(name, childPath(childPath(at, "items"), name));
  const additional = value.additional;
  return {
    type: value.type as "map" | "multimap",
    key: key === "@key" ? "@key" : { member: key.startsWith("/") ? ((pointerTokens(key) as string[])[0] as string) : key },
    required: Array.isArray(value.required) ? (value.required as string[]) : [],
    items,
    additional:
      additional === undefined ? true : typeof additional === "boolean" ? additional : { pointer: childPath(at, "additional") },
  };
}

/** Whether two typed references' declarations mean the same: the same `targets` in the same order, `cardinality` and `anchors`. */
export function sameRefDeclaration(one: RefDeclaration, other: RefDeclaration): boolean {
  const sameTargets =
    one.targets === null || other.targets === null
      ? one.targets === other.targets
      : one.targets.length === other.targets.length && one.targets.every((target, index) => target === other.targets?.[index]);
  return sameTargets && one.cardinality === other.cardinality && one.anchors === other.anchors;
}

/** Reads an `x-vmd-ref` that {@link checkExtensionKeywords} accepted. */
export function readRefDeclaration(value: ValueObject): RefDeclaration {
  return {
    targets: Array.isArray(value.targets) ? (value.targets as string[]) : null,
    cardinality: value.cardinality === "many" ? "many" : "one",
    anchors: value.anchors === "explicit" ? "explicit" : "any",
  };
}

function listProblems(value: Value): MemberProblem[] {
  if (!isObject(value)) return [{ message: `must be a mapping, not ${JSON.stringify(value)}` }];
  const problems = unknownMembers(value, LIST_MEMBERS);
  const invalid = (message: string) => problems.push({ message });
  if (value.type === undefined) invalid("has no type: map or multimap");
  else enumerated(problems, "type", value.type, ["map", "multimap"]);
  const keys = value.keys;
  if (keys === undefined) {
    invalid("has no keys: the key member of its items");
  } else if (!Array.isArray(keys) || keys.length === 0 || !keys.every((key) => typeof key === "string")) {
    invalid("keys must be a list of one key member");
  } else if (keys.length > 1) {
    invalid(`keys has ${keys.length} entries: a keyed list has one key member, and composite keys are not supported`);
  } else {
    const key = keys[0] as string;
    if (key.startsWith("/")) {
      const tokens = pointerTokens(key);
      if (tokens === null || tokens.length !== 1) {
        invalid(`key ${JSON.stringify(key)} must be a JSON Pointer of one member, such as "/@key"`);
      }
    }
  }
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) || !value.required.every((key) => typeof key === "string"))
  ) {
    invalid("required must be a list of keys");
  }
  if (value.items !== undefined) {
    if (!isObject(value.items)) {
      invalid("items must be a mapping from keys to schemas");
    } else {
      for (const [name, schema] of Object.entries(value.items)) {
        if (!isSchemaValue(schema)) invalid(`items ${JSON.stringify(name)} must be a schema`);
      }
    }
  }
  if (value.additional !== undefined && !isSchemaValue(value.additional)) {
    invalid("additional must be true, false or a schema");
  }
  return problems;
}

function refProblems(value: Value): MemberProblem[] {
  if (!isObject(value)) return [{ message: `must be a mapping, not ${JSON.stringify(value)}` }];
  const problems = unknownMembers(value, REF_MEMBERS);
  const invalid = (message: string) => problems.push({ message });
  const targets = value.targets;
  if (targets !== undefined) {
    if (!Array.isArray(targets) || !targets.every((target) => typeof target === "string")) {
      invalid("targets must be a list of collection names and globs");
    } else {
      for (const target of targets as string[]) {
        const glob = compileGlob(target);
        if (!glob.ok) invalid(`targets has ${glob.issues[0]?.message}`);
      }
    }
  }
  if (value.cardinality !== undefined) enumerated(problems, "cardinality", value.cardinality, ["one", "many"]);
  if (value.anchors !== undefined) enumerated(problems, "anchors", value.anchors, ["any", "explicit"]);
  return problems;
}

/** The members of `value` that this version does not define, which may come from a newer minor version. */
function unknownMembers(value: ValueObject, known: ReadonlySet<string>): MemberProblem[] {
  return Object.keys(value)
    .filter((name) => !known.has(name))
    .map((name) => ({
      message: `has the member ${JSON.stringify(name)}, which this version of vmd does not define`,
      unsupported: true,
    }));
}

/**
 * Checks a member whose value is one of the two strings `defined`. Another string is a value this version does not define,
 * which may come from a newer minor version; a value that is not a string has the wrong form.
 */
function enumerated(problems: MemberProblem[], member: string, value: Value, defined: readonly [string, string]): void {
  if (typeof value === "string" && defined.includes(value)) return;
  const [first, second] = defined;
  problems.push(
    typeof value === "string"
      ? {
          message: `${member} ${JSON.stringify(value)} is a value this version of vmd does not define, which defines ${first} and ${second}`,
          unsupported: true,
        }
      : { message: `${member} must be ${first} or ${second}, not ${JSON.stringify(value)}` },
  );
}
