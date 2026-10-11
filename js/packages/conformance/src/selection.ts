import { type Checked, invalid, isStringList } from "./checked.js";
import { PROFILES } from "./contract.js";
import { idMatches } from "./declaration.js";

/**
 * A narrowed run: the profiles, sections and ids a case must match, each a list of alternatives, or `null` when the run is
 * not narrowed by it. A case must meet every criterion that is not `null`.
 */
export interface Selection {
  readonly profiles: readonly string[] | null;
  readonly sections: readonly string[] | null;
  readonly ids: readonly string[] | null;
}

/** The criteria of a selection as given to the runner, a missing one not narrowing the run. */
export interface SelectionCriteria {
  readonly profiles?: readonly string[] | undefined;
  readonly sections?: readonly string[] | undefined;
  readonly ids?: readonly string[] | undefined;
}

/**
 * Checks the criteria of a selection. It is `null` when no criterion is given, which is a full run. A criterion that is given
 * must list at least one entry, none of them empty, and its profiles must be profiles the suite defines.
 */
export function checkSelection(criteria: SelectionCriteria): Checked<Selection | null> {
  const { profiles, sections, ids } = criteria;
  if (profiles === undefined && sections === undefined && ids === undefined) {
    return { ok: true, value: null };
  }
  for (const [name, list] of [
    ["profiles", profiles],
    ["sections", sections],
    ["ids", ids],
  ] as const) {
    if (list !== undefined && (!isStringList(list) || list.length === 0)) {
      return invalid(`the selection's ${name} must be a list of non-empty strings`);
    }
  }
  const unknown = profiles?.find((profile) => !PROFILES.includes(profile));
  if (unknown !== undefined) {
    return invalid(`the selection names the unknown profile ${unknown}; the profiles are ${PROFILES.join(", ")}`);
  }
  return { ok: true, value: { profiles: profiles ?? null, sections: sections ?? null, ids: ids ?? null } };
}

/**
 * What a selection is matched against: a case's global id, and its profiles and sections. Either of the two lists is absent
 * for a case too malformed to give it, and the criterion on it is then taken as met, so that a selection never hides an error.
 */
export interface SelectableCase {
  readonly id: string;
  readonly profiles?: readonly string[] | undefined;
  readonly spec?: readonly string[] | undefined;
}

/** Whether a selection selects a case. A `null` selection selects every case. */
export function isSelected(selection: Selection | null, candidate: SelectableCase): boolean {
  if (selection === null) {
    return true;
  }
  const { profiles, sections, ids } = selection;
  const { id, profiles: needed, spec } = candidate;
  return (
    (profiles === null || needed === undefined || needed.some((profile) => profiles.includes(profile))) &&
    (sections === null ||
      spec === undefined ||
      spec.some((citation) => sections.some((section) => sectionSelects(section, citation)))) &&
    (ids === null || ids.some((pattern) => idMatches(pattern, id)))
  );
}

/**
 * Whether a section of the selection selects a citation of a case: the same section, or one below it, so `7` selects `7.3`
 * and not `71`. A citation of another specification is words whose last is the section, and the words before it must be equal,
 * so `CommonMark 0.31.2 4` selects `CommonMark 0.31.2 4.3`.
 */
export function sectionSelects(section: string, citation: string): boolean {
  const [sectionName, sectionNumber] = splitCitation(section);
  const [citationName, citationNumber] = splitCitation(citation);
  return sectionName === citationName && (citationNumber === sectionNumber || citationNumber.startsWith(`${sectionNumber}.`));
}

/** Splits a citation into the specification's name and version, empty for the proposal itself, and the section number. */
function splitCitation(citation: string): readonly [string, string] {
  const space = citation.lastIndexOf(" ");
  return space < 0 ? ["", citation] : [citation.slice(0, space), citation.slice(space + 1)];
}
