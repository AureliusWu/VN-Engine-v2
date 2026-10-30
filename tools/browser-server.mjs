import { randomInt } from 'node:crypto';

const firstPort = 49152, lastPort = 65535;
const retryable = new Set(['EADDRINUSE', 'EACCES']);

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { server.off('error', failed); server.off('listening', ready); };
    const failed = error => { cleanup(); reject(error); };
    const ready = () => { cleanup(); resolve(); };
    server.once('error', failed); server.once('listening', ready);
    try { server.listen({ host: '127.0.0.1', port, exclusive: true }); }
    catch (error) { failed(error); }
  });
}

/** Use browser-safe dynamic ports without changing browser or operating-system policy. */
export async function listenBrowserServer(server, { pickPort = () => randomInt(firstPort, lastPort + 1), attempts = 16 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 128) throw new RangeError('Browser server attempts must be an integer from 1 to 128');
  if (typeof pickPort !== 'function') throw new TypeError('Browser server pickPort must be a function');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const port = pickPort();
    if (!Number.isInteger(port) || port < firstPort || port > lastPort) throw new RangeError('Browser server port must be an integer from 49152 to 65535');
    try { await listen(server, port); return server.address(); }
    catch (error) { if (!retryable.has(error.code) || attempt + 1 === attempts) throw error; }
  }
}
