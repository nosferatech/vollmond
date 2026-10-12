import { type Fragment, formatFragment, readFragment } from "../address/address.js";
import { resolveAddress, resolveAddressSteps, type StepMatch, type Target } from "../address/resolve.js";
import { titleSlugOf } from "../anchor/title-slug.js";
import type { PathClass } from "../config/classify.js";
import { type Issue, type IssueInit, makeIssue } from "../issue/issue.js";
import type { Outcome } from "../issue/outcome.js";
import { valueAt } from "../record/node-value.js";
import type { ParsedRecord } from "../record/record.js";
import type { ValueObject } from "../value/value.js";
import type { AliasTable } from "./aliases.js";
import { definitionLabelsOf, occurrencesOf } from "./extract.js";
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
      readonly inRecord?: { readonly path: string; readonly fragment: Fragment };
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
   * `alias-shadowed` for its path, or each of its anchors, that is the old name of an alias. `record` is null for a record
   * that cannot be read, which has only its path.
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
    for (const [from, to] of record === null ? [] : this.#aliases.anchorRenamesOf(path)) {
      // A node's explicit and derived anchors may share the name: one warning per node, a block being a node of its own.
      const nodes = new Set<unknown>();
      for (const entry of (record as ParsedRecord).anchors.named(from)) {
        const node = entry.kind === "block" ? entry : entry.at;
        if (nodes.has(node)) continue;
        nodes.add(node);
        issues.push(
          makeIssue({
            code: "alias-shadowed",
            path,
            at: entry.at,
            message: `the anchor ${JSON.stringify(from)} is the old name of an alias to ${JSON.stringify(to)}, so references to it reach this node`,
            hint: "a live anchor wins over an alias; remove the alias, or rename this anchor",
            ...(entry.kind === "block" ? { offset: entry.range.start } : {}),
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
    return { status: "dangling", message: `${shown} matches no node`, inRecord: { path, fragment } };
  }

  /**
   * Resolves a reference that the live store leaves dangling through the aliases: a record alias for a path where nothing is,
   * followed through a chain while nothing is at its `to`; then, in the record that was found, an anchor alias for the
   * fragment's first step, the other steps kept. Gives null when no alias applies, or when the aliases lead nowhere either.
   */
  async #throughAliases(path: string, fragmentText: string | null, live: Resolution): Promise<Resolution | null> {
    let current = live;
    if (live.status === "dangling" && live.missing === true) {
      const seen = new Set([path]);
      let target = path;
      // A chain is no longer than the entries, which bounds the walk if the paths seen ever failed to.
      const bound = this.#aliases.entries.length;
      for (let step = 0, next = this.#aliases.recordMove(target); next !== undefined && step < bound; step += 1) {
        if (seen.has(next)) break;
        seen.add(next);
        target = next;
        if (await this.#exists(target, false)) break;
        next = this.#aliases.recordMove(target);
      }
      if (target === path) return null;
      current = await this.#resolveTarget(target, false, fragmentText);
    }
    if (current.status === "dangling" && current.inRecord !== undefined && current.inRecord.fragment.kind === "semantic") {
      const { path: record, fragment } = current.inRecord;
      const [first, ...rest] = fragment.steps;
      const renamed = this.#aliases.anchorRename(record, first as string);
      if (renamed !== undefined) current = await this.#resolveFragment(record, { kind: "semantic", steps: [renamed, ...rest] });
    }
    // An alias that leads nowhere leaves the reference as dangling as the live store does.
    return current === live || current.status === "dangling" ? null : current;
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
    let labels: string[] | null = null;
    for (const section of record.nodes.sections()) {
      if (section.at === "") continue;
      const title = (valueAt(record, section.at) as ValueObject).$title;
      const text = typeof title === "string" ? title : "";
      // Only a link reference has a label to look up, and it holds a `[`.
      if (text.includes("[")) labels ??= definitionLabelsOf(record);
      slugs.push(titleSlugOf(text, text.includes("[") ? (labels as string[]) : []));
    }
  }
  const map = new Map<string, number>();
  for (const slug of slugs) map.set(slug, (map.get(slug) ?? 0) + 1);
  counts = map;
  slugCountsOf.set(record, counts);
  return counts;
}
