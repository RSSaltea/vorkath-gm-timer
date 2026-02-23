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
 * Try to OCR the name from the chatbox input line.
 * The input line always shows "PlayerName◆: [Public Chat – Press Enter to Chat]"
 * which is the most reliable source since it requires no chat activity.
 *
 * Returns true if a name was successfully extracted.
 */
function tryNameFromInputLine() {
  if (!chatReader || !chatReader.pos) {
    log('ocr: chatReader.pos not set yet');
    return false;
  }
  if (!chatReader.font) {
    log('ocr: chatReader.font not set yet — waiting for first read()');
    return false;
  }
  if (typeof OCR === 'undefined' || !OCR.readLine) {
    log('ocr: OCR lib not available');
    return false;
  }
  if (typeof A1lib === 'undefined' || !A1lib.captureHold) {
    log('ocr: A1lib.captureHold not available');
    return false;
  }

  var mainbox = chatReader.pos.mainbox;
  var rect    = mainbox.rect;
  var lineOx  = mainbox.lineOx !== undefined ? mainbox.lineOx : 0;
  var lineOy  = mainbox.lineOy !== undefined ? mainbox.lineOy : 213;

  // Absolute screen coords of the input line
  var sx = rect.x + lineOx;
  var sy = rect.y + lineOy;

  log('ocr: input line screen pos sx=' + sx + ' sy=' + sy + ' w=' + rect.width);

  // Capture a 20-pixel-tall strip centred on the input line baseline.
  // We start 14px above sy so the text sits around y=10-14 inside the buffer.
  var capX = sx;
  var capY = sy - 14;
  var capW = rect.width || 368;
  var capH = 20;

  try {
    var img = A1lib.captureHold(capX, capY, capW, capH);
    if (!img) { log('ocr: captureHold returned null'); return false; }

    var mc = (A1lib.mixColor) ? A1lib.mixColor
           : (typeof mixColor === 'function') ? mixColor
           : null;
    if (!mc) { log('ocr: mixColor not available'); return false; }

    // Colours to try — RS input line name is typically white/yellow/blue
    var colorSets = [
      [mc(255, 255, 255)],   // white
      [mc(255, 255, 0)],     // yellow
      [mc(255, 200, 0)],     // gold
      [mc(127, 169, 255)],   // public chat blue
      [mc(69,  131, 145)],   // name teal (readargs)
      [mc(153, 255, 153)],   // green
    ];

    // Try several y-baselines within the captured strip
    var yOffsets = [6, 8, 10, 12, 14];

    for (var yi = 0; yi < yOffsets.length; yi++) {
      for (var ci = 0; ci < colorSets.length; ci++) {
        var res = OCR.readLine(img, chatReader.font, colorSets[ci], 0, yOffsets[yi], true, false);
        if (!res) continue;
        var text = (typeof res === 'string') ? res : (res.text || '');
        if (!text || text.length < 2) continue;

        log('ocr y=' + yOffsets[yi] + ' c=' + ci + ': "' + text + '"');

        // The input line starts with "PlayerName" followed by a non-name character
        // (◆ U+25C6, ♦ U+2666, a colon, or a space).  We extract up to 12 chars.
        var m = text.match(/^([A-Za-z0-9][A-Za-z0-9 \-]{1,11})(?:[^A-Za-z0-9 \-]|$)/);
        if (m) {
          var name = m[1].trim();
          if (name.length >= 2) {
            log('ocr: name from input line — "' + name + '"');
            setDetectedName(name);
            updateStatus(queueData.length > 0 ? queueData : null);
            updateQueueList(queueData.length > 0 ? queueData : null);
            return true;
          }
        }
      }
    }
    log('ocr: no name matched in input line');
  } catch (e) {
    log('tryNameFromInputLine error: ' + e);
  }
  return false;
}

/** Called once the chatbox pos is known. Starts the read loop and OCR name detection. */
function startChatReading() {
  log('startChatReading: launching read + name-detect loops');

  // ── Chat read loop — populates chatReader.font and provides a chat-history fallback
  setInterval(function () {
    try {
      var lines = chatReader.read();

      // Chat-history fallback: look for the player's own public chat messages
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
          log('chat-history fallback: "' + best + '" (' + bestCount + 'x)');
          setDetectedName(best);
          updateStatus(queueData.length > 0 ? queueData : null);
          updateQueueList(queueData.length > 0 ? queueData : null);
        }
      }
    } catch (e) { log('read loop: ' + e); }
  }, 500);

  // ── Input-line OCR loop — try every 2 s until a name is found
  // Give the read loop one full second first so chatReader.font gets populated.
  setTimeout(function () {
    if (detectedName) return;
    log('ocr: first attempt...');
    tryNameFromInputLine();
  }, 1000);

  nameDetectTimer = setInterval(function () {
    if (detectedName) {
      clearInterval(nameDetectTimer);
      log('ocr: name confirmed "' + detectedName + '" — stopping detect loop');
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
      chatReader.readargs = {
        colors: [
          mc(69,  131, 145),   // name teal
          mc(153, 255, 153),   // green
          mc(255, 255, 255),   // white
          mc(127, 169, 255),   // public blue
        ],
        backwards: true,
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
