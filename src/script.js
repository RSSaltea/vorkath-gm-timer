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
    while (out.childElementCount > 80) out.removeChild(out.lastChild);
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
 * Tries several property names since UMD export shape varies by version.
 */
function getChatFonts() {
  var fonts = [];
  if (chatReader && chatReader.font) fonts.push(chatReader.font);

  if (typeof Chatbox !== 'undefined') {
    var arr = Chatbox.fonts || Chatbox.chatfonts
            || (Chatbox.default && (Chatbox.default.fonts || Chatbox.default.chatfonts));
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].def) fonts.push(arr[i].def);
      }
      log('getChatFonts: ' + arr.length + ' bundled fonts');
    } else {
      // Log actual export keys to help diagnose
      log('getChatFonts: Chatbox.fonts undef — Chatbox keys=' + Object.keys(Chatbox).join(','));
    }
  }
  return fonts;
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

  // Capture the bottom 18 px of the chatbox rect — this is always the input line.
  var capX = rect.x;
  var capY = rect.y + rect.height - 18;
  var capW = rect.width || 368;
  var capH = 18;

  try {
    // Use alt1.captureHold directly (A1lib is a wrapper but may behave differently)
    var imgRef = (typeof alt1 !== 'undefined' && alt1.captureHold)
               ? alt1.captureHold(capX, capY, capW, capH)
               : A1lib.captureHold(capX, capY, capW, capH);
    if (!imgRef) { log('ocr: captureHold null'); return false; }

    var img = imgRef.toData ? imgRef.toData() : imgRef;
    if (!img || !img.data) { log('ocr: no img.data'); return false; }

    log('ocr: img ' + img.width + 'x' + img.height + ' at (' + capX + ',' + capY + ')');

    // ── Pixel scan: find the brightest pixel to verify we got real screen data ──
    var pSum = 0, pR = 0, pG = 0, pB = 0, pY = 0, pX = 0;
    for (var py = 0; py < img.height; py++) {
      for (var px = 0; px < Math.min(img.width, 200); px++) {
        var i4 = (py * img.width + px) * 4;
        var s  = img.data[i4] + img.data[i4 + 1] + img.data[i4 + 2];
        if (s > pSum) { pSum = s; pR = img.data[i4]; pG = img.data[i4+1]; pB = img.data[i4+2]; pY = py; pX = px; }
      }
    }
    log('ocr: brightest px=(' + pX + ',' + pY + ') rgb(' + pR + ',' + pG + ',' + pB + ') sum=' + pSum);
    if (pSum < 90) { log('ocr: capture is black — coordinate mismatch?'); return false; }

    var mc = A1lib.mixColor || (typeof mixColor === 'function' ? mixColor : null);
    if (!mc) { log('ocr: no mixColor'); return false; }

    // Colours to try — white for "◆: [Public Chat..." plus other RS chat colours
    var colorSets = [
      [mc(255, 255, 255)],           // white  (most likely for input line)
      [mc(255, 255, 0)],             // yellow
      [mc(255, 200, 0)],             // gold
      [mc(127, 169, 255)],           // public chat blue
      [mc(69,  131, 145)],           // name teal
      [mc(153, 255, 153)],           // green
      [mc(pR, pG, pB)],              // dynamically discovered brightest colour
    ];

    // ── OCR every y-baseline across the full captured strip ───────────────────
    for (var fi = 0; fi < fonts.length; fi++) {
      for (var yo = 1; yo < capH - 1; yo++) {
        for (var ci = 0; ci < colorSets.length; ci++) {
          try {
            var res  = OCR.readLine(img, fonts[fi], colorSets[ci], 0, yo, true, false);
            if (!res) continue;
            var text = (typeof res === 'string') ? res : (res.text || '');
            if (text.length < 2) continue;

            log('f=' + fi + ' y=' + yo + ' c=' + ci + ': "' + text + '"');

            // ── Strategy B: anchor "◆:" or ": [" — user's suggestion ──────────
            // Input line is "Name◆: [Public Chat - Press Enter to Chat]"
            // Finding ": [" or "◆:" tells us exactly where the name ends.
            var anchorIdx = text.indexOf(': [');
            if (anchorIdx < 0) anchorIdx = text.indexOf(':[');
            if (anchorIdx < 0) anchorIdx = text.indexOf('\u25c6');   // ◆ U+25C6
            if (anchorIdx > 0) {
              var before = text.substring(0, anchorIdx).trim();
              var mB = before.match(/([A-Za-z0-9][A-Za-z0-9 \-]*)$/);
              if (mB && mB[1].trim().length >= 2) {
                log('ocr: name (anchor) — "' + mB[1].trim() + '"');
                setDetectedName(mB[1].trim());
                updateStatus(queueData.length > 0 ? queueData : null);
                updateQueueList(queueData.length > 0 ? queueData : null);
                return true;
              }
            }

            // ── Strategy A: prefix — name is at the very start of the line ────
            var mA = text.match(/^([A-Za-z0-9][A-Za-z0-9 \-]{1,11})(?:[^A-Za-z0-9 \-]|$)/);
            if (mA && mA[1].trim().length >= 2) {
              log('ocr: name (prefix) — "' + mA[1].trim() + '"');
              setDetectedName(mA[1].trim());
              updateStatus(queueData.length > 0 ? queueData : null);
              updateQueueList(queueData.length > 0 ? queueData : null);
              return true;
            }
          } catch (e2) { /* skip bad combo */ }
        }
      }
    }
    log('ocr: no match (fonts=' + fonts.length + ')');
  } catch (e) {
    log('tryNameFromInputLine: ' + e);
  }
  return false;
}

/** Called once the chatbox pos is known. Starts the read loop and OCR name detection. */
function startChatReading() {
  log('startChatReading: launching loops');
  var _lastReadLog = 0;

  // ── Chat read loop — chat-history fallback for name + keeps chatReader.font updated
  setInterval(function () {
    try {
      var lines = chatReader.read();
      // Log read() status only when lines arrive or every 10 s (not every 500 ms)
      var now = Date.now();
      if ((lines && lines.length > 0) || now - _lastReadLog > 10000) {
        log('read(): ' + (lines ? lines.length : 'null') + ' lines, font=' + !!chatReader.font);
        _lastReadLog = now;
      }

      if (!detectedName && lines && lines.length > 0) {
        var reName = /^\[\d{1,2}:\d{2}:\d{2}\] (?!\[)(?!\*)([A-Za-z0-9][A-Za-z0-9 \-]{0,11}):\s/;
        var counts = {};
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i] || !lines[i].text) continue;
          var m = lines[i].text.match(reName);
          if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
        }
        var best = null, bestCount = 0;
        for (var n in counts) {
          if (counts[n] > bestCount) { bestCount = counts[n]; best = n; }
        }
        if (best) {
          log('chat fallback: "' + best + '" (' + bestCount + 'x)');
          setDetectedName(best);
          updateStatus(queueData.length > 0 ? queueData : null);
          updateQueueList(queueData.length > 0 ? queueData : null);
        }
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
    tryNameFromInputLine();
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
