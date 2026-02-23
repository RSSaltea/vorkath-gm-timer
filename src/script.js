/* ================================================================
   Vorkath GM Timer — script.js
   ================================================================
   Reads the logged-in player name from Alt1, fetches the Vorkath
   GM carry queue from Google Sheets, and alerts the player when
   they are in the top 3 or it is their turn.
   ================================================================ */

'use strict';

// ── Config ────────────────────────────────────────────────────────
const SHEET_ID       = '164faXDaQzmPjvTX02SeK-UTjXe2Vq6GjA-EZOPF7UFQ';
const SHEET_NAME     = 'List';
const REFRESH_MS     = 10_000;   // auto-refresh interval (10 s)

// ── State ─────────────────────────────────────────────────────────
let detectedName      = '';   // name read from Alt1
let queueData         = [];   // current full queue (array of strings)
let wasFirst          = false;
let wasInTopThree     = false;
let refreshTimer      = null;

// ── Chatbox reader ────────────────────────────────────────────────
let chatReader        = null;
let nameDetectTimer   = null;  // input-line OCR interval

// ── OCR diagnostics (logged once) ─────────────────────────────────
let _fontStructLogged = false;
let _ocrKeysLogged    = false;
let _lastFontState    = false;
let _mcLogged         = false;   // separate flag: log mc() packed format once
let _rawOcrLogged     = false;   // separate flag: log raw OCR result once
let _lrbufLogged      = false;   // separate flag: log lastReadBuffer info once
let _linesLogged      = false;   // log first batch of read() lines once
let _rclLogged        = false;   // log readChatLine() attempt once
let _lastNoMatchLog   = 0;       // timestamp: suppress repeated "no match" spam

// ── Debug log ─────────────────────────────────────────────────────

function log(msg) {
  console.log('[VGT]', msg);
  try {
    var out = document.getElementById('debug-log');
    if (!out) return;
    var d = document.createElement('div');
    d.className = 'vgt-debug-entry';
    d.textContent = new Date().toLocaleTimeString() + '  ' + String(msg);
    out.prepend(d);
    while (out.childElementCount > 300) out.removeChild(out.lastChild);
  } catch (e) {}
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Build the Google Sheets gviz CSV export URL for a given range.
 * The sheet must be shared publicly (anyone with the link can view).
 */
function sheetUrl(range) {
  return (
    'https://docs.google.com/spreadsheets/d/' +
    SHEET_ID +
    '/gviz/tq?tqx=out:csv&sheet=' +
    encodeURIComponent(SHEET_NAME) +
    '&range=' +
    encodeURIComponent(range)
  );
}

/**
 * Parse a single-column CSV response into a trimmed string array,
 * stripping surrounding quotes that Google Sheets adds.
 */
function parseCSV(text) {
  return text
    .split('\n')
    .map(function(row) { return row.replace(/^"|"$/g, '').trim(); })
    .filter(function(row) { return row.length > 0; });
}

/** Escape user-provided strings before inserting them into innerHTML. */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Return the name to compare against the queue. */
function getEffectiveName() {
  var override = document.getElementById('name-override').value.trim();
  return override || detectedName;
}

// ── Player-name detection ─────────────────────────────────────────

/** Called from refresh(); only tries the Alt1 API properties (usually undefined). */
function detectName() {
  if (typeof alt1 === 'undefined') return;
  var n = alt1.rsPlayerName || alt1.rsProfileName;
  if (n && n !== 'undefined' && n !== '') setDetectedName(n);
}

/**
 * Collect all font definitions available from the Chatbox module.
 * chatReader.font may be the outer {name,lineheight,dy,def} wrapper
 * OR the inner FontDefinition {chars,basey,width,...} directly.
 * We always pass the inner def to OCR.readLine.
 */
function getChatFonts() {
  var fonts = [];

  // Log OCR module keys once — helps diagnose available helpers
  if (!_ocrKeysLogged && typeof OCR !== 'undefined') {
    _ocrKeysLogged = true;
    try { log('OCR keys: ' + Object.getOwnPropertyNames(OCR).join(',')); } catch (e) {}
  }

  if (chatReader && chatReader.font) {
    var cf = chatReader.font;

    // Log full font structure once so we can diagnose mismatches
    if (!_fontStructLogged) {
      _fontStructLogged = true;
      try {
        log('chatReader.font keys: ' + Object.keys(cf).join(','));
        if (cf.def) {
          log('font.def keys: ' + Object.keys(cf.def).join(',') +
              ' basey=' + cf.def.basey + ' h=' + cf.def.height +
              ' chars#=' + (cf.def.chars ? Object.keys(cf.def.chars).length : 'none'));
        } else {
          log('font direct: basey=' + cf.basey + ' h=' + cf.height +
              ' chars#=' + (cf.chars ? Object.keys(cf.chars).length : 'none'));
        }
        log('chatReader inst keys: ' + Object.keys(chatReader).join(','));
      } catch (e) {}
    }

    if (cf.def && cf.def.chars) {
      // Outer wrapper — OCR needs the inner def
      fonts.push(cf.def);
    } else if (cf.chars) {
      // Already the inner FontDefinition
      fonts.push(cf);
    } else {
      // Unknown structure — search common sub-property names
      log('getChatFonts: unknown struct, keys=' + Object.keys(cf).join(','));
      var tryKeys = ['def', 'font', 'fontDef', 'fd', 'data'];
      for (var tk = 0; tk < tryKeys.length; tk++) {
        var sub = cf[tryKeys[tk]];
        if (sub && sub.chars) { fonts.push(sub); log('getChatFonts: found via cf.' + tryKeys[tk]); break; }
      }
      if (fonts.length === 0) fonts.push(cf); // last resort
    }
  }

  // Check if the chatReader instance itself exposes a fonts array
  if (chatReader) {
    var crArr = chatReader.fonts || chatReader.chatfonts || chatReader._fonts;
    if (Array.isArray(crArr)) {
      log('getChatFonts: chatReader has ' + crArr.length + ' fonts in array');
      for (var ci = 0; ci < crArr.length; ci++) {
        var fi = crArr[ci];
        if (!fi) continue;
        if (fi.def && fi.def.chars) fonts.push(fi.def);
        else if (fi.chars)          fonts.push(fi);
      }
    }
  }

  if (typeof Chatbox !== 'undefined') {
    // Try several possible export shapes for the bundled fonts array
    var arr = Chatbox.fonts || Chatbox.chatfonts
            || (Chatbox.default && (Chatbox.default.fonts || Chatbox.default.chatfonts));
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length; i++) {
        var f = arr[i];
        if (!f) continue;
        if (f.def && f.def.chars) fonts.push(f.def);
        else if (f.chars)         fonts.push(f);
      }
      log('getChatFonts: +' + arr.length + ' bundled fonts');
    }
  }

  if (fonts.length === 0) {
    log('getChatFonts: no fonts yet');
  }
  return fonts;
}

/**
 * OCR helper: run readLine strategies A+B on a decoded text string.
 * Returns the extracted name, or null.
 */
function extractNameFromOcrText(text) {
  // Strategy B: anchor ": [" or " ["
  var ai = text.indexOf(': [');
  if (ai < 0) ai = text.indexOf(' [');
  if (ai > 0) {
    var before = text.substring(0, ai).trim();
    var mB = before.match(/([A-Za-z0-9][A-Za-z0-9 \-]*)$/);
    if (mB && mB[1].trim().length >= 2) return mB[1].trim();
  }
  // Strategy A: prefix
  var mA = text.match(/^([A-Za-z0-9][A-Za-z0-9 \-]{1,11})(?:[^A-Za-z0-9 \-]|$)/);
  if (mA && mA[1].trim().length >= 2) return mA[1].trim();
  return null;
}

/**
 * OCR helper: run readLine over a y-range within an ImageData.
 * Returns the first useful decoded name, or null.
 * prefix — short tag for log messages (e.g. "cap" or "lrbuf")
 */
function ocrYRange(img, fonts, colorSets, minY, maxY, prefix) {
  for (var fi = 0; fi < fonts.length; fi++) {
    for (var yo = minY; yo <= maxY; yo++) {
      for (var ci = 0; ci < colorSets.length; ci++) {
        try {
          var res  = OCR.readLine(img, fonts[fi], colorSets[ci], 0, yo, true, false);
          var text = (typeof res === 'string') ? res : (res ? (res.text || '') : '');
          if (text.length < 2) continue;
          // Log raw result once at y=9 for all colors (one-time diagnostics)
          if (!_rawOcrLogged && yo === 9) {
            log('raw[' + prefix + '] y=9 c=' + ci + ': "' + text.substring(0, 40) + '"');
            if (ci === colorSets.length - 1) _rawOcrLogged = true;
          }
          // Skip all-same-char results (font-mismatch indicator)
          var uc = {}; for (var kk = 0; kk < Math.min(text.length, 8); kk++) uc[text[kk]] = 1;
          if (Object.keys(uc).length === 1 && text.length > 4) continue;
          log(prefix + ' f=' + fi + ' y=' + yo + ' c=' + ci + ': "' + text + '"');
          var name = extractNameFromOcrText(text);
          if (name) return name;
        } catch (e2) { /* skip bad combo */ }
      }
    }
  }
  return null;
}

/**
 * Try to read the input line from chatReader.lastReadBuffer — the same
 * ImageData the chatbox uses for decoding messages (which already works).
 * The input line is at the bottom 18 px of that buffer.
 */
function tryNameFromLastBuffer() {
  if (!chatReader || !chatReader.lastReadBuffer || !chatReader.font) return false;
  if (typeof OCR === 'undefined' || !OCR.readLine) return false;

  var fonts = getChatFonts();
  if (fonts.length === 0) return false;

  try {
    var raw = chatReader.lastReadBuffer;
    var img = (raw && typeof raw.toData === 'function') ? raw.toData() : raw;
    if (!img || !img.data) { log('lrbuf: no data'); return false; }

    var mc = A1lib.mixColor || (typeof mixColor === 'function' ? mixColor : null);
    if (!mc) return false;

    // Log lastReadBuffer info once
    if (!_lrbufLogged) {
      _lrbufLogged = true;
      log('lrbuf: ' + img.width + 'x' + img.height + ' (input line at y=' + (img.height - 18) + ')');
      // Log chatReader prototype methods — might reveal readFull() or readInputLine()
      try { log('chatReader proto: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(chatReader)).join(',')); } catch(e) {}
      // Log alt1 RS-related keys — might expose rsLoginName or rsPlayerName
      try {
        var rsKeys = Object.keys(alt1).filter(function(k) { return /rs|player|name|login|char/i.test(k); });
        log('alt1 rs* keys: ' + rsKeys.join(','));
      } catch(e) {}
    }

    if (img.height < 20) { log('lrbuf: buffer too small (' + img.height + ')'); return false; }

    var baseY = img.height - 18;

    // ── readChatLine diagnostic — run once to see what the internal reader returns
    if (!_rclLogged && typeof chatReader.readChatLine === 'function') {
      _rclLogged = true;
      try {
        // How many params does it expect?
        log('readChatLine.length=' + chatReader.readChatLine.length);
        // Peek at source (may be minified but arg names still visible)
        log('readChatLine src: ' + chatReader.readChatLine.toString().substring(0, 200));
        // Try calling at input-line y positions (bottom 18 px of the buffer)
        for (var ry = baseY; ry <= baseY + 14; ry += 2) {
          try {
            var rclR = chatReader.readChatLine(img, ry);
            if (rclR !== null && rclR !== undefined) {
              log('rcl y=' + ry + ': ' + JSON.stringify(rclR).substring(0, 120));
            }
          } catch (rclE) { log('rcl y=' + ry + ' err: ' + rclE.message); break; }
        }
      } catch (e3) { log('readChatLine setup err: ' + e3); }
    }
    var colorSets = [
      [mc(255, 255, 255)],
      [mc(200, 200, 200)],
      [mc(255, 255,   0)],
      [mc(127, 169, 255)],
      [mc( 69, 131, 145)],
    ];

    var name = ocrYRange(img, fonts, colorSets, baseY, baseY + 17, 'lrbuf');
    if (name) {
      log('ocr: name (lrbuf) — "' + name + '"');
      setDetectedName(name);
      updateStatus(queueData.length > 0 ? queueData : null);
      updateQueueList(queueData.length > 0 ? queueData : null);
      return true;
    }
    var _nm = Date.now();
    if (_nm - _lastNoMatchLog > 20000) { _lastNoMatchLog = _nm; log('lrbuf: no match (still trying...)'); }
  } catch (e) { log('lrbuf err: ' + e); }
  return false;
}

/**
 * Try to OCR the chatbox input line, which always reads:
 *   "Saltea◆: [Public Chat - Press Enter to Chat]"
 *
 * Strategy A — prefix: extract name from before the first non-name char.
 * Strategy B — anchor: find ": [" or "◆:" in the OCR result and take
 *              everything to its left as the name.  This is the more
 *              robust path because "[Public Chat..." is a fixed known string.
 *
 * Returns true if a name was successfully extracted.
 */
function tryNameFromInputLine() {
  if (!chatReader || !chatReader.pos) { log('ocr: no pos yet'); return false; }
  if (typeof OCR === 'undefined' || !OCR.readLine) { log('ocr: no OCR lib'); return false; }

  var fonts = getChatFonts();
  if (fonts.length === 0) { return false; }  // getChatFonts already logged

  var rect = chatReader.pos.mainbox.rect;

  // Capture the bottom 30 px of the chatbox rect — covers the mode indicator line.
  var capX = rect.x;
  var capH = 30;
  var capY = rect.y + rect.height - capH;
  var capW = rect.width || 368;

  try {
    // Use alt1.captureHold directly (A1lib is a wrapper but may behave differently)
    var imgRef = (typeof alt1 !== 'undefined' && alt1.captureHold)
               ? alt1.captureHold(capX, capY, capW, capH)
               : A1lib.captureHold(capX, capY, capW, capH);
    if (!imgRef) { log('ocr: captureHold null'); return false; }

    var img = imgRef.toData ? imgRef.toData() : imgRef;
    if (!img || !img.data) { log('ocr: no img.data'); return false; }

    // Only log img/brightest details once every 30s to keep the debug buffer usable
    var _capNow = Date.now();
    var _logCap = (_capNow - _lastNoMatchLog > 20000);

    if (_logCap) log('ocr: img ' + img.width + 'x' + img.height + ' at (' + capX + ',' + capY + ')');

    // ── Pixel scan: find the brightest pixel to verify we got real screen data ──
    var pSum = 0, pR = 0, pG = 0, pB = 0, pY = 0, pX = 0;
    for (var py = 0; py < img.height; py++) {
      for (var px = 0; px < Math.min(img.width, 200); px++) {
        var i4 = (py * img.width + px) * 4;
        var s  = img.data[i4] + img.data[i4 + 1] + img.data[i4 + 2];
        if (s > pSum) { pSum = s; pR = img.data[i4]; pG = img.data[i4+1]; pB = img.data[i4+2]; pY = py; pX = px; }
      }
    }
    if (_logCap) log('ocr: brightest px=(' + pX + ',' + pY + ') rgb(' + pR + ',' + pG + ',' + pB + ') sum=' + pSum);
    if (pSum < 90) { log('ocr: capture is black — coordinate mismatch?'); return false; }

    var mc = A1lib.mixColor || (typeof mixColor === 'function' ? mixColor : null);
    if (!mc) { log('ocr: no mixColor'); return false; }

    // One-time diagnostics: packed-color format, pixel colors, alpha channel
    if (!_mcLogged) {
      _mcLogged = true;
      log('mc(255,255,255) = 0x' + (mc(255,255,255) >>> 0).toString(16).padStart(8,'0'));
      // Alpha at brightest pixel
      var ai4 = (pY * img.width + pX) * 4;
      log('brightest alpha = ' + img.data[ai4 + 3]);
      // Pixel scan at y=0, y=5, y=9 (baseline) across name area
      ['y=0','y=5','y=9'].forEach(function(label, scanY) {
        scanY = [0, 5, 9][['y=0','y=5','y=9'].indexOf(label)];
        var row = label + ':';
        for (var sx = 0; sx <= 100; sx += 5) {
          var si = (scanY * img.width + sx) * 4;
          row += ' x' + sx + '=(' + img.data[si] + ',' + img.data[si+1] + ',' + img.data[si+2] + ')';
        }
        log('px ' + row);
      });
    }

    // Colours to try — white for "◆: [Public Chat..." plus other RS chat colours
    var colorSets = [
      [mc(255, 255, 255)],           // white
      [mc(200, 200, 200)],           // light grey
      [mc(160, 160, 160)],           // medium grey
      [mc(255, 255,   0)],           // yellow
      [mc(255, 200,   0)],           // gold
      [mc(127, 169, 255)],           // public chat blue
      [mc( 69, 131, 145)],           // name teal
      [mc(153, 255, 153)],           // green
      [mc(pR, pG, pB)],              // dynamically discovered brightest
    ];

    // ── Try captureHold OCR ────────────────────────────────────────────────────
    var capName = ocrYRange(img, fonts, colorSets, 0, capH - 1, 'cap');
    if (capName) {
      log('ocr: name (cap) — "' + capName + '"');
      setDetectedName(capName);
      updateStatus(queueData.length > 0 ? queueData : null);
      updateQueueList(queueData.length > 0 ? queueData : null);
      return true;
    }

    // ── Try OCR.findReadLine if available ─────────────────────────────────────
    if (typeof OCR.findReadLine === 'function') {
      try {
        for (var fci = 0; fci < colorSets.length; fci++) {
          var flr = OCR.findReadLine(img, fonts[0], colorSets[fci], 0, 0, capH - 1);
          if (!flr) continue;
          var flText = (typeof flr === 'string') ? flr : (flr ? (flr.text || '') : '');
          if (flText.length < 2) continue;
          log('findReadLine c=' + fci + ': "' + flText + '"');
          var flName = extractNameFromOcrText(flText);
          if (flName) {
            log('ocr: name (findReadLine) — "' + flName + '"');
            setDetectedName(flName);
            updateStatus(queueData.length > 0 ? queueData : null);
            updateQueueList(queueData.length > 0 ? queueData : null);
            return true;
          }
        }
      } catch (efl) { log('findReadLine: ' + efl); }
    }

    var _nm2 = Date.now();
    if (_nm2 - _lastNoMatchLog > 20000) { _lastNoMatchLog = _nm2; log('ocr: no match (fonts=' + fonts.length + ')'); }
  } catch (e) {
    log('tryNameFromInputLine: ' + e);
  }
  return false;
}

/** Called once the chatbox pos is known. Starts the read loop and OCR name detection. */
function startChatReading() {
  log('startChatReading: launching loops');
  var _lastReadLog = 0;
  // Log full pos so we know what rect/line0y we have
  try { log('pos.mainbox: ' + JSON.stringify(chatReader.pos.mainbox)); } catch(e) {}

  // ── Chat read loop — keeps chatReader.font updated and scans the input line.
  setInterval(function () {
    try {
      var lines = chatReader.read();
      var now = Date.now();
      var fontNow = !!chatReader.font;

      if ((lines && lines.length > 0) || now - _lastReadLog > 10000) {
        log('read(): ' + (lines ? lines.length : 'null') + ' lines, font=' + fontNow);
        _lastReadLog = now;
      }

      // ── One-shot: log the raw structure of lines so we can see what read() returns
      if (!_linesLogged) {
        _linesLogged = true;
        log('_linesLogged fired: lines=' + (lines ? lines.length : 'null') + ' type=' + typeof lines);
        if (lines && lines.length > 0) {
          try { log('lines[0] JSON: ' + JSON.stringify(lines[0]).substring(0, 120)); } catch(e) { log('lines[0] JSON err'); }
          var l0raw = lines[0];
          log('lines[0] keys: ' + (l0raw && typeof l0raw === 'object' ? Object.keys(l0raw).join(',') : String(l0raw)));
          for (var ll = 0; ll < Math.min(lines.length, 3); ll++) {
            var lt = lines[ll] ? (lines[ll].text || String(lines[ll])) : '(null)';
            log('lines[' + ll + ']: "' + lt.substring(0, 80) + '"');
          }
        }
      }

      // ── Input-line scan — the mode indicator is always:
      //   "PlayerName◆: [Channel - Press Enter to Chat]"
      // Regular chat messages are "Name: message" — never have ": [" after the colon
      // unless someone literally types "[" as first character (extremely rare).
      if (fontNow && !detectedName && lines && lines.length > 0) {
        for (var lx = 0; lx < lines.length; lx++) {
          var lxt = lines[lx] ? (lines[lx].text || String(lines[lx])) : '';
          var lxai = lxt.indexOf(': [');
          if (lxai > 0) {
            var lxbefore = lxt.substring(0, lxai);
            // Strip leading timestamp "12:34:56 " if present, then grab trailing name
            var lxm = lxbefore.match(/([A-Za-z0-9][A-Za-z0-9 \-]*)$/);
            if (lxm && lxm[1].trim().length >= 2) {
              var lxName = lxm[1].trim();
              log('line-scan: name "' + lxName + '" via ": [" in lines[' + lx + ']');
              setDetectedName(lxName);
              updateStatus(queueData.length > 0 ? queueData : null);
              updateQueueList(queueData.length > 0 ? queueData : null);
              break;
            }
          }
        }
      }

      // Font just became available — trigger input-line OCR immediately
      if (fontNow && !_lastFontState && !detectedName) {
        log('font just set — triggering OCR now');
        setTimeout(function() {
          if (!detectedName) tryNameFromInputLine();
          if (!detectedName) tryNameFromLastBuffer();
        }, 100);
      }
      _lastFontState = fontNow;

      // After each successful read, try lastReadBuffer while it is fresh
      if (fontNow && !detectedName && lines && lines.length > 0) {
        setTimeout(tryNameFromLastBuffer, 50);
      }
    } catch (e) { log('read loop: ' + e); }
  }, 500);

  // ── Input-line OCR — first attempt immediately, then every 2 s
  log('ocr: first attempt...');
  tryNameFromInputLine();

  nameDetectTimer = setInterval(function () {
    if (detectedName) {
      clearInterval(nameDetectTimer);
      log('ocr: stopped (name="' + detectedName + '")');
      return;
    }
    if (!tryNameFromInputLine()) tryNameFromLastBuffer();
  }, 2000);
}

function initChatbox() {
  if (typeof alt1 === 'undefined')    { log('alt1 not defined — chatbox skipped');   return; }
  if (typeof Chatbox === 'undefined') { log('Chatbox lib not defined — skipped'); return; }
  try {
    chatReader = new Chatbox.default();
    log('chatReader created');

    var mc = (typeof A1lib !== 'undefined' && A1lib.mixColor) ? A1lib.mixColor
           : (typeof mixColor === 'function') ? mixColor
           : null;
    if (mc) {
      // readargs only expects { colors } — no extra fields
      chatReader.readargs = {
        colors: [
          mc(69,  131, 145),   // name teal
          mc(153, 255, 153),   // green
          mc(255, 255, 255),   // white
          mc(127, 169, 255),   // public blue
        ],
      };
      log('readargs set (' + chatReader.readargs.colors.length + ' colours)');
    } else {
      log('mixColor not found — using default readargs');
    }

    // Small delay so Alt1 finishes identifying the app before we touch the chatbox
    setTimeout(function () {
      var finder = setInterval(function () {
        try {
          if (!chatReader.pos) {
            chatReader.find();
            log('find() → pos=' + JSON.stringify(chatReader.pos));
          } else {
            log('chatbox found → mainbox=' + JSON.stringify(chatReader.pos.mainbox));
            clearInterval(finder);
            startChatReading();
          }
        } catch (e) { log('finder: ' + e); }
      }, 800);
    }, 50);

    // Re-find if chatbox ever loses position (e.g. user resizes RS)
    setInterval(function () {
      try { if (chatReader && !chatReader.pos) chatReader.find(); } catch (e) {}
    }, 2000);

  } catch (e) { log('initChatbox: ' + e); }
}

function setDetectedName(name) {
  // Normalise: replace underscore with space (RS convention)
  name = name.replace(/_/g, ' ');
  if (name === detectedName) return;
  detectedName = name;
  try { localStorage.setItem('vgt_playerName', name); } catch (e) {}
  updateNameDisplay(detectedName, true);
}

function updateNameDisplay(name, detected) {
  var el = document.getElementById('player-name');
  if (name) {
    el.textContent = name;
    el.classList.toggle('detected', !!detected);
  } else {
    el.textContent = 'Not detected';
    el.classList.remove('detected');
  }
}

// ── Google Sheets fetch ───────────────────────────────────────────

async function fetchQueue() {
  try {
    var resp = await fetch(sheetUrl('A2:A'), { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    queueData = parseCSV(text);
    return queueData;
  } catch (err) {
    console.warn('[VGT] Failed to fetch queue:', err);
    return null;
  }
}

// ── Status tab ────────────────────────────────────────────────────

function updateStatus(queue) {
  var alertCard  = document.getElementById('alert-card');
  var alertIcon  = document.getElementById('alert-icon');
  var alertTitle = document.getElementById('alert-title');
  var alertSub   = document.getElementById('alert-sub');
  var posEl      = document.getElementById('queue-position');

  // ── failed to load
  if (!queue) {
    setCard(alertCard, 'error');
    alertIcon.textContent  = '❌';
    alertTitle.textContent = 'Failed to load queue';
    alertSub.textContent   = 'Check your internet connection';
    posEl.textContent      = '—';
    return;
  }

  var name = getEffectiveName();

  // ── name not known yet
  if (!name) {
    setCard(alertCard, 'warning');
    alertIcon.textContent  = '👤';
    alertTitle.textContent = 'Name not detected';
    alertSub.textContent   = 'Type your RS name in the box above';
    posEl.textContent      = '—';
    return;
  }

  var nameLower = name.toLowerCase();
  var idx       = -1;

  for (var i = 0; i < queue.length; i++) {
    if (queue[i].toLowerCase() === nameLower) { idx = i; break; }
  }

  var rank = idx + 1; // 1-based

  // ── not in queue
  if (idx === -1) {
    setCard(alertCard, 'neutral');
    alertIcon.textContent  = '💤';
    alertTitle.textContent = 'Not in queue';
    alertSub.textContent   = 'You are not currently listed';
    posEl.textContent      = '—';
    wasInTopThree = false;
    wasFirst      = false;
    return;
  }

  posEl.textContent = '#' + rank;

  // ── #1 — it's your turn
  if (idx === 0) {
    setCard(alertCard, 'turn');
    alertIcon.textContent  = '🐉';
    alertTitle.textContent = "It's your turn!";
    alertSub.textContent   = 'Head to Vorkath now!';
    if (!wasFirst) playAlert('turn');
    wasFirst      = true;
    wasInTopThree = true;
    return;
  }

  // ── #2 or #3 — coming up soon
  if (idx <= 2) {
    setCard(alertCard, 'soon');
    alertIcon.textContent  = '⚠️';
    alertTitle.textContent = 'Get ready!';
    alertSub.textContent   = 'You are #' + rank + ' — up soon';
    if (!wasInTopThree) playAlert('soon');
    wasInTopThree = true;
    wasFirst      = false;
    return;
  }

  // ── in queue but not top 3
  setCard(alertCard, 'waiting');
  alertIcon.textContent  = '⏳';
  alertTitle.textContent = 'In queue';
  alertSub.textContent   = 'Position #' + rank + ' — wait for your turn';
  wasInTopThree = false;
  wasFirst      = false;
}

/** Swap the card's state class without disrupting the base class. */
function setCard(el, state) {
  el.className = 'vgt-alert-card ' + state;
}

// ── Queue tab ─────────────────────────────────────────────────────

function updateQueueList(queue) {
  var listEl = document.getElementById('queue-list');

  if (!queue) {
    listEl.innerHTML = '<div class="vgt-queue-state">Failed to load queue.</div>';
    return;
  }

  if (queue.length === 0) {
    listEl.innerHTML = '<div class="vgt-queue-state">The queue is empty.</div>';
    return;
  }

  var name      = getEffectiveName();
  var nameLower = name ? name.toLowerCase() : '';

  var html = '';
  for (var i = 0; i < queue.length; i++) {
    var n    = queue[i];
    var rank = i + 1;
    var isYou  = n.toLowerCase() === nameLower;
    var isFirst = rank === 1;
    var isTop3  = rank <= 3 && !isFirst;

    var cls = 'vgt-queue-item';
    if (isFirst) cls += ' first';
    if (isTop3)  cls += ' top3';
    if (isYou)   cls += ' is-you';

    var badge = '';
    if (rank === 1)      badge = '<span class="vgt-badge turn">NOW</span>';
    else if (rank <= 3)  badge = '<span class="vgt-badge soon">SOON</span>';

    var youTag = isYou ? '<span class="you-tag">YOU</span>' : '';

    html +=
      '<div class="' + cls + '">' +
        '<span class="vgt-queue-rank">#' + rank + '</span>' +
        '<span class="vgt-queue-name">' + escapeHtml(n) + youTag + '</span>' +
        badge +
      '</div>';
  }

  listEl.innerHTML = html;
}

// ── Audio alert ───────────────────────────────────────────────────

function playAlert(type) {
  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    var ctx  = new AudioCtx();
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    var t = ctx.currentTime;
    if (type === 'turn') {
      // Three ascending beeps — "go now!"
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.setValueAtTime(880, t + 0.12);
      osc.frequency.setValueAtTime(1100, t + 0.24);
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.55);
    } else {
      // Two softer beeps — "get ready"
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.setValueAtTime(880, t + 0.15);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
      osc.start(t);
      osc.stop(t + 0.40);
    }
  } catch (e) {
    // Web Audio not available — silently ignore
  }
}

// ── Dot / timestamp helpers ───────────────────────────────────────

function setDot(status) {
  var dot = document.getElementById('vgt-dot');
  dot.className = 'vgt-status-dot ' + status;
}

function updateTimestamp() {
  var now = new Date();
  document.getElementById('last-updated').textContent =
    'Updated ' + now.toLocaleTimeString();
}

// ── Main refresh ──────────────────────────────────────────────────

async function refresh() {
  setDot('loading');
  detectName();                       // re-check name on every refresh

  var queue = await fetchQueue();

  if (queue) {
    setDot('connected');
  } else {
    setDot('error');
  }

  updateStatus(queue);
  updateQueueList(queue);
  updateTimestamp();
}

// ── Initialise ────────────────────────────────────────────────────

function init() {
  log('=== VGT v2.5 init ===');   // version banner — confirms which file loaded

  // ── Load cached name immediately so the UI shows it before the first refresh
  try {
    var saved = localStorage.getItem('vgt_playerName');
    if (saved && saved.trim()) {
      detectedName = saved.trim();
      updateNameDisplay(detectedName, true);
      log('name from cache: "' + detectedName + '"');
    }
  } catch (e) {}

  // ── Tab switching
  document.querySelectorAll('.vgt-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.vgt-tab').forEach(function(t) {
        t.classList.remove('active');
      });
      document.querySelectorAll('.vgt-page').forEach(function(p) {
        p.classList.remove('active');
      });
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ── Manual name input refreshes status immediately
  document.getElementById('name-override').addEventListener('input', function() {
    var val = this.value.trim();
    if (val) {
      // Show what the user typed in the name display
      updateNameDisplay(val, true);
    } else {
      // Revert to detected name
      updateNameDisplay(detectedName || '', !!detectedName);
    }
    // Re-run status logic against current queue without a network fetch
    updateStatus(queueData.length > 0 ? queueData : null);
    updateQueueList(queueData.length > 0 ? queueData : null);
  });

  // ── Refresh buttons
  document.getElementById('refresh-btn').addEventListener('click', refresh);
  document.getElementById('refresh-btn-queue').addEventListener('click', refresh);

  // ── Debug clear button
  document.getElementById('debug-clear-btn').addEventListener('click', function() {
    var out = document.getElementById('debug-log');
    out.innerHTML = '<div class="vgt-debug-entry muted">Log cleared.</div>';
  });

  // ── Start chatbox reader (shows Alt1 capture overlay)
  initChatbox();

  // ── Initial load
  refresh();

  // ── Auto-refresh
  refreshTimer = setInterval(refresh, REFRESH_MS);
}

// ── Identify app to Alt1 immediately on script load (must run before chatbox)
if (typeof alt1 !== 'undefined') {
  try {
    alt1.identifyAppUrl('./appconfig.json');
    console.log('[VGT] identifyAppUrl called');
  } catch (e) {
    console.error('[VGT] identifyAppUrl error:', e);
  }
} else {
  console.log('[VGT] alt1 not present at top level');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
