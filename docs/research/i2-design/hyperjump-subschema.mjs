// Whether @hyperjump/json-schema 1.18.0 can validate against a schema that sits inside an unknown keyword, as the per-key
// schemas of `x-vmd-list` do (Appendix A's ticket schema), through a wrapper schema whose `$ref` points there.
//
//   node hyperjump-subschema.mjs
import * as hj from "@hyperjump/json-schema/draft-2020-12";
import { BASIC } from "@hyperjump/json-schema/experimental";

const D = "https://json-schema.org/draft/2020-12/schema";
hj.registerSchema(
  {
    $schema: D,
    type: "object",
    properties: {
      $sections: {
        type: "array",
        "x-vmd-list": { type: "map", keys: ["@key"], items: { "what-is-confirmed": { $ref: "#/$defs/prose-section" } } },
      },
    },
    $defs: { "prose-section": { type: "object", required: ["$title", "$body"] } },
  },
  "https://vmd.invalid/schema/ticket.schema.yaml",
);
const pointer = "/properties/$sections/x-vmd-list/items/what-is-confirmed";
hj.registerSchema({ $schema: D, $ref: `ticket.schema.yaml#${pointer.replaceAll("$", "%24")}` }, "https://vmd.invalid/schema/item-wrapper");
const out = await hj.validate("https://vmd.invalid/schema/item-wrapper", { $title: "What is confirmed" }, BASIC);
console.log(`a section without $body against the per-key schema, through a wrapper: valid ${out.valid}`);
for (const e of out.errors ?? []) console.log(`  ${e.instanceLocation} ${e.keyword.split("/").pop()} ${e.absoluteKeywordLocation}`);
const ok = await hj.validate("https://vmd.invalid/schema/item-wrapper", { $title: "What is confirmed", $body: "x" });
console.log(`the same section with $body: valid ${ok.valid}`);
