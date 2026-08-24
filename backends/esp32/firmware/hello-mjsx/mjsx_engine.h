#pragma once
/*
 * The engine include lives in its own header, not the .ino.
 *
 * The Arduino preprocessor scans the .ino for function definitions to
 * auto-generate prototypes, and its scan carries `extern "C"` state past
 * the end of a block on that file specifically — so a setup()/loop() that
 * follows an extern "C" block in the .ino itself comes out declared with
 * C linkage, which conflicts with the C++-linkage prototypes Arduino.h
 * already declared for them. Headers are not subject to this scan.
 */
extern "C" {
#include "src/engine/mquickjs.h"
extern const JSSTDLibraryDef js_stdlib;
}
