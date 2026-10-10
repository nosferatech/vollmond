# Parser survey experiments

Scripts behind [../parser-survey.md](../parser-survey.md). Each one prints plain text; `results/` holds the output of the last full
run, so the report's measured claims can be checked without installing anything.

## Run everything

```sh
./run-all.sh
```

It creates `node_modules/` (from `package-lock.json`) and `.venv/` (from `requirements.txt`), both ignored by git, and rewrites
`results/`. It needs Node 24, Python 3.9 or later, `cargo` and a JDK. The Ruby script runs only where `ruby` exists. If `npm`
fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, run `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem ./run-all.sh` (macOS path).

## The scripts

| File | What it measures | Needs |
|---|---|---|
| `js-json.mjs` | `JSON.parse`, the reviver `context.source`, `JSON.rawJSON`, `jsonc-parser` values, offsets, errors and edits | Node 24 |
| `js-yaml.mjs` | `yaml`, `js-yaml` 5 and `js-yaml` 4 on every case in `yaml-cases.json`; the source text of YAML numbers; serializer quoting | Node 24 |
| `js-number-representations.mjs` | the number shapes compared in the report: equality, RFC 8785, Ajv, sorting, time and heap | Node 24 |
| `js-lossless-json.mjs` | `lossless-json` 4.3.1, what an exact object's `valueOf` decides, and the "report, do not hold" option | Node 24 |
| `decimal.mjs` | exact decimal compare, canonical text and the double-safe test used by the two scripts above | |
| `py_json.py` | Python `json` | Python 3.9 or later |
| `py_yaml.py` | PyYAML and `ruamel.yaml` on the same cases; round trips; the composed node tree | `.venv` |
| `ruby-yaml.rb` | Ruby's Psych on the scalar cases | Ruby |
| `serde-json-check/` | `serde_json`, with and without `arbitrary_precision`, and `RawValue` | `cargo` |
| `jackson/` | Jackson 2.22.3 `readTree`, duplicate detection, streaming text; downloads its jars into `jackson/lib/` | JDK, `curl` |
| `yaml-cases.json` | the inputs shared by the YAML scripts | |

Go's `encoding/json` is not run (no Go toolchain was available); the report cites its documentation instead.

## Versions

Pinned in `package.json` (with `package-lock.json`), `requirements.txt`, `serde-json-check/Cargo.toml` (with `Cargo.lock`) and
`jackson/run.sh`. `js-yaml4` in `package.json` is an npm alias for js-yaml 4.3.2, so both major versions of js-yaml are run
side by side. Dates in the YAML output depend on the time zone, so `run-all.sh` sets `TZ=UTC`.

Rerunning `run-all.sh` changes the timing and heap lines in `results/js-number-representations.txt` and nothing else; the other
result files are reproducible byte for byte. Those lines are single runs on one machine and show orders of magnitude only. The
report quotes the committed copy of that file.
