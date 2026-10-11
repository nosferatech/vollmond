import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { deriveAnchors } from "./derived-anchors.js";

describe("derived anchors with repeat suffixes", () => {
  test("a repeated slug gets -1, then -2", () => {
    expect(deriveAnchors(["notes", "notes", "notes"])).toEqual(["notes", "notes-1", "notes-2"]);
  });

  test("earlier candidates count as used: Foo, Foo, Foo-1 give foo, foo-1, foo-1-1", () => {
    expect(deriveAnchors(["foo", "foo", "foo-1"])).toEqual(["foo", "foo-1", "foo-1-1"]);
  });

  test("a literal suffix first makes the repeat skip it", () => {
    expect(deriveAnchors(["foo-1", "foo", "foo"])).toEqual(["foo-1", "foo", "foo-2"]);
  });

  test("the smallest unused n is found again after a later heading takes the next one", () => {
    expect(deriveAnchors(["a", "a", "a-2", "a", "a"])).toEqual(["a", "a-1", "a-2", "a-3", "a-4"]);
  });

  test("an empty slug gives no derived anchor, but its candidates still count as used", () => {
    expect(deriveAnchors(["", "", "-1", "tail"])).toEqual([null, null, "-1-1", "tail"]);
    expect(deriveAnchors(["", "-1"])).toEqual([null, "-1"]);
  });

  test("property: gives what the definition gives, searching every n from 1 for each heading", () => {
    /** Step 7 as written: the smallest n of 1 or more whose candidate no earlier heading took. */
    const byDefinition = (slugs: readonly string[]) => {
      const used = new Set<string>();
      return slugs.map((slug) => {
        let candidate = slug;
        for (let n = 1; used.has(candidate); n++) candidate = `${slug}-${n}`;
        used.add(candidate);
        return slug === "" ? null : candidate;
      });
    };
    const slug = fc.constantFrom("", "a", "a-1", "a-2", "a-1-1", "-1", "-1-1", "b", "b-1", "a-10");
    fc.assert(
      fc.property(fc.array(slug, { maxLength: 40 }), (slugs) => {
        expect(deriveAnchors(slugs)).toEqual(byDefinition(slugs));
      }),
      { numRuns: 2000 },
    );
  });

  test("the search resumes from the last n of each slug: ten times the headings cost ten times the work, but for a constant", () => {
    // A spy would record every call's arguments, so `Set.prototype.has` is wrapped by hand, with a counter only.
    let calls = 0;
    const has = Set.prototype.has;
    const probes = (count: number) => {
      calls = 0;
      const anchors = deriveAnchors(Array.from({ length: count }, () => "a"));
      expect(anchors.at(-1)).toBe(`a-${count - 1}`);
      return calls;
    };
    Set.prototype.has = function (this: Set<unknown>, value: unknown) {
      calls += 1;
      return has.call(this, value);
    };
    let counts: number[];
    try {
      counts = [probes(1000), probes(2000), probes(10000)];
    } finally {
      Set.prototype.has = has;
    }
    const [one, two, ten] = counts as [number, number, number];
    expect(two - one).toBeGreaterThan(0);
    expect(ten - one).toBe(9 * (two - one));
  });
});
