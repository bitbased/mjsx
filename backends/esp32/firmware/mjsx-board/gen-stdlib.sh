#!/bin/bash
#
# Regenerate the MicroQuickJS standard-library tables for this firmware.
#
# The engine keeps its stdlib as relocatable C structures built ahead of time
# by a host tool, so the device does not build it at boot. The output is
# committed; this only needs running when the native table changes — adding a
# native to tools/mjsx_board_stdlib.c, for instance.
#
# The name table lives in tools/, NOT in src/: the Arduino build compiles
# everything under src/ into the sketch, and this file is host-only -- it
# was linked into the firmware and collided with the engine's own main().
#
# The tables are word-size dependent, hence -m32 for the ESP32. Tables and
# atoms disagreeing about word size is the worst failure this engine has: it
# corrupts atom numbering and surfaces as parse errors and panics, so both are
# generated from the same run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENG="$HERE/src/engine"
T="$HERE/tools"

cc -Wall -O2 -D_GNU_SOURCE -I"$ENG" -I"$T" -c -o "$T/stdlib.o" "$T/mjsx_board_stdlib.c"
cc -Wall -O2 -D_GNU_SOURCE -I"$ENG" -I"$T" -c -o "$T/build.o" "$T/mquickjs_build.c"
cc -o "$T/gen" "$T/stdlib.o" "$T/build.o"

"$T/gen" -m32    > "$ENG/mjsx_board_stdlib.h"
"$T/gen" -m32 -a > "$ENG/mquickjs_atom.h"

rm -f "$T"/*.o "$T/gen"
echo "regenerated $(basename "$ENG")/mjsx_board_stdlib.h and mquickjs_atom.h"
