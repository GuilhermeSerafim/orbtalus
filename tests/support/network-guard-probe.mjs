// Isolated child: replace native boundaries with sentinels BEFORE loading the
// real guard. Even a broken guard can only call a sentinel, never the network.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram, * as dgramExports from 'node:dgram';
import dns, * as dnsExports from 'node:dns';
import dnsPromises, * as promiseExports from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

let originalCalls = 0;
const sentinel = () => { originalCalls++; throw new Error('ORIGINAL_NETWORK_CALLED'); };
const cases = [];
const add = (name, invoke, localPipe = false) => cases.push({name, invoke, localPipe});
const methods = target => {
  const names = new Set();
  for (let object = target; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
    for (const name of Object.getOwnPropertyNames(object)) {
      if (/^(lookup|resolve|reverse)/.test(name) && typeof target[name] === 'function') names.add(name);
    }
  }
  return [...names];
};
for (const [label, target, receiver] of [
  ['dns', dns, dns], ['dns.promises', dnsPromises, dnsPromises],
  ['Resolver', dns.Resolver.prototype, Object.create(dns.Resolver.prototype)],
  ['promises.Resolver', dnsPromises.Resolver.prototype, Object.create(dnsPromises.Resolver.prototype)],
]) {
  for (const name of methods(target)) {
    target[name] = sentinel;
    add(`${label}.${name}`, () => receiver[name]('example.test', () => {}));
  }
}
// Capture prototype before the guard replaces the constructor: sockets created
// earlier must also be denied. Object.create avoids constructing native handles.
const udpPrototype = dgram.Socket.prototype;
for (const name of ['connect', 'send', 'bind']) {
  udpPrototype[name] = sentinel;
  add(`existing UDP.${name}`, () => udpPrototype[name].call(Object.create(udpPrototype)));
}
function SocketSentinel() { return sentinel(); }
SocketSentinel.prototype = udpPrototype;
dgram.Socket = SocketSentinel;
dgram.createSocket = sentinel;
add('UDP constructor', () => new dgram.Socket('udp4'));
add('UDP named constructor', () => new dgramExports.Socket('udp4'));
add('UDP factory', () => dgram.createSocket('udp4'));
add('UDP named factory', () => dgramExports.createSocket('udp4'));
net.Socket.prototype.connect = sentinel;
tls.connect = http.request = http.get = https.request = https.get = sentinel;
globalThis.fetch = sentinel;
add('TCP socket', () => net.Socket.prototype.connect.call({}, {host: 'example.test', port: 443}));
add('TCP connect', () => net.connect({host: 'example.test', port: 443}));
add('TCP createConnection', () => net.createConnection({host: 'example.test', port: 443}));
add('TLS connect', () => tls.connect({host: 'example.test', port: 443}));
for (const [label, target] of [['http', http], ['https', https]]) {
  for (const name of ['get', 'request']) add(`${label}.${name}`, () => target[name]('https://example.test'));
}
add('fetch', () => fetch('https://example.test'));
add('DNS named resolve4', () => dnsExports.resolve4('example.test', () => {}));
add('DNS promise named resolve6', () => promiseExports.resolve6('example.test'));
for (const path of ['\\\\?\\pipe\\tsx-test', '\\\\.\\pipe\\tsx-test']) {
  add(`local pipe ${path}`, () => net.Socket.prototype.connect.call({}, path), true);
  add(`local pipe options ${path}`, () => net.Socket.prototype.connect.call({}, {path}), true);
  add(`local pipe normalized ${path}`, () => net.Socket.prototype.connect.call({}, [{path}]), true);
}
const tsxParentPipe = join(tmpdir(), `tsx-${process.geteuid?.() ?? userInfo().username}`, `${process.ppid}.pipe`);
add('tsx parent IPC in socket options', () => net.Socket.prototype.connect.call({}, [{path: tsxParentPipe}]), true);
add('unrelated local socket', () => net.Socket.prototype.connect.call({}, {path: join(tmpdir(), 'other.sock')}));
syncBuiltinESMExports();
await import('./network-guard.mjs');
const results = [];
for (const {name, invoke, localPipe} of cases) {
  let error;
  try { await invoke(); } catch (caught) { error = caught.message; }
  results.push({name, error, expected: localPipe ? 'TEST_LOCAL_PIPE_FORBIDDEN' : 'TEST_NETWORK_FORBIDDEN'});
}
console.log(JSON.stringify({originalCalls, results, external: cases.filter(c => !c.localPipe).length,
  pipes: cases.filter(c => c.localPipe).length}));
// Deliberate attempts must cause exit1 via the real guard's exit handler. The
// parent verifies this status and the exact external/local counters separately.
