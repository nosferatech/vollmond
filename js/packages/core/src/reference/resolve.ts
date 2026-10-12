import { type Fragment, formatFragment, readFragment } from "../address/address.js";
import { resolveAddress, resolveAddressSteps, type StepMatch, type Target } from "../address/resolve.js";
import { titleSlugOf } from "../anchor/title-slug.js";
import type { PathClass } from "../config/classify.js";
import { type Issue, type IssueInit, makeIssue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { definitionLabelsOfRecord } from "../record/definition-labels.js";
import { valueAt } from "../record/node-value.js";
import type { ParsedRecord } from "../record/record.js";
import type { ValueObject } from "../value/value.js";
import type { AliasTable } from "./aliases.js";
import { occurrencesOf } from "./extract.js";
import type { Reference, ReferenceOccurrence, ReferenceStatus, ReferenceTarget } from "./reference.js";
import { resolveReferenceUri } from "./uri.js";

/** What resolving references needs of a store. */
export interface ReferenceStore {
  /** Gives what a store path is under the configuration. */
  classify(path: string): PathClass;
  /** Reads a record as readers do: a failure for one with a structural error or one refused for its schema. */
  record(path: string): Promise<Outcome<ParsedRecord> | null>;
  /**
   * Looks up a path that the listing the resolver was given leaves out, because the configuration ignores it: whether a file
   * is there, or for `directory`, whether a file is below it. A file the backend cannot read is there.
   */
  exists(path: string, directory: boolean): Promise<boolean>;
}

/** What a target path and fragment resolved to, before aliases and warnings. */
type Resolution =
  | { readonly status: "ok"; readonly targets: readonly ReferenceTarget[]; readonly steps?: Steps }
  | { readonly status: "ambiguous"; readonly targets: readonly Target[]; readonly message: string }
  | { readonly status: "unreadable"; readonly path: string; readonly issues: readonly Issue[] }
  | {
      readonly status: "dangling";
      readonly message: string;
      /** The record that exists, with the fragment that matched nothing in it, which an anchor alias may still resolve. */
      readonly inRecord?: { readonly record: ParsedRecord; readonly fragment: Fragment };
      /** Whether nothing is at the path, which a record alias may still resolve. */
      readonly missing?: true;
    };

/** How each step of a semantic path matched, and the record and fragment it was evaluated in. */
interface Steps {
  readonly record: ParsedRecord;
  readonly fragment: Fragment & { readonly kind: "semantic" };
  readonly ways: readonly (readonly StepMatch[])[];
}

/**
 * Resolves the references of a store's records against its files, its records and its aliases, all read once: the files are
 * those of the store's listing without the paths vmd ignores, an ignored path that a reference names is looked up on its own,
 * once, and a record is read as a reader reads it. It is meant for one operation, as a store is.
 */
export class ReferenceResolver {
  readonly #store: ReferenceStore;
  readonly #files: ReadonlySet<string>;
  readonly #directories: ReadonlySet<string>;
  readonly #aliases: AliasTable;
  /** What the store said of each ignored path looked up, by `path` for a file and `path/` for a directory. */
  readonly #lookedUp = new Map<string, Promise<boolean>>();
  /** Each record's anchor aliases, those under its path and its old paths, by the record's path, found when first needed. */
  readonly #anchorRenames = new Map<string, Promise<ReadonlyMap<string, string>>>();
  /** Where the record alias chains walked end, by the paths they started at and passed. */
  readonly #recordChainEnds: RecordChainEnds = { starts: new Map(), acyclic: new Map() };
  /** The live name that the anchor alias chain from each name reaches in a record, or null, by the record's path and the name. */
  readonly #anchorChainEnds = new Map<string, Map<string, string | null>>();

  /** Takes the store paths of the store's files but those vmd ignores, and its aliases. */
  constructor(store: ReferenceStore, files: Iterable<string>, aliases: AliasTable) {
    this.#store = store;
    this.#files = new Set(files);
    const directories = new Set<string>([""]);
    for (const path of this.#files) {
      for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1)) {
        directories.add(path.slice(0, slash));
      }
    }
    this.#directories = directories;
    this.#aliases = aliases;
  }

  /**
   * Whether a file is at `path`, or for `directory` below it: in the listing, or else, for an ignored file or any directory,
   * by looking it up once.
   */
  async #exists(path: string, directory: boolean): Promise<boolean> {
    if (directory ? this.#directories.has(path) : this.#files.has(path)) return true;
    // A file is left out of the listing only when the configuration ignores it. A directory is left out when it holds only
    // ignored files, which a dotfile or a filename pattern can make of any directory, so a missing one is always looked up.
    if (!directory && this.#store.classify(path).kind !== "ignored") return false;
    const key = directory ? `${path}/` : path;
    let found = this.#lookedUp.get(key);
    if (found === undefined) {
      found = this.#store.exists(path, directory);
      this.#lookedUp.set(key, found);
    }
    return found;
  }

  /** The store paths of every record among the store's files, in the order given. */
  recordPaths(): string[] {
    return [...this.#files].filter((path) => this.#store.classify(path).kind === "record");
  }

  /**
   * Gives the references a record makes, in document order, each resolved, with its issues; with `under`, those in that node
   * and below it. References that leave the store are not given.
   */
  async referencesOf(record: ParsedRecord, under = ""): Promise<Reference[]> {
    const references: Reference[] = [];
    for (const occurrence of occurrencesOf(record, under)) {
      const reference = await this.resolve(record, occurrence);
      if (reference !== null) references.push(reference);
    }
    return references;
  }

  /**
   * Gives the issues of a record that `check` reports for its references: those of each reference it makes, and an
   * `alias-shadowed` for its path that is the old name of a record alias, and for each node or block anchor that a first step
   * named by the old name of one of the record's anchor aliases reaches, those under its old paths included: an anchor, a key
   * of the root, as a JSON or YAML record's top-level key or a Markdown record's front matter key, or a child section of the
   * root by its key. `record` is null for a record that cannot be read, which has only its path.
   */
  async issuesOf(path: string, record: ParsedRecord | null): Promise<Issue[]> {
    const issues: Issue[] = [];
    const moved = this.#aliases.recordMove(path);
    if (moved !== undefined) {
      issues.push(
        makeIssue({
          code: "alias-shadowed",
          path,
          at: "",
          message: `${path} is the old path of an alias to ${moved}, so references to it reach this record, not ${moved}`,
          hint: "a live record wins over an alias; remove the alias, or move this record",
        }),
      );
    }
    for (const [from, to] of record === null ? [] : await this.#anchorRenamesOf(path)) {
      // One warning per node the name reaches: a node that a step matches several ways is one match.
      for (const target of firstStepTargets(record as ParsedRecord, from)) {
        issues.push(
          makeIssue({
            code: "alias-shadowed",
            path,
            at: target.at,
            message: `the name ${JSON.stringify(from)}, which a link's first step reaches here, is the old name of an alias to ${JSON.stringify(to)}, so references to it reach this node`,
            hint: "a live name wins over an alias; remove the alias, or rename this node's anchor or key",
            ...(target.range === undefined ? {} : { offset: target.range.start }),
          }),
        );
      }
    }
    if (record !== null) for (const reference of await this.referencesOf(record)) issues.push(...reference.issues);
    return issues;
  }

  /** Resolves one reference of a record, or gives null for one that leaves the store. */
  async resolve(citing: ParsedRecord, occurrence: ReferenceOccurrence): Promise<Reference | null> {
    const uri = resolveReferenceUri(citing.path, occurrence.uri);
    if (uri.kind === "outside") return null;
    const resolution =
      uri.kind === "invalid"
        ? ({ status: "dangling", message: uri.message } as const)
        : await this.#resolveTarget(uri.path, uri.directory, uri.fragment);
    let final: Resolution = resolution;
    let aliased = false;
    if (resolution.status === "dangling" && uri.kind === "store") {
      const through = await this.#throughAliases(uri.path, uri.fragment, resolution);
      if (through !== null) {
        final = through;
        aliased = true;
      }
    }
    return this.#reference(citing, occurrence, final, aliased);
  }

  /** Resolves a target path and fragment against the live store. */
  async #resolveTarget(path: string, directory: boolean, fragmentText: string | null): Promise<Resolution> {
    if (directory) {
      return (await this.#exists(path, true))
        ? { status: "ok", targets: [{ path, kind: "directory" }] }
        : { status: "dangling", message: `the store has no directory ${path}/`, missing: true };
    }
    if (!(await this.#exists(path, false))) {
      if (await this.#exists(path, true)) return { status: "ok", targets: [{ path, kind: "directory" }] };
      return { status: "dangling", message: `the store has no file ${path}`, missing: true };
    }
    if (this.#store.classify(path).kind !== "record") return { status: "ok", targets: [{ path, kind: "asset" }] };
    const read = readFragment(fragmentText ?? "");
    if ("problem" in read) {
      return { status: "dangling", message: `its fragment ${JSON.stringify(fragmentText)} is not an address: ${read.problem}` };
    }
    const fragment = read.fragment;
    if (fragment === null) return { status: "ok", targets: [{ path, at: "", address: "" }] };
    return this.#resolveFragment(path, fragment);
  }

  /** Resolves a fragment in a record that exists, as a singular address. */
  async #resolveFragment(path: string, fragment: Fragment): Promise<Resolution> {
    const record = await this.#store.record(path);
    if (record === null) return { status: "dangling", message: `the store has no record ${path}`, missing: true };
    if (!record.ok) return { status: "unreadable", path, issues: record.issues };
    // TODO(#24): references resolve in the parsed record alone, as in a record without a schema: no step goes through a keyed
    // list by key and none is proved singular. Typed references bring both, with ref-ambiguous for a reference the proof
    // refuses.
    const resolved = resolveAddressSteps(record.value, fragment, "singular");
    const shown = `${path}${formatFragment(fragment)}`;
    if (resolved.ok) {
      const { targets, steps: ways } = resolved.value;
      return fragment.kind === "semantic"
        ? { status: "ok", targets, steps: { record: record.value, fragment, ways } }
        : { status: "ok", targets };
    }
    const issue = resolved.issues[0] as Issue;
    if (issue.code === "address-ambiguous") {
      return { status: "ambiguous", targets: issue.candidates ?? [], message: `${shown} matches several nodes` };
    }
    return { status: "dangling", message: `${shown} matches no node`, inRecord: { record: record.value, fragment } };
  }

  /**
   * Resolves a reference that the live store leaves dangling through the aliases: for a path where nothing is, the chain of
   * record aliases from it, which stops at the first path where a file is; then, in the record that was found, when the
   * fragment's first step reaches nothing there, the chain of anchor aliases from that step, among those recorded under the
   * record's path and its old paths, which stops at the first name that a first step reaches in the record; the other steps are
   * kept. A first step that reaches something is live and wins over its aliases, whatever the later steps match. Gives null
   * when no alias applies, or when the aliases lead nowhere either.
   */
  async #throughAliases(path: string, fragmentText: string | null, live: Resolution): Promise<Resolution | null> {
    let current = live;
    if (live.status === "dangling" && live.missing === true) {
      const target = await this.#recordChainEnd(path);
      if (target === path) return null;
      current = await this.#resolveTarget(target, false, fragmentText);
    }
    if (current.status === "dangling" && current.inRecord !== undefined && current.inRecord.fragment.kind === "semantic") {
      const { record, fragment } = current.inRecord;
      const [first, ...rest] = fragment.steps as [string, ...string[]];
      const renamed = firstStepReaches(record, first) ? null : await this.#anchorChainLiveEnd(record, first);
      if (renamed !== null) {
        current = await this.#resolveFragment(record.path, { kind: "semantic", steps: [renamed, ...rest] });
      }
    }
    // An alias that leads nowhere leaves the reference as dangling as the live store does.
    return current === live || current.status === "dangling" ? null : current;
  }

  /**
   * Gives where the record alias chain from `path` ends, which stops at the first path where a file is. A chain without a
   * cycle is walked once, whichever of its paths references start at.
   */
  #recordChainEnd(path: string): Promise<string> {
    const moves: AliasChain = {
      next: (from) => this.#aliases.recordMove(from),
      live: (to) => this.#exists(to, false),
    };
    return endOfAliasChain(path, moves, this.#aliases.entries.length, this.#recordChainEnds);
  }

  /**
   * Gives the live name that the anchor alias chain from `name` reaches in a record, among the record's anchor aliases: the
   * first name after `name` that a first step reaches in the record, or null when the chain ends before one. `name` must be one
   * that no first step reaches in the record. Each name of a record's chains is walked from once, however many references
   * start at it or pass it.
   */
  async #anchorChainLiveEnd(record: ParsedRecord, name: string): Promise<string | null> {
    let ends = this.#anchorChainEnds.get(record.path);
    if (ends === undefined) {
      ends = new Map();
      this.#anchorChainEnds.set(record.path, ends);
    }
    const renames = await this.#anchorRenamesOf(record.path);
    const chain: AliasChain = { next: (from) => renames.get(from), live: (to) => firstStepReaches(record, to) };
    return liveEndOfAliasChain(name, chain, this.#aliases.entries.length, ends);
  }

  /**
   * Gives a record's anchor aliases, from each old name to the new one: those recorded under its own path and under its old
   * paths, the paths whose record aliases lead to it through paths where no file is, the last line of the file counting for an
   * old name. An old path where a file is again is left out, since its anchor aliases are that file's. Found once a record.
   */
  #anchorRenamesOf(path: string): Promise<ReadonlyMap<string, string>> {
    let renames = this.#anchorRenames.get(path);
    if (renames === undefined) {
      renames = this.#anchorAliasPaths(path).then((paths) => this.#aliases.anchorRenamesOf(paths));
      this.#anchorRenames.set(path, renames);
    }
    return renames;
  }

  /** Finds the store paths whose anchor aliases are a record's, its own path first, as {@link #anchorRenamesOf} takes them. */
  async #anchorAliasPaths(path: string): Promise<readonly string[]> {
    const paths = [path];
    const seen = new Set(paths);
    // Back along the record aliases: a path leads to the record when its alias leads to one that does, nothing being at it.
    for (let index = 0; index < paths.length; index += 1) {
      for (const from of this.#aliases.recordMovesTo(paths[index] as string)) {
        if (seen.has(from)) continue;
        seen.add(from);
        if (!(await this.#exists(from, false))) paths.push(from);
      }
    }
    return paths;
  }

  /** Builds a reference from its resolution, with its issues. */
  #reference(citing: ParsedRecord, occurrence: ReferenceOccurrence, resolution: Resolution, aliased: boolean): Reference {
    const from = {
      path: citing.path,
      at: occurrence.at,
      ...(occurrence.offset === undefined ? {} : { offset: occurrence.offset }),
    };
    const issue = (init: Omit<IssueInit, "path" | "at" | "offset" | "position">) =>
      makeIssue({ ...init, ...from, ...positionOf(citing, occurrence) });
    const shown = JSON.stringify(occurrence.raw);
    const issues: Issue[] = [];
    let status: ReferenceStatus = resolution.status;
    let targets: readonly ReferenceTarget[] = [];
    let steps: readonly (readonly StepMatch[])[] | undefined;
    switch (resolution.status) {
      case "ok":
        targets = resolution.targets;
        steps = resolution.steps?.ways;
        if (aliased) {
          status = "aliased";
          const now = targets.map(targetText).join(", ");
          issues.push(
            issue({
              code: "ref-aliased",
              message: `${shown} resolves only through an alias, to ${now}`,
              hint: "write the current address in the reference",
            }),
          );
        }
        if (resolution.steps !== undefined) {
          const warning = derivedAnchorWarning(resolution.steps);
          if (warning !== null) issues.push(issue({ ...warning, message: `${shown} ${warning.message}` }));
        }
        break;
      case "ambiguous":
        targets = resolution.targets;
        issues.push(
          issue({
            code: "ref-ambiguous",
            message: `${shown}: ${resolution.message}`,
            hint: "use the address of the node you mean, or give it an explicit anchor",
            candidates: resolution.targets,
          }),
        );
        break;
      case "unreadable":
        issues.push(
          issue({
            code: "ref-target-unreadable",
            message: `${shown} points into ${resolution.path}, which cannot be read, so its target cannot be resolved: ${resolution.issues[0]?.message ?? ""}`,
            hint: `fix ${resolution.path} as its own issues say; a reference to the record itself, without a fragment, needs only the file`,
          }),
        );
        break;
      case "dangling":
        issues.push(issue({ code: "ref-dangling", message: `${shown}: ${resolution.message}` }));
        break;
    }
    return Object.freeze({
      ...occurrence,
      from: Object.freeze(from),
      status,
      targets: Object.freeze([...targets]),
      ...(steps === undefined ? {} : { steps }),
      issues: Object.freeze(issues),
    });
  }
}

/** A kind of alias chain: the alias of each name, and the names that end a chain. */
interface AliasChain {
  /** Gives the name that the alias of `from` leads to, or undefined when no alias has `from` as its old name. */
  next(from: string): string | undefined;
  /** Whether `to` is live, which ends a chain there. */
  live(to: string): boolean | Promise<boolean>;
}

/** The ends of record alias chains a resolver has walked, by the path a walk started at, or passed. */
interface RecordChainEnds {
  /** The end of the walk from each path it started at, cycle or not. */
  readonly starts: Map<string, string>;
  /**
   * The end of every walk that ended without a cycle, by the path it started at and by each path it passed: the end from any
   * of those paths, since a walk without a cycle goes from each of them the same way to the same end.
   */
  readonly acyclic: Map<string, string>;
}

/**
 * Follows a chain of aliases from `start`: from each name to the one its alias leads to, until a name that is live, one that
 * no alias has as its old name, or one the chain has passed, which ends a cycle. Gives the last name reached, which is `start`
 * when no alias has it as its old name, live or not. A walk takes at most `bound` steps, which bounds it if the names seen
 * ever failed to; one cut short counts as a cycle.
 *
 * `ends` keeps the end of each walk under its start, and the end of a walk without a cycle under every name it passed too; a
 * walk that reaches a name kept so stops there with that end. In a cycle the last name reached depends on where the walk
 * started, so a walk with one keeps only its start's. A walk passes no live name, and stops at a live name before looking at
 * what is kept, so the start, never checked for being live, is the only live name whose end is kept. A kept end that is
 * `start` is passed by: the chain from there comes back to `start`, which is a cycle.
 */
async function endOfAliasChain(start: string, chain: AliasChain, bound: number, ends: RecordChainEnds): Promise<string> {
  const kept = ends.starts.get(start) ?? ends.acyclic.get(start);
  if (kept !== undefined) return kept;
  const seen = new Set([start]);
  const passed: string[] = [];
  let end = start;
  let cycle = false;
  for (let step = 0, next = chain.next(start); next !== undefined; step += 1) {
    if (seen.has(next) || step >= bound) {
      cycle = true;
      break;
    }
    if (await chain.live(next)) {
      end = next;
      break;
    }
    const known = ends.acyclic.get(next);
    if (known !== undefined && known !== start) {
      end = known;
      break;
    }
    seen.add(next);
    passed.push(next);
    end = next;
    next = chain.next(next);
  }
  ends.starts.set(start, end);
  if (!cycle) for (const name of [start, ...passed]) ends.acyclic.set(name, end);
  return end;
}

/**
 * Follows a chain of aliases from `start` as {@link endOfAliasChain} does, but gives only the live name it stops at, or null
 * when it ends before one: at a name that no alias has as its old name, or at a cycle. `start` must not be live. `known` keeps
 * that result of every walk, by the name it started at and by each name it passed, and a walk that reaches a name in it stops
 * there with its result.
 *
 * Keeping it is sound because no name kept is live: the start is not, and a walk passes only names that are not. From each
 * name a walk passed, the chain goes the same way to the same end, and a cycle, which contains no live name, ends as null from
 * every name on it.
 */
async function liveEndOfAliasChain(
  start: string,
  chain: AliasChain,
  bound: number,
  known: Map<string, string | null>,
): Promise<string | null> {
  if (known.has(start)) return known.get(start) ?? null;
  const seen = new Set([start]);
  const passed: string[] = [];
  let end: string | null = null;
  for (let step = 0, next = chain.next(start); next !== undefined && step < bound; step += 1) {
    if (seen.has(next)) break;
    if (await chain.live(next)) {
      end = next;
      break;
    }
    if (known.has(next)) {
      end = known.get(next) ?? null;
      break;
    }
    seen.add(next);
    passed.push(next);
    next = chain.next(next);
  }
  for (const name of [start, ...passed]) known.set(name, end);
  return end;
}

/** Whether a semantic path whose only step is `name` matches anything in a record: a node, or a block anchor. */
function firstStepReaches(record: ParsedRecord, name: string): boolean {
  return firstStepTargets(record, name).length > 0;
}

/** Gives what a semantic path whose only step is `name` matches in a record, nodes and block anchors, in document order. */
function firstStepTargets(record: ParsedRecord, name: string): readonly Target[] {
  const found = resolveAddress(record, { kind: "semantic", steps: [name] }, "selector");
  return found.ok ? found.value : [];
}

/** A target as a message names it. */
function targetText(target: ReferenceTarget): string {
  return "kind" in target ? target.path : `${target.path}${target.address}`;
}

/** Where a reference's issue is in the file: its destination, or else the start of the node that holds it. */
function positionOf(record: ParsedRecord, occurrence: ReferenceOccurrence): Pick<IssueInit, "position"> {
  const offset = occurrence.destination?.start ?? record.nodes.node(occurrence.at)?.range.start;
  return offset === undefined ? {} : { position: record.source.position(offset) };
}

// Deviation from the I2 design, recorded in issue #24: `ref-retargeted` is not raised, since it compares a reference with the
// previous index, which the local index brings.
/** The ways of matching a step that derive from a title, which change when the title changes. */
const TITLE_DERIVED: ReadonlySet<StepMatch> = new Set(["anchor-derived", "key-title"]);

/**
 * Gives the warning of a reference whose first step matched only through its title, by a derived anchor or a key that is the
 * title's slug: `ref-derived-repeat` when another heading of the record has the same slug, so that a change to either
 * renumbers the other, and `ref-derived-anchor` otherwise. Null when the step matched another way too.
 */
function derivedAnchorWarning(steps: Steps): Pick<IssueInit, "code" | "message" | "hint"> | null {
  const first = steps.ways[0];
  if (first === undefined || first.length === 0 || !first.every((way) => TITLE_DERIVED.has(way))) return null;
  const step = steps.fragment.steps[0] as string;
  const firstStep = resolveAddress(steps.record, { kind: "semantic", steps: [step] }, "singular");
  const at = firstStep.ok ? (firstStep.value[0] as Target).at : "";
  const derived = steps.record.anchors.of(at).find((entry) => entry.kind === "derived" && entry.name === step);
  const slug = derived?.slug ?? step;
  const hint = "give the heading an explicit anchor, and reference it by that";
  if ((slugCounts(steps.record).get(slug) ?? 0) > 1) {
    return {
      code: "ref-derived-repeat",
      message: `reaches its target through the title-derived name ${JSON.stringify(step)}, whose slug ${JSON.stringify(slug)} another heading of the record has, so that a change to either renumbers the other`,
      hint,
    };
  }
  return {
    code: "ref-derived-anchor",
    message: `reaches its target through the title-derived name ${JSON.stringify(step)}, which changes when the title does`,
    hint,
  };
}

const slugCountsOf = new WeakMap<ParsedRecord, ReadonlyMap<string, number>>();

/**
 * Counts the headings of a record by slug: a Markdown record's headings that have a derived anchor, and a JSON or YAML
 * record's sections but the root, by the slug of their titles.
 */
function slugCounts(record: ParsedRecord): ReadonlyMap<string, number> {
  let counts = slugCountsOf.get(record);
  if (counts !== undefined) return counts;
  const slugs: string[] = [];
  if (record.format === "md") {
    for (const entry of record.anchors.anchors) if (entry.kind === "derived" && entry.slug !== undefined) slugs.push(entry.slug);
  } else {
    let labels: readonly string[] | null = null;
    for (const section of record.nodes.sections()) {
      if (section.at === "") continue;
      const title = (valueAt(record, section.at) as ValueObject).$title;
      const text = typeof title === "string" ? title : "";
      // Only a link reference has a label to look up, and it holds a `[`.
      if (text.includes("[")) labels ??= definitionLabelsOfRecord(record.value);
      slugs.push(titleSlugOf(text, text.includes("[") ? (labels as readonly string[]) : []));
    }
  }
  const map = new Map<string, number>();
  for (const slug of slugs) map.set(slug, (map.get(slug) ?? 0) + 1);
  counts = map;
  slugCountsOf.set(record, counts);
  return counts;
}
