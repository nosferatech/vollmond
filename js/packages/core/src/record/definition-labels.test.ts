import { describe, expect, test } from "vitest";
import { definitionLabelsOfRecord } from "./definition-labels.js";

describe("definitionLabelsOfRecord", () => {
  test("lists the labels in the order of the record's Markdown form: each section's $body, then its sections", () => {
    const record = {
      $body: "[root]: /r",
      $sections: [
        { $title: "S", $body: "[s]: /s\n\n[same]: /first", $sections: [{ $title: "U", $body: "[u]: /u" }] },
        { $title: "V", $body: "[same]: /second" },
      ],
    };
    expect(definitionLabelsOfRecord(record)).toEqual(["root", "s", "same", "u", "same"]);
  });

  test("skips a $body or a $sections item of the wrong type, which the shape check reports", () => {
    expect(definitionLabelsOfRecord({ $body: 1, $sections: ["x", { $title: "S", $body: "[a]: /x" }] })).toEqual(["a"]);
  });
});
