// Exact decimal helpers shared by the number experiments: the minimum any exact representation needs.

/** Splits a JSON or YAML 1.2 number lexeme into sign, significant digits and a power of ten, with no leading or trailing zeros. */
export function decimalParts(lexeme) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(lexeme);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`not a decimal: ${lexeme}`);
  const [, sign, int, frac = '', exp = '0'] = m;
  let digits = int + frac;
  let exponent = Number(exp) - frac.length;
  const lead = digits.length - digits.replace(/^0+/, '').length;
  digits = digits.slice(lead);
  const trailing = digits.length - digits.replace(/0+$/, '').length;
  digits = digits.slice(0, digits.length - trailing);
  exponent += trailing;
  if (digits === '') return { neg: false, digits: '', exp: 0 }; // zero; negative zero is not a different number
  return { neg: sign === '-', digits, exp: exponent };
}

/** Compares two decimal lexemes exactly. Returns -1, 0 or 1. */
export function compareDecimal(a, b) {
  const x = decimalParts(a);
  const y = decimalParts(b);
  if (x.digits === '' && y.digits === '') return 0;
  if (x.digits === '') return y.neg ? 1 : -1;
  if (y.digits === '') return x.neg ? -1 : 1;
  if (x.neg !== y.neg) return x.neg ? -1 : 1;
  const sign = x.neg ? -1 : 1;
  const magX = x.digits.length + x.exp;
  const magY = y.digits.length + y.exp;
  if (magX !== magY) return sign * (magX < magY ? -1 : 1);
  const n = Math.max(x.digits.length, y.digits.length);
  const dx = x.digits.padEnd(n, '0');
  const dy = y.digits.padEnd(n, '0');
  return dx === dy ? 0 : sign * (dx < dy ? -1 : 1);
}

/** A canonical text for a decimal value, the same for 1, 1.0 and 10e-1. */
export function canonicalDecimal(lexeme) {
  const { neg, digits, exp } = decimalParts(lexeme);
  if (digits === '') return '0';
  const body = exp >= 0 && exp <= 20 ? digits + '0'.repeat(exp) : exp < 0 && digits.length + exp > 0 ? `${digits.slice(0, digits.length + exp)}.${digits.slice(digits.length + exp)}` : exp < 0 && exp >= -20 ? `0.${'0'.repeat(-exp - digits.length)}${digits}` : `${digits}e${exp}`;
  return (neg ? '-' : '') + body;
}

/** True when the lexeme equals its own shortest round-trip form, that is the decimal printed by `String(Number(lexeme))`. */
export function isDoubleSafe(lexeme) {
  const d = Number(lexeme);
  return Number.isFinite(d) && compareDecimal(lexeme, String(d)) === 0;
}
