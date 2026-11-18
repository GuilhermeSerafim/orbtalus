import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('network guard denies Node DNS/UDP/TCP/HTTP boundaries without calling originals', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./support/network-guard-probe.mjs', import.meta.url))],
    {encoding: 'utf8', timeout: 15000});
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  const evidence = JSON.parse(child.stdout.trim());
  assert.equal(evidence.originalCalls, 0, 'every native boundary is replaced by a sentinel; none may be called');
  for (const result of evidence.results) assert.equal(result.error, result.expected, result.name);
  for (const name of ['dns.resolve4', 'dns.resolve6', 'dns.reverse', 'dns.promises.resolve4',
    'Resolver.resolve4', 'Resolver.reverse', 'promises.Resolver.resolve6', 'promises.Resolver.reverse',
    'existing UDP.send', 'existing UDP.connect', 'UDP constructor', 'UDP named constructor',
    'DNS named resolve4', 'DNS promise named resolve6']) {
    assert.ok(evidence.results.some(result => result.name === name), `required boundary ${name} is present`);
  }
  assert.equal(child.status, 1, 'deliberate forbidden attempts make the child fail closed');
  assert.match(child.stderr, new RegExp(`unmocked egress=${evidence.external}; denied local pipes=${evidence.pipes}\\b`));
  console.log(`Isolated guard proof: ${evidence.external} external denials, ${evidence.pipes} local denials, originals=${evidence.originalCalls}`);
});
