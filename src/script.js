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
const REFRESH_MS  = 5_000;    // auto-refresh interval (5 s)

const GAS_URL = 'https://script.google.com/macros/s/' +
                'AKfycbxSYj9hystM_Kxpn4tAx6NSFFWa2mL26iA9oISfq-8AC-jSIq3sCD1msVMisimn8_9Yvg' +
                '/exec';

const HEARTBEAT_MS         = 15_000;  // send heartbeat every 15 s
const ONLINE_THRESHOLD_MS  = 20_000;  // online if heartbeat < 20 s old

// ── State ─────────────────────────────────────────────────────────
let queueData       = [];   // current full queue (array of strings)
let wasFirst        = false;
let wasInTopThree   = false;
let refreshTimer    = null;
let submissionsOpen = true; // controlled by Responses!G947
let heartbeatTimer  = null;
let heartbeatData   = {};    // { lowercaseName: isoTimestamp }
let currentWorld    = '';     // world number from Responses!F2
let calibrated      = false;
let configSeed      = null;
let lastPingCheck   = new Date().toISOString();
let completedData   = [];     // names marked "done" in Responses!C

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
    if (!submissionsOpen) {
      joinBtn.style.display = 'block';
      joinBtn.disabled      = true;
      joinBtn.textContent   = 'Submissions closed';
      joinBtn.classList.add('closed');
    } else {
      joinBtn.style.display = 'none';
    }
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
    alertSub.innerHTML     = (currentWorld
      ? 'Head to Vorkath on World: ' + currentWorld + ' now!'
      : 'Head to Vorkath now!')
      + '<br>Please be at the statue ready to fight Vorkath';
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
    alertSub.innerHTML     = (currentWorld
      ? 'You are #' + rank + ' — head to World: ' + currentWorld + ' now'
      : 'You are #' + rank + ' — up soon')
      + '<br>Please be at the statue ready to fight Vorkath';
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

function updateToggleOpenBtn() {
  var btn = document.getElementById('toggle-open-btn');
  if (!btn) return;
  if (calibrated) {
    btn.style.display = '';
    if (submissionsOpen) {
      btn.textContent = 'Open';
      btn.classList.add('open');
    } else {
      btn.textContent = 'Closed';
      btn.classList.remove('open');
    }
  } else {
    btn.style.display = 'none';
  }
}

function updateQueueList(queue) {
  updateToggleOpenBtn();
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

    var adminBtns = '';
    var dragHandle = '';
    var nameClass = 'vgt-queue-name';
    if (calibrated) {
      adminBtns =
        '<span class="vgt-admin-actions">' +
          '<button class="vgt-admin-action done" data-action="adminDone" data-name="' + escapeHtml(n) + '" title="Mark Done">\u2713</button>' +
          '<button class="vgt-admin-action skip" data-action="adminSkip" data-name="' + escapeHtml(n) + '" title="Mark Skip">\u2717</button>' +
          '<button class="vgt-admin-action ping" data-action="ping" data-name="' + escapeHtml(n) + '" title="Ping Player">\u266A</button>' +
        '</span>';
      dragHandle = '<span class="vgt-drag-handle" title="Drag to reorder">\u2261</span>';
      nameClass += ' editable';
    }

    html +=
      '<div class="' + cls + '"' + (calibrated ? ' draggable="true" data-index="' + i + '"' : '') + '>' +
        dragHandle +
        '<span class="vgt-queue-rank">#' + rank + '</span>' +
        '<span class="' + dotClass + '" title="' + dotTitle + '"></span>' +
        '<span class="' + nameClass + '" data-original="' + escapeHtml(n) + '">' + escapeHtml(n) + youTag + '</span>' +
        badge +
        adminBtns +
      '</div>';
  }

  listEl.innerHTML = html;
}

// ── Completed panel ──────────────────────────────────────────────

function updateCompletedPanel() {
  var toggleBtn = document.getElementById('completed-toggle');
  var listEl    = document.getElementById('completed-list');
  if (!toggleBtn || !listEl) return;

  var arrow = toggleBtn.textContent.slice(-1);
  toggleBtn.textContent = calibrated
    ? 'Completed (' + completedData.length + ') ' + arrow
    : 'Completed ' + arrow;

  var search = (document.getElementById('completed-search') || {}).value || '';
  renderCompletedList(search);
}

function renderCompletedList(filter) {
  var listEl = document.getElementById('completed-list');
  if (!listEl) return;
  var filtered = completedData;
  if (filter) {
    var f = filter.toLowerCase();
    filtered = completedData.filter(function(n) {
      return n.toLowerCase().indexOf(f) !== -1;
    });
  }
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="vgt-completed-item" style="color:var(--text-muted);">No results</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    html += '<div class="vgt-completed-item">' + escapeHtml(filtered[i]) + '</div>';
  }
  listEl.innerHTML = html;
}

function showCompletedSuggestions(value) {
  var el = document.getElementById('completed-suggestions');
  if (!el) return;
  if (!value) { el.style.display = 'none'; return; }
  var v = value.toLowerCase();
  var matches = completedData.filter(function(n) {
    return n.toLowerCase().indexOf(v) !== -1;
  });
  if (matches.length === 0 || (matches.length === 1 && matches[0].toLowerCase() === v)) {
    el.style.display = 'none';
    return;
  }
  var html = '';
  for (var i = 0; i < Math.min(matches.length, 8); i++) {
    html += '<div class="vgt-completed-suggestion" data-name="' + escapeHtml(matches[i]) + '">' + escapeHtml(matches[i]) + '</div>';
  }
  el.innerHTML = html;
  el.style.display = 'block';
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

async function fetchWorld() {
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:csv&sheet=Responses&range=F2';
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    currentWorld = text.replace(/"/g, '').trim();
    var el = document.getElementById('vgt-world');
    if (el) el.textContent = currentWorld ? 'World: ' + currentWorld : '';
  } catch (err) {
    console.warn('[VGT] Failed to fetch world:', err);
  }
}

// ── Stats (Total / Today) ────────────────────────────────────────

async function fetchStats() {
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:csv&sheet=Responses&range=D2:E2';
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    var parts = text.replace(/"/g, '').split(',');
    var today = (parts[0] || '').trim();
    var total = (parts[1] || '').trim();
    var elTotal = document.getElementById('info-total');
    var elToday = document.getElementById('info-today');
    if (elTotal) elTotal.textContent = 'Total: ' + (total || '—');
    if (elToday) elToday.textContent = 'Today: ' + (today || '—');
  } catch (err) {
    console.warn('[VGT] Failed to fetch stats:', err);
  }
}

// ── Completed list ───────────────────────────────────────────────

async function fetchCompleted() {
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              "/gviz/tq?tqx=out:csv&sheet=Responses&tq=" +
              encodeURIComponent("SELECT B WHERE C='done'");
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    var lines = text.split('\n');
    var names = [];
    for (var i = 0; i < lines.length; i++) {
      var name = lines[i].replace(/^"|"$/g, '').trim();
      if (name && name.toLowerCase() !== 'your runescape name?') names.push(name);
    }
    completedData = names;
    updateCompletedPanel();
  } catch (err) {
    console.warn('[VGT] Failed to fetch completed:', err);
  }
}

// ── Config seed ──────────────────────────────────────────────────

async function fetchConfigSeed() {
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:csv&sheet=Responses&range=H1';
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    configSeed = text.replace(/^"|"$/g, '').trim();
  } catch (err) {
    console.warn('[VGT] Failed to fetch config seed:', err);
    configSeed = null;
  }
}

// ── Pings ─────────────────────────────────────────────────────────

async function fetchPings() {
  var name = getEffectiveName();
  if (!name) return;

  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:csv&sheet=Pings&range=A2:B';
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var text = await resp.text();
    var rows = text.split('\n');
    var nameLower = name.toLowerCase();

    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].trim()) continue;
      var idx = rows[i].indexOf(',');
      if (idx === -1) continue;
      var pingName = rows[i].substring(0, idx).replace(/^"|"$/g, '').trim().toLowerCase();
      var pingTime = rows[i].substring(idx + 1).replace(/^"|"$/g, '').trim();
      if (pingName === nameLower) {
        var pingDate = new Date(pingTime).getTime();
        var lastCheck = new Date(lastPingCheck).getTime();
        if (!isNaN(pingDate) && pingDate > lastCheck) {
          playAlert('turn');
          console.log('[VGT] Ping received! Timestamp:', pingTime);
        }
        break;
      }
    }

    lastPingCheck = new Date().toISOString();
  } catch (err) {
    console.warn('[VGT] Ping fetch failed:', err);
  }
}

// ── Queue actions ─────────────────────────────────────────────────

async function runAction(action, name, btnEl) {
  if (!calibrated) return;
  btnEl.disabled = true;

  try {
    var resp = await fetch(
      GAS_URL + '?action=' + action + '&name=' + encodeURIComponent(name),
      { cache: 'no-store' }
    );
    var data = await resp.json();
    if (data.ok) {
      btnEl.textContent = '\u2713';
      setTimeout(refresh, 1500);
    } else {
      btnEl.textContent = '!';
      btnEl.disabled = false;
    }
  } catch (err) {
    console.warn('[VGT] Action failed:', err);
    btnEl.textContent = '!';
    btnEl.disabled = false;
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

  var results = await Promise.all([fetchQueue(), fetchSubmissionsOpen(), fetchHeartbeats(), fetchWorld(), fetchPings(), fetchStats()]);
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

  // ── Completed list — refresh every 60 s
  fetchCompleted();
  setInterval(fetchCompleted, 60_000);

  // ── Heartbeat — announce presence every 15 s
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

  // ── Calibration mode ───────────────────────────────────────────
  fetchConfigSeed();

  var adminBtn       = document.getElementById('admin-btn');
  var adminOverlay   = document.getElementById('admin-overlay');
  var adminPassInput = document.getElementById('admin-pass-input');
  var adminLoginBtn  = document.getElementById('admin-login-btn');
  var adminCancelBtn = document.getElementById('admin-cancel-btn');
  var adminError     = document.getElementById('admin-error');

  adminBtn.addEventListener('click', function() {
    if (calibrated) {
      calibrated = false;
      adminBtn.textContent = 'Admin';
      adminBtn.classList.remove('active');
      updateQueueList(queueData);
      return;
    }
    adminOverlay.style.display = 'flex';
    adminPassInput.value = '';
    adminError.style.display = 'none';
    adminPassInput.focus();
  });

  adminCancelBtn.addEventListener('click', function() {
    adminOverlay.style.display = 'none';
  });

  function attemptCalibration() {
    var entered = adminPassInput.value.trim();
    if (!configSeed) {
      adminError.textContent = 'Could not verify — retry';
      adminError.style.display = 'block';
      fetchConfigSeed();
      return;
    }
    if (entered === configSeed) {
      calibrated = true;
      adminOverlay.style.display = 'none';
      adminBtn.textContent = 'Admin \u2713';
      adminBtn.classList.add('active');
      updateToggleOpenBtn();
      updateQueueList(queueData);
    } else {
      adminError.textContent = 'Invalid key';
      adminError.style.display = 'block';
      adminPassInput.value = '';
      adminPassInput.focus();
    }
  }

  adminLoginBtn.addEventListener('click', attemptCalibration);

  adminPassInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') attemptCalibration();
    if (e.key === 'Escape') adminOverlay.style.display = 'none';
  });

  // ── Queue action delegation (single listener) ──────────────────
  var queueListEl = document.getElementById('queue-list');

  queueListEl.addEventListener('click', function(e) {
    if (!calibrated) return;

    // Admin action buttons
    var btn = e.target.closest('.vgt-admin-action');
    if (btn && !btn.disabled) {
      var action = btn.getAttribute('data-action');
      var name   = btn.getAttribute('data-name');
      if (action && name) runAction(action, name, btn);
      return;
    }

    // Inline name editing
    var nameEl = e.target.closest('.vgt-queue-name.editable');
    if (nameEl && !nameEl.classList.contains('editing')) {
      var original = nameEl.getAttribute('data-original');
      nameEl.classList.add('editing');
      nameEl.innerHTML = '<input class="vgt-queue-name-input" type="text" value="' + escapeHtml(original) + '" autocomplete="off" autocorrect="off" data-lpignore="true" data-form-type="other" />';
      var input = nameEl.querySelector('input');
      input.focus();
      input.select();

      function saveEdit() {
        var newName = input.value.trim();
        if (newName && newName !== original) {
          nameEl.innerHTML = escapeHtml(newName);
          nameEl.classList.remove('editing');
          fetch(GAS_URL + '?action=editName&oldName=' + encodeURIComponent(original) + '&newName=' + encodeURIComponent(newName), { cache: 'no-store' })
            .then(function() { setTimeout(refresh, 1500); })
            .catch(function(err) { console.warn('[VGT] Edit failed:', err); });
        } else {
          nameEl.innerHTML = escapeHtml(original);
          nameEl.classList.remove('editing');
        }
      }

      input.addEventListener('blur', saveEdit);
      input.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') {
          input.removeEventListener('blur', saveEdit);
          nameEl.innerHTML = escapeHtml(original);
          nameEl.classList.remove('editing');
        }
      });
    }
  });

  // ── Drag-and-drop reorder ──────────────────────────────────────
  var dragSourceIndex = null;

  queueListEl.addEventListener('dragstart', function(e) {
    if (!calibrated) return;
    var item = e.target.closest('.vgt-queue-item');
    if (!item) return;
    // Only allow drag from the handle
    if (!e.target.closest('.vgt-drag-handle')) { e.preventDefault(); return; }
    dragSourceIndex = parseInt(item.getAttribute('data-index'), 10);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSourceIndex);
  });

  queueListEl.addEventListener('dragover', function(e) {
    if (!calibrated || dragSourceIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var item = e.target.closest('.vgt-queue-item');
    if (!item) return;
    // Clear all drag-over classes
    var items = queueListEl.querySelectorAll('.vgt-queue-item');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('drag-over');
    item.classList.add('drag-over');
  });

  queueListEl.addEventListener('dragleave', function(e) {
    var item = e.target.closest('.vgt-queue-item');
    if (item) item.classList.remove('drag-over');
  });

  queueListEl.addEventListener('drop', function(e) {
    if (!calibrated || dragSourceIndex === null) return;
    e.preventDefault();
    var item = e.target.closest('.vgt-queue-item');
    if (!item) return;
    var targetIndex = parseInt(item.getAttribute('data-index'), 10);

    // Clean up classes
    var items = queueListEl.querySelectorAll('.vgt-queue-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('dragging', 'drag-over');
    }

    if (targetIndex === dragSourceIndex || isNaN(targetIndex)) {
      dragSourceIndex = null;
      return;
    }

    var movedName = queueData[dragSourceIndex];

    // Optimistically reorder
    queueData.splice(dragSourceIndex, 1);
    queueData.splice(targetIndex, 0, movedName);
    updateQueueList(queueData);

    // Send to GAS
    fetch(GAS_URL + '?action=moveQueue&name=' + encodeURIComponent(movedName) + '&toIndex=' + targetIndex, { cache: 'no-store' })
      .then(function() { setTimeout(refresh, 2000); })
      .catch(function(err) { console.warn('[VGT] Move failed:', err); });

    dragSourceIndex = null;
  });

  queueListEl.addEventListener('dragend', function() {
    dragSourceIndex = null;
    var items = queueListEl.querySelectorAll('.vgt-queue-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('dragging', 'drag-over');
    }
  });

  // ── Toggle open/closed button ─────────────────────────────────
  document.getElementById('toggle-open-btn').addEventListener('click', async function() {
    if (!calibrated) return;
    var btn = this;
    var newValue = !submissionsOpen;
    btn.disabled = true;
    try {
      await fetch(GAS_URL + '?action=toggleOpen&value=' + newValue, { mode: 'no-cors' });
      submissionsOpen = newValue;
      updateToggleOpenBtn();
    } catch (err) {
      console.warn('[VGT] Failed to toggle open:', err);
    }
    btn.disabled = false;
  });

  // ── Completed panel toggle + search ─────────────────────────────
  document.getElementById('completed-toggle').addEventListener('click', function() {
    var body = document.getElementById('completed-body');
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    var arrow = open ? '\u25B8' : '\u25BE';
    this.textContent = calibrated
      ? 'Completed (' + completedData.length + ') ' + arrow
      : 'Completed ' + arrow;
  });

  document.getElementById('completed-search').addEventListener('input', function() {
    var val = this.value.trim();
    renderCompletedList(val);
    showCompletedSuggestions(val);
  });

  document.getElementById('completed-suggestions').addEventListener('click', function(e) {
    var item = e.target.closest('.vgt-completed-suggestion');
    if (!item) return;
    var name = item.getAttribute('data-name');
    var input = document.getElementById('completed-search');
    input.value = name;
    renderCompletedList(name);
    this.style.display = 'none';
  });
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
  document.body.classList.add('browser-view');
  var banner = document.getElementById('alt1-banner');
  if (banner) banner.style.display = 'flex';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
