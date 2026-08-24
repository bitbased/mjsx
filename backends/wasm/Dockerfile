# Reproducible WASM build of the mjsx engine — the SAME C source that
# targets ESP32 (backends/esp32/engine), compiled with Emscripten instead
# of the Arduino/Xtensa toolchain. Docker exists here for one reason:
# Emscripten's version pinning is notoriously fussy to get right on a bare
# machine, and this makes the build reproducible on anyone's laptop without
# them installing emsdk themselves.
FROM emscripten/emsdk:3.1.51

WORKDIR /src
COPY . /src

RUN mkdir -p /out && \
    emcc \
      -O2 \
      -I/src/engine \
      /src/engine/mquickjs.c \
      /src/engine/cutils.c \
      /src/engine/dtoa.c \
      /src/engine/libm.c \
      /src/glue.c \
      -s EXPORTED_FUNCTIONS=_mjsxInit,_mjsxEval,_mjsxRenderTick \
      -s EXPORTED_RUNTIME_METHODS=cwrap,ccall \
      -s ALLOW_MEMORY_GROWTH=1 \
      -s MODULARIZE=1 \
      -s EXPORT_NAME=createMjsxModule \
      -o /out/mjsx.js

CMD ["true"]
