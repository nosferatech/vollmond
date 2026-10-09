"""Python YAML parsers: PyYAML (YAML 1.1) and ruamel.yaml (YAML 1.2). Run with the virtual environment's python."""
import datetime
import io
import json
import math
import sys
from pathlib import Path

import ruamel.yaml
import yaml
from ruamel.yaml import YAML

cases = json.loads((Path(__file__).parent / "yaml-cases.json").read_text(encoding="utf8"))
print(f"python {sys.version.split()[0]}; PyYAML {yaml.__version__}; ruamel.yaml {ruamel.yaml.__version__}; libyaml in PyYAML: {yaml.__with_libyaml__}")


def fmt(v):
    if v is None:
        return "None"
    if isinstance(v, bool):
        return f"bool({v})"
    if isinstance(v, int):
        return f"{type(v).__name__}({int(v)})"
    if isinstance(v, float):
        if math.isnan(v):
            return f"{type(v).__name__}(nan)"
        if v == 0 and math.copysign(1, v) < 0:
            return f"{type(v).__name__}(-0.0)"
        return f"{type(v).__name__}({float(v)!r})"
    if isinstance(v, str):
        return json.dumps(str(v)) if type(v) is str else f"{type(v).__name__}({json.dumps(str(v))})"
    if isinstance(v, datetime.datetime):
        return f"datetime({v.isoformat()})"
    if isinstance(v, datetime.date):
        return f"date({v.isoformat()})"
    if isinstance(v, (bytes, bytearray)):
        return f"bytes[{len(v)}]"
    if isinstance(v, (set, frozenset)):
        return "set{" + ", ".join(fmt(x) for x in v) + "}"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{fmt(k)}: {fmt(x)}" for k, x in v.items()) + "}"
    return f"{type(v).__name__}({v!r})"


def pyyaml_safe(text):
    return list(yaml.safe_load_all(text))


def pyyaml_base(text):
    return list(yaml.load_all(text, Loader=yaml.BaseLoader))


def ruamel_factory(typ, pure=True):
    def run(text):
        y = YAML(typ=typ, pure=pure)
        return list(y.load_all(text))
    return run


parsers = {
    "PyYAML safe_load": pyyaml_safe,
    "ruamel safe": ruamel_factory("safe"),
    "ruamel rt": ruamel_factory("rt"),
}


def run(name, text):
    try:
        docs = parsers[name](text)
    except Exception as e:  # noqa: BLE001 - survey: report whatever the parser raises
        return f"ERROR {type(e).__name__}: {str(e).splitlines()[0][:60] if str(e) else ''}"
    return fmt(docs[0]) if len(docs) == 1 else f"{len(docs)} docs: " + " ; ".join(fmt(d) for d in docs)


print("\n## Scalars, as the value of `v:`")
print("columns: " + " | ".join(parsers))
for s in cases["scalars"]:
    cells = []
    for name in parsers:
        r = run(name, f"v: {s}\n")
        cells.append(r[6:-1] if r.startswith('{"v": ') else r)
    print(f"{json.dumps(s):<34} " + " | ".join(cells))

print("\n## Documents")
for label, text in cases["documents"].items():
    print(f"\n{label}: {json.dumps(text)}")
    for name in parsers:
        print(f"  {name:<18} {run(name, text)}")

print("\n## Single-document loaders on a multi-document source and on an empty source")
for name, fn in [("PyYAML safe_load", yaml.safe_load), ("ruamel safe load", lambda t: YAML(typ="safe").load(t)), ("ruamel rt load", lambda t: YAML(typ="rt").load(t))]:
    for label, text in [("multi", "a: 1\n---\nb: 2\n"), ("empty", "")]:
        try:
            out = fmt(fn(text))
        except Exception as e:  # noqa: BLE001
            out = f"ERROR {type(e).__name__}: {str(e).splitlines()[0][:60]}"
        print(f"  {name:<18} {label:<8} {out}")

print("\n## PyYAML: the unsafe loaders and the warning in its own documentation")
for label, text in [("python/object/apply under yaml.safe_load", "a: !!python/object/apply:os.getcwd []\n")]:
    try:
        print("  ", label, yaml.safe_load(text))
    except Exception as e:  # noqa: BLE001
        print("  ", label, "->", type(e).__name__)

print("\n## ruamel.yaml: duplicate keys option")
y = YAML(typ="rt")
y.allow_duplicate_keys = True
print("  rt allow_duplicate_keys=True:", fmt(y.load("a: 1\na: 2\n")))
print("  rt version attribute:", YAML(typ="rt").version, "(None means the default, YAML 1.2)")
y11 = YAML(typ="rt")
y11.version = (1, 1)
for s in ["yes", "017", "0o17", "2026-10-09", "1:30", "1_000"]:
    print(f"  rt version (1,1) v: {s} ->", end=" ")
    try:
        print(fmt(y11.load(f"%YAML 1.1\n---\nv: {s}\n")["v"]))
    except Exception as e:  # noqa: BLE001
        print("ERROR", type(e).__name__, str(e).splitlines()[0][:60])

print("\n## ruamel.yaml round trip: are numbers rewritten when a document is loaded and dumped unchanged?")
src = "a: 1.0\nb: 12345678901234567890\nc: 0x1F\nd: 1e3\ne: -0\nf: 0o17\ng: 1e400\nh: +1\ni: 017\nj: 1_000\nk: 0.10\nl: 1.0e+3\nm: 1E3\nn: .5\n"
rt = YAML(typ="rt")
data = rt.load(src)
buf = io.StringIO()
rt.dump(data, buf)
out = buf.getvalue()
print("  identical:", out == src)
for a, b in zip(src.splitlines(), out.splitlines()):
    if a != b:
        print(f"    {a!r} -> {b!r}")
print("  value types after rt load:", {k: type(v).__name__ for k, v in data.items()})
print("  after data['a'] = 2 :")
data["a"] = 2
buf = io.StringIO()
rt.dump(data, buf)
print("   ", buf.getvalue().splitlines()[0:3])

print("\n## ruamel.yaml rt: where a custom tag lives after loading")
tagged = YAML(typ="rt").load("a: !foo {b: 1}\nc: !foo bar\n")
print("  mapping tag attribute:", repr(getattr(tagged["a"], "tag", None)), "; scalar:", type(tagged["c"]).__name__, repr(getattr(tagged["c"], "tag", None)))

print("\n## ruamel.yaml: line and column of a node (rt)")
print("  lc of key b:", data.lc.key("b"), "value:", data.lc.value("b"))

print("\n## Exact source text of a number in Python: the composed node tree (before any conversion to int or float)")
node_src = "a: 1.0\nb: 12345678901234567890\nc: 0x1F\nd: 1e3\ne: -0\nf: 0o17\ng: 1e400\nh: +1\ni: 017\n"
for label, root in [("PyYAML yaml.compose", yaml.compose(node_src, Loader=yaml.SafeLoader)), ("ruamel YAML().compose", YAML(typ="rt").compose(node_src))]:
    print(f"  {label}:")
    for key_node, value_node in root.value:
        start, end = value_node.start_mark.index, value_node.end_mark.index
        print(f"    {key_node.value}: value={value_node.value!r} tag={value_node.tag} source slice={node_src[start:end]!r}")
