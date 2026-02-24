/* ================================================================
   Vorkath GM Timer — chat-reader.js  v2.3
   ================================================================
   reader.find() does not auto-detect in our UMD context.
   After 3 failed find() attempts we manually set reader.pos to
   the standard RS3 chatbox coordinates (bottom-left of RS window).
   reader.read() uses reader.pos.mainbox.rect to know where to OCR.
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  var SCAN_MS      = 500;
  var FLASH_INT_MS = 1000;
  var FLASH_ON_MS  = 700;
  var FLASH_TOTAL  = 10000;

  var OVERLAY_TEXT  = 'MOVE SOUTH';
  var OVERLAY_SIZE  = 32;
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 0 * 256 + 0) | 0;

  var flashTimer  = null;
  var stopTimer   = null;
  var lastTrigger = 0;

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

  // ── Manual chatbox position ───────────────────────────────────────
  // RS3 default interface: chatbox sits in the bottom-left corner.
  // These proportions match the default layout at any resolution.
  function buildManualPos() {
    var w = Math.min(516, Math.floor(alt1.rsWidth * 0.27));
    var h = 130;
    var x = 7;
    var y = alt1.rsHeight - 148;
    return {
      mainbox: { rect: { x: x, y: y, width: w, height: h } }
    };
  }

  function initWithChatbox() {
    var reader = new Chatbox.default();

    reader.readargs = {
      colors: Chatbox.defaultcolors || [],
      backwards: true,
    };

    console.log('[VGT-chat] reader created | defaultcolors:', (Chatbox.defaultcolors || []).length);

    var findAttempts = 0;
    var scanCount    = 0;
    var posSource    = 'none';  // 'find' or 'manual'

    function tryFind() {
      try {
        reader.find();
      } catch (e) {
        console.warn('[VGT-chat] reader.find() threw:', e && e.message ? e.message : e);
      }

      if (reader.pos) {
        posSource = 'find';
        console.log('[VGT-chat] Chatbox found via reader.find():', JSON.stringify(reader.pos));
      } else if (findAttempts >= 3) {
        // Auto-detect gave up — fall back to manual position
        reader.pos = buildManualPos();
        posSource = 'manual';
        console.log('[VGT-chat] reader.find() failed ' + findAttempts + ' times.'
                  + ' Using manual pos:', JSON.stringify(reader.pos));
      }
    }

    function readChat() {
      scanCount++;
      if (!alt1.rsLinked) return;

      // Keep trying to find (or use manual) until we have a pos
      if (!reader.pos) {
        findAttempts++;
        tryFind();
        return;
      }

      try {
        var segs = reader.read() || [];

        if (segs.length === 0) {
          if (scanCount % 20 === 1) {
            console.log('[VGT-chat] tick#' + scanCount + ': 0 segments (pos src: ' + posSource + ')');
          }
          // If manual pos keeps giving 0 segments, log a hint
          if (posSource === 'manual' && scanCount % 60 === 1) {
            var p = reader.pos.mainbox.rect;
            console.log('[VGT-chat] manual rect: x=' + p.x + ' y=' + p.y
                      + ' w=' + p.width + ' h=' + p.height
                      + ' | rsH=' + alt1.rsHeight + ' rsW=' + alt1.rsWidth);
          }
        } else {
          if (scanCount <= 30 || scanCount % 10 === 1) {
            var preview = segs.slice(0, 4).map(function (s) {
              return JSON.stringify((s.text || '').slice(0, 50));
            }).join(', ');
            console.log('[VGT-chat] tick#' + scanCount + ' [' + posSource + ']:'
                      + ' ' + segs.length + ' segs → ' + preview);
          }

          for (var i = 0; i < segs.length; i++) {
            var text = (segs[i] && segs[i].text) || '';
            if (containsKeyword(text)) {
              console.log('[VGT-chat] KEYWORD in seg[' + i + ']: ' + JSON.stringify(text));
              triggerMoveSouth();
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[VGT-chat] read() error:', e && e.message ? e.message : e);
        // Reset so we rebuild pos on next tick
        reader.pos = null;
        posSource = 'none';
        findAttempts = 0;
      }
    }

    setInterval(readChat, SCAN_MS);

    // Re-find every 10 s in case chatbox moves
    setInterval(function () {
      if (posSource === 'find') {
        try { reader.find(); } catch(e) {}
        if (!reader.pos) {
          reader.pos = buildManualPos();
          posSource = 'manual';
        }
      }
    }, 10000);

    console.log('[VGT-chat] Chatbox reader started (v2.3)');
  }

  // ── Fallback: bindReadStringEx ────────────────────────────────────
  function initWithBindRead() {
    console.log('[VGT-chat] FALLBACK: using bindReadStringEx');
    var scanCount = 0;
    function scan() {
      var tick = ++scanCount;
      if (!alt1.rsLinked) return;
      try {
        var handle = alt1.bindRegion(0, 0, alt1.rsWidth, alt1.rsHeight);
        if (handle <= 0) return;
        var chatY = alt1.rsHeight - 148;
        var text = (typeof alt1.bindReadStringEx === 'function'
          ? alt1.bindReadStringEx(handle, 7, chatY, 516, 130)
          : alt1.bindReadString(handle, 7, chatY, 516, 130)) || '';
        if (tick <= 10 || tick % 40 === 1) {
          console.log('[VGT-chat] fallback#' + tick + ':', JSON.stringify(text.slice(0, 100)));
        }
        if (containsKeyword(text)) triggerMoveSouth();
      } catch (e) { console.warn('[VGT-chat] fallback error:', e); }
    }
    setInterval(scan, SCAN_MS);
  }

  function init() {
    console.log('[VGT-chat] Starting up (v2.3)...');
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
