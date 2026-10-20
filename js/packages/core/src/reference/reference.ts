import type { StepMatch, Target } from "../address/resolve.js";
import type { Issue } from "../issue/issue.js";
import type { RefDeclaration } from "../schema/keywords.js";
import type { ByteRange, Position } from "../text/source-text.js";

/**
 * The form of a reference: a Markdown inline link, a link reference definition or an image, in a `$body` or a
 * `$title` of any format; a JSON Reference object, `{"$ref": …}`, in a field's value; or a typed string, a string whose
 * collection's schema declares it a reference with `x-vmd-ref`.
 */
export type ReferenceForm = "link" | "definition" | "image" | "ref-object" | "typed";

/** What a record says about a reference, independent of the record's path and of what the target is. */
export interface ReferenceOccurrence {
  readonly form: ReferenceForm;
  /** The exact path of the node that holds it: the `$ref` object or the typed string, or the `$body` or `$title` of a link. */
  readonly at: string;
  /**
   * For a link, a definition or an image, where it starts in the value at `at`, in UTF-8 bytes of the value: its `[`,
   * or its `!` for an image.
   */
  readonly offset?: number;
  /** The target as written: a Markdown destination's source text, without its angle brackets; a `$ref`'s or a typed string. */
  readonly raw: string;
  /** The URI reference vmd resolves: for Markdown, the destination as CommonMark reads it, entities and escapes decoded. */
  readonly uri: string;
  /** Where `raw` is in the file, in UTF-8 bytes, where the record has a file and `raw` is its bytes there. */
  readonly destination?: ByteRange;
  /**
   * What the collection's schema declares of the reference with `x-vmd-ref`: always for a typed string; for a `$ref` object,
   * where its schema or its `$ref` member's declares it; never for a link.
   */
  readonly declaration?: RefDeclaration;
}

/**
 * What a reference resolves to: `ok`; `dangling`, with no target; `ambiguous`, several targets for a singular
 * reference; `aliased`, through an alias; or `unreadable`, a fragment into a record that readers refuse.
 */
export type ReferenceStatus = "ok" | "dangling" | "ambiguous" | "aliased" | "unreadable";

// Deviation from the I1 design, recorded in issue #15 (its second deviation): the targets of resolution are nodes of records,
// with `at` and `address`; a reference may also name an asset or a directory, which has a path alone.
/** A reference's target: a node or a block anchor of a record, or an asset or a directory, by its path. */
export type ReferenceTarget = Target | { readonly path: string; readonly kind: "asset" | "directory" };

/** A reference of a record, resolved in its store. */
export interface Reference extends ReferenceOccurrence {
  /** Where the reference is: the citing record's path, the node of {@link ReferenceOccurrence.at}, and a link's offset. */
  readonly from: { readonly path: string; readonly at: string; readonly offset?: number };
  readonly status: ReferenceStatus;
  /**
   * Where the reference is in its file, by line and column, as its issues report it: where its destination starts for a
   * Markdown link, the value's position for a typed string or a `$ref`. Absent where the record has no source position for it.
   */
  readonly position?: Position;
  /**
   * The targets: one for an `ok` or `aliased` reference; for an `ambiguous` one, the nodes of the step that matched several,
   * or none for one whose address could cross a level declared `multimap` and was not evaluated; none for a `dangling` or
   * `unreadable` one.
   */
  readonly targets: readonly ReferenceTarget[];
  /** For a record target reached by a semantic path, how each step matched. */
  readonly steps?: readonly (readonly StepMatch[])[];
  /** The issues the reference raised, at their default severities: its status's issue and its warnings. */
  readonly issues: readonly Issue[];
}
