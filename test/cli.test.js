/*
 * CLI tests: spawn the real `mjsx` binary and check the two properties a
 * command-line tool has to have — it finishes, and it says why when it
 * cannot.
 *
 * Nothing here touches a real board. The only address used is
 * 10.255.255.1, which is routable-looking but black-holes: a connect to it
 * never completes and never refuses, which is exactly the shape that used
 * to leave mjsx hanging. Fleet discovery is always pinned with --ips for
 * the same reason — an mDNS sweep would find whatever boards are actually
 * on the tester's LAN and start talking to them. The one test that does
 * broadcast is opt-in via MJSX_TEST_LAN=1.
 */
import { test, expect } from 'bun:test';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const BIN = path.join(REPO, 'packages/cli/bin/mjsx.js');
const BLACKHOLE = '10.255.255.1';

/* Run mjsx and report what a user would see, plus how long they waited. */
function mjsx(args, timeoutMs) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [BIN].concat(args), {
    cwd: REPO,
    encoding: 'utf8',
    timeout: timeoutMs || 20000,
    killSignal: 'SIGKILL'
  });
  return {
    code: r.status,
    signal: r.signal,
    out: r.stdout || '',
    err: r.stderr || '',
    both: (r.stdout || '') + (r.stderr || ''),
    ms: Date.now() - t0
  };
}

/* A user-facing failure is prose, not a dump: no "at frame" lines, no
   internal module paths, no bare "Error:" prefix. */
function expectNoStackTrace(r) {
  expect(r.both).not.toMatch(/^\s+at\s/m);
  expect(r.both).not.toMatch(/node:internal/);
  expect(r.both).not.toMatch(/\/packages\/cli\/src\/\S+:\d+/);
}

/* One actionable line on stderr, and nothing spilled onto stdout. */
function expectOneLineFailure(r) {
  expect(r.code).not.toBe(0);
  expect(r.signal).toBeNull();
  const lines = r.err.trim().split('\n').filter((l) => l.trim());
  expect(lines.length).toBe(1);
  expect(lines[0].length).toBeGreaterThan(10);
  expectNoStackTrace(r);
}

function scratch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjsx-cli-test-'));
  return path.join(dir, name);
}

/* ---- help and dispatch ---- */

test('--help prints usage and exits 0', () => {
  const r = mjsx(['--help']);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/^usage: mjsx <command>/);
  expect(r.err).toBe('');
});

test('an unknown command exits 1 with a line naming the real commands', () => {
  const r = mjsx(['definitely-not-a-command']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/unknown command "definitely-not-a-command"/);
  for (const cmd of ['dev', 'run', 'push', 'ota', 'device', 'fleet']) {
    expect(r.err).toContain(cmd);
  }
  expect(r.out).toBe('');
});

test('no command at all exits 1 rather than sitting there', () => {
  const r = mjsx([]);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/no command given/);
});

test('every command answers --help with exit 0', () => {
  for (const cmd of ['run', 'push', 'ota', 'device', 'fleet', 'dev']) {
    const r = mjsx([cmd, '--help']);
    expect(`${cmd}:${r.code}`).toBe(`${cmd}:0`);
    expect(r.out).toMatch(/^usage: mjsx /);
  }
});

/* ---- run: the one command that produces a file ---- */

test('run --ppm renders to a scratch file and exits 0', () => {
  const out = scratch('hello.ppm');
  const r = mjsx(['run', 'examples/hello/app.jsx', '--ppm', out, '--size', '120x140']);
  expect(r.code).toBe(0);
  expect(fs.existsSync(out)).toBe(true);

  /* Valid P6: magic, the size we asked for, maxval, then exactly w*h*3
     bytes of pixel data. */
  const buf = fs.readFileSync(out);
  const head = /^P6\n(\d+) (\d+)\n(\d+)\n/.exec(buf.subarray(0, 32).toString('latin1'));
  expect(head).not.toBeNull();
  const [w, h, max] = [Number(head[1]), Number(head[2]), Number(head[3])];
  expect([w, h, max]).toEqual([120, 140, 255]);
  expect(buf.length - head[0].length).toBe(w * h * 3);
}, 30000);

test('run with no app exits 1 with one line', () => {
  const r = mjsx(['run']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/missing <app\.jsx>/);
});

test('run on a file that is not there names the file, not a stack', () => {
  const r = mjsx(['run', '/nope/definitely/missing.jsx']);
  expectOneLineFailure(r);
  expect(r.err).toContain('/nope/definitely/missing.jsx');
});

test('run --ppm dangling at the end of the line is caught, not rendered', () => {
  const r = mjsx(['run', 'examples/hello/app.jsx', '--ppm']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/--ppm needs a value/);
});

test('run --ppm= with an empty path is caught, not rendered to the terminal', () => {
  const r = mjsx(['run', 'examples/hello/app.jsx', '--ppm=']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/--ppm needs an output path/);
});

/* A valued flag must not swallow the next flag as its value. */
test('run --ppm followed by another flag is caught, not fed "--size"', () => {
  const r = mjsx(['run', 'examples/hello/app.jsx', '--ppm', '--size', '10x10']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/--ppm needs a value/);
});

/* ---- unreachable devices: bounded, non-zero, legible ---- */

test('push to an unroutable address fails fast and cleanly', () => {
  const r = mjsx(['push', BLACKHOLE, 'examples/hello/app.jsx', '--timeout', '1'], 15000);
  expectOneLineFailure(r);
  expect(r.err).toContain(BLACKHOLE);
  expect(r.err).toMatch(/not answering|timed out|no route/);
  /* The board is probed before the bundle is built, so this costs a
     second — not a transpile plus the OS connect timeout. */
  expect(r.ms).toBeLessThan(6000);
}, 20000);

test('ota to an unroutable address fails fast and cleanly', () => {
  const fw = scratch('firmware.bin');
  fs.writeFileSync(fw, Buffer.alloc(1024, 7));
  const r = mjsx(['ota', BLACKHOLE, fw, '--timeout', '1'], 15000);
  expectOneLineFailure(r);
  expect(r.err).toContain(BLACKHOLE);
  expect(r.ms).toBeLessThan(6000);
}, 20000);

test('ota with a missing firmware file never opens a socket', () => {
  const r = mjsx(['ota', BLACKHOLE, '/nope/firmware.bin', '--timeout', '1']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/no such file/);
  expect(r.ms).toBeLessThan(3000);
});

test('push rejects a file where the address belongs', () => {
  const r = mjsx(['push', 'examples/hello/app.jsx', BLACKHOLE]);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/is a file, not a board address/);
});

/* ---- fleet: a bounded discovery window, then exit ---- */

test('fleet ls --wait 1 finishes inside the window and exits 0', () => {
  const r = mjsx(['fleet', 'ls', '--wait', '1', '--ips', BLACKHOLE], 10000);
  expect(r.signal).toBeNull();
  expect(r.code).toBe(0);
  expect(r.ms).toBeLessThan(3000);
  expect(r.both).toContain(BLACKHOLE);
  expectNoStackTrace(r);
}, 15000);

test('fleet ls prints a result line per board and a count', () => {
  const r = mjsx(['fleet', 'ls', '--wait', '1', '--ips', `${BLACKHOLE},10.255.255.2`], 10000);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/no \/info:/);
  expect(r.out).toMatch(/^2 board\(s\)$/m);
  expect(r.ms).toBeLessThan(4000);
}, 15000);

test('fleet push against an unreachable board exits non-zero', () => {
  const r = mjsx(['fleet', 'push', 'examples/hello/app.jsx', '--ips', BLACKHOLE, '--timeout', '1'], 60000);
  expect(r.signal).toBeNull();
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/1 of 1 board\(s\) failed/);
  expectNoStackTrace(r);
}, 90000);

test('fleet ota with no firmware argument exits 1 before discovery runs', () => {
  const r = mjsx(['fleet', 'ota']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/missing <firmware\.bin>/);
  expect(r.ms).toBeLessThan(3000);
});

test('an unknown fleet subcommand exits 1 and names the real ones', () => {
  const r = mjsx(['fleet', 'nope']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/ls, push or ota/);
});

/* A bare --wait 2500 used to mean milliseconds. It now means 2500
   seconds, which is a hang by another name, so it is refused. */
test('--wait rejects a duration that would outlast the user', () => {
  const r = mjsx(['fleet', 'ls', '--wait', '2500', '--ips', BLACKHOLE]);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/2500ms if you meant milliseconds/);
  expect(r.ms).toBeLessThan(3000);
});

test('--wait rejects nonsense instead of defaulting silently', () => {
  const r = mjsx(['fleet', 'ls', '--wait', 'soon', '--ips', BLACKHOLE]);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/wants a duration/);
});

test('--wait takes an explicit ms suffix', () => {
  const r = mjsx(['fleet', 'ls', '--wait', '600ms', '--ips', BLACKHOLE], 10000);
  expect(r.code).toBe(0);
  expect(r.ms).toBeLessThan(3000);
}, 15000);

/* A bad --subnet must not cost a discovery window before it is noticed. */
test('a malformed --subnet is refused before discovery starts', () => {
  const r = mjsx(['fleet', 'ls', '--subnet', 'not-a-subnet', '--wait', '5']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/first three octets/);
  expect(r.ms).toBeLessThan(3000);
});

test('an empty --ips list is refused rather than treated as "the whole LAN"', () => {
  const r = mjsx(['fleet', 'ls', '--ips', '']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/--ips is empty/);
  expect(r.ms).toBeLessThan(3000);
});

/* ---- missing optional dependency ---- */

test('device wifi asks for serialport by name when it is not installed', () => {
  let installed = true;
  try { require.resolve('serialport'); } catch (e) { installed = false; }
  if (installed) return; /* the dep is optional; nothing to prove here */
  const r = mjsx(['device', 'wifi', 'auto', '--ssid', 'x']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/bun add serialport/);
  expect(r.ms).toBeLessThan(5000);
});

test('device wifi with no port exits 1 with one line', () => {
  const r = mjsx(['device', 'wifi']);
  expectOneLineFailure(r);
  expect(r.err).toMatch(/missing <port\|auto>/);
});

/* ---- --debug ---- */

test('--debug adds the stack that plain output withholds', () => {
  const plain = mjsx(['push', BLACKHOLE, 'examples/hello/app.jsx', '--timeout', '1'], 15000);
  const debug = mjsx(['push', BLACKHOLE, 'examples/hello/app.jsx', '--timeout', '1', '--debug'], 15000);
  expect(plain.code).not.toBe(0);
  expect(debug.code).not.toBe(0);
  expect(plain.err).not.toMatch(/^\s+at\s/m);
  expect(debug.err).toMatch(/^\s+at\s/m);
  /* Same headline either way. */
  expect(debug.err.split('\n')[0]).toBe(plain.err.split('\n')[0]);
}, 30000);

test('--debug on an argument error shows where it was raised', () => {
  const r = mjsx(['run', '/nope/missing.jsx', '--debug']);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/^\s+at\s/m);
});

/* ---- opt-in: real multicast discovery on the tester's own LAN ---- *
 * Off by default so `bun test` never broadcasts or talks to hardware.
 * MJSX_TEST_LAN=1 bun test  runs the real thing, and asserts only what
 * this whole change is about: the window closes and mjsx exits.          */
const LAN = process.env.MJSX_TEST_LAN === '1';
test.skipIf(!LAN)('fleet ls over real mDNS still exits inside its window', () => {
  const r = mjsx(['fleet', 'ls', '--wait', '1'], 12000);
  expect(r.signal).toBeNull();
  expect(r.code).toBe(0);
  expect(r.ms).toBeLessThan(5000);
}, 20000);
