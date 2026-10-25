import { createHash } from 'node:crypto';

export function fingerprintFiles(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    // Frame both path and length, so renames and byte-boundary changes invalidate.
    hash.update(JSON.stringify([file.name, file.bytes.byteLength]) + '\n');
    hash.update(file.bytes);
  }
  return hash.digest('hex').slice(0, 14);
}

export function renderWorker({ namespace, version, urls }) {
  return `// Generated from actual build paths and bytes. Assets are cached atomically.
const PREFIX = ${JSON.stringify(namespace + '-v2:')} + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + ${JSON.stringify(version)};
const FILES = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(url => new Request(new URL(url, self.registration.scope), { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    // These immutable local files can have different Origin request headers.
    if (request.mode === 'navigate') {
      const shell = await cache.match(new URL('index.html', self.registration.scope), { ignoreVary: true });
      if (shell) return shell;
    }
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    try { return await fetch(request); }
    catch {
      if (request.mode === 'navigate') return await cache.match(new URL('index.html', self.registration.scope), { ignoreVary: true }) || Response.error();
      return Response.error();
    }
  }));
});
`;
}
