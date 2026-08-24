#!/bin/bash
#
# Regenerate mjsx's MicroQuickJS standard-library tables.
#
# The engine keeps its stdlib as relocatable C structures built ahead of
# time by a host tool rather than constructed at boot. -m32 because every
# mjsx target that uses this engine (ESP32, and WASM's default 32-bit
# memory model) has 32-bit pointers — one generation covers both.
#
# The output is committed; run this only when native_api.c's tables change.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # backends/esp32
ENGINE="$HERE/engine"

cc -Wall -O2 -D_GNU_SOURCE -I"$ENGINE" -c -o "$ENGINE/native_api.o" "$ENGINE/native_api.c"
cc -Wall -O2 -D_GNU_SOURCE -I"$ENGINE" -c -o "$ENGINE/mquickjs_build.o" "$HERE/tools/mquickjs_build.c"
cc -o "$ENGINE/gen" "$ENGINE/native_api.o" "$ENGINE/mquickjs_build.o"

"$ENGINE/gen" -m32 > "$ENGINE/mjsx_stdlib.h"
"$ENGINE/gen" -m32 -a > "$ENGINE/mquickjs_atom.h"

rm -f "$ENGINE/native_api.o" "$ENGINE/mquickjs_build.o" "$ENGINE/gen"
echo "regenerated $ENGINE/mjsx_stdlib.h and mquickjs_atom.h"
