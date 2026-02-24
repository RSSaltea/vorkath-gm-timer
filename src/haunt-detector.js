/* ================================================================
   Vorkath GM Timer — haunt-detector.js
   ================================================================
   Polls the RS screen every 2 s.
   If all three encounter images (Zemouregal, Vorkath, ghost icon)
   are visible but the purple Haunt ghost is absent, flashes an
   overlay reminder in the centre of the screen.
   ================================================================ */

'use strict';

(function () {

  // Only meaningful inside Alt1
  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS    = 2000;   // scan interval (ms)
  var OVERLAY_MS = 2500;   // how long each text flash lasts (ms)
  var TOLERANCE  = 25;     // per-channel colour tolerance (0–255)
  var MAX_KP     = 30;     // max keypoints sampled from each reference

  var OVERLAY_TEXT  = 'Command Ghost for Haunt';
  var OVERLAY_SIZE  = 28;

  // ARGB orange-yellow: A=255 R=255 G=165 B=0
  // Built without the signed-int trap: use float arithmetic then |0
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 165 * 256 + 0) | 0;

  // ── State ────────────────────────────────────────────────────────
  var kp = {};   // { name: { pts, w, h } | null }

  // ── Load a reference image and extract keypoints ─────────────────
  // Canvas gives RGBA; alt1 capture is BGRA — we store (r,g,b) from
  // the reference so the comparison function can swap channels.
  function loadRef(name, path) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width  = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        var id = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        kp[name] = buildKP(id);
        resolve();
      };
      img.onerror = function () {
        console.warn('[VGT-haunt] Could not load image:', path);
        kp[name] = null;
        resolve();
      };
      img.src = path;
    });
  }

  // ── Build up to MAX_KP evenly-spaced opaque keypoints ────────────
  function buildKP(imgData) {
    var w = imgData.width, h = imgData.height, d = imgData.data;
    var all = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (d[i + 3] >= 128) {
          all.push({ nx: x, ny: y, r: d[i], g: d[i + 1], b: d[i + 2] });
        }
      }
    }
    if (all.length === 0) return null;
    if (all.length <= MAX_KP) return { pts: all, w: w, h: h };

    var step = Math.floor(all.length / MAX_KP);
    var pts  = [];
    for (var j = 0; j < all.length; j += step) {
      pts.push(all[j]);
      if (pts.length >= MAX_KP) break;
    }
    return { pts: pts, w: w, h: h };
  }

  // ── Search for a reference's keypoints inside a captured screen ──
  // Screen data from alt1 is BGRA; reference keypoints are RGBA.
  // We compare: screen[i+0]=B↔ref.b, [i+1]=G↔ref.g, [i+2]=R↔ref.r
  function imageFound(screen, ref) {
    if (!ref || !ref.pts || !screen) return false;

    var hw  = screen.width, hh = screen.height;
    var hd  = screen.data;
    var pts = ref.pts, nw = ref.w, nh = ref.h;
    var tol = TOLERANCE;
    var first = pts[0];

    for (var y = 0; y <= hh - nh; y++) {
      for (var x = 0; x <= hw - nw; x++) {

        // Fast first-keypoint check (eliminates ~99% of positions)
        var hi = ((y + first.ny) * hw + (x + first.nx)) * 4;
        if (Math.abs(hd[hi]     - first.b) > tol) continue;
        if (Math.abs(hd[hi + 1] - first.g) > tol) continue;
        if (Math.abs(hd[hi + 2] - first.r) > tol) continue;

        // Full keypoint check
        var match = true;
        for (var k = 1; k < pts.length; k++) {
          var p  = pts[k];
          var pi = ((y + p.ny) * hw + (x + p.nx)) * 4;
          if (Math.abs(hd[pi]     - p.b) > tol ||
              Math.abs(hd[pi + 1] - p.g) > tol ||
              Math.abs(hd[pi + 2] - p.r) > tol) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
    }
    return false;
  }

  // ── Overlay ───────────────────────────────────────────────────────
  function showReminder() {
    // Estimate horizontal centre (text ~320 px wide at size 28)
    var cx = alt1.rsX + Math.floor(alt1.rsWidth  / 2) - 160;
    var cy = alt1.rsY + Math.floor(alt1.rsHeight / 2);
    alt1.overLayText(OVERLAY_TEXT, OVERLAY_COLOR, OVERLAY_SIZE, cx, cy, OVERLAY_MS);
  }

  // ── Main scan ─────────────────────────────────────────────────────
  function scan() {
    if (!alt1.rsLinked) return;

    var screen = alt1.captureHoldFullRs();
    if (!screen) return;

    // Step 1 — confirm encounter is active (all three must be visible)
    if (!imageFound(screen, kp.zemouregal))   return;
    if (!imageFound(screen, kp.vorkath))      return;
    if (!imageFound(screen, kp.ghostTrigger)) return;

    // Step 2 — if Haunt ghost is NOT visible, remind the player
    if (!imageFound(screen, kp.ghostHaunt)) {
      showReminder();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    Promise.all([
      loadRef('zemouregal',   './src/img/zemouregal.png'),
      loadRef('vorkath',      './src/img/vorkath.png'),
      loadRef('ghostTrigger', './src/img/ghost_trigger.png'),
      loadRef('ghostHaunt',   './src/img/ghost_haunt.png'),
    ]).then(function () {
      var loaded = Object.keys(kp).filter(function (k) { return kp[k] !== null; }).length;
      console.log('[VGT-haunt] Loaded ' + loaded + '/4 reference images. Detector running.');
      setInterval(scan, SCAN_MS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
