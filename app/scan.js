/* 扫电脑上的二维码：优先用浏览器自带识别，没有就临时拉一个解码库 */
window.AsterScan = async function () {
  const base = (localStorage.getItem('aster.sync.base') || '').replace(/\/$/, '');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('这个浏览器不给用摄像头。用系统相机扫那个二维码也一样，扫完会直接打开这一页。');
    return;
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;display:flex;flex-direction:column';
  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.style.cssText = 'flex:1;object-fit:cover;width:100%';
  const bar = document.createElement('div');
  bar.style.cssText = 'padding:14px;text-align:center;color:#fff;font:14px -apple-system,sans-serif;background:#111';
  bar.textContent = '对准电脑上那个二维码';
  const close = document.createElement('button');
  close.textContent = '取消';
  close.style.cssText = 'margin-top:8px;padding:8px 18px;border-radius:999px;border:1px solid #555;background:transparent;color:#fff';
  bar.appendChild(document.createElement('br'));
  bar.appendChild(close);
  wrap.appendChild(video); wrap.appendChild(bar);
  document.body.appendChild(wrap);

  let stream, stopped = false, timer;
  const stop = () => {
    stopped = true; clearTimeout(timer);
    try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    wrap.remove();
  };
  close.onclick = stop;

  const apply = (text) => {
    let m = /[?&]sync=([^&]+)/.exec(text);
    let url = m ? decodeURIComponent(m[1]) : (/^https?:\/\//.test(text) ? text : '');
    if (!url) return false;
    localStorage.setItem('aster.sync.base', url.replace(/\/$/, ''));
    stop();
    alert('记下了：' + url + '\n以后进同一个 Wi-Fi 就自动同步');
    if (window.AsterSync) AsterSync.flush(true);
    return true;
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
    video.srcObject = stream; await video.play();
  } catch (e) { stop(); alert('打不开摄像头：' + e.message); return; }

  let detector = null;
  try { if ('BarcodeDetector' in window) detector = new BarcodeDetector({formats: ['qr_code']}); } catch (e) {}
  let jsQR = null;
  const loadJsQR = () => new Promise(res => {
    if (window.jsQR) return res(window.jsQR);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = () => res(window.jsQR || null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });

  const canvas = document.createElement('canvas');
  const tick = async () => {
    if (stopped) return;
    try {
      if (detector) {
        const codes = await detector.detect(video);
        if (codes && codes.length && apply(codes[0].rawValue)) return;
      } else {
        if (!jsQR) jsQR = await loadJsQR();
        if (jsQR && video.videoWidth) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(img.data, img.width, img.height, {inversionAttempts: 'dontInvert'});
          if (found && found.data && apply(found.data)) return;
        }
      }
    } catch (e) {}
    timer = setTimeout(tick, 300);
  };
  tick();
};
