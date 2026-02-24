/* ================================================================
   Vorkath GM Timer — haunt-detector.js  v1.6
   ================================================================
   Uses alt1.bindRegion + alt1.bindFindSubImg directly.

   Scans the full RS screen every 4 ticks (2400 ms).
   Trigger:   zemouregal + vorkath + ghost_trigger all visible
   Condition: ghost_haunt NOT visible
   Action:    flash "Command Ghost for Haunt" at screen centre

   v1.6 fix: load reference images via fetch + createImageBitmap
   with colorSpaceConversion:'none' so Chromium does not apply
   sRGB gamma transforms that alter pixel values and break matching.
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
  var refs    = {};   // { name: ImageData }
  var needles = {};   // { name: BGR base64 string for bindFindSubImg }

  // ── Encode reference image as BGR base64 for bindFindSubImg ──────
  // alt1.bindFindSubImg expects the needle as a base64 string of
  // raw BGR bytes (3 bytes per pixel, no alpha, Blue first).
  function encodeNeedle(imgData) {
    var d     = imgData.data;
    var bytes = '';
    for (var i = 0; i < d.length; i += 4) {
      bytes += String.fromCharCode(d[i + 2], d[i + 1], d[i]); // B, G, R
    }
    return btoa(bytes);
  }

  // ── Load reference PNG without sRGB colour-space transformation ───
  // new Image() / drawImage lets Chromium apply sRGB gamma correction,
  // producing pixel values that don't match the raw RS screen pixels.
  // fetch + createImageBitmap({colorSpaceConversion:'none'}) bypasses
  // that transform — the same approach used by a1lib internally.
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
        refs[name]    = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        needles[name] = encodeNeedle(refs[name]);
        var d = refs[name].data;
        console.log('[VGT-haunt] Loaded "' + name + '" (' + refs[name].width + 'x' + refs[name].height + ')'
                  + ' | px0 RGBA(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3] + ')');
      })
      .catch(function (e) {
        console.warn('[VGT-haunt] Could not load:', path, e);
        refs[name]    = null;
        needles[name] = null;
      });
  }

  // ── Capture + search ─────────────────────────────────────────────
  // bindRegion(x, y, w, h) — captures a fresh screenshot into a handle
  // bindFindSubImg(handle, bgrBase64, needleW, sx, sy, sw, sh) → JSON [{x,y}]
  var handle = 0;

  function capture() {
    try {
      handle = alt1.bindRegion(0, 0, alt1.rsWidth, alt1.rsHeight);
      return handle > 0;
    } catch (e) {
      console.warn('[VGT-haunt] bindRegion error:', e);
      return false;
    }
  }

  function imageFound(name) {
    if (!needles[name] || handle <= 0) return false;
    try {
      var nw = refs[name].width;
      var r  = alt1.bindFindSubImg(handle, needles[name], nw,
                                   0, 0, alt1.rsWidth, alt1.rsHeight);
      if (!r) return false;
      var hits = JSON.parse(r);
      return Array.isArray(hits) && hits.length > 0;
    } catch (e) {
      console.warn('[VGT-haunt] bindFindSubImg("' + name + '") error:', e);
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

    if (!capture()) return;

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
    console.log('[VGT-haunt] Starting up (v1.6)...');

    Promise.all([
      loadRef('zemouregal',   './src/img/zemouregal.png'),
      loadRef('vorkath',      './src/img/vorkath.png'),
      loadRef('ghostTrigger', './src/img/ghost_trigger.png'),
      loadRef('ghostHaunt',   './src/img/ghost_haunt.png'),
    ]).then(function () {
      var ok = Object.keys(refs).filter(function (n) { return refs[n] !== null; }).length;
      console.log('[VGT-haunt] ' + ok + '/4 images loaded. Scanning every ' + SCAN_MS + 'ms.');
      setInterval(scan, SCAN_MS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
