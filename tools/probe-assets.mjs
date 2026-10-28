import { chromium } from 'playwright';

/** Decode local bytes in an isolated document; embedded assets cannot contact outside origins. */
export async function probeAssets(inputs, options = {}) {
  if (!inputs.length) return { status: 'N/A', checks: [], scope: 'No image, font, audio or video assets are declared.' };
  const started=Date.now(),budget=options.timeoutMs??60000;
  if(budget<25)return {status:'UNVERIFIED',reason:'Decode budget exhausted before browser launch',checks:[]};
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout:Math.min(15000,budget), executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.setContent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src blob:; font-src blob:; media-src blob:; connect-src \'none\'; style-src \'unsafe-inline\'">');
    const checks = [];
    for (const input of inputs) {
      const remaining=budget-(Date.now()-started);if(remaining<=0){checks.push({id:input.id,status:'UNVERIFIED',reason:'Decode budget exhausted'});continue;}
      const result = await page.evaluate(async ({ bytes, kind, mime, timeoutMs }) => {
        const data = Uint8Array.from(atob(bytes), char => char.charCodeAt(0)), url = URL.createObjectURL(new Blob([data], { type: mime }));
        let timer, media;
        try {
          const decode = async () => {
            if (kind === 'font') { const font = new FontFace('QAProbe', `url(${url})`); await font.load(); return { format: 'font' }; }
            if (kind === 'audio') {
              const context = new OfflineAudioContext(1, 1, 48000), audio = await context.decodeAudioData(data.buffer);
              if(audio.length*audio.numberOfChannels>28800000)return {status:'UNVERIFIED',reason:'Decoded audio sample budget exceeded'};
              let peak=0,sum=0,silent=0,clipped=0,boundary=0;const total=audio.length*audio.numberOfChannels;
              for(let c=0;c<audio.numberOfChannels;c++){const samples=audio.getChannelData(c);for(let i=0;i<samples.length;i++){const a=Math.abs(samples[i]);peak=Math.max(peak,a);sum+=samples[i]*samples[i];if(a<0.0001)silent++;if(a>=0.999)clipped++;}boundary+=(samples[0]-samples.at(-1))**2;}
              return { format:'audio',duration:audio.duration,channels:audio.numberOfChannels,sampleRate:audio.sampleRate,sampleRateBasis:'Web Audio analysis resampled to 48000 Hz; original WAVE rate is in container',frames:audio.length,peak,rms:Math.sqrt(sum/total),silentFraction:silent/total,clippedFraction:clipped/total,boundaryDelta:Math.sqrt(boundary/audio.numberOfChannels) };
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
            if(image.naturalWidth*image.naturalHeight>16777216)return {status:'UNVERIFIED',reason:'Image exceeds 16 megapixel decode budget'};
            const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
            const stride=Math.max(1,Math.floor(canvas.width*canvas.height/1000000));let transparent=0,sampled=0,hasTransparency=false;for(let i=3;i<pixels.length;i+=4*stride){sampled++;if(pixels[i]<255)hasTransparency=true;if(pixels[i]<=1)transparent++;}
            return {format:'image',width:image.naturalWidth,height:image.naturalHeight,hasTransparency,transparentFraction:transparent/sampled,alphaSampleStride:stride};
          };
          const details = await Promise.race([decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Asset decode timed out')), timeoutMs); })]);
          return { status: 'PASS', ...details };
        } catch (error) { return { status: error.message.includes('timed out')?'UNVERIFIED':'FAIL', reason: error.message }; }
        finally { clearTimeout(timer); if (media) { media.onloadeddata = null; media.onerror = null; media.pause(); media.removeAttribute('src'); media.load(); } URL.revokeObjectURL(url); }
      }, { bytes: input.bytes.toString('base64'), kind: input.kind, mime: input.mime, timeoutMs:Math.min(10000,remaining) });
      checks.push({ id: input.id, ...result });
    }
    return { status: checks.some(check=>check.status==='FAIL')?'FAIL':checks.some(check=>check.status==='UNVERIFIED')?'UNVERIFIED':'PASS', browser: await browser.version(), checks,
      scope: 'Images/fonts and complete audio buffers decoded; video first frame probed. This does not verify full playback, composition, sound quality or other devices.' };
  } catch (error) { return { status: 'UNVERIFIED', reason: error.message, checks: [] }; }
  finally { await browser?.close(); }
}
