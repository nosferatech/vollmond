import type { IssueCode } from "../issue/codes.js";
import { type Issue, makeIssue, repeatedNodes } from "../issue/issue.js";
import type { Position, SourceText } from "../text/source-text.js";
import type { Value, ValueObject } from "../value/value.js";
import { childPath } from "./exact-path.js";
import type { NodeIndex } from "./node-index.js";

/**
 * Where an object being checked comes from, which decides the rules for its top-level `$` members:
 *
 * - `record`: the root of a JSON or YAML record, a section whose `$sections` items are sections too;
 * - `front-matter`: a Markdown record's front matter, whose members are the root's fields and may include the root's `$schema`;
 * - `data-block`: a Markdown section's data block, whose members are the section's fields.
 */
export type ShapeUnit = "record" | "front-matter" | "data-block";

/** What the shape checker needs besides the value. */
export interface ShapeContext {
  /** The record's store path, for the issues. */
  readonly path: string;
  /** Gives the position in the file of the node at an exact path, when the record has a source file. */
  readonly locate?: (at: string) => Position | undefined;
}

/** The members that only a section has. */
const SECTION_MEMBERS = new Set(["$title", "$anchor", "$tags", "$body", "$sections"]);

/**
 * Checks the shape of a parsed object and returns the issues, in document order of the value's members:
 *
 * - on a section, a `$title`, `$body` or `$anchor` that is not a string, `$tags` that is not an array of strings, or
 *   `$sections` that is not an array of objects (`reserved-member-type`, at the member); an item of `$sections` without a
 *   `$title` (`section-title-missing`, at the item); `$key`, or `$schema` below the root (`dollar-member`); and any other
 *   member whose name begins with `$` (`feature-unsupported`);
 * - at the top of front matter or of a data block, `$key` and the section members (`dollar-member`), `$schema` in a data block
 *   (`dollar-member`), and any other `$` member except front matter's `$schema` (`feature-unsupported`);
 * - inside a field's value, where other `$` members are data: an object with a `$ref` member that has other members or a `$ref`
 *   that is not a string (`ref-malformed`, at the object, whose members are still checked), and on any object an `$anchor` that
 *   is not a string or `$tags` that is not an array of strings (`reserved-member-type`);
 * - on any object, each repeat of a tag in its `$tags` after the first (`duplicate-tag`, a warning, at the object); the value
 *   keeps the repeat.
 *
 * `at` is the exact path of the object: `""` for a record or front matter, and the section's for a data block. The root's
 * `$schema` is stored data and is not looked into. Every structural issue is an error; positions come from `context.locate`.
 */
export function checkShape(unit: ShapeUnit, value: ValueObject, at: string, context: ShapeContext): Issue[] {
  const checker = new ShapeChecker(context);
  if (unit === "record") {
    checker.section(value, at, true);
  } else {
    checker.fields(value, at, unit);
  }
  return checker.issues;
}

/**
 * Gives a locator for {@link ShapeContext.locate}: the position of a node's `memberRange` start where it has one, so that an
 * issue on a member points at its key, and of its `range` start otherwise.
 */
export function nodeLocator(index: NodeIndex, source: SourceText): (at: string) => Position | undefined {
  return (at) => {
    const node = index.node(at);
    return node === undefined ? undefined : source.position((node.memberRange ?? node.range).start);
  };
}

class ShapeChecker {
  readonly issues: Issue[] = [];
  readonly #context: ShapeContext;

  constructor(context: ShapeContext) {
    this.#context = context;
  }

  section(section: ValueObject, at: string, isRoot: boolean): void {
    for (const [name, member] of Object.entries(section)) {
      const memberAt = childPath(at, name);
      switch (name) {
        case "$title":
        case "$body":
        case "$anchor":
          if (typeof member !== "string") this.#raise("reserved-member-type", memberAt, `${name} must be a string`);
          break;
        case "$tags":
          this.#tags(member, at, memberAt);
          break;
        case "$sections":
          this.#sections(member, memberAt);
          break;
        case "$schema":
          if (!isRoot) this.#raise("dollar-member", memberAt, "$schema is allowed on the root only");
          break;
        case "$key":
          this.#raise("dollar-member", memberAt, "$key is derived, not stored; set the key with $anchor");
          break;
        default:
          if (name.startsWith("$")) {
            this.#raise("feature-unsupported", memberAt, `${name} is not a section member of this version`);
          } else {
            this.#fieldValue(member, memberAt);
          }
      }
    }
  }

  fields(fields: ValueObject, at: string, unit: "front-matter" | "data-block"): void {
    const where = unit === "front-matter" ? "front matter" : "a data block";
    for (const [name, member] of Object.entries(fields)) {
      const memberAt = childPath(at, name);
      if (name === "$key" || SECTION_MEMBERS.has(name)) {
        this.#raise("dollar-member", memberAt, `${name} is not allowed in ${where}; Markdown has its own syntax for it`);
      } else if (name === "$schema") {
        if (unit === "data-block") this.#raise("dollar-member", memberAt, "$schema is allowed on the root only");
      } else if (name.startsWith("$")) {
        this.#raise("feature-unsupported", memberAt, `${name} is not a member of ${where} in this version`);
      } else {
        this.#fieldValue(member, memberAt);
      }
    }
  }

  #sections(member: Value, memberAt: string): void {
    if (!Array.isArray(member) || !member.every(isObject)) {
      this.#raise("reserved-member-type", memberAt, "$sections must be an array of objects");
    }
    if (!Array.isArray(member)) return;
    member.forEach((item: Value, index: number) => {
      if (!isObject(item)) return;
      const itemAt = childPath(memberAt, index);
      if (!Object.hasOwn(item, "$title")) this.#raise("section-title-missing", itemAt, "a section needs a $title");
      this.section(item, itemAt, false);
    });
  }

  #fieldValue(value: Value, at: string): void {
    if (Array.isArray(value)) {
      value.forEach((item: Value, index: number) => {
        this.#fieldValue(item, childPath(at, index));
      });
      return;
    }
    if (!isObject(value)) return;
    if (Object.hasOwn(value, "$ref") && (Object.keys(value).length !== 1 || typeof value.$ref !== "string")) {
      this.#raise("ref-malformed", at, "a $ref object has only a $ref member, and it is a string");
    }
    for (const [name, member] of Object.entries(value)) {
      const memberAt = childPath(at, name);
      if (name === "$anchor") {
        if (typeof member !== "string") this.#raise("reserved-member-type", memberAt, "$anchor must be a string");
      } else if (name === "$tags") {
        this.#tags(member, at, memberAt);
      } else if (name !== "$ref" || typeof member !== "string") {
        this.#fieldValue(member, memberAt);
      }
    }
  }

  #tags(member: Value, holderAt: string, memberAt: string): void {
    if (!Array.isArray(member) || !member.every((tag: Value) => typeof tag === "string")) {
      this.#raise("reserved-member-type", memberAt, "$tags must be an array of strings");
      return;
    }
    const tags = member as readonly string[];
    for (const index of repeatedNodes(tags.map((name, node) => ({ name, node })))) {
      this.#raise("duplicate-tag", holderAt, `the tag ${JSON.stringify(tags[index])} is repeated`);
    }
  }

  #raise(code: IssueCode, at: string, message: string): void {
    const position = this.#context.locate?.(at);
    this.issues.push(
      makeIssue(
        position === undefined
          ? { code, path: this.#context.path, at, message }
          : { code, path: this.#context.path, at, message, position },
      ),
    );
  }
}

function isObject(value: Value): value is ValueObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
