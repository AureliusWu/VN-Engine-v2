// Hold a real preview reply, then release it through the same iframe's postMessage.
export async function installPreviewReplyGate(page) {
  await page.addInitScript(() => {
    const gate = globalThis.previewReplyGate = { replies: [] };
    window.addEventListener('message', event => {
      if (event.source !== document.querySelector('#preview')?.contentWindow || event.origin !== location.origin) return;
      if (event.data?.source === 'vn-engine-preview-test') { gate.delivered = event.data.serial; return; }
      if (event.data?.source !== 'vn-engine-preview' || event.data.type !== gate.type) return;
      if (gate.type === 'rendered' && event.data.recording !== true) return;
      event.stopImmediatePropagation();
      gate.replies.push(event.data);
    }, true);
  });
  let serial = 0;
  return {
    hold: type => page.evaluate(type => { previewReplyGate.type = type; previewReplyGate.replies = []; }, type),
    async wait(count = 1) {
      await page.waitForFunction(count => previewReplyGate.replies.length >= count, count, { timeout: 4000 });
      return page.evaluate(count => previewReplyGate.replies[count - 1], count);
    },
    async release(reply) {
      await page.evaluate(() => { previewReplyGate.type = undefined; });
      const marker = ++serial;
      await page.frameLocator('#preview').locator('body').evaluate((_body, { reply, marker }) => {
        parent.postMessage(reply, location.origin);
        parent.postMessage({ source: 'vn-engine-preview-test', serial: marker }, location.origin);
      }, { reply, marker });
      await page.waitForFunction(marker => previewReplyGate.delivered === marker, marker, { timeout: 4000 });
    }
  };
}
