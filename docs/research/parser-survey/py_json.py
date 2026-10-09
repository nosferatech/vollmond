"""Python json module: numbers, duplicate keys and strictness. Run with the virtual environment's python."""
import decimal
import json
import math
import sys

print(f"python {sys.version.split()[0]}; json module of the standard library")


def fmt(v):
    if isinstance(v, bool):
        return f"bool({v})"
    if isinstance(v, int):
        return f"int({v})"
    if isinstance(v, float):
        if math.isnan(v):
            return "float(nan)"
        if v == 0 and math.copysign(1, v) < 0:
            return "float(-0.0)"
        return f"float({v!r})"
    if isinstance(v, decimal.Decimal):
        return f"Decimal({str(v)!r})"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, list):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{k}: {fmt(x)}" for k, x in v.items()) + "}"
    return repr(v)


def show(label, fn):
    try:
        out = fmt(fn())
    except Exception as e:  # noqa: BLE001 - survey: report whatever the parser raises
        out = f"RAISES {type(e).__name__}: {str(e)[:80]}"
    print(f"{label:<58} {out}")


def section(t):
    print(f"\n== {t}")


samples = [
    "9007199254740991", "9007199254740992", "9007199254740993", "12345678901234567890",
    "123456789012345678901234567890", "1", "1.0", "1e0", "10e-1", "-0", "-0.0", "0",
    "1e400", "-1e400", "1e-400", "5e-324", "0.1", "0.30000000000000004",
    "0.3000000000000000444089209850062616169452667236328125", "123456789.123456789123456789",
]

section("json.loads defaults")
for s in samples:
    show(s, lambda s=s: json.loads(s))

section("json.loads(parse_float=Decimal, parse_int=default)")
for s in samples:
    show(s, lambda s=s: json.loads(s, parse_float=decimal.Decimal))

section("json.loads(parse_float=str, parse_int=str): the lexeme itself (also for -0, 1e400)")
for s in samples:
    show(s, lambda s=s: json.loads(s, parse_float=str, parse_int=str))

section("1 == 1.0 and json round trip of the type")
show("json.loads('1') == json.loads('1.0')", lambda: json.loads("1") == json.loads("1.0"))
show("json.dumps(json.loads('1.0'))", lambda: json.dumps(json.loads("1.0")))
show("json.dumps(json.loads('1e3'))", lambda: json.dumps(json.loads("1e3")))
show("json.dumps(json.loads('12345678901234567890'))", lambda: json.dumps(json.loads("12345678901234567890")))
show("json.dumps(json.loads('1e400'))  (Infinity is written)", lambda: json.dumps(json.loads("1e400")))
show("json.dumps(Decimal('1E+400'))", lambda: json.dumps(decimal.Decimal("1E+400")))

section("Duplicate keys")
show('{"a":1,"a":2}', lambda: json.loads('{"a":1,"a":2}'))


def reject_duplicates(pairs):
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate key")
    return dict(pairs)


show("with object_pairs_hook that raises on a repeat", lambda: json.loads('{"a":1,"a":2}', object_pairs_hook=reject_duplicates))

section("Strictness")
for label, text in [
    ("NaN", "NaN"), ("Infinity", "Infinity"), ("-Infinity", "-Infinity"), ("trailing comma [1,]", "[1,]"), ("comment", "[1 /* c */]"),
    ("leading zero 01", "01"), ("+1", "+1"), (".5", ".5"), ("lone surrogate escape", '"\\ud800"'), ("BOM prefix (str)", "﻿1"),
    ("two values", "1 2"), ("control character in string", '"a\tb"'),
]:
    show(label, lambda text=text: json.loads(text))
show("NaN with parse_constant that raises", lambda: json.loads("NaN", parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c))))
show("json.loads(bytes with BOM)", lambda: json.loads(b"\xef\xbb\xbf1"))

section("Digit limit for int <-> str conversion (3.11 and later; 3.9.14 and later patch releases)")
show("hasattr(sys, 'get_int_max_str_digits')", lambda: hasattr(sys, "get_int_max_str_digits"))
if hasattr(sys, "get_int_max_str_digits"):
    show("sys.get_int_max_str_digits()", lambda: sys.get_int_max_str_digits())
    show("json.loads of a 5000 digit integer", lambda: len(str(json.loads("1" * 5000))))
