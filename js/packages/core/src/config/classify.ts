import { compileGlob, type GlobTest } from "../storage/path.js";
import { IGNORED_PATH_GLOBS, storePathKind } from "../store/store-path.js";
import type { Collection, StoreConfiguration } from "./configuration.js";

/**
 * What a store path is under a configuration: a path vmd ignores, an asset, or a record with the collections that claim it,
 * in the order of their names. A record that no collection claims is unschematized, and one that several claim is in
 * conflict (`collection-conflict`), and read as if in none.
 */
export type PathClass =
  | { readonly kind: "ignored" }
  | { readonly kind: "asset" }
  | { readonly kind: "record"; readonly collections: readonly Collection[] };

/** A collection's globs, compiled. */
interface CompiledCollection {
  readonly collection: Collection;
  readonly match: readonly GlobTest[];
  readonly exclude: readonly GlobTest[];
}

const IGNORED: PathClass = Object.freeze({ kind: "ignored" });
const ASSET: PathClass = Object.freeze({ kind: "asset" });

/** Sorts store paths into ignored paths, assets and records with their collections, by a configuration's globs. */
export class PathClassifier {
  /**
   * The globs that match exactly the paths {@link PathClassifier.classify} ignores, for a backend's `exclude`: those of
   * `.vmd/` and dotfiles, then the configuration's `ignore`.
   */
  readonly ignoredGlobs: readonly string[];
  readonly #ignore: readonly GlobTest[];
  readonly #collections: readonly CompiledCollection[];

  /** Compiles the configuration's globs, which reading the configuration has checked. */
  constructor(configuration: StoreConfiguration) {
    this.ignoredGlobs = Object.freeze([...IGNORED_PATH_GLOBS, ...configuration.ignore]);
    this.#ignore = configuration.ignore.map(compiled);
    this.#collections = configuration.collections.map((collection) => ({
      collection,
      match: collection.match.map(compiled),
      exclude: collection.exclude.map(compiled),
    }));
  }

  /**
   * Gives what a store path is: ignored when a segment starts with `.` or an `ignore` glob matches it; otherwise a record
   * when it ends in a record's extension, compared exactly, with every collection one of whose `match` globs matches it and
   * none of whose `exclude` globs does; and an asset otherwise, which is never in a collection.
   *
   * Precondition: `path` is a store path, which a backend's check accepts.
   */
  classify(path: string): PathClass {
    const kind = storePathKind(path);
    if (kind === "ignored" || this.#ignore.some((matches) => matches(path))) return IGNORED;
    if (kind === "asset") return ASSET;
    const collections = this.#collections
      .filter((entry) => entry.match.some((matches) => matches(path)) && !entry.exclude.some((matches) => matches(path)))
      .map((entry) => entry.collection);
    return Object.freeze({ kind: "record", collections: Object.freeze(collections) });
  }
}

/** Gives the one collection a record is in: undefined for a record no collection claims, or several do. */
export function collectionOfRecord(found: PathClass): Collection | undefined {
  return found.kind === "record" && found.collections.length === 1 ? found.collections[0] : undefined;
}

/** Compiles a glob that reading the configuration has checked. */
function compiled(glob: string): GlobTest {
  const outcome = compileGlob(glob);
  if (!outcome.ok) throw new Error(`the configuration holds the malformed glob ${JSON.stringify(glob)}`);
  return outcome.value;
}
