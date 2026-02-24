/* ================================================================
   Vorkath GM Timer — chat-reader.js  v1.0
   ================================================================
   Reads the RS chat box every second via alt1.bindReadStringEx.
   If "south" or "move" appears (case-insensitive) in the visible
   chat text, flashes "MOVE SOUTH" in red for 10 seconds.

   Overlay is positioned 55 px above screen centre so it does not
   overlap the "COMMAND GHOST FOR HAUNT!" overlay (which sits at
   screen centre).
   ================================================================ */

'use strict';

(function () {

  if (typeof alt1 === 'undefined') return;

  // ── Config ──────────────────────────────────────────────────────
  var SCAN_MS      = 1000;   // check chat every second
  var FLASH_INT_MS = 1000;   // flash cycle length
  var FLASH_ON_MS  = 700;    // text visible per cycle (300 ms off)
  var FLASH_TOTAL  = 10000;  // auto-stop after 10 s

  var OVERLAY_TEXT  = 'MOVE SOUTH';
  var OVERLAY_SIZE  = 32;
  // ARGB red: A=255, R=255, G=0, B=0
  var OVERLAY_COLOR = (255 * 16777216 + 255 * 65536 + 0 * 256 + 0) | 0;

  // RS3 default chatbox region (relative to RS window top-left)
  var CHAT_X        = 7;
  var CHAT_Y_BOTTOM = 139;  // distance from bottom of RS window
  var CHAT_W        = 520;
  var CHAT_H        = 120;

  // ── State ────────────────────────────────────────────────────────
  var flashTimer  = null;
  var stopTimer   = null;
  var lastTrigger = 0;     // Date.now() of last trigger

  // ── Overlay (55 px above centre, clear of haunt overlay) ─────────
  function showOverlay() {
    var cx = alt1.rsX + Math.floor(alt1.rsWidth  / 2) - 140;
    var cy = alt1.rsY + Math.floor(alt1.rsHeight / 2) - 55;
    // Draw twice for fake-bold effect
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

  // ── Trigger: flash for exactly 10 s, ignore retriggering until done
  function triggerMoveSouth() {
    var now = Date.now();
    if (now - lastTrigger < FLASH_TOTAL) return;  // still running
    lastTrigger = now;
    stopFlashing();
    startFlashing();
    stopTimer = setTimeout(stopFlashing, FLASH_TOTAL);
    console.log('[VGT-chat] MOVE SOUTH triggered');
  }

  // ── Read chat via native OCR ──────────────────────────────────────
  function readChat() {
    try {
      var handle = alt1.bindRegion(0, 0, alt1.rsWidth, alt1.rsHeight);
      if (handle <= 0) return '';
      var chatY = alt1.rsHeight - CHAT_Y_BOTTOM;
      var text = '';
      if (typeof alt1.bindReadStringEx === 'function') {
        text = alt1.bindReadStringEx(handle, CHAT_X, chatY, CHAT_W, CHAT_H) || '';
      } else if (typeof alt1.bindReadString === 'function') {
        text = alt1.bindReadString(handle, CHAT_X, chatY, CHAT_W, CHAT_H) || '';
      }
      return text;
    } catch (e) {
      return '';
    }
  }

  // ── Scan ──────────────────────────────────────────────────────────
  var scanCount = 0;
  function scan() {
    var tick = ++scanCount;
    if (!alt1.rsLinked) return;

    var text = readChat();

    // Log first 3 scans and every 30 s so we can verify what's being read
    if (tick <= 3 || tick % 30 === 1) {
      console.log('[VGT-chat] tick#' + tick + ' chat:', JSON.stringify(text.slice(0, 120)));
    }

    if (text.toLowerCase().indexOf('south') !== -1 ||
        text.toLowerCase().indexOf('move')  !== -1) {
      triggerMoveSouth();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log('[VGT-chat] Starting up (v1.0)...');
    setInterval(scan, SCAN_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
