/* ================================================================
   Vorkath GM Timer — chat-reader.js  v2.5
   ================================================================
   Mirrors the chatbox initialisation from the working Amascut
   Helper plugin (same CDN URLs, same mixColor colour setup,
   same find-poll → read-poll flow).

   When "south" or "move" appears in any chat segment the overlay
   "MOVE SOUTH" flashes red for 10 s then auto-stops.
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var FIND_POLL_MS = 800;    // how often to retry reader.find()
  var READ_POLL_MS = 500;    // how often to call reader.read() once found
  var EMPTY_LIMIT  = 4;      // re-find after this many consecutive empty reads

  var FLASH_INT_MS = 1000;
  var FLASH_ON_MS  = 700;
  var FLASH_TOTAL  = 10000;

  var OVERLAY_TEXT  = 'MOVE SOUTH';
  var OVERLAY_SIZE  = 32;
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 0 * 256 + 0) | 0;

  // ── State ────────────────────────────────────────────────────────
  var flashTimer  = null;
  var stopTimer   = null;
  var lastTrigger = 0;
  var emptyCount  = 0;

  // ── Overlay ──────────────────────────────────────────────────────
  // Measure text width via canvas so the overlay is truly centred.
  function overlayHalfWidth(text, size) {
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      ctx.font = 'bold ' + size + 'px Arial';
      return Math.floor(ctx.measureText(text).width / 2);
    } catch (e) { return 0; }
  }

  var _halfW = overlayHalfWidth(OVERLAY_TEXT, OVERLAY_SIZE);

  function showOverlay() {
    var cx = alt1.rsX + Math.floor(alt1.rsWidth  / 2) - _halfW;
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
    if (now - lastTrigger < FLASH_TOTAL) return;
    lastTrigger = now;
    stopFlashing();
    startFlashing();
    stopTimer = setTimeout(stopFlashing, FLASH_TOTAL);
    console.log('[VGT-chat] *** MOVE SOUTH TRIGGERED ***');
  }

  function containsKeyword(text) {
    var low = (text || '').toLowerCase();
    return low.indexOf('south') !== -1 || low.indexOf('move') !== -1;
  }

  // ── Chatbox reader ───────────────────────────────────────────────
  function initWithChatbox() {
    var A1 = window.a1lib || window.A1lib || null;
    if (!A1 || typeof A1.mixColor !== 'function') {
      console.error('[VGT-chat] A1lib not available — chat reader disabled.');
      return;
    }

    var reader = new Chatbox.default();

    // Build colours with mixColor exactly as Amascut does.
    // Covers public (white), action/name (blue), CC names (teal), FC (cyan).
    reader.readargs = {
      colors: [
        A1.mixColor(255, 255, 255),   // white  — public chat text
        A1.mixColor(127, 169, 255),   // blue   — public chat names / actions
        A1.mixColor(69,  131, 145),   // teal   — CC player name
        A1.mixColor(0,   255, 255),   // cyan   — FC text
        A1.mixColor(255, 140,   0),   // orange — game messages
      ],
      backwards: true,
    };

    console.log('[VGT-chat] reader created (v2.5)');

    var readInterval = null;

    function startReading() {
      if (readInterval) return;
      console.log('[VGT-chat] Chatbox found — starting read loop');
      readInterval = setInterval(readChat, READ_POLL_MS);
    }

    function readChat() {
      if (!alt1.rsLinked) return;
      var segs = [];
      try {
        segs = reader.read() || [];
      } catch (e) {
        console.warn('[VGT-chat] read() error:', e && e.message ? e.message : e);
        segs = [];
      }

      if (!segs.length) {
        emptyCount++;
        if (emptyCount >= EMPTY_LIMIT) {
          console.log('[VGT-chat] ' + EMPTY_LIMIT + ' empty reads — re-running find()');
          emptyCount = 0;
          try { reader.pos = null; reader.find(); } catch (e) {}
          if (!reader.pos) {
            console.warn('[VGT-chat] re-find failed, will keep retrying');
          } else {
            console.log('[VGT-chat] re-find succeeded:', JSON.stringify(reader.pos));
          }
        }
        return;
      }

      emptyCount = 0;

      for (var i = 0; i < segs.length; i++) {
        var text = (segs[i] && segs[i].text) || '';
        if (containsKeyword(text)) {
          console.log('[VGT-chat] KEYWORD in seg[' + i + ']: ' + JSON.stringify(text));
          triggerMoveSouth();
          break;
        }
      }
    }

    // Poll find() every FIND_POLL_MS until chatbox is located, then switch to reading.
    var finder = setInterval(function () {
      if (!alt1.rsLinked) return;
      try {
        if (!reader.pos) {
          reader.find();
        }
        if (reader.pos && reader.pos.mainbox && reader.pos.mainbox.rect) {
          clearInterval(finder);
          console.log('[VGT-chat] Chatbox pos:', JSON.stringify(reader.pos));
          startReading();
        }
      } catch (e) {
        console.warn('[VGT-chat] find() error:', e && e.message ? e.message : e);
      }
    }, FIND_POLL_MS);

    console.log('[VGT-chat] Polling for chatbox every ' + FIND_POLL_MS + ' ms...');
  }

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-chat] Starting up (v2.5)...');
    if (typeof Chatbox !== 'undefined' && Chatbox && Chatbox.default) {
      initWithChatbox();
    } else {
      var waited = 0;
      var check = setInterval(function () {
        waited += 200;
        if (typeof Chatbox !== 'undefined' && Chatbox && Chatbox.default) {
          clearInterval(check);
          initWithChatbox();
        } else if (waited >= 3000) {
          clearInterval(check);
          console.error('[VGT-chat] Chatbox library not available after 3 s — chat reader disabled.');
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
