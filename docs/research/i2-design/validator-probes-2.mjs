// Second round of validator probes for docs/design/i2-validate.md: the `__proto__` member, formats over numbers and strings,
// keywords vmd adds, the errors of a failing `oneOf`, references between schema files, and speed, for Ajv 8.20.0,
// json-schema-library 11.6.5 and @hyperjump/json-schema 1.18.0.
//
//   node validator-probes-2.mjs
//
// Every line prints what the library did. Nothing here is a vmd rule; the design says what core does about each.
import { performance } from "node:perf_hooks";

const ajvModule = await import("ajv/dist/2020.js");
const Ajv2020 = ajvModule.default.default ?? ajvModule.default;
const jsl = await import("json-schema-library");
const hj = await import("@hyperjump/json-schema/draft-2020-12");
const hjx = await import("@hyperjump/json-schema/experimental");
const annotations = await import("@hyperjump/json-schema/annotations/experimental");
const annotated = await import("@hyperjump/json-schema/annotated-instance/experimental");

function line(label, value) {
  console.log(`${label.padEnd(70)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}
// Core's values: null-prototype objects. JSON.parse gives `__proto__` as an own member of an ordinary object.
function nullProto(value) {
  if (Array.isArray(value)) return value.map(nullProto);
  if (value !== null && typeof value === "object") {
    const o = Object.create(null);
    for (const k of Object.keys(value)) o[k] = nullProto(value[k]);
    return o;
  }
  return value;
}
const protoSchema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"}}}');
const cases = [
  ["JSON.parse {__proto__: 5}", JSON.parse('{"__proto__": 5}'), false],
  ["null-prototype {__proto__: 5}", nullProto(JSON.parse('{"__proto__": 5}')), false],
  ["null-prototype {__proto__: 'x'}", nullProto(JSON.parse('{"__proto__": "x"}')), true],
  ["null-prototype {constructor: 5}", nullProto(JSON.parse('{"constructor": 5}')), false],
  ["null-prototype {} ", nullProto({}), true],
];

// --- __proto__ and constructor as members ---
{
  // Without ownProperties, Ajv reads inherited members, so `{"__proto__": 5}` from JSON.parse fails on the inherited
  // `constructor`, not on `__proto__`; ajv-own-properties.mjs separates the two.
  for (const ownProperties of [false, true]) {
    const v = new Ajv2020({ allErrors: true, strict: false, ownProperties }).compile(protoSchema);
    for (const [label, value, expected] of cases) {
      line(`ajv${ownProperties ? " ownProperties" : ""} ${label} (expected ${expected ? "valid" : "invalid"})`, v(value) ? "valid" : "invalid");
    }
  }
  const node = jsl.compileSchema(protoSchema);
  for (const [label, value, expected] of cases) line(`jsl ${label} (expected ${expected ? "valid" : "invalid"})`, node.validate(value).valid ? "valid" : "invalid");
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...protoSchema, properties: JSON.parse('{"__proto__":{"type":"string"},"constructor":{"type":"string"}}') }, "https://vmd.invalid/proto");
  for (const [label, value, expected] of cases) {
    try {
      const out = await hj.validate("https://vmd.invalid/proto", value);
      line(`hyperjump ${label} (expected ${expected ? "valid" : "invalid"})`, out.valid ? "valid" : "invalid");
    } catch (e) {
      line(`hyperjump ${label}`, `throws: ${e.message.slice(0, 60)}`);
    }
  }
}

// --- required and properties with names an object's prototype has ---
{
  const required = { type: "object", required: ["toString", "constructor"] };
  const properties = JSON.parse('{"type":"object","properties":{"toString":{"type":"string"}}}');
  const empty = [
    ["JSON.parse {}", JSON.parse("{}")],
    ["null-prototype {}", Object.create(null)],
  ];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const rv = ajv.compile(required);
  const pv = ajv.compile(properties);
  const own = new Ajv2020({ allErrors: true, strict: false, ownProperties: true });
  const rvo = own.compile(required);
  const pvo = own.compile(properties);
  const rn = jsl.compileSchema(required);
  const pn = jsl.compileSchema(properties);
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...required }, "https://vmd.invalid/required");
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...properties }, "https://vmd.invalid/properties");
  for (const [label, value] of empty) {
    line(`ajv required [toString, constructor] vs ${label} (expected invalid)`, rv(value) ? "valid" : "invalid");
    line(`ajv properties.toString: string vs ${label} (expected valid)`, pv(value) ? "valid" : "invalid");
    line(`ajv ownProperties required [toString, constructor] vs ${label} (expected invalid)`, rvo(value) ? "valid" : "invalid");
    line(`ajv ownProperties properties.toString: string vs ${label} (expected valid)`, pvo(value) ? "valid" : "invalid");
    line(`jsl required [toString, constructor] vs ${label} (expected invalid)`, rn.validate(value).valid ? "valid" : "invalid");
    line(`jsl properties.toString: string vs ${label} (expected valid)`, pn.validate(value).valid ? "valid" : "invalid");
    const hr = await hj.validate("https://vmd.invalid/required", value);
    const hp = await hj.validate("https://vmd.invalid/properties", value);
    line(`hyperjump required [toString, constructor] vs ${label} (expected invalid)`, hr.valid ? "valid" : "invalid");
    line(`hyperjump properties.toString: string vs ${label} (expected valid)`, hp.valid ? "valid" : "invalid");
  }
}

// --- a format over numbers and strings (int64), and an unknown format ---
const INT = /^-?(0|[1-9][0-9]*)$/;
const int64 = (d) => (typeof d === "number" ? Number.isInteger(d) : typeof d === "string" ? INT.test(d) : true);
const formatSchema = { type: "array", items: { type: ["integer", "string"], format: "int64" } };
const formatData = ["42", 7, "007", 1.5, "abc"];
{
  // createError needs a code that the draft's errors define: an unknown one throws ("name is not defined").
  const draft = jsl.extendDraft(jsl.draft2020, {
    errors: { "format-int64-error": "Value {{value}} at {{pointer}} is not an int64" },
    formats: {
      int64: ({ node, pointer, data }) => (int64(data) ? undefined : node.createError("format-int64-error", { value: data, pointer, schema: node.schema })),
    },
  });
  const node = jsl.compileSchema(formatSchema, { drafts: [draft] });
  line("jsl int64 over [\"42\",7,\"007\",1.5,\"abc\"]", node.validate(formatData).errors.map((e) => `${e.data.pointer} ${e.code}`));
  const unknown = jsl.compileSchema({ type: "string", format: "no-such-format" });
  line("jsl unknown format", unknown.validate("x").valid ? "valid (annotation)" : unknown.validate("x").errors.map((e) => e.code));
  line("jsl formats of draft2020 by default", Object.keys(jsl.draft2020.formats));
  const host = jsl.compileSchema({ type: "string", format: "hostname" });
  line("jsl format hostname on 'not a host!'", host.validate("not a host!").valid ? "valid (no check)" : "invalid");
}
{
  hjx.addFormat({ id: "https://vmd.invalid/format/int64", handler: int64 });
  hjx.setFormatHandler("https://json-schema.org/keyword/draft-2020-12/format", "int64", "https://vmd.invalid/format/int64");
  hj.setShouldValidateFormat(true);
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...formatSchema }, "https://vmd.invalid/int64");
  const out = await hj.validate("https://vmd.invalid/int64", formatData, hjx.BASIC);
  line("hyperjump int64 over [\"42\",7,\"007\",1.5,\"abc\"]", (out.errors ?? []).map((e) => `${e.instanceLocation} ${e.keyword.split("/").pop()}`));
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "string", format: "no-such-format" }, "https://vmd.invalid/unknown-format");
  try {
    const u = await hj.validate("https://vmd.invalid/unknown-format", "x");
    line("hyperjump unknown format (format validation on)", u.valid ? "valid" : "invalid");
  } catch (e) {
    line("hyperjump unknown format (format validation on)", `throws: ${e.message.slice(0, 60)}`);
  }
}

// --- keywords vmd adds: accepted, and seen where? ---
const vmdSchema = {
  type: "object",
  properties: {
    a: { oneOf: [{ const: 1, "x-vmd-probe": "one-fails" }, { const: 2, "x-vmd-probe": "one-passes" }] },
    d: { type: "array", items: { "x-vmd-probe": "item" } },
  },
};
{
  const node = jsl.compileSchema(vmdSchema);
  line("jsl unknown keyword x-vmd-probe: validate", node.validate(nullProto({ a: 2, d: [1] })).valid);
  const child = node.getNode("#/a", nullProto({ a: 2, d: [1] }));
  line("jsl getNode('#/a', data) under oneOf: the schema it gives", child.node?.schema ?? child.error?.message);
  const item = node.getNode("#/d/0", nullProto({ a: 2, d: [1] }));
  line("jsl getNode('#/d/0'): the schema it gives", item.node?.schema ?? item.error?.message);
}
{
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...vmdSchema }, "https://vmd.invalid/vmd-keywords");
  const instance = await annotations.annotate("https://vmd.invalid/vmd-keywords", { a: 2, d: [1] });
  const at = (pointer) => annotated.annotation(annotated.get(pointer, instance), "x-vmd-probe", "https://json-schema.org/draft/2020-12/schema");
  line("hyperjump annotations x-vmd-probe at #/a (a failing oneOf branch dropped?)", at("#/a"));
  line("hyperjump annotations x-vmd-probe at #/d/0", at("#/d/0"));
}

// --- the errors of a failing oneOf ---
const oneOfSchema = { type: "object", properties: { v: { oneOf: [{ type: "string", maxLength: 2 }, { type: "number", minimum: 10 }] } } };
const oneOfData = nullProto({ v: "long" });
{
  const v = new Ajv2020({ allErrors: true, strict: false }).compile(oneOfSchema);
  v(oneOfData);
  line("ajv oneOf errors", v.errors.map((e) => `${e.instancePath} ${e.keyword} ${e.schemaPath}`));
  line("jsl oneOf errors", jsl.compileSchema(oneOfSchema).validate(oneOfData).errors.map((e) => `${e.data.pointer} ${e.code}`));
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...oneOfSchema }, "https://vmd.invalid/one-of");
  const out = await hj.validate("https://vmd.invalid/one-of", oneOfData, hjx.BASIC);
  line("hyperjump oneOf errors (BASIC)", (out.errors ?? []).map((e) => `${e.instanceLocation} ${e.keyword.split("/").pop()}`));
}

// --- references between schema files ---
{
  const common = { $id: "https://vmd.invalid/schema/common.schema.yaml", $defs: { id: { type: "string", pattern: "^[A-Z]+-[0-9]{4}$" } } };
  const ticket = { $id: "https://vmd.invalid/schema/ticket.schema.yaml", type: "object", properties: { parent: { $ref: "common.schema.yaml#/$defs/id" } } };
  const node = jsl.compileSchema(ticket, { remotes: [common] });
  line("jsl relative $ref to another file: {parent: 'x'}", node.validate(nullProto({ parent: "x" })).errors.map((e) => `${e.data.pointer} ${e.code}`));
  const missing = jsl.compileSchema({ properties: { a: { $ref: "missing.schema.yaml" } } }, { throwOnInvalidRef: false });
  line("jsl $ref to a missing file (throwOnInvalidRef false): validate {a: 1}", missing.validate(nullProto({ a: 1 })).errors.map((e) => e.code));
}

// --- speed: compile and validate ---
const big = { type: "object", properties: {} };
for (let i = 0; i < 200; i++) big.properties[`f${i}`] = { type: "string", enum: ["a", "b", "c"], maxLength: 10 };
const record = nullProto(Object.fromEntries(Object.keys(big.properties).map((k) => [k, "a"])));
{
  let t = performance.now();
  const v = new Ajv2020({ allErrors: true, strict: false }).compile(big);
  const ajvCompile = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 1000; i++) v(record);
  line("ajv compile, then 1000 validations of a 200-member record (ms)", `${ajvCompile.toFixed(1)}, ${(performance.now() - t).toFixed(1)}`);
}
{
  let t = performance.now();
  const node = jsl.compileSchema(big);
  const compile = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 1000; i++) node.validate(record);
  line("jsl compile, then 1000 validations of a 200-member record (ms)", `${compile.toFixed(1)}, ${(performance.now() - t).toFixed(1)}`);
}
{
  hj.registerSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", ...big }, "https://vmd.invalid/big");
  let t = performance.now();
  await hj.validate("https://vmd.invalid/big", record);
  const first = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 1000; i++) await hj.validate("https://vmd.invalid/big", record);
  line("hyperjump validate(uri, instance): first, then 1000 more (ms)", `${first.toFixed(1)}, ${(performance.now() - t).toFixed(1)}`);
  t = performance.now();
  const compiled = await hj.validate("https://vmd.invalid/big");
  const compile = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 1000; i++) compiled(record);
  const flag = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 1000; i++) compiled(record, hjx.BASIC);
  line("hyperjump validate(uri) once, then 1000 sync calls, FLAG and BASIC (ms)", `${compile.toFixed(1)}, ${flag.toFixed(1)}, ${(performance.now() - t).toFixed(1)}`);
}

// --- hyperjump: no reads of the network or the disk once the URI schemes are removed ---
{
  const browser = await import("@hyperjump/browser");
  for (const scheme of ["http", "https", "file"]) browser.removeUriSchemePlugin(scheme);
  hj.registerSchema(
    { $schema: "https://json-schema.org/draft/2020-12/schema", properties: { a: { $ref: "missing.schema.yaml" }, b: { $ref: "https://json-schema.org/draft/2020-12/schema#/$defs/x" } } },
    "https://vmd.invalid/schema/refs-out.schema.yaml",
  );
  try {
    await hj.validate("https://vmd.invalid/schema/refs-out.schema.yaml", { a: 1 });
    line("hyperjump $ref to an unregistered file, schemes removed", "validated");
  } catch (e) {
    line("hyperjump $ref to an unregistered file, schemes removed", `throws ${e.constructor.name}: ${e.message.slice(0, 90)}`);
  }
}

// --- @hyperjump/json-schema-formats against the suite's samples and §4.3 ---
{
  const f = await import("@hyperjump/json-schema-formats");
  // Every value of the suite's values/logical-types/identifiers-valid.json and identifiers-invalid.json, then §4.3's leap seconds.
  const samples = [
    ["isUri", "https://example.com/a", true],
    ["isUri", "../a.md", false],
    ["isUriReference", "../a.md#b", true],
    ["isUriReference", "https://example.com/a", true],
    ["isUriReference", "%zz", false],
    ["isEmail", "ada@example.com", true],
    ["isEmail", "ada.example.com", false],
    ["isUuid", "123e4567-e89b-12d3-a456-426614174000", true],
    ["isUuid", "123e4567e89b12d3a456426614174000", false],
    ["isUuid", "123e4567-e89b-12d3-a456-42661417400g", false],
    ["isTime", "23:59:60Z", true],
    ["isTime", "01:59:60+02:00", true],
    ["isTime", "08:00:00+02", false],
    ["isDateTime", "2026-10-09 08:00:00Z", false],
  ];
  for (const [fn, value, expected] of samples) {
    const got = f[fn](value);
    line(`json-schema-formats ${fn}(${JSON.stringify(value)}), §4.3 or the suite says ${expected}`, `${got}${got === expected ? "" : "  (differs)"}`);
  }
}
