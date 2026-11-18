// Preloaded before TypeScript or application imports. No connection is allowed.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
let attempts = 0;
let blockedLocalPipes = 0;
const deny = () => { attempts++; throw new Error('TEST_NETWORK_FORBIDDEN'); };
net.Socket.prototype.connect = function (...args) {
  // tsx checks for an optional parent via Windows named pipe. Deny that too,
  // but distinguish it from TCP/HTTP egress. Never call the original connect.
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const path = typeof options === 'string' ? options : options?.path;
  if (typeof path === 'string' && (path.startsWith('\\\\?\\pipe\\') || path.startsWith('\\\\.\\pipe\\'))) {
    blockedLocalPipes++;
    throw new Error('TEST_LOCAL_PIPE_FORBIDDEN');
  }
  return deny();
};
tls.connect = deny;
http.request = http.get = https.request = https.get = deny;
dgram.createSocket = deny;
// Deny both factory and public constructor, including sockets instantiated
// before preload. No native UDP handle is constructed by the replacement.
const udpPrototype = dgram.Socket.prototype;
udpPrototype.connect = udpPrototype.send = udpPrototype.bind = deny;
dgram.Socket = function ForbiddenSocket() { return deny(); };
dgram.Socket.prototype = udpPrototype;
// Resolver has resolve*/reverse methods on its prototype; global callback and
// promise APIs also expose lookupService. Cover every such API in this runtime.
for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (let object = target; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
    for (const name of Object.getOwnPropertyNames(object)) {
      if (/^(lookup|resolve|reverse)/.test(name) && typeof target[name] === 'function') target[name] = deny;
    }
  }
}
globalThis.fetch = deny;
syncBuiltinESMExports();
process.on('exit', () => {
  process.stderr.write(`Network guard: unmocked egress=${attempts}; denied local pipes=${blockedLocalPipes}\n`);
  if (attempts !== 0) process.exitCode = 1;
});
