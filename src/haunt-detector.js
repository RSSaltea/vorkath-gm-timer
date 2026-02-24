/* ================================================================
   Vorkath GM Timer — haunt-detector.js  v1.2
   ================================================================
   Uses a1lib.captureHoldFullRs() + a1lib.findSubimage() — the same
   API used by AFKWarden and other RuneApps plugins.

   Scans the full RS screen every 2 s.
   Trigger:   zemouregal + vorkath + ghost_trigger all visible
   Condition: ghost_haunt NOT visible
   Action:    flash "Command Ghost for Haunt" at screen centre
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS    = 2000;
  var OVERLAY_MS = 2500;

  var OVERLAY_TEXT  = 'Command Ghost for Haunt';
  var OVERLAY_SIZE  = 28;
  // ARGB orange: A=255, R=255, G=165, B=0  (float arithmetic avoids signed-int issues)
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 165 * 256 + 0) | 0;

  // ── State ────────────────────────────────────────────────────────
  var refs = {};   // { name: ImageData | null }

  // ── Load a reference PNG as a standard RGBA ImageData ─────────────
  // a1lib.findSubimage() accepts plain canvas ImageData as the needle.
  function loadRef(name, path) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width  = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        refs[name] = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        console.log('[VGT-haunt] Loaded "' + name + '" (' + refs[name].width + 'x' + refs[name].height + ')');
        resolve();
      };
      img.onerror = function () {
        console.warn('[VGT-haunt] Could not load:', path);
        refs[name] = null;
        resolve();
      };
      img.src = path;
    });
  }

  // ── Image search via a1lib ────────────────────────────────────────
  // a1lib.findSubimage(ImgRefBind, ImageData) → [{x,y}]
  // Uses native alt1.bindFindSubImg when available (fast),
  // falls back to JS comparison — handles pixel format internally.
  function imageFound(screen, name) {
    if (!refs[name] || !screen) return false;
    try {
      var hits = a1lib.findSubimage(screen, refs[name]);
      return hits && hits.length > 0;
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

  // ── Main scan ─────────────────────────────────────────────────────
  var scanCount = 0;
  function scan() {
    var tick = ++scanCount;

    if (!alt1.rsLinked) {
      if (tick % 5 === 1) console.log('[VGT-haunt] RS not linked');
      return;
    }

    var screen;
    try {
      screen = a1lib.captureHoldFullRs();
    } catch (e) {
      console.warn('[VGT-haunt] Capture error:', e);
      return;
    }
    if (!screen) { console.warn('[VGT-haunt] No capture returned'); return; }

    if (tick % 10 === 1) {
      console.log('[VGT-haunt] Scan #' + tick + ' — ' + screen.width + 'x' + screen.height);
    }

    // Step 1: confirm all three encounter indicators are on screen
    if (!imageFound(screen, 'zemouregal'))   return;
    if (!imageFound(screen, 'vorkath'))      return;
    if (!imageFound(screen, 'ghostTrigger')) return;

    console.log('[VGT-haunt] Encounter active!');

    // Step 2: if purple ghost (Haunt) is not present, remind the player
    if (!imageFound(screen, 'ghostHaunt')) {
      console.log('[VGT-haunt] Ghost haunt MISSING — overlay');
      showReminder();
    } else {
      if (tick % 5 === 0) console.log('[VGT-haunt] Ghost haunt present — OK');
    }
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-haunt] Starting up...');

    if (typeof a1lib === 'undefined' || !a1lib.findSubimage) {
      console.error('[VGT-haunt] a1lib.findSubimage not available — detection disabled');
      return;
    }

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
