#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
classes=$(mktemp -d)
trap 'python3 -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$classes"' EXIT
javac --release 8 -classpath "$1" -d "$classes" "$root/tools/android-catalog/Catalog.java"
java -cp "$2" com.android.tools.r8.D8 --release --min-api 24 --lib "$1" \
  --output "$root/lib/engine/assets/android-catalog.jar" "$classes/io/hashpix/android/Catalog.class"
