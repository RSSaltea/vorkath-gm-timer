/* ================================================================
   Vorkath GM Timer — haunt-detector.js  v2.0
   ================================================================
   Logic (scan every 4 ticks / 2400 ms):
     1. vorkath.png OR zemouregal.png visible  → encounter active
     2. ghostTrigger NOT found while active    → start flashing
     3. Either NPC gone OR ghostTrigger found  → stop flashing

   Flash effect: overLayText every 1000 ms with 700 ms duration
   → text visible 700 ms, off 300 ms per cycle.
   Fake bold: text drawn twice with 1 px horizontal offset.
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS      = 2400;   // 4 RS ticks
  var FLASH_INT_MS = 1000;   // flash cycle (ms)
  var FLASH_ON_MS  = 700;    // how long text stays visible each cycle

  var OVERLAY_TEXT  = 'COMMAND GHOST FOR HAUNT!';
  var OVERLAY_SIZE  = 32;
  // ARGB red: A=255, R=255, G=0, B=0
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 0 * 256 + 0) | 0;

  // ── State ────────────────────────────────────────────────────────
  var GHOST_SKIP_MS = 10000; // skip ghost checks for 10 s after a match

  var refs       = {};
  var lib        = null;
  var screen     = null;
  var flashTimer = null;   // non-null while flashing
  var ghostFoundAt = 0;    // timestamp of last ghost trigger match

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
          console.warn('[VGT-haunt] Failed "' + name + '":', e);
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
    } catch (e) { return false; }
  }

  // ── Search ────────────────────────────────────────────────────────
  function imageFound(name) {
    if (!refs[name] || !screen) return false;
    try {
      var hits = typeof screen.findSubimage === 'function'
        ? screen.findSubimage(refs[name])
        : lib.findSubimage(screen, refs[name]);
      return Array.isArray(hits) && hits.length > 0;
    } catch (e) { return false; }
  }

  // ── Overlay: flashing bold red text ──────────────────────────────
  // Measure text width via canvas so the overlay is truly centred.
  // Drawn twice with 1 px x-offset for a fake-bold appearance.
  function overlayHalfWidth(text, size) {
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      ctx.font = 'bold ' + size + 'px Arial';
      return Math.floor(ctx.measureText(text).width / 2);
    } catch (e) { return 0; }
  }

  var _halfW = overlayHalfWidth(OVERLAY_TEXT, OVERLAY_SIZE);

  function showReminder() {
    var cx = alt1.rsX + Math.floor(alt1.rsWidth  / 2) - _halfW;
    var cy = alt1.rsY + Math.floor(alt1.rsHeight / 2);
    alt1.overLayText(OVERLAY_TEXT, OVERLAY_COLOR, OVERLAY_SIZE, cx + 1, cy, FLASH_ON_MS);
    alt1.overLayText(OVERLAY_TEXT, OVERLAY_COLOR, OVERLAY_SIZE, cx,     cy, FLASH_ON_MS);
  }

  function startFlashing() {
    if (flashTimer) return;   // already flashing
    showReminder();
    flashTimer = setInterval(showReminder, FLASH_INT_MS);
  }

  function stopFlashing() {
    if (!flashTimer) return;  // already stopped
    clearInterval(flashTimer);
    flashTimer = null;
    // Overlay expires on its own within FLASH_ON_MS
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

    var encounterActive = imageFound('vorkath') || imageFound('zemouregal');

    // Expose for chat-reader.js so MOVE SOUTH only triggers mid-encounter.
    window.VGT_encounterActive = encounterActive;

    // Check all ghost trigger variants (normal + cooldown states).
    // If any match, skip further checks for 10 s.
    var ghostVisible = false;
    if (Date.now() - ghostFoundAt < GHOST_SKIP_MS) {
      ghostVisible = true;  // still within skip window
    } else if (imageFound('ghostTrigger') || imageFound('ghostTrigger2') || imageFound('ghostTrigger3') || imageFound('ghostTrigger4') || imageFound('ghostTriggerBackup')) {
      ghostVisible = true;
      ghostFoundAt = Date.now();
    }

    if (window.VGT_remindersEnabled !== false && encounterActive && !ghostVisible) {
      startFlashing();
    } else {
      stopFlashing();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-haunt] Starting up (v2.0)...');
    if (!resolveLib()) {
      console.error('[VGT-haunt] A1lib not available.');
      return;
    }
    var ghostRefs = ['ghostTrigger', 'ghostTrigger2', 'ghostTrigger3', 'ghostTrigger4', 'ghostTriggerBackup'];
    Promise.all([
      loadRef('vorkath',             './src/img/vorkath.png'),
      loadRef('zemouregal',          './src/img/zemouregal.png'),
      loadRef('ghostTrigger',        './src/img/ghost_trigger.png'),
      loadRef('ghostTrigger2',       './src/img/ghost_trigger2.png'),
      loadRef('ghostTrigger3',       './src/img/ghost_trigger3.png'),
      loadRef('ghostTrigger4',       './src/img/ghost_trigger4.png'),
      loadRef('ghostTriggerBackup',  './src/img/ghost_trigger_backup.png'),
    ]).then(function () {
      var allRefs = ['vorkath', 'zemouregal'].concat(ghostRefs);
      var loaded = allRefs.filter(function (n) { return refs[n] !== null; }).length;
      console.log('[VGT-haunt] ' + loaded + '/' + allRefs.length + ' images loaded. Scanning every ' + SCAN_MS + 'ms.');
      setInterval(scan, SCAN_MS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
