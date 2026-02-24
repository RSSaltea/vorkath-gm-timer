/* ================================================================
   Vorkath GM Timer — chat-reader.js  v2.2
   ================================================================
   - Uses Chatbox.defaultcolors (built-in palette) instead of manual
     color list, which is what find() uses to locate the chatbox.
   - Enables reader.debug = true for extra find() diagnostics.
   - Logs reader.pos in full on every find() attempt.
   - Tries both backwards:true and backwards:false.
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

  function initWithChatbox() {
    var reader = new Chatbox.default();

    // Enable debug output from the reader itself
    reader.debug = true;

    // Use the built-in default color palette — this is what find()
    // uses internally to locate the chatbox on screen.
    var colors = (Chatbox.defaultcolors && Chatbox.defaultcolors.length)
      ? Chatbox.defaultcolors
      : null;

    if (!colors && typeof A1lib !== 'undefined' && A1lib.mixColor) {
      var mc = A1lib.mixColor.bind(A1lib);
      colors = [
        mc(255,255,255), mc(127,169,255), mc(0,255,0),
        mc(153,255,153), mc(255,165,0),   mc(255,255,0),
        mc(0,255,255),   mc(255,100,100), mc(200,200,200),
      ];
    }

    reader.readargs = {
      colors: colors,
      backwards: true,
    };

    console.log('[VGT-chat] Using Chatbox.defaultcolors:', !!(Chatbox.defaultcolors && Chatbox.defaultcolors.length),
                '| color count:', colors ? colors.length : 0);

    var chatFound = false;
    var scanCount = 0;
    var findAttempts = 0;

    function findAndRead() {
      scanCount++;

      if (!alt1.rsLinked) {
        if (scanCount % 20 === 1) console.log('[VGT-chat] rsLinked = false, skipping');
        return;
      }

      if (!chatFound) {
        findAttempts++;
        try {
          reader.find();
        } catch (e) {
          console.warn('[VGT-chat] reader.find() THREW:', e && e.message ? e.message : e);
        }

        // Log what pos looks like (null, undefined, or object)
        if (findAttempts <= 10 || findAttempts % 20 === 1) {
          console.log('[VGT-chat] find attempt #' + findAttempts
                    + ' | reader.pos =', JSON.stringify(reader.pos));
        }

        if (reader.pos) {
          chatFound = true;
          console.log('[VGT-chat] *** CHATBOX FOUND *** pos:', JSON.stringify(reader.pos));
        }
        return;
      }

      // Read segments
      try {
        var segs = reader.read() || [];
        if (segs.length === 0) {
          if (scanCount % 20 === 1) console.log('[VGT-chat] tick#' + scanCount + ': 0 segments');
        } else {
          if (scanCount <= 30 || scanCount % 10 === 1) {
            var preview = segs.slice(0, 4).map(function (s) {
              return JSON.stringify((s.text || '').slice(0, 50));
            }).join(', ');
            console.log('[VGT-chat] tick#' + scanCount + ': ' + segs.length + ' segs → ' + preview);
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
        chatFound = false;
      }
    }

    setInterval(findAndRead, SCAN_MS);
    setInterval(function () {
      if (chatFound) { try { reader.find(); } catch(e) {} }
    }, 5000);

    console.log('[VGT-chat] reader ready (debug=true, scan every ' + SCAN_MS + 'ms)');
  }

  function initWithBindRead() {
    console.log('[VGT-chat] FALLBACK: using bindReadStringEx');
    var CHAT_X = 7, CHAT_Y_BOTTOM = 139, CHAT_W = 520, CHAT_H = 120;
    var scanCount = 0;
    function scan() {
      var tick = ++scanCount;
      if (!alt1.rsLinked) return;
      try {
        var handle = alt1.bindRegion(0, 0, alt1.rsWidth, alt1.rsHeight);
        if (handle <= 0) return;
        var chatY = alt1.rsHeight - CHAT_Y_BOTTOM;
        var text = (typeof alt1.bindReadStringEx === 'function'
          ? alt1.bindReadStringEx(handle, CHAT_X, chatY, CHAT_W, CHAT_H)
          : alt1.bindReadString(handle, CHAT_X, chatY, CHAT_W, CHAT_H)) || '';
        if (tick <= 10 || tick % 40 === 1) {
          console.log('[VGT-chat] fallback#' + tick + ':', JSON.stringify(text.slice(0, 100)));
        }
        if (containsKeyword(text)) triggerMoveSouth();
      } catch (e) { console.warn('[VGT-chat] fallback error:', e); }
    }
    setInterval(scan, SCAN_MS);
  }

  function init() {
    console.log('[VGT-chat] Starting up (v2.2)...');
    console.log('[VGT-chat] Chatbox:', typeof Chatbox,
                '| defaultcolors:', Array.isArray(Chatbox && Chatbox.defaultcolors)
                  ? Chatbox.defaultcolors.length + ' colors' : 'n/a');

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
          console.warn('[VGT-chat] Chatbox never available — falling back');
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
