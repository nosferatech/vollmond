/**
 * Gives the derived anchor of each heading from its slug, the headings in document order: the slug when no earlier heading's
 * candidate is that string, and otherwise the slug followed by `-n`, for the smallest n of 1 or more that no earlier candidate
 * is. An empty slug gives null, no derived anchor, but its candidate (`""`, then `-1`, and so on) still counts as used.
 * Explicit anchors take no part.
 *
 * Costs time linear in the number of headings and the length of the slugs: the search for a repeat's n resumes after the n the
 * slug took last, since every smaller n was found used then and candidates are never released.
 */
export function deriveAnchors(slugs: readonly string[]): (string | null)[] {
  const used = new Set<string>();
  /** The n that each repeated slug took last. */
  const lastSuffix = new Map<string, number>();
  return slugs.map((slug) => {
    let candidate = slug;
    if (used.has(candidate)) {
      let n = (lastSuffix.get(slug) ?? 0) + 1;
      while (used.has(`${slug}-${n}`)) n += 1;
      lastSuffix.set(slug, n);
      candidate = `${slug}-${n}`;
    }
    used.add(candidate);
    return slug === "" ? null : candidate;
  });
}
