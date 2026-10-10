#!/bin/sh
# Installs the pinned dependencies (first run only) and writes every experiment's output to results/.
# Needs node 24, python3 (3.9 or later), cargo and a JDK on the path. Skip a part by commenting out its line.
set -eu
cd "$(dirname "$0")"
mkdir -p results

# On a machine whose Node does not trust the system certificates, point it at them first, for example
#   NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem ./run-all.sh
[ -d node_modules ] || npm ci --no-audit --no-fund
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --quiet -r requirements.txt

export TZ=UTC
node js-json.mjs > results/js-json.txt
node js-yaml.mjs > results/js-yaml.txt
node --expose-gc js-number-representations.mjs > results/js-number-representations.txt
node js-lossless-json.mjs > results/js-lossless-json.txt
.venv/bin/python py_json.py > results/py-json.txt
.venv/bin/python py_yaml.py > results/py-yaml.txt
(cd serde-json-check && cargo run --quiet) > results/serde-json-default.txt
(cd serde-json-check && cargo run --quiet --features arbitrary) > results/serde-json-arbitrary-precision.txt
jackson/run.sh > results/jackson.txt
if command -v ruby > /dev/null; then ruby ruby-yaml.rb > results/ruby-yaml.txt; fi
echo "wrote results/"
