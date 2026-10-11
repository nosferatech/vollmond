import { describe, expect, test } from "vitest";
import { approximateTokens, formatCount, formatTokens } from "./sizes.js";

describe("formatCount", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [1204, "1,204"],
    [1234567, "1,234,567"],
  ])("writes %d as %s", (count, text) => {
    expect(formatCount(count)).toBe(text);
  });

  test.each([-1, 1.5, Number.NaN])("throws for %d, which is not a count", (count) => {
    expect(() => formatCount(count)).toThrow(RangeError);
  });
});

describe("approximateTokens", () => {
  test("is a quarter of the bytes", () => {
    expect(approximateTokens(10)).toBe(2.5);
  });
});

describe("formatTokens", () => {
  test.each([
    [0, "~0 tok"],
    [360, "~90 tok"],
    [3200, "~800 tok"],
    [3996, "~999 tok"],
    [4800, "~1.2k tok"],
    [8400, "~2.1k tok"],
    [124_000, "~31k tok"],
    [667_000, "~167k tok"],
    [6_000_000, "~1.5M tok"],
    [400_000_000, "~100M tok"],
  ])("writes %d bytes as %s", (bytes, text) => {
    expect(formatTokens(bytes)).toBe(text);
  });

  test.each([
    [3998, "~1.0k tok"],
    [39_800, "~10k tok"],
    [3_998_000, "~1.0M tok"],
  ])("writes %d bytes, which round up to the next unit, in that unit: %s", (bytes, text) => {
    expect(formatTokens(bytes)).toBe(text);
  });

  test.each([-4, 2.5, Number.POSITIVE_INFINITY])("throws for %d, which is not a size", (bytes) => {
    expect(() => formatTokens(bytes)).toThrow(RangeError);
  });
});
