import { chromium } from 'playwright';

/** Decode local bytes in an isolated document; embedded assets cannot contact outside origins. */
export async function probeAssets(inputs) {
  if (!inputs.length) return { status: 'N/A', checks: [], scope: 'No image, font, audio or video assets are declared.' };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.setContent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src blob:; font-src blob:; media-src blob:; connect-src \'none\'; style-src \'unsafe-inline\'">');
    const checks = [];
    for (const input of inputs) {
      const result = await page.evaluate(async ({ bytes, kind, mime }) => {
        const data = Uint8Array.from(atob(bytes), char => char.charCodeAt(0)), url = URL.createObjectURL(new Blob([data], { type: mime }));
        let timer, media;
        try {
          const decode = async () => {
            if (kind === 'font') { const font = new FontFace('QAProbe', `url(${url})`); await font.load(); return { format: 'font' }; }
            if (kind === 'audio') {
              const context = new OfflineAudioContext(1, 1, 48000), audio = await context.decodeAudioData(data.buffer);
              return { format: 'audio', duration: audio.duration, channels: audio.numberOfChannels };
            }
            if (kind === 'video') {
              media = document.createElement('video'); media.preload = 'auto'; media.muted = true; media.playsInline = true;
              return new Promise((resolve, reject) => {
                media.onerror = () => reject(Error('Video could not decode its first frame'));
                media.onloadeddata = () => resolve({ format: 'video-first-frame', width: media.videoWidth, height: media.videoHeight, duration: Number.isFinite(media.duration) ? media.duration : null });
                media.src = url; media.load(); void media.play().catch(() => {});
              });
            }
            const image = new Image(); image.src = url; await image.decode();
            if (!image.naturalWidth || !image.naturalHeight) throw Error('Image dimensions are empty');
            return { format: 'image', width: image.naturalWidth, height: image.naturalHeight };
          };
          const details = await Promise.race([decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Asset decode timed out')), 10000); })]);
          return { status: 'PASS', ...details };
        } catch (error) { return { status: 'FAIL', reason: error.message }; }
        finally { clearTimeout(timer); if (media) { media.onloadeddata = null; media.onerror = null; media.pause(); media.removeAttribute('src'); media.load(); } URL.revokeObjectURL(url); }
      }, { bytes: input.bytes.toString('base64'), kind: input.kind, mime: input.mime });
      checks.push({ id: input.id, ...result });
    }
    return { status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL', browser: await browser.version(), checks,
      scope: 'Images/fonts and complete audio buffers decoded; video first frame probed. This does not verify full playback, composition, sound quality or other devices.' };
  } catch (error) { return { status: 'UNVERIFIED', reason: error.message, checks: [] }; }
  finally { await browser?.close(); }
}
