// Behaviors of JSON Schema 2020-12 validators that docs/design/i2-validate.md relies on: Ajv 8.20.0, @hyperjump/json-schema
// 1.18.0, json-schema-library 11.6.5 and @cfworker/json-schema 4.1.1.
//
//   node validator-probes.mjs
//
// Every line prints what the library did. Nothing here is a vmd rule; the design says what core does about each.
import { performance } from "node:perf_hooks";

const t0 = performance.now();
const ajvModule = await import("ajv/dist/2020.js");
const tAjv = performance.now();
const Ajv2020 = ajvModule.default.default ?? ajvModule.default;

// Values as core builds them: objects with a null prototype, so that `__proto__` is an ordinary member.
function nullProto(value) {
  if (Array.isArray(value)) return value.map(nullProto);
  if (value !== null && typeof value === "object") {
    const o = Object.create(null);
    for (const [k, v] of Object.entries(value)) o[k] = nullProto(v);
    return o;
  }
  return value;
}
function withProto(object, protoValue) {
  const o = nullProto(object);
  Object.defineProperty(o, "__proto__", { value: protoValue, enumerable: true, writable: true, configurable: true });
  return o;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/; // a stand-in: vmd's own check is the design's section 3.4
const base = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["status", "owner"],
  properties: {
    status: { enum: ["Open", "Closed"] },
    due: { type: "string", format: "date" },
    tags: { type: "array", items: { type: "string" } },
    host: { type: "string", format: "hostname" },
  },
  additionalProperties: false,
};
const instance = nullProto({ status: "Bad", due: "2026-13", tags: ["a", 1], host: "not a host!", extra: 1 });

function line(label, value) {
  console.log(`${label.padEnd(58)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

console.log(`node ${process.versions.node}`);
line("ajv: import of ajv/dist/2020.js (ms, in this process)", (tAjv - t0).toFixed(1));

// --- Ajv ---
{
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  try {
    ajv.compile(base);
    line("ajv strict: unknown format hostname", "compiled");
  } catch (e) {
    line("ajv strict: unknown format hostname", `throws: ${e.message.slice(0, 80)}`);
  }
  try {
    new Ajv2020({ strict: true }).compile({ type: "string", "x-vmd-summary": true });
    line("ajv strict: unknown keyword x-vmd-summary", "compiled");
  } catch (e) {
    line("ajv strict: unknown keyword x-vmd-summary", `throws: ${e.message.slice(0, 80)}`);
  }
  const lax = new Ajv2020({ allErrors: true, strictSchema: false, ownProperties: true, validateFormats: true, formats: { hostname: true } });
  lax.addFormat("date", { type: "string", validate: (s) => DATE.test(s) });
  const v = lax.compile(base);
  v(instance);
  for (const e of v.errors) line(`ajv error ${e.keyword}`, { instancePath: e.instancePath, schemaPath: e.schemaPath, params: e.params, message: e.message });

  // __proto__ as a member, in the schema and in the instance.
  const protoSchema = nullProto({ type: "object", required: ["__proto__"], properties: {} });
  protoSchema.properties = withProto({}, { type: "string" });
  try {
    const pv = new Ajv2020({ allErrors: true, ownProperties: true }).compile(protoSchema);
    line("ajv __proto__: {__proto__: 5} (should be invalid)", pv(withProto({}, 5)) ? "valid" : pv.errors.map((e) => e.message));
    line("ajv __proto__: {__proto__: 'x'} (should be valid)", pv(withProto({}, "x")) ? "valid" : pv.errors.map((e) => e.message));
    line("ajv __proto__: {} (should be invalid: required)", pv(nullProto({})) ? "valid" : pv.errors.map((e) => e.message));
  } catch (e) {
    line("ajv __proto__ schema", `throws: ${e.message.slice(0, 80)}`);
  }

  // A format for numbers and strings: int64 is either (§4.3).
  const twoTypes = new Ajv2020({ allErrors: true });
  try {
    twoTypes.removeKeyword("format");
    twoTypes.addKeyword({
      keyword: "format",
      schemaType: "string",
      errors: true,
      validate: function f(name, data) {
        if (name !== "int64") return true;
        const ok = typeof data === "number" ? Number.isInteger(data) : typeof data === "string" ? /^-?(0|[1-9][0-9]*)$/.test(data) : true;
        if (!ok) f.errors = [{ keyword: "format", message: `must be ${name}`, params: { format: name } }];
        return ok;
      },
    });
    const iv = twoTypes.compile({ type: "array", items: { type: ["integer", "string"], format: "int64" } });
    iv(["42", 7, "007", 1.5]);
    line("ajv format replaced by a keyword: int64 over [\"42\",7,\"007\",1.5]", iv.errors.map((e) => `${e.instancePath} ${e.keyword}`));
  } catch (e) {
    line("ajv removeKeyword('format')", `throws: ${e.message.slice(0, 100)}`);
  }

  // A custom keyword: where it runs, and whether it runs in a branch that fails.
  const seen = [];
  const kw = new Ajv2020({ allErrors: true });
  kw.addKeyword({
    keyword: "x-probe",
    validate: (schema, _data, _parent, cxt) => {
      seen.push(`${schema}@${cxt.instancePath || "/"}`);
      return true;
    },
  });
  const kv = kw.compile({
    type: "object",
    properties: {
      a: { oneOf: [{ const: 1, "x-probe": "one-fails" }, { const: 2, "x-probe": "one-passes" }] },
      b: { not: { "x-probe": "under-not", type: "string" } },
      c: { if: { const: 0, "x-probe": "if" }, then: { "x-probe": "then" }, else: { "x-probe": "else" } },
      d: { type: "array", items: { "x-probe": "item" } },
    },
  });
  kv(nullProto({ a: 2, b: 5, c: 1, d: [1, 2] }));
  line("ajv custom keyword ran at", seen);

  // Several schema files, one referring to another by a relative URI.
  const files = new Ajv2020({ allErrors: true });
  files.addSchema({ $id: "https://vmd.invalid/schema/common.schema.yaml", $defs: { id: { type: "string", pattern: "^[A-Z]+-[0-9]{4}$" } } });
  files.addSchema({ $id: "https://vmd.invalid/schema/ticket.schema.yaml", type: "object", properties: { parent: { $ref: "common.schema.yaml#/$defs/id" } } });
  const tv = files.getSchema("https://vmd.invalid/schema/ticket.schema.yaml");
  line("ajv relative $ref to another schema file: {parent: 'x'}", tv(nullProto({ parent: "x" })) ? "valid" : tv.errors.map((e) => `${e.instancePath} ${e.keyword} ${e.schemaPath}`));
  const sub = files.getSchema("https://vmd.invalid/schema/common.schema.yaml#/$defs/id");
  line("ajv getSchema by JSON Pointer into a document", sub === undefined ? "undefined" : sub("VDB-0158") ? "valid" : "invalid");
  try {
    files.addSchema({ $id: "https://vmd.invalid/schema/broken.schema.yaml", properties: { a: { $ref: "missing.schema.yaml" } } });
    files.getSchema("https://vmd.invalid/schema/broken.schema.yaml");
    line("ajv $ref to a missing file", "compiled");
  } catch (e) {
    line("ajv $ref to a missing file", `throws: ${e.message.slice(0, 80)}`);
  }

  // Compile time, the cost a cold `vmd check` pays per schema.
  const big = { type: "object", properties: {} };
  for (let i = 0; i < 200; i++) big.properties[`f${i}`] = { type: "string", enum: ["a", "b", "c"], maxLength: 10 };
  let t = performance.now();
  const bv = new Ajv2020({ allErrors: true }).compile(big);
  line("ajv compile of a 200-property schema (ms)", (performance.now() - t).toFixed(1));
  const record = nullProto(Object.fromEntries(Object.keys(big.properties).map((k) => [k, "a"])));
  t = performance.now();
  for (let i = 0; i < 1000; i++) bv(record);
  line("ajv 1000 validations of a 200-member record (ms)", (performance.now() - t).toFixed(1));
}

// --- @hyperjump/json-schema ---
await (async () => {
  let hj;
  const t1 = performance.now();
  try {
    hj = await import("@hyperjump/json-schema/draft-2020-12");
  } catch (e) {
    line("hyperjump import", `fails: ${e.message.slice(0, 100)}`);
    return;
  }
  line("hyperjump: import (ms, in this process)", (performance.now() - t1).toFixed(1));
  line("hyperjump: exports", Object.keys(hj));
  const { registerSchema, validate } = hj;
  registerSchema({ ...base, $schema: "https://json-schema.org/draft/2020-12/schema" }, "https://vmd.invalid/schema/base.schema.json");
  try {
    const out = await validate("https://vmd.invalid/schema/base.schema.json", instance, "BASIC");
    line("hyperjump BASIC output valid", out.valid);
    for (const e of out.errors ?? []) line(`hyperjump error`, { keyword: e.keyword, instanceLocation: e.instanceLocation, absoluteKeywordLocation: e.absoluteKeywordLocation });
  } catch (e) {
    line("hyperjump validate", `throws: ${e.message.slice(0, 100)}`);
  }
})();

// --- json-schema-library ---
await (async () => {
  let jsl;
  const t1 = performance.now();
  try {
    jsl = await import("json-schema-library");
  } catch (e) {
    line("json-schema-library import", `fails: ${e.message.slice(0, 100)}`);
    return;
  }
  line("json-schema-library: import (ms, in this process)", (performance.now() - t1).toFixed(1));
  line("json-schema-library: exports (first 30)", Object.keys(jsl).slice(0, 30));
  try {
    const node = jsl.compileSchema(base);
    const { valid, errors } = node.validate(instance);
    line("json-schema-library valid", valid);
    for (const e of errors) line(`json-schema-library error ${e.code}`, { pointer: e.data?.pointer, message: e.message });
  } catch (e) {
    line("json-schema-library validate", `throws: ${e.message.slice(0, 100)}`);
  }
})();

// --- @cfworker/json-schema ---
await (async () => {
  let cf;
  const t1 = performance.now();
  try {
    cf = await import("@cfworker/json-schema");
  } catch (e) {
    line("cfworker import", `fails: ${e.message.slice(0, 100)}`);
    return;
  }
  line("cfworker: import (ms, in this process)", (performance.now() - t1).toFixed(1));
  line("cfworker: exports", Object.keys(cf));
  try {
    const validator = new cf.Validator(base, "2020-12", false);
    const r = validator.validate(instance);
    line("cfworker valid", r.valid);
    for (const e of r.errors) line(`cfworker error ${e.keyword}`, { instanceLocation: e.instanceLocation, keywordLocation: e.keywordLocation, error: e.error });
  } catch (e) {
    line("cfworker validate", `throws: ${e.message.slice(0, 100)}`);
  }
})();
