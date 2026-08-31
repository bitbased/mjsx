#!/bin/bash
#
# Build the mjsx-board firmware for one panel, and optionally send it.
#
#   ./build.sh --b35                     build for the 3.5" board
#   ./build.sh --b169 --ota 192.168.1.144   build and update over the air
#   ./build.sh --b128 --port /dev/cu.usbmodem1234   build and flash over USB
#
# Everything this needs is in THIS repo. The firmware was once carried in an
# unrelated project and hand-synced here, which let the two drift; it is not
# any more, and nothing below reads a file from outside mjsx.
#
# The four boards differ in more than a panel driver: the round one is an
# S3R2 (2 MB quad PSRAM, and its USB console is a CH343, so CDCOnBoot must
# stay off), while the others are S3R8 with octal PSRAM. That is why the
# FQBN is per-board and not a single constant.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="$(basename "$HERE")"

FQBN='esp32:esp32:esp32s3:USBMode=hwcdc,CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M,PartitionScheme=custom'
BOARD=""
LABEL=""
EXTRA=""
OTA_IP=""
PORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --b169) BOARD=1; LABEL='1.69" 240x280 ST7789' ;;
    --b35)  BOARD=2; LABEL='3.5" 320x480 ST7796' ;;
    --b147) BOARD=3; LABEL='1.47" 172x320 JD9853' ;;
    --b128) BOARD=4; LABEL='1.28" round 240x240 GC9A01'
            # S3R2: 2 MB QUAD psram, and the USB console is a CH343
            FQBN='esp32:esp32:esp32s3:USBMode=hwcdc,CDCOnBoot=default,PSRAM=enabled,FlashSize=16M,PartitionScheme=custom' ;;
    --rfid) EXTRA="$EXTRA -DMOD_RFID=1" ;;   # needs mod_pn532.h
    --ota)  shift; OTA_IP="${1:-}" ;;
    --port) shift; PORT="${1:-}" ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$BOARD" ]; then
  echo "usage: $0 --b169|--b35|--b147|--b128 [--rfid] [--ota <ip>] [--port <tty>]" >&2
  exit 2
fi

OUT="${TMPDIR:-/tmp}/mjsx-board-$BOARD"
echo "board: $LABEL"

arduino-cli compile --fqbn "$FQBN" \
  --build-path "${TMPDIR:-/tmp}/mjsx-build-$BOARD" \
  --build-property "compiler.cpp.extra_flags=-DBOARD=$BOARD -DHAS_DISPLAY=1 -DHAS_JS=1$EXTRA" \
  --output-dir "$OUT" "$HERE" >/dev/null

BIN="$OUT/$NAME.ino.bin"
echo "built $(stat -f%z "$BIN" 2>/dev/null || stat -c%s "$BIN") bytes -> $BIN"

# OTA is the normal path. USB flashing on these boards is unreliable enough
# that taking a working board off the network to reflash it over a cable is
# a step backwards; keep the remote path alive and use it.
if [ -n "$OTA_IP" ]; then
  SIZE=$(stat -f%z "$BIN" 2>/dev/null || stat -c%s "$BIN")
  echo "sending to $OTA_IP"
  curl -fsS --max-time 240 -F "f=@$BIN" "http://$OTA_IP/update?size=$SIZE" >/dev/null
  echo "updated over the air"
fi

if [ -n "$PORT" ]; then
  arduino-cli upload --fqbn "$FQBN" --port "$PORT" --input-dir "$OUT" "$HERE"
  echo "flashed over USB"
fi
