/* ================================================================
   Vorkath GM Timer — chat-reader.js  v2.1
   ================================================================
   Uses @alt1/chatbox (Chatbox.default()) for RS3 chat OCR.
   v2.1: verbose console logging so you can see exactly what the
   reader is (or isn't) picking up.
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS      = 500;
  var FLASH_INT_MS = 1000;
  var FLASH_ON_MS  = 700;
  var FLASH_TOTAL  = 10000;

  var OVERLAY_TEXT  = 'MOVE SOUTH';
  var OVERLAY_SIZE  = 32;
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 0 * 256 + 0) | 0; // ARGB red

  // ── State ────────────────────────────────────────────────────────
  var flashTimer  = null;
  var stopTimer   = null;
  var lastTrigger = 0;

  // ── Overlay ───────────────────────────────────────────────────────
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

  // ── Chatbox reader ────────────────────────────────────────────────
  function initWithChatbox() {
    console.log('[VGT-chat] Chatbox global found:', typeof Chatbox, '| keys:', Object.keys(Chatbox).join(', '));

    var reader = new Chatbox.default();
    console.log('[VGT-chat] reader created, keys:', Object.keys(reader).join(', '));

    var mc = (typeof A1lib !== 'undefined' && A1lib.mixColor) ? A1lib.mixColor.bind(A1lib) : null;
    if (mc) {
      reader.readargs = {
        colors: [
          mc(255, 255, 255),   // white
          mc(127, 169, 255),   // public blue
          mc(0,   255, 0),     // FC green
          mc(153, 255, 153),   // light green
          mc(255, 165, 0),     // orange (clan)
          mc(255, 255, 0),     // yellow
          mc(0,   255, 255),   // cyan
          mc(255, 100, 100),   // light red
          mc(200, 200, 200),   // light grey
        ],
        backwards: true,
      };
      console.log('[VGT-chat] readargs set with', reader.readargs.colors.length, 'colors');
    } else {
      console.warn('[VGT-chat] A1lib.mixColor not available — readargs NOT set');
    }

    var chatFound = false;
    var scanCount = 0;
    var emptyStreak = 0;

    function findAndRead() {
      scanCount++;

      // ── Find chatbox ──
      if (!chatFound) {
        try {
          reader.find();
          if (reader.pos) {
            chatFound = true;
            console.log('[VGT-chat] Chatbox found! pos:', JSON.stringify(reader.pos));
          } else {
            if (scanCount <= 5 || scanCount % 20 === 1) {
              console.log('[VGT-chat] tick#' + scanCount + ': chatbox NOT found (reader.pos is null/undefined)');
            }
          }
        } catch (e) {
          console.warn('[VGT-chat] reader.find() error:', e);
        }
        return;
      }

      // ── Read ──
      try {
        var segs = reader.read() || [];

        if (segs.length === 0) {
          emptyStreak++;
          if (emptyStreak <= 5 || emptyStreak % 10 === 1) {
            console.log('[VGT-chat] tick#' + scanCount + ': 0 segments (empty streak: ' + emptyStreak + ')');
          }
        } else {
          emptyStreak = 0;
          // Log every read that returns content (but throttle after first 10 ticks)
          if (scanCount <= 20 || scanCount % 10 === 1) {
            var preview = segs.map(function (s) { return JSON.stringify((s.text || '').slice(0, 40)); }).join(', ');
            console.log('[VGT-chat] tick#' + scanCount + ': ' + segs.length + ' segs → [' + preview + ']');
          }

          for (var i = 0; i < segs.length; i++) {
            var text = (segs[i] && segs[i].text) ? segs[i].text : '';
            if (containsKeyword(text)) {
              console.log('[VGT-chat] KEYWORD found in seg[' + i + ']: ' + JSON.stringify(text));
              triggerMoveSouth();
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[VGT-chat] reader.read() error:', e);
        chatFound = false;
      }
    }

    setInterval(findAndRead, SCAN_MS);
    // Re-find every 5 s to handle chatbox position changes
    setInterval(function () {
      if (chatFound) { try { reader.find(); } catch (e) {} }
    }, 5000);

    console.log('[VGT-chat] Chatbox reader running (scan every ' + SCAN_MS + 'ms)');
  }

  // ── Fallback: bindReadStringEx ────────────────────────────────────
  function initWithBindRead() {
    console.log('[VGT-chat] Using bindReadStringEx fallback (Chatbox not available)');
    var CHAT_X = 7, CHAT_Y_BOTTOM = 139, CHAT_W = 520, CHAT_H = 120;
    var scanCount = 0;

    function scan() {
      var tick = ++scanCount;
      if (!alt1.rsLinked) return;
      try {
        var handle = alt1.bindRegion(0, 0, alt1.rsWidth, alt1.rsHeight);
        if (handle <= 0) { console.log('[VGT-chat] fallback: bindRegion returned', handle); return; }
        var chatY = alt1.rsHeight - CHAT_Y_BOTTOM;
        var text = '';
        if (typeof alt1.bindReadStringEx === 'function') {
          text = alt1.bindReadStringEx(handle, CHAT_X, chatY, CHAT_W, CHAT_H) || '';
        } else if (typeof alt1.bindReadString === 'function') {
          text = alt1.bindReadString(handle, CHAT_X, chatY, CHAT_W, CHAT_H) || '';
        }
        // Log every tick for first 10, then every 20 s
        if (tick <= 10 || tick % 40 === 1) {
          console.log('[VGT-chat] fallback tick#' + tick + ':', JSON.stringify(text.slice(0, 100)));
        }
        if (containsKeyword(text)) triggerMoveSouth();
      } catch (e) { console.warn('[VGT-chat] fallback scan error:', e); }
    }

    setInterval(scan, SCAN_MS);
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-chat] Starting up (v2.1)...');
    console.log('[VGT-chat] Chatbox type:', typeof Chatbox,
                '| OCR type:', typeof OCR,
                '| A1lib type:', typeof A1lib);

    if (typeof Chatbox !== 'undefined' && Chatbox && Chatbox.default) {
      initWithChatbox();
    } else {
      console.log('[VGT-chat] Chatbox not ready at init — waiting up to 3 s...');
      var waited = 0;
      var check = setInterval(function () {
        waited += 200;
        if (typeof Chatbox !== 'undefined' && Chatbox && Chatbox.default) {
          clearInterval(check);
          console.log('[VGT-chat] Chatbox became available after ' + waited + 'ms');
          initWithChatbox();
        } else if (waited >= 3000) {
          clearInterval(check);
          console.warn('[VGT-chat] Chatbox never became available — falling back');
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
