#!/usr/bin/env python3
"""Builds, renders and assembles the GitHub heading slug data. Python 3.9 or later, standard library and the gh CLI only.

  python3 slugs.py build               write the input documents and case-index.json from cases.py
  python3 slugs.py render [VARIANT] [DOCUMENT ...]
                                       render documents through GitHub's Markdown API and save the responses
  python3 slugs.py assemble            read the saved responses and write ../github-heading-slugs.json and
                                       ../github-heading-slugs.capture.json

VARIANT is one of
  markdown        POST /markdown, mode=markdown, context=nosferatech/vollmond  (saved in rendered/; the default)
  second-capture  the same call made again                                    (rendered-variants/second-capture/)
  raw             POST /markdown/raw                                          (rendered-variants/raw/)
  no-context      POST /markdown without context                              (rendered-variants/no-context/)
  mode-gfm        POST /markdown with mode=gfm                                (rendered-variants/mode-gfm/)

Rendering makes one read-only request per document and waits a second between requests.
"""
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
RESEARCH = os.path.dirname(HERE)
DOCS = os.path.join(RESEARCH, "github-heading-slugs")
INDEX = os.path.join(HERE, "case-index.json")
CAPTURED_ON = "2026-10-09"
CONTEXT = "nosferatech/vollmond"

VARIANT_DIRS = {
    "markdown": "rendered",
    "second-capture": "rendered-variants/second-capture",
    "raw": "rendered-variants/raw",
    "no-context": "rendered-variants/no-context",
    "mode-gfm": "rendered-variants/mode-gfm",
}


def build():
    import cases
    os.makedirs(DOCS, exist_ok=True)
    index = []
    for doc, items in sorted(cases.docs.items()):
        nl = "\r\n" if doc in cases.crlf_docs else "\n"
        parts = [md.replace("\n", nl) for (_n, md, _c) in items]
        text = (nl + nl).join(parts) + nl
        if doc in cases.footers:
            text += nl + cases.footers[doc].replace("\n", nl)
        with open(os.path.join(DOCS, doc + ".md"), "w", encoding="utf-8", newline="") as f:
            f.write(text)
        index.append({"document": doc, "cases": [{"name": n, "markdown": md.replace("\n", nl), "expected": c} for (n, md, c) in items]})
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(len(index), "documents", sum(len(d["cases"]) for d in index), "cases")


def command(variant, path):
    if variant == "raw":
        return ["gh", "api", "-X", "POST", "/markdown/raw", "-H", "Content-Type: text/x-markdown", "--input", path]
    if variant == "no-context":
        return ["gh", "api", "-X", "POST", "/markdown", "-f", "mode=markdown", "-F", "text=@" + path]
    mode = "gfm" if variant == "mode-gfm" else "markdown"
    return ["gh", "api", "-X", "POST", "/markdown", "-f", "mode=" + mode, "-f", "context=" + CONTEXT, "-F", "text=@" + path]


def render(variant, only):
    out = os.path.join(DOCS, VARIANT_DIRS[variant])
    os.makedirs(out, exist_ok=True)
    for fn in sorted(os.listdir(DOCS)):
        if not fn.endswith(".md") or (only and fn[:-3] not in only):
            continue
        r = subprocess.run(command(variant, os.path.join(DOCS, fn)), capture_output=True)
        if r.returncode != 0:
            print("FAIL", fn, r.stderr.decode()[:300])
            continue
        with open(os.path.join(out, fn[:-3] + ".html"), "wb") as f:
            f.write(r.stdout)
        print("ok", fn, len(r.stdout))
        time.sleep(1)


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def same(a, b):
    with open(a, "rb") as f, open(b, "rb") as g:
        return f.read() == g.read()


def assemble():
    from extract import extract
    index = sorted(json.load(open(INDEX, encoding="utf-8")), key=lambda d: d["document"])
    cases = []
    files = []
    for d in index:
        doc = d["document"]
        rendered = os.path.join(DOCS, "rendered", doc + ".html")
        headings = extract(open(rendered, encoding="utf-8").read())
        expected = sum(c["expected"] for c in d["cases"])
        if expected != len(headings):
            raise SystemExit("%s: expected %d headings, found %d" % (doc, expected, len(headings)))
        i = 0
        for c in d["cases"]:
            cases.append({"case": doc + "/" + c["name"], "document": doc + ".md", "markdown": c["markdown"],
                          "headings": headings[i:i + c["expected"]]})
            i += c["expected"]
        files.append({"document": doc + ".md", "inputSha256": sha(os.path.join(DOCS, doc + ".md")),
                      "rendered": "github-heading-slugs/rendered/" + doc + ".html", "renderedSha256": sha(rendered)})
    with open(os.path.join(RESEARCH, "github-heading-slugs.json"), "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False, indent=1)
        f.write("\n")

    variants = {}
    for variant, sub in VARIANT_DIRS.items():
        if variant == "markdown":
            continue
        folder = os.path.join(DOCS, sub)
        entries = []
        if os.path.isdir(folder):
            for fn in sorted(os.listdir(folder)):
                primary = os.path.join(DOCS, "rendered", fn)
                entries.append({"file": "github-heading-slugs/" + sub + "/" + fn, "sha256": sha(os.path.join(folder, fn)),
                                "identicalToPrimary": same(os.path.join(folder, fn), primary)})
        variants[variant] = entries
    committed = len(index) + sum(len(v) for v in variants.values())
    meta = {
        "capturedOn": CAPTURED_ON,
        "api": {
            "endpoint": "POST https://api.github.com/markdown",
            "command": "gh api -X POST /markdown -f mode=markdown -f context=%s -F text=@<file>" % CONTEXT,
            "note": "mode=gfm emits no heading ids, so mode=markdown (the API default) was used for the data.",
        },
        "requests": {
            "committed": committed,
            "explanation": "One primary render per document, plus the variant renders listed under variants. About 24 further requests (exploratory probes of empty headings and early trials) are not committed.",
        },
        "documents": len(index),
        "cases": len(cases),
        "headings": sum(len(c["headings"]) for c in cases),
        "headingFields": {
            "level": "1 to 6",
            "text": "textContent of the heading element, exactly as returned (entities decoded, markup removed, whitespace kept)",
            "id": "id attribute of the permalink anchor GitHub adds next to the heading, as returned (with the user-content- prefix); null when GitHub added no permalink anchor",
            "anchor": "id with the user-content- prefix removed; null when there is no permalink anchor",
            "href": "href of that permalink anchor; null when there is none",
            "explicitIds": "ids (and name= values) of elements inside the heading element, as returned",
            "html": "inner HTML of the heading element, as returned",
        },
        "files": files,
        "variants": variants,
    }
    with open(os.path.join(RESEARCH, "github-heading-slugs.capture.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(meta["documents"], "documents", meta["cases"], "cases", meta["headings"], "headings", committed, "committed requests")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        build()
    elif cmd == "render":
        args = sys.argv[2:]
        variant = args.pop(0) if args and args[0] in VARIANT_DIRS else "markdown"
        render(variant, set(args))
    elif cmd == "assemble":
        assemble()
    else:
        raise SystemExit(__doc__)
