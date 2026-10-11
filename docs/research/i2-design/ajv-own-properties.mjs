// Ajv 8.20.0 with `ownProperties: true`, the option that makes it read only an object's own members, on the inputs that
// docs/design/i2-validate.md's first round of probes found wrong without it: members named like Object.prototype's, and
// `__proto__`, in `properties`, `required`, `dependentRequired` and `additionalProperties`, on ordinary objects from
// JSON.parse and on null-prototype objects.
//
//   node ajv-own-properties.mjs
const m = await import("ajv/dist/2020.js");
const Ajv2020 = m.default.default ?? m.default;

function nullProto(value) {
  if (Array.isArray(value)) return value.map(nullProto);
  if (value !== null && typeof value === "object") {
    const o = Object.create(null);
    for (const k of Object.keys(value)) o[k] = nullProto(value[k]);
    return o;
  }
  return value;
}
const schemas = {
  "properties.toString: string": '{"type":"object","properties":{"toString":{"type":"string"}}}',
  "properties.constructor: string": '{"type":"object","properties":{"constructor":{"type":"string"}}}',
  "properties.__proto__: string": '{"type":"object","properties":{"__proto__":{"type":"string"}}}',
  "required [toString, constructor]": '{"type":"object","required":["toString","constructor"]}',
  "required [__proto__]": '{"type":"object","required":["__proto__"]}',
  "dependentRequired {a: [toString]}": '{"type":"object","dependentRequired":{"a":["toString"]}}',
  "properties {a}, additionalProperties false": '{"type":"object","properties":{"a":{}},"additionalProperties":false}',
};
const instances = {
  "{}": "{}",
  '{"toString": 5}': '{"toString": 5}',
  '{"constructor": 5}': '{"constructor": 5}',
  '{"__proto__": 5}': '{"__proto__": 5}',
  '{"__proto__": "x"}': '{"__proto__": "x"}',
  '{"a": 1}': '{"a": 1}',
};
// What JSON Schema 2020-12 says each pair gives, worked out by hand from the keywords' definitions.
const expected = {
  "properties.toString: string": { "{}": true, '{"toString": 5}': false, '{"constructor": 5}': true, '{"__proto__": 5}': true, '{"__proto__": "x"}': true, '{"a": 1}': true },
  "properties.constructor: string": { "{}": true, '{"toString": 5}': true, '{"constructor": 5}': false, '{"__proto__": 5}': true, '{"__proto__": "x"}': true, '{"a": 1}': true },
  "properties.__proto__: string": { "{}": true, '{"toString": 5}': true, '{"constructor": 5}': true, '{"__proto__": 5}': false, '{"__proto__": "x"}': true, '{"a": 1}': true },
  "required [toString, constructor]": { "{}": false, '{"toString": 5}': false, '{"constructor": 5}': false, '{"__proto__": 5}': false, '{"__proto__": "x"}': false, '{"a": 1}': false },
  "required [__proto__]": { "{}": false, '{"toString": 5}': false, '{"constructor": 5}': false, '{"__proto__": 5}': true, '{"__proto__": "x"}': true, '{"a": 1}': false },
  "dependentRequired {a: [toString]}": { "{}": true, '{"toString": 5}': true, '{"constructor": 5}': true, '{"__proto__": 5}': true, '{"__proto__": "x"}': true, '{"a": 1}': false },
  "properties {a}, additionalProperties false": { "{}": true, '{"toString": 5}': false, '{"constructor": 5}': false, '{"__proto__": 5}': false, '{"__proto__": "x"}': false, '{"a": 1}': true },
};
for (const ownProperties of [false, true]) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, ownProperties });
  let wrong = 0;
  const lines = [];
  for (const [sname, stext] of Object.entries(schemas)) {
    const v = ajv.compile(JSON.parse(stext));
    for (const [iname, itext] of Object.entries(instances)) {
      for (const [kind, value] of [["JSON.parse", JSON.parse(itext)], ["null-prototype", nullProto(JSON.parse(itext))]]) {
        const got = v(value);
        const want = expected[sname][iname];
        if (got !== want) {
          wrong++;
          lines.push(`  wrong: ${sname} on ${kind} ${iname}: ${got ? "valid" : "invalid"}, should be ${want ? "valid" : "invalid"}`);
        }
      }
    }
  }
  console.log(`ajv ownProperties: ${ownProperties}: ${wrong} wrong of ${Object.keys(schemas).length * Object.keys(instances).length * 2}`);
  for (const l of lines) console.log(l);
}
