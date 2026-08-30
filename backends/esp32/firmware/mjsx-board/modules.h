#pragma once
/*
 * Runtime module registry.
 *
 * Compile flags (MOD_PRINTER, MOD_RFID, ...) decide what is PRESENT in
 * the firmware; this registry decides what is RUNNING, and JS is a
 * first-class operator: sys.mods() lists them, sys.modCtl(name, action)
 * starts and stops them. Everything is ASYNC by design -- control calls
 * return immediately, and results, readings and state changes arrive as
 * state patches through the same queue the printer feed already uses
 * (UI.patch -> UI.state), so a script subscribes by simply rendering
 * from state.
 *
 * The registration table is filled in the sketch, where the modules'
 * functions live. A module that is compiled out is simply never
 * registered; sys.modCtl on an unknown name answers 0.
 */

struct BridgeMod {
  const char *name;
  bool running;
  bool (*startFn)();          // begin work; quick, non-blocking
  void (*stopFn)();           // cease work; quick
  void (*tickFn)();           // called every loop() while running
  int (*statusFn)(char *out, int cap);  // JSON object body, may be empty
  int (*ctlFn)(const char *action);     // module-specific actions ("snap")
};

#define BRIDGE_MOD_MAX 8
static BridgeMod g_bridgeMods[BRIDGE_MOD_MAX];
static int g_bridgeModCount = 0;

static void modRegister(const char *name, bool running,
                        bool (*startFn)(), void (*stopFn)(), void (*tickFn)(),
                        int (*statusFn)(char *, int),
                        int (*ctlFn)(const char *) = nullptr) {
  if (g_bridgeModCount >= BRIDGE_MOD_MAX) return;
  BridgeMod &m = g_bridgeMods[g_bridgeModCount++];
  m.name = name;
  m.running = running;
  m.startFn = startFn;
  m.stopFn = stopFn;
  m.tickFn = tickFn;
  m.statusFn = statusFn;
  m.ctlFn = ctlFn;
}

static int modFind(const char *name) {
  for (int i = 0; i < g_bridgeModCount; i++) {
    if (!strcmp(g_bridgeMods[i].name, name)) return i;
  }
  return -1;
}

static void modsTick() {
  for (int i = 0; i < g_bridgeModCount; i++) {
    if (g_bridgeMods[i].running && g_bridgeMods[i].tickFn) g_bridgeMods[i].tickFn();
  }
}

/* ---- the JS-facing natives (referenced from the stdlib tables) ---- */
extern "C" {

int sysNMods(char *out, int cap) {
  int used = snprintf(out, cap, "[");
  for (int i = 0; i < g_bridgeModCount; i++) {
    BridgeMod &m = g_bridgeMods[i];
    used += snprintf(out + used, cap - used, "%s{\"name\":\"%s\",\"running\":%s",
                     i ? "," : "", m.name, m.running ? "true" : "false");
    if (m.statusFn && used < cap - 8) {
      used += snprintf(out + used, cap - used, ",\"status\":{");
      used += m.statusFn(out + used, cap - used);
      used += snprintf(out + used, cap - used, "}");
    }
    used += snprintf(out + used, cap - used, "}");
    if (used >= cap - 100) break;
  }
  used += snprintf(out + used, cap - used, "]");
  return used;
}

/* actions: "start", "stop". Returns 1 accepted, 0 unknown/failed.
   Async: acceptance is immediate; effects and readings arrive as
   patches. */
int sysNModCtl(const char *name, int nlen, const char *action, int alen) {
  char nm[24], ac[16];
  snprintf(nm, sizeof(nm), "%.*s", nlen > 23 ? 23 : nlen, name);
  snprintf(ac, sizeof(ac), "%.*s", alen > 15 ? 15 : alen, action);
  int i = modFind(nm);
  if (i < 0) return 0;
  BridgeMod &m = g_bridgeMods[i];
  if (!strcmp(ac, "start")) {
    if (m.running) return 1;
    if (m.startFn && !m.startFn()) return 0;
    m.running = true;
    return 1;
  }
  if (!strcmp(ac, "stop")) {
    if (!m.running) return 1;
    if (m.stopFn) m.stopFn();
    m.running = false;
    return 1;
  }
  /* module-specific actions, only while running ("snap") */
  if (m.running && m.ctlFn) return m.ctlFn(ac);
  return 0;
}

}  // extern "C"
