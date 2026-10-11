import type { Position } from "../text/source-text.js";
import { ISSUE_CODES, type IssueClass, type IssueCode, type Severity } from "./codes.js";

// Deviation from the I1 design, recorded in issue #10: no `candidates` member for an ambiguity yet, since its type is an
// address target, which the address module defines when it lands.
/**
 * A problem vmd found: in a record, in the store's configuration, or in an operation's input. Messages and hints are for
 * people; the code, the severity, the class, `path` and `at` are what programs compare.
 */
export interface Issue {
  readonly code: IssueCode;
  readonly severity: Severity;
  readonly class: IssueClass;
  /** The store path of the record the issue is about, or of the record an address names; null when there is none. */
  readonly path: string | null;
  /**
   * The exact path of the node the issue is attached to: `""` for the record as a whole (a syntax error included), the `$body`
   * for an issue on a block anchor, and null for an issue with no node, such as one about an address.
   */
  readonly at: string | null;
  readonly message: string;
  readonly hint?: string;
  /** Where in the file the issue is, when the record has a source file. */
  readonly position?: Position;
  /** For an issue inside a `$body` or a `$title`, the UTF-8 byte offset into the value that `at` names. */
  readonly offset?: number;
}

/** The members of an issue that its code does not determine. */
export interface IssueInit {
  readonly code: IssueCode;
  readonly path: string | null;
  readonly at: string | null;
  readonly message: string;
  readonly hint?: string;
  readonly position?: Position;
  readonly offset?: number;
  /** The class where the context gives the code one other than its default. */
  readonly class?: IssueClass;
  /** The severity where the context gives the code one other than its default. */
  readonly severity?: Severity;
}

/**
 * Creates an issue, with its code's default severity and class unless `init` names others. The issue is frozen.
 *
 * Throws a `RangeError` when `init` names a severity or a class that its code does not have.
 */
export function makeIssue(init: IssueInit): Issue {
  const info = ISSUE_CODES[init.code];
  const severity = init.severity ?? info.severities[0];
  const issueClass = init.class ?? info.classes[0];
  if (!info.severities.includes(severity)) throw new RangeError(`${init.code} is never a ${severity}`);
  if (!info.classes.includes(issueClass)) throw new RangeError(`${init.code} is never a ${issueClass} issue`);
  const issue: { -readonly [K in keyof Issue]: Issue[K] } = {
    code: init.code,
    severity,
    class: issueClass,
    path: init.path,
    at: init.at,
    message: init.message,
  };
  if (init.hint !== undefined) issue.hint = init.hint;
  if (init.position !== undefined) issue.position = init.position;
  if (init.offset !== undefined) issue.offset = init.offset;
  return Object.freeze(issue);
}

/** Whether any of `issues` is a structural error, which leaves its record without a value view. */
export function hasStructuralError(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.class === "structural");
}

/** One place where a name occurs: the name and the node that carries it. */
export interface NameOccurrence<Node> {
  readonly name: string;
  readonly node: Node;
}

/**
 * Finds the repeats among names, which an issue reports once per occurrence after the first: for occurrences in document
 * order, it returns each node that carries a name an earlier, different node already carried, once, in document order. So a
 * name given on three nodes gives two nodes, and a node whose two names both repeat earlier ones is returned once. A node that
 * carries one name twice is not a repeat of itself. Nodes are compared with `===`, so callers pass exact paths, indexes or the
 * node objects themselves.
 */
export function repeatedNodes<Node>(occurrences: Iterable<NameOccurrence<Node>>): Node[] {
  const firstNodeByName = new Map<string, Node>();
  const repeated = new Set<Node>();
  for (const { name, node } of occurrences) {
    if (!firstNodeByName.has(name)) {
      firstNodeByName.set(name, node);
    } else if (firstNodeByName.get(name) !== node) {
      repeated.add(node);
    }
  }
  return [...repeated];
}
