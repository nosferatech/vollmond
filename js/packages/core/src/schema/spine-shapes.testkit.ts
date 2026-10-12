// Schemas whose spine check is costly in one part each, for the tests of that part's cost and for the differential tests at
// sizes the check's first form still finishes.

const REF = { type: "object", "x-vmd-ref": {} };
const REF_MANY = { type: "object", "x-vmd-ref": { cardinality: "many" } };

/**
 * Two cycles of definitions under member `a`, of lengths `p` and `q`, both even: the pairs of the two grow as their product.
 * A0 declares at `x`; B declares unequally at `x` at its odd positions, which never meet A0, or with `conflict` only at
 * position q - 2, which meets A0 at a path of length lcm(p, q) when p/2 and q/2 are coprime.
 */
export function cycles(p: number, q: number, conflict = false): unknown {
  const $defs: Record<string, unknown> = {};
  for (let i = 0; i < p; i++) {
    const properties: Record<string, unknown> = { a: { $ref: `#/$defs/A${(i + 1) % p}` } };
    if (i === 0) properties.x = REF;
    $defs[`A${i}`] = { properties };
  }
  for (let j = 0; j < q; j++) {
    const properties: Record<string, unknown> = { a: { $ref: `#/$defs/B${(j + 1) % q}` } };
    if (conflict ? j === q - 2 : j % 2 === 1) properties.x = REF_MANY;
    $defs[`B${j}`] = { properties };
  }
  return { type: "object", allOf: [{ $ref: "#/$defs/A0" }, { $ref: "#/$defs/B0" }], $defs };
}

/** A chain of `depth` nested members, of definitions, over an object of `refs` typed references, each to its own collection. */
export function chain(depth: number, refs: number): unknown {
  const properties: Record<string, unknown> = {};
  for (let i = 0; i < refs; i++) properties[`r${i}`] = { type: "object", "x-vmd-ref": { targets: [`c${i}`] } };
  const $defs: Record<string, unknown> = {};
  for (let i = 0; i < depth; i++) $defs[`L${i}`] = { properties: { a: { $ref: `#/$defs/L${i + 1}` } } };
  $defs[`L${depth}`] = { type: "object", properties };
  return { $ref: "#/$defs/L0", $defs };
}

/** `k` allOf branches that all refer to one definition, which has `k` parents. */
export function fanIn(k: number): unknown {
  return {
    type: "object",
    allOf: Array.from({ length: k }, () => ({ $ref: "#/$defs/a" })),
    $defs: { a: { properties: { r: REF } } },
  };
}

/** `k` allOf branches of a bare `x-vmd-ref` beside `k` branches that give its format. */
export function formats(k: number): unknown {
  const bare = Array.from({ length: k }, () => ({ properties: { r: { "x-vmd-ref": {} } } }));
  const given = Array.from({ length: k }, () => ({ properties: { r: { format: "uri-reference" } } }));
  return { type: "object", allOf: [...bare, ...given] };
}

/** A record built from `k` mixins by allOf, each with `fields` plain members and one typed reference to its own collection. */
export function mixins(k: number, fields: number): unknown {
  const $defs: Record<string, unknown> = {};
  for (let i = 0; i < k; i++) {
    const properties: Record<string, unknown> = {};
    for (let f = 0; f < fields; f++) properties[`m${i}f${f}`] = { type: "string" };
    properties[`m${i}ref`] = { type: "string", format: "uri-reference", "x-vmd-ref": { targets: [`c${i}`] } };
    $defs[`mixin${i}`] = { type: "object", properties };
  }
  return { type: "object", allOf: Array.from({ length: k }, (_, i) => ({ $ref: `#/$defs/mixin${i}` })), $defs };
}

/** `k` allOf branches that declare `x-vmd-ref: {}` beside `k` that declare cardinality `many`: k² unequal pairs. */
export function unequalBranches(k: number): unknown {
  const one = Array.from({ length: k }, () => ({ "x-vmd-ref": {} }));
  const many = Array.from({ length: k }, () => ({ "x-vmd-ref": { cardinality: "many" } }));
  return { type: "object", format: "uri-reference", allOf: [...one, ...many] };
}

/** `n` members, member i referring to link i of one `$ref` chain of `n` links, whose last declares: closures of n²/2 in all. */
export function deepClosures(n: number): unknown {
  const properties: Record<string, unknown> = {};
  const $defs: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    properties[`p${i}`] = { $ref: `#/$defs/c${i}` };
    $defs[`c${i}`] = i + 1 < n ? { $ref: `#/$defs/c${i + 1}` } : REF;
  }
  return { type: "object", properties, $defs };
}

/** `n` members, member i referring to link i of one `$ref` chain, each link a bare `x-vmd-ref`: n²/2 closure entries in all. */
export function bareReferenceChain(n: number): unknown {
  const properties: Record<string, unknown> = {};
  const $defs: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    properties[`p${i}`] = { $ref: `#/$defs/c${i}` };
    $defs[`c${i}`] = i + 1 < n ? { $ref: `#/$defs/c${i + 1}`, "x-vmd-ref": {} } : { "x-vmd-ref": {} };
  }
  return { type: "object", properties, $defs };
}
