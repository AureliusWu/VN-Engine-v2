import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createDemoServer } from '../tools/serve.mjs';

const server = await createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/engine/`); await page.waitForSelector('.vn-engine');
  await page.evaluate(async () => {
    const { mountGame } = await import('./lib/index.js'); vnDemo.dispose();
    const project = { schema: 1, game: 'timeline-fixture', version: 'v1', title: 'Timeline fixture', type: 'narrative', settings: { textDelayMs: 0 },
      assets: [{ id: 'room', kind: 'background', src: 'assets/bedroom.svg' }, { id: 'hero', kind: 'portrait', src: 'assets/student.svg' }],
      stage: { lines: { one: { layers: { background: { asset: 'room', kind: 'background' }, 'character-front': { asset: 'hero', kind: 'portrait' } },
        timeline: { durationMs: 1200, animations: [{ id: 'enter', layer: 'character-front', target: 'hero', from: { x: 0, y: 0, scale: 1, opacity: 0 }, to: { x: 90, y: 30, scale: 1.5, opacity: .8 }, durationMs: 1200 }],
          camera: [{ atMs: 0, x: 0, y: 0, scale: 1 }, { atMs: 1200, x: 40, y: 10, scale: 1.2 }] } } } },
      scenes: [{ id: 'start', lines: [{ id: 'one', speaker: 'Narrator', text: 'one' }, { id: 'two', speaker: 'Narrator', text: 'two' }], ending: 'done' }] };
    globalThis.timelineGame = mountGame(document.getElementById('game'), project, { audio: false, storage: null });
  });
  const layer = page.locator('[data-layer="character-front"]'); await layer.waitFor({ state: 'visible' });
  assert.equal(await layer.getAttribute('data-asset'), 'hero');
  assert.equal(await page.evaluate(() => document.querySelector('.vn-camera').contains(document.querySelector('.vn-reading'))), false);
  await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-layer="character-front"]')).transform).m41 > 1);
  await page.evaluate(() => timelineGame.session.hide(true));
  const hidden = await layer.evaluate(node => node.style.transform); await page.waitForTimeout(120);
  assert.equal(await layer.evaluate(node => node.style.transform), hidden);
  await page.evaluate(() => timelineGame.session.hide(false));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: true } })));
  const backgrounded = await layer.evaluate(node => node.style.transform); await page.waitForTimeout(120);
  assert.equal(await layer.evaluate(node => node.style.transform), backgrounded);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('vn-engine-host-visibility', { detail: { hidden: false } })));
  await page.waitForFunction(() => document.querySelector('[data-layer="character-front"]').style.transform === 'translate(90px, 30px) scale(1.5)');
  assert.equal(await layer.evaluate(node => node.style.opacity), '0.8');
  assert.equal(await page.locator('.vn-camera').evaluate(node => node.style.transform), 'translate(40px, 10px) scale(1.2)');
  await page.evaluate(() => timelineGame.session.next());
  assert.equal(await layer.evaluate(node => node.style.transform), 'translate(90px, 30px) scale(1.5)');
  const restored = await page.evaluate(() => { const save = timelineGame.session.save(); timelineGame.session.restart(); timelineGame.session.restore(save); return document.querySelector('[data-layer="character-front"]').style.transform; });
  assert.equal(restored, 'translate(90px, 30px) scale(1.5)');
  const skipped = await page.evaluate(() => { timelineGame.session.restart(); const accepted = timelineGame.session.setSkip(true); return { accepted, transform: document.querySelector('[data-layer="character-front"]').style.transform }; });
  assert.deepEqual(skipped, { accepted: true, transform: 'translate(90px, 30px) scale(1.5)' });
  const reduced = await page.evaluate(() => { timelineGame.session.setSkip(false); timelineGame.session.configure({ reducedMotion: true }); timelineGame.session.restart(); return document.querySelector('[data-layer="character-front"]').style.transform; });
  assert.equal(reduced, 'translate(90px, 30px) scale(1.5)');
  await page.evaluate(() => timelineGame.dispose()); assert.equal(await page.locator('.vn-engine').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS DOM layers and camera animate, pause, settle on skip/reduced motion, and restore final state');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
