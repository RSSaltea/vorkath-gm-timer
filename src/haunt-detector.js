/* ================================================================
   Vorkath GM Timer — haunt-detector.js  v1.7
   ================================================================
   Switches from native alt1.bindFindSubImg (zero-tolerance exact
   matching) to A1lib.captureHoldFullRs() + ImgRef.findSubimage(),
   which is the standard approach used by AFKWarden, buff bars, etc.
   findSubimage uses tolerance-based template matching and handles
   the Alt1 memory model correctly.

   Scans the full RS screen every 4 ticks (2400 ms).
   Trigger:   zemouregal + vorkath + ghost_trigger all visible
   Condition: ghost_haunt NOT visible
   Action:    flash "Command Ghost for Haunt" at screen centre
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS    = 2400;   // 4 RS ticks (4 × 600 ms)
  var OVERLAY_MS = 2500;

  var OVERLAY_TEXT  = 'Command Ghost for Haunt';
  var OVERLAY_SIZE  = 28;
  // ARGB orange: A=255, R=255, G=165, B=0
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 165 * 256 + 0) | 0;

  // ── State ────────────────────────────────────────────────────────
  var refs   = {};    // { name: ImageData }
  var lib    = null;  // resolved A1lib reference
  var screen = null;  // captured ImgRef for current scan tick

  // ── Resolve the A1lib global ─────────────────────────────────────
  // The UMD bundle at unpkg.com/alt1/dist/base/index.js exposes the
  // library as window.A1lib (capital).  Some older builds use a1lib.
  function resolveLib() {
    if (lib) return lib;
    var candidate =
      (typeof A1lib !== 'undefined' && A1lib && A1lib.captureHoldFullRs && A1lib) ||
      (typeof a1lib !== 'undefined' && a1lib && a1lib.captureHoldFullRs && a1lib) ||
      null;
    if (candidate) {
      lib = candidate;
      console.log('[VGT-haunt] capture lib resolved:', lib === A1lib ? 'A1lib' : 'a1lib');
    }
    return lib;
  }

  // ── Load reference PNG without sRGB colour-space transformation ───
  // colorSpaceConversion:'none' prevents Chromium from applying gamma
  // correction, keeping pixel values identical to the raw PNG bytes.
  function loadRef(name, path) {
    return fetch(path)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        return createImageBitmap(blob, { colorSpaceConversion: 'none' });
      })
      .then(function (bitmap) {
        var c = document.createElement('canvas');
        c.width  = bitmap.width;
        c.height = bitmap.height;
        c.getContext('2d').drawImage(bitmap, 0, 0);
        refs[name] = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        var d = refs[name].data;
        console.log('[VGT-haunt] Loaded "' + name + '" (' + refs[name].width + 'x' + refs[name].height + ')'
                  + ' | px0 RGBA(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3] + ')');
      })
      .catch(function (e) {
        console.warn('[VGT-haunt] Could not load:', path, e);
        refs[name] = null;
      });
  }

  // ── Capture ───────────────────────────────────────────────────────
  function captureScreen() {
    var l = resolveLib();
    if (!l) return false;
    try {
      screen = l.captureHoldFullRs();
      return screen != null;
    } catch (e) {
      console.warn('[VGT-haunt] captureHoldFullRs error:', e);
      return false;
    }
  }

  // ── Search ────────────────────────────────────────────────────────
  // ImgRef.findSubimage(needle: ImageData) → {x,y}[]
  // A1lib.findSubimage(haystack: ImgRef, needle: ImageData) → {x,y}[]
  function imageFound(name) {
    if (!refs[name] || !screen) return false;
    try {
      var hits;
      if (typeof screen.findSubimage === 'function') {
        hits = screen.findSubimage(refs[name]);
      } else if (typeof lib.findSubimage === 'function') {
        hits = lib.findSubimage(screen, refs[name]);
      } else {
        return false;
      }
      return Array.isArray(hits) && hits.length > 0;
    } catch (e) {
      console.warn('[VGT-haunt] findSubimage("' + name + '") error:', e);
      return false;
    }
  }

  // ── Overlay ───────────────────────────────────────────────────────
  function showReminder() {
    var cx = alt1.rsX + Math.floor(alt1.rsWidth  / 2) - 160;
    var cy = alt1.rsY + Math.floor(alt1.rsHeight / 2);
    alt1.overLayText(OVERLAY_TEXT, OVERLAY_COLOR, OVERLAY_SIZE, cx, cy, OVERLAY_MS);
  }

  // ── Scan ──────────────────────────────────────────────────────────
  var scanCount = 0;
  function scan() {
    var tick = ++scanCount;

    if (!alt1.rsLinked) {
      if (tick % 5 === 1) console.log('[VGT-haunt] RS not linked');
      return;
    }

    if (!captureScreen()) {
      if (tick % 5 === 1) console.log('[VGT-haunt] captureScreen failed');
      return;
    }

    // One-time: log what captureHoldFullRs returned so we can verify
    if (tick === 1) {
      console.log('[VGT-haunt] screen type:', typeof screen,
                  '| keys:', Object.keys(screen || {}).join(', '));
    }

    if (tick % 10 === 1) {
      console.log('[VGT-haunt] Scan #' + tick + ' — RS ' + alt1.rsWidth + 'x' + alt1.rsHeight);
    }

    // Short-circuit: require all three trigger images
    if (!imageFound('zemouregal'))   return;
    if (!imageFound('vorkath'))      return;
    if (!imageFound('ghostTrigger')) return;

    console.log('[VGT-haunt] Encounter detected!');

    if (!imageFound('ghostHaunt')) {
      console.log('[VGT-haunt] Ghost haunt MISSING — showing overlay');
      showReminder();
    } else {
      if (tick % 5 === 0) console.log('[VGT-haunt] Ghost haunt present — OK');
    }
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-haunt] Starting up (v1.7)...');

    // Log A1lib API surface once for diagnostics
    if (typeof A1lib !== 'undefined') {
      console.log('[VGT-haunt] A1lib keys:', Object.keys(A1lib).join(', '));
    } else {
      console.warn('[VGT-haunt] A1lib not found — will check a1lib at capture time');
    }

    Promise.all([
      loadRef('zemouregal',   './src/img/zemouregal.png'),
      loadRef('vorkath',      './src/img/vorkath.png'),
      loadRef('ghostTrigger', './src/img/ghost_trigger.png'),
      loadRef('ghostHaunt',   './src/img/ghost_haunt.png'),
    ]).then(function () {
      var ok = Object.keys(refs).filter(function (n) { return refs[n] !== null; }).length;
      console.log('[VGT-haunt] ' + ok + '/4 images loaded. Scanning every ' + SCAN_MS + 'ms.');

      if (!resolveLib()) {
        console.error('[VGT-haunt] No capture library available — A1lib / a1lib both missing.');
        return;
      }

      setInterval(scan, SCAN_MS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
