/* ================================================================
   Vorkath GM Timer — haunt-detector.js  v1.8
   ================================================================
   - Loads images via A1lib.imageDataFromUrl (native a1lib format,
     same sRGB-free path used by @alt1/imagedata-loader)
   - For first 10 scans: checks ALL 4 images and logs raw results
     (no short-circuit) so we can see exactly which match and which
     don't, regardless of prior results.
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
  function resolveLib() {
    if (lib) return lib;
    var candidate =
      (typeof A1lib !== 'undefined' && A1lib && A1lib.captureHoldFullRs && A1lib) ||
      (typeof a1lib !== 'undefined' && a1lib && a1lib.captureHoldFullRs && a1lib) ||
      null;
    if (candidate) {
      lib = candidate;
    }
    return lib;
  }

  // ── Load images via A1lib.imageDataFromUrl ────────────────────────
  // imageDataFromUrl is a1lib's own loader — it strips sRGB and
  // returns an ImageData in exactly the format findSubimage expects.
  function loadRef(name, path) {
    var l = resolveLib();
    if (l && typeof l.imageDataFromUrl === 'function') {
      return l.imageDataFromUrl(path)
        .then(function (imgData) {
          refs[name] = imgData;
          var d = imgData.data;
          console.log('[VGT-haunt] Loaded "' + name + '" via imageDataFromUrl'
                    + ' (' + imgData.width + 'x' + imgData.height + ')'
                    + ' | px0 RGBA(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3] + ')');
        })
        .catch(function (e) {
          console.warn('[VGT-haunt] imageDataFromUrl failed "' + name + '":', e);
          refs[name] = null;
        });
    }
    // Fallback: fetch + canvas with colorSpaceConversion:none
    return fetch(path)
      .then(function (r) { return r.blob(); })
      .then(function (blob) { return createImageBitmap(blob, { colorSpaceConversion: 'none' }); })
      .then(function (bitmap) {
        var c = document.createElement('canvas');
        c.width  = bitmap.width;
        c.height = bitmap.height;
        c.getContext('2d').drawImage(bitmap, 0, 0);
        refs[name] = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        var d = refs[name].data;
        console.log('[VGT-haunt] Loaded "' + name + '" via canvas fallback'
                  + ' (' + refs[name].width + 'x' + refs[name].height + ')'
                  + ' | px0 RGBA(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3] + ')');
      })
      .catch(function (e) {
        console.warn('[VGT-haunt] Could not load "' + name + '":', e);
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
  // Returns the raw hit array (may be empty) or null on error.
  function queryImage(name) {
    if (!refs[name] || !screen) return null;
    try {
      if (typeof screen.findSubimage === 'function') {
        return screen.findSubimage(refs[name]);
      }
      if (typeof lib.findSubimage === 'function') {
        return lib.findSubimage(screen, refs[name]);
      }
      return null;
    } catch (e) {
      console.warn('[VGT-haunt] findSubimage("' + name + '") error:', e);
      return null;
    }
  }

  function imageFound(name) {
    var hits = queryImage(name);
    return Array.isArray(hits) && hits.length > 0;
  }

  // ── Overlay ───────────────────────────────────────────────────────
  function showReminder() {
    var cx = alt1.rsX + Math.floor(alt1.rsWidth  / 2) - 160;
    var cy = alt1.rsY + Math.floor(alt1.rsHeight / 2);
    alt1.overLayText(OVERLAY_TEXT, OVERLAY_COLOR, OVERLAY_SIZE, cx, cy, OVERLAY_MS);
  }

  // ── Scan ──────────────────────────────────────────────────────────
  var scanCount = 0;
  var NAMES = ['zemouregal', 'vorkath', 'ghostTrigger', 'ghostHaunt'];

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

    // ── DEBUG MODE: first 10 scans — check ALL images, log raw results ──
    if (tick <= 10) {
      var results = {};
      NAMES.forEach(function (n) {
        var hits = queryImage(n);
        results[n] = hits === null ? 'ERROR' :
                     hits.length  ? 'FOUND(' + hits.length + ')' : '[]';
      });
      console.log('[VGT-haunt] tick#' + tick,
        'zem=' + results['zemouregal'],
        'vork=' + results['vorkath'],
        'trig=' + results['ghostTrigger'],
        'haunt=' + results['ghostHaunt']);
      return; // Don't act during debug phase — just observe
    }

    // ── Normal operation ──────────────────────────────────────────────
    if (tick % 10 === 1) {
      console.log('[VGT-haunt] Scan #' + tick + ' — RS ' + alt1.rsWidth + 'x' + alt1.rsHeight);
    }

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
    console.log('[VGT-haunt] Starting up (v1.8 — debug mode for first 10 scans)...');

    var l = resolveLib();
    if (!l) {
      console.error('[VGT-haunt] A1lib / a1lib not available at init time.');
      return;
    }
    console.log('[VGT-haunt] lib resolved, imageDataFromUrl available:',
                typeof l.imageDataFromUrl === 'function');

    Promise.all(NAMES.map(function (n) {
      var paths = {
        zemouregal:   './src/img/zemouregal.png',
        vorkath:      './src/img/vorkath.png',
        ghostTrigger: './src/img/ghost_trigger.png',
        ghostHaunt:   './src/img/ghost_haunt.png',
      };
      return loadRef(n, paths[n]);
    })).then(function () {
      var ok = NAMES.filter(function (n) { return refs[n] !== null; }).length;
      console.log('[VGT-haunt] ' + ok + '/4 images loaded. DEBUG for first 10 scans, then normal.');
      setInterval(scan, SCAN_MS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
