// Push mjsx-core + the examples to a filament-rfid-bridge board as its UI.
//
//   bun backends/esp32/tools/push-examples.mjs <ip> [example ...]
//
// The bridge firmware already speaks mjsx's world: its native `gfx` object
// IS the 10-call contract (mjsx inherited it from that device), its UI
// thread calls UI.ticker()/render()/pointer(), and it swaps /app.js over
// TCP without reflashing. So "make the examples run on the ESP32" is a
// BUNDLE, not a firmware: mjsx-core, a small device shim (3-arg pointer,
// touch dead bands), each example wrapped as a lazy function, and a menu.
//
// The bundle is validated in the kit repo's MicroQuickJS harness (same
// engine build as the firmware) before a byte leaves this machine.
import net from "node:net";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MJSX = join(here, "../../..");
const KIT = "/Users/brantwedel/bitbased/kit/projects/filament-rfid";
const HARNESS = join(KIT, "firmware/esp32/mquickjs-host/harness");

const ip = process.argv[2];
if (!ip) { console.error("usage: bun push-examples.mjs <ip> [example ...]"); process.exit(1); }
const wanted = process.argv.slice(3);

const TSC = join(KIT, "node_modules/.bin/tsc");

function transpile(file) {
  /* tsc, not Bun: tsc never MODERNISES -- Bun rewrites ES5 source into
     shorthand, destructuring and template literals, all of which
     MicroQuickJS rejects. The examples are written in the ES5 subset
     already, so tsc only has the JSX to transform and prints the rest
     as it was written. (ES5 as a target is gone in TS7; irrelevant,
     since nothing here needs downlevelling.) */
  const dir = mkdtempSync(join(tmpdir(), "mjsx-tsc-"));
  /* .jsx + allowJs: plain JavaScript with JSX, transformed but never
     type-checked, so unknown globals (h, UI, gfx) are not errors */
  const src = join(dir, "in.jsx");
  writeFileSync(src, readFileSync(file, "utf8"));
  execFileSync(TSC, [
    "--jsx", "react", "--jsxFactory", "h", "--jsxFragmentFactory", "Fragment",
    "--target", "es2015", "--module", "commonjs", "--noResolve", "--skipLibCheck",
    "--allowJs", "--ignoreConfig", "--outDir", dir, src
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return readFileSync(join(dir, "in.js"), "utf8");
}

// ---- assemble ----
const exDir = join(MJSX, "examples");
let names = readdirSync(exDir).filter((n) => existsSync(join(exDir, n, "app.jsx"))).sort();
if (wanted.length) names = names.filter((n) => wanted.includes(n));

let bundle = readFileSync(join(MJSX, "packages/core/src/mjsx.js"), "utf8");
bundle += "\n" + readFileSync(join(here, "device-shim.js"), "utf8");
/* the desktop runners give each app a CommonJS `module` for the optional
   demo() export; the engine has no such global. Same stub as
   packages/cli/src/bundle.js. */
bundle += "\nvar module = { exports: {} };\n";
for (const n of names) {
  const code = transpile(join(exDir, n, "app.jsx"));
  bundle += `\n/* ---- example: ${n} ---- */\nEXAMPLES.push(['${n}', function () {\n${code}\n}]);\n`;
}
bundle += "\n" + readFileSync(join(here, "device-menu.js"), "utf8");

const out = join(mkdtempSync(join(tmpdir(), "mjsx-esp32-")), "app.bundle.js");
writeFileSync(out, bundle);
console.log(`bundle: ${bundle.length} bytes, examples: ${names.join(", ")}`);

// ---- validate in the real engine ----
if (existsSync(HARNESS)) {
  let ho;
  try { ho = execFileSync(HARNESS, [out, "render"], { encoding: "utf8" }); }
  catch (e) { ho = (e.stdout || "") + (e.stderr || ""); }
  if (/EXCEPTION/.test(ho)) {
    const m = ho.match(/app\.bundle\.js:(\d+)/);
    const lines = ho.split("\n").filter((l) => /EXCEPTION|^\s+at /.test(l));
    if (m) {
      const src = bundle.split("\n"); const n = Number(m[1]);
      for (let i = Math.max(0, n - 2); i < Math.min(src.length, n + 1); i++) lines.push(`  ${i + 1} | ${src[i]}`);
    }
    console.error("engine rejected the bundle:\n" + lines.join("\n"));
    process.exit(1);
  }
  console.log("engine check: ok");
} else {
  console.warn("harness not built - pushing unchecked");
}

// ---- push (the bridge's line protocol on :8765) ----
const s = net.connect(8765, ip);
let buf = "", queue = [], inFlight = null;
const send = (obj) => new Promise((res, rej) => { queue.push({ obj, res, rej }); pump(); });
function pump() {
  if (inFlight || !queue.length) return;
  inFlight = queue.shift();
  s.write(JSON.stringify({ i: 1, ...inFlight.obj }) + "\n");
}
s.on("data", (d) => {
  buf += d.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.i !== undefined && inFlight) { const f = inFlight; inFlight = null; f.res(m); pump(); }
  }
});
s.on("error", (e) => { console.error("link:", e.message); process.exit(1); });
setTimeout(() => { console.error("timed out"); process.exit(1); }, 180000);

s.on("connect", async () => {
  const bytes = Buffer.from(bundle, "utf8");
  console.log(`pushing ${bytes.length} bytes to ${ip} ...`);
  const CHUNK = 3072;
  for (let off = 0, first = true; off < bytes.length; off += CHUNK, first = false) {
    const r = await send({ c: "fput", name: "/app.js", first, b64: bytes.subarray(off, off + CHUNK).toString("base64") });
    if (!r.ok) { console.error("fput failed:", r.err); process.exit(1); }
    process.stdout.write(".");
  }
  // Reboot rather than frun: the firmware's run marker EVALS INTO THE
  // EXISTING context (jsBegin returns the live one), so a re-push loads
  // the new bundle on top of the old app and everything it retained --
  // enough, with a ~115KB bundle, to exhaust the 2MB heap. A boot runs
  // /app.js in a fresh arena.
  console.log("\nrebooting into the new bundle ...");
  send({ c: "reboot" }).catch(() => {});
  await new Promise((x) => setTimeout(x, 15000));
  for (let i = 0; i < 20; i++) {
    try {
      const t = await fetch("http://" + ip + "/state", { signal: AbortSignal.timeout(3000) });
      if (t.ok) { console.log("OK: rebooted, bundle running"); process.exit(0); }
    } catch (e) {}
    await new Promise((x) => setTimeout(x, 1500));
  }
  console.error("board did not come back"); process.exit(1);
});
