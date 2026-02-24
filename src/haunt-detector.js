/* ================================================================
   Vorkath GM Timer — haunt-detector.js  v1.9
   ================================================================
   Logic (runs every 4 ticks / 2400 ms):
     1. If vorkath.png OR zemouregal.png is found  → encounter active
     2. If encounter active AND ghost_trigger.png NOT found
        → flash red "Command Ghost for Haunt!" at screen centre
     3. As soon as BOTH disappear (encounter over) OR ghost_trigger
        is found → stop calling overLayText; overlay expires in 2500 ms
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS    = 2400;   // 4 RS ticks (4 × 600 ms)
  var OVERLAY_MS = 2500;   // slightly longer than scan interval

  var OVERLAY_TEXT  = 'Command Ghost for Haunt!';
  var OVERLAY_SIZE  = 28;
  // ARGB red: A=255, R=255, G=0, B=0  →  0xFFFF0000
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 0 * 256 + 0) | 0;

  // ── State ────────────────────────────────────────────────────────
  var refs   = {};
  var lib    = null;
  var screen = null;

  // ── Resolve A1lib ────────────────────────────────────────────────
  function resolveLib() {
    if (lib) return lib;
    var candidate =
      (typeof A1lib !== 'undefined' && A1lib && A1lib.captureHoldFullRs && A1lib) ||
      (typeof a1lib !== 'undefined' && a1lib && a1lib.captureHoldFullRs && a1lib) ||
      null;
    if (candidate) lib = candidate;
    return lib;
  }

  // ── Load image ────────────────────────────────────────────────────
  function loadRef(name, path) {
    var l = resolveLib();
    if (l && typeof l.imageDataFromUrl === 'function') {
      return l.imageDataFromUrl(path)
        .then(function (imgData) {
          refs[name] = imgData;
          console.log('[VGT-haunt] Loaded "' + name + '" (' + imgData.width + 'x' + imgData.height + ')');
        })
        .catch(function (e) {
          console.warn('[VGT-haunt] Failed to load "' + name + '":', e);
          refs[name] = null;
        });
    }
    return fetch(path)
      .then(function (r) { return r.blob(); })
      .then(function (blob) { return createImageBitmap(blob, { colorSpaceConversion: 'none' }); })
      .then(function (bitmap) {
        var c = document.createElement('canvas');
        c.width = bitmap.width; c.height = bitmap.height;
        c.getContext('2d').drawImage(bitmap, 0, 0);
        refs[name] = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        console.log('[VGT-haunt] Loaded "' + name + '" via canvas fallback');
      })
      .catch(function (e) {
        console.warn('[VGT-haunt] Could not load "' + name + '":', e);
        refs[name] = null;
      });
  }

  // ── Capture ───────────────────────────────────────────────────────
  function captureScreen() {
    try {
      screen = lib.captureHoldFullRs();
      return screen != null;
    } catch (e) {
      return false;
    }
  }

  // ── Search ────────────────────────────────────────────────────────
  function imageFound(name) {
    if (!refs[name] || !screen) return false;
    try {
      var hits = typeof screen.findSubimage === 'function'
        ? screen.findSubimage(refs[name])
        : lib.findSubimage(screen, refs[name]);
      return Array.isArray(hits) && hits.length > 0;
    } catch (e) {
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

    if (!alt1.rsLinked) return;
    if (!captureScreen()) return;

    if (tick % 10 === 1) {
      console.log('[VGT-haunt] Scan #' + tick);
    }

    // Step 1: encounter active if Vorkath OR Zemouregal is visible
    var encounterActive = imageFound('vorkath') || imageFound('zemouregal');
    if (!encounterActive) return;

    // Step 2: ghost trigger missing → remind player
    if (!imageFound('ghostTrigger')) {
      showReminder();
    }
    // If ghostTrigger IS found, do nothing — let the overlay expire
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-haunt] Starting up (v1.9)...');

    if (!resolveLib()) {
      console.error('[VGT-haunt] A1lib not available.');
      return;
    }

    Promise.all([
      loadRef('vorkath',      './src/img/vorkath.png'),
      loadRef('zemouregal',   './src/img/zemouregal.png'),
      loadRef('ghostTrigger', './src/img/ghost_trigger.png'),
    ]).then(function () {
      var loaded = ['vorkath', 'zemouregal', 'ghostTrigger']
                    .filter(function (n) { return refs[n] !== null; }).length;
      console.log('[VGT-haunt] ' + loaded + '/3 images loaded. Scanning every ' + SCAN_MS + 'ms.');
      setInterval(scan, SCAN_MS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
