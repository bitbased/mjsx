/*
 * One-shot mDNS service discovery, hand-rolled over dgram — small enough
 * that the multicast-dns package is not needed. The PTR question goes out
 * from an ephemeral port (an RFC 6762 "legacy unicast" query), so every
 * responder answers straight back to this socket and we never contend
 * with the OS resolver for port 5353.
 */
var dgram = require('dgram');

function encodeName(name) {
  var parts = name.split('.');
  var bufs = [];
  for (var i = 0; i < parts.length; i++) {
    bufs.push(Buffer.from([parts[i].length]));
    bufs.push(Buffer.from(parts[i], 'utf8'));
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

/* DNS name at msg[off], following compression pointers; returns the
   dotted name and the offset just past the name's first encoding. */
function parseName(msg, off) {
  var labels = [], jumped = false, next = off, guard = 0;
  while (guard++ < 128 && off < msg.length) {
    var len = msg[off];
    if (len === 0) { if (!jumped) next = off + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) next = off + 2;
      off = ((len & 0x3f) << 8) | msg[off + 1];
      jumped = true;
      continue;
    }
    labels.push(msg.slice(off + 1, off + 1 + len).toString('utf8'));
    off += 1 + len;
  }
  return { name: labels.join('.'), next: next };
}

function queryPacket(service) {
  var head = Buffer.alloc(12);
  head.writeUInt16BE(0x6d6a, 0); /* nonzero id, required for legacy unicast */
  head.writeUInt16BE(1, 4);      /* one question */
  var tail = Buffer.alloc(4);
  tail.writeUInt16BE(12, 0);     /* PTR */
  tail.writeUInt16BE(1, 2);      /* IN */
  return Buffer.concat([head, encodeName(service), tail]);
}

/* Instance names from any PTR record for `service` in the packet. */
function ptrInstances(msg, service) {
  var found = [];
  try {
    var qd = msg.readUInt16BE(4);
    var total = msg.readUInt16BE(6) + msg.readUInt16BE(8) + msg.readUInt16BE(10);
    var off = 12;
    for (var q = 0; q < qd; q++) off = parseName(msg, off).next + 4;
    for (var i = 0; i < total && off + 10 <= msg.length; i++) {
      var n = parseName(msg, off); off = n.next;
      var type = msg.readUInt16BE(off);
      var rdlen = msg.readUInt16BE(off + 8);
      var rdoff = off + 10;
      off = rdoff + rdlen;
      if (type === 12 && n.name.toLowerCase() === service.toLowerCase()) {
        found.push(parseName(msg, rdoff).name);
      }
    }
  } catch (e) {}
  return found;
}

/* Resolves to [{ip, name}] — the responder's address plus the instance
   label from its PTR answer. Asks twice (UDP on a busy band) and
   collects until waitMs is up. */
function discover(service, waitMs) {
  return new Promise(function (resolve) {
    var sock = dgram.createSocket('udp4');
    var seen = new Map();
    function finish() {
      try { sock.close(); } catch (e) {}
      resolve(Array.from(seen.values()));
    }
    sock.on('message', function (msg, rinfo) {
      var inst = ptrInstances(msg, service);
      if (inst.length) seen.set(rinfo.address, { ip: rinfo.address, name: inst[0].split('.')[0] });
    });
    sock.on('error', finish);
    sock.bind(0, function () {
      var pkt = queryPacket(service);
      sock.send(pkt, 5353, '224.0.0.251');
      setTimeout(function () { try { sock.send(pkt, 5353, '224.0.0.251'); } catch (e) {} }, 700);
    });
    setTimeout(finish, waitMs || 2500);
  });
}

module.exports = { discover: discover };
