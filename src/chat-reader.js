/* ================================================================
   Vorkath GM Timer — chat-reader.js  v2.0
   ================================================================
   Uses @alt1/chatbox (Chatbox.default()) — the same reader used by
   the Amascut plugin — for proper RS3 chat OCR.

   Triggers: any visible chat message containing "south" or "move"
   (case-insensitive).
   Action:   flash red "MOVE SOUTH" for 10 s, 700 ms on / 300 ms off.
   Position: 55 px above screen centre (above haunt overlay).
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS      = 500;    // read chat every 500 ms
  var FLASH_INT_MS = 1000;   // flash cycle
  var FLASH_ON_MS  = 700;    // text visible per cycle
  var FLASH_TOTAL  = 10000;  // auto-stop after 10 s

  var OVERLAY_TEXT  = 'MOVE SOUTH';
  var OVERLAY_SIZE  = 32;
  // ARGB red: A=255, R=255, G=0, B=0
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 0 * 256 + 0) | 0;

  // ── State ────────────────────────────────────────────────────────
  var flashTimer  = null;
  var stopTimer   = null;
  var lastTrigger = 0;

  // ── Overlay: 55 px above centre (clear of haunt overlay) ─────────
  function showOverlay() {
    var cx = alt1.rsX + Math.floor(alt1.rsWidth  / 2) - 140;
    var cy = alt1.rsY + Math.floor(alt1.rsHeight / 2) - 55;
    alt1.overLayText(OVERLAY_TEXT, OVERLAY_COLOR, OVERLAY_SIZE, cx + 1, cy, FLASH_ON_MS);
    alt1.overLayText(OVERLAY_TEXT, OVERLAY_COLOR, OVERLAY_SIZE, cx,     cy, FLASH_ON_MS);
  }

  function startFlashing() {
    if (flashTimer) return;
    showOverlay();
    flashTimer = setInterval(showOverlay, FLASH_INT_MS);
  }

  function stopFlashing() {
    if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
    if (stopTimer)  { clearTimeout(stopTimer);   stopTimer  = null; }
  }

  function triggerMoveSouth() {
    var now = Date.now();
    if (now - lastTrigger < FLASH_TOTAL) return;  // debounce while flashing
    lastTrigger = now;
    stopFlashing();
    startFlashing();
    stopTimer = setTimeout(stopFlashing, FLASH_TOTAL);
    console.log('[VGT-chat] MOVE SOUTH triggered');
  }

  // ── Keywords ─────────────────────────────────────────────────────
  function containsKeyword(text) {
    var low = text.toLowerCase();
    return low.indexOf('south') !== -1 || low.indexOf('move') !== -1;
  }

  // ── Chatbox reader (Chatbox.default() — same as Amascut plugin) ───
  function initWithChatbox() {
    var reader = new Chatbox.default();

    // Read a broad palette so we catch messages from any chat channel.
    // mixColor(r, g, b) is available on A1lib global.
    var mc = (A1lib && A1lib.mixColor) ? A1lib.mixColor.bind(A1lib) : null;
    if (mc) {
      reader.readargs = {
        colors: [
          mc(255, 255, 255),   // white (general text)
          mc(127, 169, 255),   // public chat blue
          mc(0,   255, 0),     // friends chat green
          mc(153, 255, 153),   // light green (FC/CC)
          mc(255, 165, 0),     // orange (clan)
          mc(255, 255, 0),     // yellow
          mc(0,   255, 255),   // cyan
        ],
        backwards: true,       // newest messages first
      };
    }

    var chatFound = false;

    function findAndRead() {
      if (!chatFound) {
        try {
          reader.find();
          if (reader.pos) {
            chatFound = true;
            console.log('[VGT-chat] Chatbox found via Chatbox API');
          }
        } catch (e) { return; }
      }
      if (!chatFound) return;

      try {
        var segs = reader.read() || [];
        for (var i = 0; i < segs.length; i++) {
          var text = segs[i] && segs[i].text ? segs[i].text : '';
          if (containsKeyword(text)) {
            triggerMoveSouth();
            break;
          }
        }
      } catch (e) {
        console.warn('[VGT-chat] read error:', e);
        chatFound = false;  // re-find on next tick
      }
    }

    // Re-find if chatbox moves (e.g. interface resize)
    setInterval(function () {
      if (chatFound) {
        try { reader.find(); } catch (e) {}
      }
    }, 5000);

    setInterval(findAndRead, SCAN_MS);
    console.log('[VGT-chat] Using Chatbox.default() reader');
  }

  // ── Fallback: native alt1.bindReadStringEx ────────────────────────
  function initWithBindRead() {
    console.log('[VGT-chat] Chatbox API unavailable — using bindReadStringEx fallback');

    var CHAT_X        = 7;
    var CHAT_Y_BOTTOM = 139;
    var CHAT_W        = 520;
    var CHAT_H        = 120;

    var scanCount = 0;
    function scan() {
      var tick = ++scanCount;
      if (!alt1.rsLinked) return;
      try {
        var handle = alt1.bindRegion(0, 0, alt1.rsWidth, alt1.rsHeight);
        if (handle <= 0) return;
        var chatY = alt1.rsHeight - CHAT_Y_BOTTOM;
        var text = '';
        if (typeof alt1.bindReadStringEx === 'function') {
          text = alt1.bindReadStringEx(handle, CHAT_X, chatY, CHAT_W, CHAT_H) || '';
        } else if (typeof alt1.bindReadString === 'function') {
          text = alt1.bindReadString(handle, CHAT_X, chatY, CHAT_W, CHAT_H) || '';
        }
        if (tick <= 3 || tick % 60 === 1) {
          console.log('[VGT-chat] fallback tick#' + tick + ':', JSON.stringify(text.slice(0, 80)));
        }
        if (containsKeyword(text)) triggerMoveSouth();
      } catch (e) {}
    }

    setInterval(scan, SCAN_MS);
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-chat] Starting up (v2.0)...');

    if (typeof Chatbox !== 'undefined' && Chatbox && Chatbox.default) {
      initWithChatbox();
    } else {
      // Chatbox may still be loading — wait up to 3 s then fall back
      var waited = 0;
      var check = setInterval(function () {
        waited += 200;
        if (typeof Chatbox !== 'undefined' && Chatbox && Chatbox.default) {
          clearInterval(check);
          initWithChatbox();
        } else if (waited >= 3000) {
          clearInterval(check);
          initWithBindRead();
        }
      }, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
