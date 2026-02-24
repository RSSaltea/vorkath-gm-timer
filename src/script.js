/* ================================================================
   Vorkath GM Timer — script.js
   ================================================================
   Fetches the Vorkath GM carry queue from Google Sheets and alerts
   the player when they are in the top 3 or it is their turn.
   ================================================================ */

'use strict';

// ── Config ────────────────────────────────────────────────────────
const SHEET_ID    = '164faXDaQzmPjvTX02SeK-UTjXe2Vq6GjA-EZOPF7UFQ';
const SHEET_NAME  = 'List';
const REFRESH_MS  = 10_000;   // auto-refresh interval (10 s)

const GAS_URL = 'https://script.google.com/macros/s/' +
                'AKfycbzPxwizWq7ewt0UBWlRSNbHlSbjjV5kQBXjIGghvCdMYSpCke3ZpT-R5oj-KWghfwrb' +
                '/exec';

const HEARTBEAT_MS         = 30_000;  // send heartbeat every 30 s
const ONLINE_THRESHOLD_MS  = 60_000;  // online if heartbeat < 60 s old

// ── State ─────────────────────────────────────────────────────────
let queueData       = [];   // current full queue (array of strings)
let wasFirst        = false;
let wasInTopThree   = false;
let refreshTimer    = null;
let submissionsOpen = true; // controlled by Responses!G947
let heartbeatTimer  = null;
let heartbeatData   = {};    // { lowercaseName: isoTimestamp }

// ── Helpers ───────────────────────────────────────────────────────

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

function parseCSV(text) {
  return text
    .split('\n')
    .map(function(row) { return row.replace(/^"|"$/g, '').trim(); })
    .filter(function(row) { return row.length > 0; });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/** Return the player name typed into the input field. */
function getEffectiveName() {
  return document.getElementById('name-override').value.trim();
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

  var joinBtn = document.getElementById('join-queue-btn');

  // ── failed to load
  if (!queue) {
    setCard(alertCard, 'error');
    alertIcon.textContent  = '❌';
    alertTitle.textContent = 'Failed to load queue';
    alertSub.textContent   = 'Check your internet connection';
    posEl.textContent      = '—';
    joinBtn.style.display  = 'none';
    return;
  }

  var name = getEffectiveName();

  // ── name not set
  if (!name) {
    setCard(alertCard, 'warning');
    alertIcon.textContent  = '👤';
    alertTitle.textContent = 'No name set';
    alertSub.textContent   = 'Enter your RS name in the box above';
    posEl.textContent      = '—';
    joinBtn.style.display  = 'none';
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
    joinBtn.style.display  = 'block';
    if (submissionsOpen) {
      joinBtn.disabled     = false;
      joinBtn.textContent  = '+ Join Queue';
      joinBtn.classList.remove('closed');
    } else {
      joinBtn.disabled     = true;
      joinBtn.textContent  = 'Submissions closed';
      joinBtn.classList.add('closed');
    }
    wasInTopThree = false;
    wasFirst      = false;
    return;
  }

  joinBtn.style.display = 'none';

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

    var online   = isOnline(n);
    var dotClass = online ? 'vgt-presence online' : 'vgt-presence offline';
    var dotTitle = online ? 'Online — plugin active' : 'Offline — plugin not detected';

    html +=
      '<div class="' + cls + '">' +
        '<span class="vgt-queue-rank">#' + rank + '</span>' +
        '<span class="' + dotClass + '" title="' + dotTitle + '"></span>' +
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

async function fetchSubmissionsOpen() {
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:csv&sheet=Responses&range=G2';
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    submissionsOpen = text.replace(/"/g, '').trim().toUpperCase() === 'TRUE';
  } catch (err) {
    console.warn('[VGT] Failed to fetch submissions status:', err);
    submissionsOpen = true; // default open on error
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────

async function sendHeartbeat() {
  var name = getEffectiveName();
  if (!name) return;
  try {
    await fetch(
      GAS_URL + '?action=heartbeat&name=' + encodeURIComponent(name),
      { cache: 'no-store' }
    );
  } catch (err) {
    console.warn('[VGT] Heartbeat send failed:', err);
  }
}

async function fetchHeartbeats() {
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:csv&sheet=Heartbeats&range=A2:B';
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    var rows = text.split('\n');
    heartbeatData = {};
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].trim()) continue;
      // Split on first comma only — timestamp may contain commas if Sheets auto-formats
      var idx = rows[i].indexOf(',');
      if (idx === -1) continue;
      var n  = rows[i].substring(0, idx).replace(/^"|"$/g, '').trim().toLowerCase();
      var ts = rows[i].substring(idx + 1).replace(/^"|"$/g, '').trim();
      if (n) heartbeatData[n] = ts;
    }
  } catch (err) {
    console.warn('[VGT] Heartbeat fetch failed:', err);
  }
}

function isOnline(name) {
  var key  = name.toLowerCase();
  var ts   = heartbeatData[key];
  if (!ts) return false;
  var then = new Date(ts).getTime();
  if (isNaN(then)) return false;
  return (Date.now() - then) < ONLINE_THRESHOLD_MS;
}

async function refresh() {
  setDot('loading');

  var results = await Promise.all([fetchQueue(), fetchSubmissionsOpen(), fetchHeartbeats()]);
  var queue   = results[0];

  if (queue) {
    setDot('connected');
  } else {
    setDot('error');
  }

  updateStatus(queue);
  updateQueueList(queue);
  updateTimestamp();
}

// ── Join Queue ────────────────────────────────────────────────────

async function joinQueue() {
  var name = getEffectiveName();
  if (!name) return;

  var btn = document.getElementById('join-queue-btn');
  btn.disabled    = true;
  btn.textContent = 'Submitting...';

  try {
    var resp = await fetch(GAS_URL + '?name=' + encodeURIComponent(name));
    var data = await resp.json();
    btn.textContent = data.ok ? '✓ Joined queue!' : '✗ Failed — try again';
  } catch (e) {
    console.warn('[VGT] Join queue error:', e);
    btn.textContent = '✗ Error — try again';
  }

  btn.classList.add('submitted');
  setTimeout(function() {
    btn.textContent = '+ Join Queue';
    btn.disabled    = false;
    btn.classList.remove('submitted');
    refresh();
  }, 4000);
}

// ── Initialise ────────────────────────────────────────────────────

function init() {
  // Load saved name into the input field
  try {
    var saved = localStorage.getItem('vgt_playerName');
    if (saved && saved.trim()) {
      document.getElementById('name-override').value = saved.trim();
    }
  } catch (e) {}

  // ── Reminder toggle
  var reminderToggle = document.getElementById('reminder-toggle');
  var savedReminder = localStorage.getItem('vgt_remindersEnabled');
  if (savedReminder !== null) {
    reminderToggle.checked = savedReminder === 'true';
  }
  window.VGT_remindersEnabled = reminderToggle.checked;
  reminderToggle.addEventListener('change', function() {
    window.VGT_remindersEnabled = this.checked;
    localStorage.setItem('vgt_remindersEnabled', this.checked);
  });

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

  // ── Name input: update display immediately; refresh queue 1s after typing stops
  var nameDebounce = null;
  var heartbeatDebounce = null;
  document.getElementById('name-override').addEventListener('input', function() {
    try { localStorage.setItem('vgt_playerName', this.value.trim()); } catch (e) {}
    updateStatus(queueData);
    updateQueueList(queueData);
    clearTimeout(nameDebounce);
    nameDebounce = setTimeout(refresh, 1000);
    // Debounce heartbeat — wait 5 s after last keystroke before sending
    clearTimeout(heartbeatDebounce);
    heartbeatDebounce = setTimeout(sendHeartbeat, 5000);
  });

  // ── Join Queue button
  document.getElementById('join-queue-btn').addEventListener('click', joinQueue);

  // ── Refresh buttons
  document.getElementById('refresh-btn').addEventListener('click', refresh);
  document.getElementById('refresh-btn-queue').addEventListener('click', refresh);

  // ── Initial load
  refresh();

  // ── Auto-refresh
  refreshTimer = setInterval(refresh, REFRESH_MS);

  // ── Heartbeat — announce presence every 30 s
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
}

// ── Identify app to Alt1 on script load ───────────────────────────
if (typeof alt1 !== 'undefined') {
  try {
    alt1.identifyAppUrl('./appconfig.json');
  } catch (e) {
    console.error('[VGT] identifyAppUrl error:', e);
  }
} else {
  // Running in a regular browser — show the install banner
  var banner = document.getElementById('alt1-banner');
  if (banner) banner.style.display = 'flex';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
