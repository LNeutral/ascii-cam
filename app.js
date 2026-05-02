const video      = document.getElementById('video');
const canvas     = document.getElementById('canvas');
const maskCanvas = document.getElementById('mask-canvas');
const ctx        = canvas.getContext('2d', { willReadFrequently: true });
const maskCtx    = maskCanvas.getContext('2d', { willReadFrequently: true });
const output     = document.getElementById('ascii-output');
const colsSlider = document.getElementById('cols-slider');
const sizeSlider = document.getElementById('size-slider');
const contSlider = document.getElementById('contrast-slider');
const colsVal    = document.getElementById('cols-val');
const sizeVal    = document.getElementById('size-val');
const contVal    = document.getElementById('contrast-val');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const invertBtn  = document.getElementById('invert-btn');
const cutoutBtn  = document.getElementById('cutout-btn');
const pastelBtn  = document.getElementById('pastel-btn');
const cameraBtn  = document.getElementById('camera-btn');
const aboutBtn   = document.getElementById('about-btn');
const aboutOverlay = document.getElementById('about-overlay');
const aboutClose = document.getElementById('about-close');

// Dense ramp — index 0 = bright, last = dark
const CHARS = ' `\'.,;-~=+ilt!I?1rcoueanszxv][}{)(|\\/<>JCLYUQ0OZmwpqbdk*#MWNB&8%@$';

// Pastel palette: yellow (light) → pink (mid) → navy (dark)
const PASTEL = ['#FEFFA1', '#FFD6DC', '#2B3D91'];
function pastelColor(t) {
  if (t < 0.35) return PASTEL[0];
  if (t < 0.68) return PASTEL[1];
  return PASTEL[2];
}

// Escape HTML special chars that appear in CHARS
function esc(c) {
  if (c === '&') return '&amp;';
  if (c === '<') return '&lt;';
  if (c === '>') return '&gt;';
  return c;
}

let inverted      = false;
let cutoutEnabled = false;
let pastelEnabled = false;
let segmenter     = null;
let latestMask    = null;
let segReady      = false;

invertBtn.addEventListener('click', () => {
  inverted = !inverted;
  invertBtn.classList.toggle('active', inverted);
});

cutoutBtn.addEventListener('click', () => {
  if (!segReady) return;
  cutoutEnabled = !cutoutEnabled;
  cutoutBtn.classList.toggle('active', cutoutEnabled);
});

pastelBtn.addEventListener('click', () => {
  pastelEnabled = !pastelEnabled;
  pastelBtn.classList.toggle('active', pastelEnabled);
});

cameraBtn.addEventListener('click', () => {
  const widget = document.getElementById('camera-widget');
  const visible = widget.classList.toggle('camera-visible');
  cameraBtn.classList.toggle('active', visible);
});

function openAbout() {
  aboutOverlay.classList.remove('hidden', 'fade-out');
}
function closeAbout() {
  aboutOverlay.classList.add('fade-out');
  setTimeout(() => {
    aboutOverlay.classList.add('hidden');
    aboutOverlay.classList.remove('fade-out');
  }, 250);
}

aboutBtn.addEventListener('click', openAbout);
aboutClose.addEventListener('click', closeAbout);
aboutOverlay.addEventListener('click', (e) => {
  if (e.target === aboutOverlay) closeAbout();
});

function syncSlider(slider, display) {
  display.textContent = slider.value;
  slider.addEventListener('input', () => { display.textContent = slider.value; });
}
syncSlider(colsSlider, colsVal);
syncSlider(sizeSlider, sizeVal);
syncSlider(contSlider, contVal);

function applyContrast(v, factor) {
  return Math.min(1, Math.max(0, (v - 0.5) * factor + 0.5));
}

// ── Segmentation setup ───────────────────────────────────────────────────────
function initSegmentation() {
  segmenter = new SelfieSegmentation({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
  });
  segmenter.setOptions({ modelSelection: 1 });
  segmenter.onResults((results) => {
    if (!results.segmentationMask) return;
    const cols        = parseInt(colsSlider.value);
    const charAspect  = 0.48;
    const rows        = Math.round(cols * (video.videoHeight / video.videoWidth) * charAspect);
    maskCanvas.width  = cols;
    maskCanvas.height = rows;
    maskCtx.drawImage(results.segmentationMask, 0, 0, cols, rows);
    latestMask = maskCtx.getImageData(0, 0, cols, rows).data;

    if (!segReady) {
      segReady = true;
      cutoutBtn.disabled = false;
      cutoutBtn.title    = '';
      statusText.textContent = 'Live';
    }
  });
}

// ── Render ASCII frame ───────────────────────────────────────────────────────
function renderASCII() {
  if (video.readyState < 2) return;

  const cols       = parseInt(colsSlider.value);
  const fontSize   = parseInt(sizeSlider.value);
  const contrast   = parseFloat(contSlider.value);
  const charAspect = 0.48;
  const rows       = Math.round(cols * (video.videoHeight / video.videoWidth) * charAspect);

  canvas.width  = cols;
  canvas.height = rows;

  // Mirror for selfie feel
  ctx.save();
  ctx.translate(cols, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, cols, rows);
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, cols, rows);

  // Mask arrives in original video orientation; mirror x to align with flipped canvas.
  const maskReady = latestMask && latestMask.length === rows * cols * 4;
  const len       = CHARS.length - 1;

  // Build output — plain text normally, HTML spans in pastel mode
  let result   = '';
  let curColor = null; // tracks open <span> color in pastel mode

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const mx       = cols - 1 - x;
      const mi       = (y * cols + mx) * 4;
      const isPerson = maskReady && latestMask[mi] >= 128;
      const isBg     = maskReady && !isPerson;

      if (cutoutEnabled && isBg) {
        if (pastelEnabled && curColor !== null) { result += '</span>'; curColor = null; }
        result += ' ';
        continue;
      }

      const i  = (y * cols + x) * 4;
      let lum  = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      lum = applyContrast(lum, contrast);
      const t  = inverted ? lum : 1 - lum;
      const ch = isBg ? '.' : CHARS[Math.round(t * len)];

      if (pastelEnabled && !isBg) {
        const color = pastelColor(t);
        if (color !== curColor) {
          if (curColor !== null) result += '</span>';
          result += `<span style="color:${color}">`;
          curColor = color;
        }
        result += esc(ch);
      } else {
        if (pastelEnabled && curColor !== null) { result += '</span>'; curColor = null; }
        result += pastelEnabled ? esc(ch) : ch;
      }
    }
    result += '\n';
  }

  if (pastelEnabled && curColor !== null) result += '</span>';

  output.style.fontSize   = fontSize + 'px';
  output.style.lineHeight = (fontSize * 1.12) + 'px';
  if (pastelEnabled) {
    output.innerHTML = result;
  } else {
    output.textContent = result;
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
let running = false;
async function loop() {
  while (running) {
    if (video.readyState >= 2 && segmenter) {
      try { await segmenter.send({ image: video }); } catch (_) {}
    }
    renderASCII();
    await new Promise((r) => requestAnimationFrame(r));
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
const landingEl      = document.getElementById('landing');
const permissionEl   = document.getElementById('permission');
const allowBtn       = document.getElementById('allow-btn');
const denyBtn        = document.getElementById('deny-btn');
const loadingEl      = document.getElementById('loading');
const loadingSpinner = document.getElementById('loading-spinner');
const continueBtn    = document.getElementById('continue-btn');

// Seed history so the browser back button has an entry to pop to
history.replaceState({ page: 'landing' }, '');

const SPIN_FRAMES = ['|', '/', '-', '\\'];
let spinIdx = 0, spinTimer = null;

const LOADING_MIN_MS = 2200;

async function init() {
  const loadStart = Date.now();

  const hideLoading = () => {
    const elapsed = Date.now() - loadStart;
    const remaining = Math.max(0, LOADING_MIN_MS - elapsed);
    setTimeout(() => {
      clearInterval(spinTimer);
      loadingEl.classList.add('fade-out');
      setTimeout(() => { loadingEl.style.display = 'none'; }, 500);
    }, remaining);
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = stream;
    await video.play();

    // Camera ready — hide loading screen (respecting minimum duration)
    hideLoading();

    statusDot.classList.add('live');
    statusText.textContent = 'Live  ·  Loading silhouette model…';

    initSegmentation();

    running = true;
    loop();
  } catch (err) {
    hideLoading();
    statusText.textContent = 'Camera unavailable';
    output.innerHTML = '<span class="error-msg">Could not access camera.\nPlease allow camera permission and reload.</span>';
    console.error(err);
  }
}

function startLoading() {
  loadingEl.classList.remove('hidden');
  spinTimer = setInterval(() => {
    loadingSpinner.textContent = SPIN_FRAMES[spinIdx++ % SPIN_FRAMES.length];
  }, 110);
  init();
}

continueBtn.addEventListener('click', () => {
  continueBtn.disabled = true;
  history.pushState({ page: 'app' }, '');

  // Show permission prompt over the landing page
  permissionEl.classList.remove('hidden');
});

allowBtn.addEventListener('click', () => {
  permissionEl.classList.add('fade-out');
  setTimeout(() => { permissionEl.style.display = 'none'; }, 350);

  // Show loading screen immediately beneath fading landing
  startLoading();
  landingEl.classList.add('fade-out');
  setTimeout(() => { landingEl.style.display = 'none'; }, 450);
});

denyBtn.addEventListener('click', () => {
  permissionEl.classList.add('fade-out');
  setTimeout(() => {
    permissionEl.style.display = 'none';
    permissionEl.classList.remove('fade-out');
    permissionEl.classList.add('hidden');
    continueBtn.disabled = false;
  }, 350);
});

window.addEventListener('popstate', () => {
  // Stop the camera loop
  running = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  clearInterval(spinTimer);

  // Hide loading/app, show landing
  loadingEl.classList.add('hidden');
  loadingEl.classList.remove('fade-out');
  permissionEl.style.display = '';
  permissionEl.classList.remove('fade-out');
  permissionEl.classList.add('hidden');
  landingEl.style.display = '';
  landingEl.classList.remove('fade-out');
  continueBtn.disabled = false;

  // Reset status
  statusDot.classList.remove('live');
  statusText.textContent = 'Requesting camera…';
  output.textContent = 'Waiting for camera access…';
});
