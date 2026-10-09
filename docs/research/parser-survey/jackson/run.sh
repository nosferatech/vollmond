#!/bin/sh
# Downloads Jackson 2.22.3 from Maven Central into jackson/lib (ignored by git), then runs Survey.java.
set -eu
cd "$(dirname "$0")"
mkdir -p lib
base=https://repo1.maven.org/maven2/com/fasterxml/jackson/core
[ -f lib/jackson-core-2.22.3.jar ] || curl -fsS -o lib/jackson-core-2.22.3.jar "$base/jackson-core/2.22.3/jackson-core-2.22.3.jar"
[ -f lib/jackson-databind-2.22.3.jar ] || curl -fsS -o lib/jackson-databind-2.22.3.jar "$base/jackson-databind/2.22.3/jackson-databind-2.22.3.jar"
[ -f lib/jackson-annotations-2.22.jar ] || curl -fsS -o lib/jackson-annotations-2.22.jar "$base/jackson-annotations/2.22/jackson-annotations-2.22.jar"
java -cp "lib/*" Survey.java
