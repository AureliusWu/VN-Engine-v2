import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { listenBrowserServer } from '../tools/browser-server.mjs';

function server(t) {
  const value = createServer((_request, response) => response.end('browser server fixture'));
  t.after(async () => {
    value.closeAllConnections();
    if (value.listening) await new Promise((resolve, reject) => value.close(error => error ? reject(error) : resolve()));
  });
  return value;
}
const listeners = value => ({ error: value.listenerCount('error'), listening: value.listenerCount('listening') });

test('the browser server actually serves HTTP on IPv4 loopback in the dynamic high range', async t => {
  const value = server(t), before = listeners(value), address = await listenBrowserServer(value);
  assert.equal(address.address, '127.0.0.1'); assert.equal(address.family, 'IPv4');
  assert.ok(address.port >= 49152 && address.port <= 65535);
  assert.equal(await (await fetch(`http://127.0.0.1:${address.port}/`)).text(), 'browser server fixture');
  assert.deepEqual(listeners(value), before);
});

test('a real occupied port retries another high port and cleans its own event listeners', async t => {
  const occupied = server(t), value = server(t);
  const blockedPort = (await listenBrowserServer(occupied)).port, before = listeners(value); let picks = 0;
  const address = await listenBrowserServer(value, { attempts: 8, pickPort: () => ++picks === 1 ? blockedPort : randomInt(49152, 65536) });
  assert.ok(picks >= 2 && picks <= 8); assert.notEqual(address.port, blockedPort);
  assert.equal(await (await fetch(`http://127.0.0.1:${address.port}/`)).text(), 'browser server fixture');
  assert.deepEqual(listeners(value), before);
});

test('repeated real collisions stop at the retry budget and preserve the final native error', async t => {
  const occupied = server(t), value = server(t);
  const blockedPort = (await listenBrowserServer(occupied)).port, before = listeners(value); let picks = 0;
  await assert.rejects(listenBrowserServer(value, { attempts: 3, pickPort: () => { picks++; return blockedPort; } }), { code: 'EADDRINUSE' });
  assert.equal(picks, 3); assert.equal(value.listening, false); assert.deepEqual(listeners(value), before);
});

test('invalid injected ports and attempt budgets reject without opening a listener', async t => {
  const value = server(t), before = listeners(value);
  for (const port of [0, 6668, 49151, 65536, 50000.5, NaN, '50000']) {
    await assert.rejects(listenBrowserServer(value, { pickPort: () => port }), /port must be an integer from 49152 to 65535/);
    assert.equal(value.listening, false);
  }
  for (const attempts of [0, -1, 1.5, Infinity, NaN, 129])
    await assert.rejects(listenBrowserServer(value, { attempts }), /attempts must be an integer from 1 to 128/);
  assert.deepEqual(listeners(value), before);
});

test('an already-listening server propagates its native error without retrying or closing it', async t => {
  const value = server(t), address = await listenBrowserServer(value), before = listeners(value); let picks = 0;
  await assert.rejects(listenBrowserServer(value, { attempts: 3, pickPort: () => { picks++; return address.port; } }), { code: 'ERR_SERVER_ALREADY_LISTEN' });
  assert.equal(picks, 1); assert.equal(value.address().port, address.port); assert.equal(value.listening, true);
  assert.deepEqual(listeners(value), before);
});
