/* ================================================================
   Vorkath GM Timer — script.js
   ================================================================
   Manages the Vorkath GM carry queue using Supabase as the backend.
   Alerts the player when they are in the top 3 or it is their turn.
   ================================================================ */

'use strict';

// ── Config ────────────────────────────────────────────────────────
var SUPABASE_URL = 'https://gogwmrnsofnqkjjxyskt.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZ3dtcm5zb2ZucWtqanh5c2t0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNjE1OTcsImV4cCI6MjA4NzkzNzU5N30.Pw__3qey7A9dV2hjzei-9VNUY4Jc7unVFUGgU-3nTdk';
var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

var HEARTBEAT_MS        = 15000;
var ONLINE_THRESHOLD_MS = 20000;
var INFO_CODE           = 'dragon fire';

// ── State ─────────────────────────────────────────────────────────
var queueData       = [];
var wasFirst        = false;
var wasInTopThree   = false;
var submissionsOpen = true;
var heartbeatTimer  = null;
var realtimeDebounce = null;
var heartbeatData   = {};
var currentWorld    = '';
var calibrated      = false;
var adminPass       = '';
var lastPingCheck   = new Date().toISOString();
var completedData   = [];
var sessionActive   = localStorage.getItem('vgt-session-active') === 'true';
var sessionKillCount = 0;
var skippedData     = [];
var skippedPanelOpen = false;
var completedSidePanelOpen = false;
var adminControlsPanelOpen = false;
var chatPanelOpen = false;
var chatMessages = [];

// ── Helpers ───────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getEffectiveName() {
  return document.getElementById('name-override').value.trim();
}

// ── Supabase data fetches ─────────────────────────────────────────

async function fetchQueue() {
  try {
    var result = await sb.from('queue').select('name').order('joined_at');
    if (result.error) throw result.error;
    queueData = result.data ? result.data.map(function(r) { return r.name; }) : [];
    return queueData;
  } catch (err) {
    console.warn('[VGT] Failed to fetch queue:', err);
    return null;
  }
}

async function fetchSubmissionsOpen() {
  try {
    var result = await sb.from('app_state').select('value').eq('key', 'submissions_open').single();
    if (result.error) throw result.error;
    submissionsOpen = result.data.value === 'true';
  } catch (err) {
    console.warn('[VGT] Failed to fetch submissions status:', err);
    submissionsOpen = true;
  }
}

async function fetchWorld() {
  try {
    var result = await sb.from('app_state').select('value').eq('key', 'world').single();
    if (result.error) throw result.error;
    currentWorld = result.data.value || '';
    var el = document.getElementById('vgt-world');
    if (el) el.textContent = currentWorld ? 'World: ' + currentWorld : '';
  } catch (err) {
    console.warn('[VGT] Failed to fetch world:', err);
  }
}

async function fetchStats() {
  try {
    var result = await sb.from('app_state').select('key, value').in('key', ['total_kills', 'session_kills']);
    if (result.error) throw result.error;
    var total = '—';
    var today = '—';
    for (var i = 0; i < result.data.length; i++) {
      if (result.data[i].key === 'total_kills') total = result.data[i].value || '—';
      if (result.data[i].key === 'session_kills') today = result.data[i].value || '—';
    }
    var elTotal = document.getElementById('info-total');
    var elToday = document.getElementById('info-today');
    if (elTotal) elTotal.textContent = 'Total: ' + total;
    if (elToday) elToday.textContent = 'Today: ' + today;
  } catch (err) {
    console.warn('[VGT] Failed to fetch stats:', err);
  }
}

async function fetchCompleted() {
  try {
    var result = await sb.from('completed').select('name').order('id', { ascending: false });
    if (result.error) throw result.error;
    completedData = result.data ? result.data.map(function(r) { return r.name; }) : [];
    updateCompletedPanel();
    if (completedSidePanelOpen) {
      var sideSearch = document.getElementById('completed-side-search');
      renderCompletedSidePanel(sideSearch ? sideSearch.value.trim() : '');
    }
  } catch (err) {
    console.warn('[VGT] Failed to fetch completed:', err);
  }
}

async function fetchHeartbeats() {
  try {
    var result = await sb.from('heartbeats').select('name, last_seen');
    if (result.error) throw result.error;
    heartbeatData = {};
    if (result.data) {
      for (var i = 0; i < result.data.length; i++) {
        heartbeatData[result.data[i].name.toLowerCase()] = result.data[i].last_seen;
      }
    }
  } catch (err) {
    console.warn('[VGT] Heartbeat fetch failed:', err);
  }
}

async function sendHeartbeat() {
  var name = getEffectiveName();
  if (!name) return;
  try {
    await sb.rpc('upsert_heartbeat', { player_name: name });
  } catch (err) {
    console.warn('[VGT] Heartbeat send failed:', err);
  }
}

async function fetchPings() {
  var name = getEffectiveName();
  if (!name) return;
  try {
    var result = await sb.from('pings')
      .select('pinged_at')
      .ilike('target_name', name)
      .gt('pinged_at', lastPingCheck)
      .limit(1);
    if (result.error) throw result.error;
    if (result.data && result.data.length > 0) {
      playAlert('turn');
      console.log('[VGT] Ping received!');
    }
    lastPingCheck = new Date().toISOString();
  } catch (err) {
    console.warn('[VGT] Ping fetch failed:', err);
  }
}

async function fetchSessionCount() {
  try {
    var result = await sb.from('app_state').select('value').eq('key', 'session_kills').single();
    if (result.error) throw result.error;
    sessionKillCount = parseInt(result.data.value, 10) || 0;
    updateSessionDisplay();
  } catch (err) {
    console.warn('[VGT] Session count fetch failed:', err);
  }
}

async function fetchSkipped() {
  try {
    var result = await sb.from('skipped').select('name').order('skipped_at', { ascending: false }).limit(20);
    if (result.error) throw result.error;
    skippedData = result.data ? result.data.map(function(r) { return r.name; }) : [];
    renderSkippedPanel();
  } catch (err) {
    console.warn('[VGT] Skipped fetch failed:', err);
  }
}

// ── Status tab ────────────────────────────────────────────────────

function updateStatus(queue) {
  var alertCard  = document.getElementById('alert-card');
  var alertIcon  = document.getElementById('alert-icon');
  var alertTitle = document.getElementById('alert-title');
  var alertSub   = document.getElementById('alert-sub');
  var posEl      = document.getElementById('queue-position');
  var joinBtn    = document.getElementById('join-queue-btn');

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

  var rank = idx + 1;

  if (idx === -1) {
    setCard(alertCard, 'neutral');
    alertIcon.textContent  = '💤';
    alertTitle.textContent = 'Not in queue';
    alertSub.textContent   = 'You are not currently listed';
    posEl.textContent      = '—';
    if (!submissionsOpen) {
      joinBtn.style.display = 'none';
    } else {
      joinBtn.style.display = 'block';
      var infoInput = document.getElementById('info-phrase-input');
      var infoValue = infoInput ? infoInput.value.trim().toLowerCase() : '';
      if (infoValue !== INFO_CODE) {
        joinBtn.disabled    = true;
        joinBtn.textContent = 'Incorrect Info Phrase';
        joinBtn.classList.add('closed');
      } else {
        joinBtn.disabled    = false;
        joinBtn.textContent = '+ Join Queue';
        joinBtn.classList.remove('closed');
      }
    }
    wasInTopThree = false;
    wasFirst      = false;
    return;
  }

  joinBtn.style.display = 'none';
  posEl.textContent = '#' + rank;

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
  var statusEl = document.getElementById('ac-submissions-status');
  var toggleBtn = document.getElementById('ac-toggle-submissions');
  if (!statusEl || !toggleBtn) return;
  if (submissionsOpen) {
    statusEl.textContent = 'Open';
    statusEl.className = 'vgt-ac-status open';
    toggleBtn.textContent = 'Close';
    toggleBtn.className = 'vgt-ac-btn toggle open-state';
  } else {
    statusEl.textContent = 'Closed';
    statusEl.className = 'vgt-ac-status closed';
    toggleBtn.textContent = 'Open';
    toggleBtn.className = 'vgt-ac-btn toggle';
  }
}

function updateQueueList(queue) {
  updateToggleOpenBtn();
  var listEl = document.getElementById('queue-list');

  // Skip re-render if an inline name edit is in progress
  if (listEl.querySelector('.vgt-queue-name.editing')) return;

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
    var moveButtons = '';
    var nameClass = 'vgt-queue-name';
    if (calibrated) {
      adminBtns =
        '<span class="vgt-admin-actions">' +
          '<button class="vgt-admin-action done" data-action="adminDone" data-name="' + escapeHtml(n) + '" title="Mark Done">\u2713</button>' +
          '<button class="vgt-admin-action skip" data-action="adminSkip" data-name="' + escapeHtml(n) + '" title="Mark Skip">\u2717</button>' +
          '<button class="vgt-admin-action ping" data-action="ping" data-name="' + escapeHtml(n) + '" title="Ping Player">\u266A</button>' +
        '</span>';
      moveButtons =
        '<span class="vgt-move-btns">' +
          '<button class="vgt-move-btn" data-dir="up" data-name="' + escapeHtml(n) + '"' + (i === 0 ? ' disabled' : '') + ' title="Move up">\u25B2</button>' +
          '<button class="vgt-move-btn" data-dir="down" data-name="' + escapeHtml(n) + '"' + (i === queue.length - 1 ? ' disabled' : '') + ' title="Move down">\u25BC</button>' +
        '</span>';
      nameClass += ' editable';
    }

    html +=
      '<div class="' + cls + '" data-index="' + i + '">' +
        moveButtons +
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
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.setValueAtTime(880, t + 0.12);
      osc.frequency.setValueAtTime(1100, t + 0.24);
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.55);
    } else {
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.setValueAtTime(880, t + 0.15);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
      osc.start(t);
      osc.stop(t + 0.40);
    }
  } catch (e) {}
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

// ── Submissions Status Bar ────────────────────────────────────

function updateSubmissionsStatus() {
  var el = document.getElementById('submissions-status');
  if (!el) return;
  if (submissionsOpen) {
    el.textContent = 'Submissions open';
    el.className = 'vgt-submissions-status open';
  } else {
    el.textContent = 'Submissions closed';
    el.className = 'vgt-submissions-status closed';
  }
}

// ── Queue actions ─────────────────────────────────────────────────

async function runAction(action, name, btnEl) {
  if (!calibrated) return;
  btnEl.disabled = true;

  try {
    var result;
    if (action === 'adminDone') {
      result = await sb.rpc('admin_complete', {
        pass: adminPass,
        player_name: name,
        increment_session: sessionActive
      });
    } else if (action === 'adminSkip') {
      result = await sb.rpc('admin_skip', { pass: adminPass, player_name: name });
    } else if (action === 'ping') {
      result = await sb.rpc('admin_ping', { pass: adminPass, target: name });
    }

    if (result.error) throw result.error;

    btnEl.textContent = '\u2713';
    if (action === 'adminDone' && sessionActive) {
      sessionKillCount++;
      updateSessionDisplay();
    }
  } catch (err) {
    console.warn('[VGT] Action failed:', err);
    btnEl.textContent = '!';
    btnEl.disabled = false;
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────

function isOnline(name) {
  var key  = name.toLowerCase();
  var ts   = heartbeatData[key];
  if (!ts) return false;
  var then = new Date(ts).getTime();
  if (isNaN(then)) return false;
  return (Date.now() - then) < ONLINE_THRESHOLD_MS;
}

// ── Main refresh ──────────────────────────────────────────────────

async function refresh() {
  setDot('loading');

  var fetches = [fetchQueue(), fetchSubmissionsOpen(), fetchHeartbeats(), fetchWorld(), fetchPings(), fetchStats()];
  if (calibrated) {
    fetches.push(fetchSessionCount());
    fetches.push(fetchSkipped());
  }
  var results = await Promise.all(fetches);
  var queue   = results[0];

  if (queue) {
    setDot('connected');
  } else {
    setDot('error');
  }

  updateSubmissionsStatus();
  updateStatus(queue);
  updateQueueList(queue);
  updateTimestamp();
}

// ── Realtime subscriptions ────────────────────────────────────────

function onRealtimeChange() {
  clearTimeout(realtimeDebounce);
  realtimeDebounce = setTimeout(refresh, 300);
}

function setupRealtime() {
  sb.channel('vgt-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'skipped' }, onRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'completed' }, function() {
      fetchCompleted();
      onRealtimeChange();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pings' }, function() {
      fetchPings();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'heartbeats' }, function() {
      fetchHeartbeats();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_chat' }, function() {
      if (chatPanelOpen) fetchAdminChat();
    })
    .subscribe();
}

// ── Session Tracking ─────────────────────────────────────────────

function updateSessionDisplay() {
  var statusEl = document.getElementById('ac-session-status');
  var countEl = document.getElementById('ac-session-count');
  var startBtn = document.getElementById('ac-session-start');
  var endBtn = document.getElementById('ac-session-end');
  if (!countEl) return;

  countEl.textContent = 'Kills: ' + sessionKillCount;
  if (sessionActive) {
    if (statusEl) { statusEl.textContent = 'Active'; statusEl.className = 'vgt-ac-status active'; }
    startBtn.style.display = 'none';
    endBtn.style.display = '';
  } else {
    if (statusEl) { statusEl.textContent = 'Inactive'; statusEl.className = 'vgt-ac-status inactive'; }
    startBtn.style.display = '';
    endBtn.style.display = 'none';
  }
}

// ── Skipped Players ──────────────────────────────────────────────

function renderSkippedPanel() {
  var listEl = document.getElementById('skipped-list');
  if (!listEl) return;

  if (skippedData.length === 0) {
    listEl.innerHTML = '<div class="vgt-skipped-empty">No skipped players</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < skippedData.length; i++) {
    html += '<div class="vgt-skipped-item">' +
      '<span class="vgt-skipped-name">' + escapeHtml(skippedData[i]) + '</span>' +
      '<button class="vgt-unskip-btn" data-name="' + escapeHtml(skippedData[i]) + '">Unskip</button>' +
      '<button class="vgt-skip-complete-btn" data-name="' + escapeHtml(skippedData[i]) + '">Complete</button>' +
      '</div>';
  }
  listEl.innerHTML = html;
}

function toggleSkippedPanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('skipped-panel');
  var app = document.querySelector('.vgt-app');
  if (!panel || !app) return;

  skippedPanelOpen = typeof show === 'boolean' ? show : !skippedPanelOpen;

  if (skippedPanelOpen) {
    panel.style.display = 'flex';
    app.classList.add('panel-open');
    fetchSkipped();
  } else {
    panel.style.display = 'none';
    app.classList.remove('panel-open');
  }
}

// ── Completed Side Panel (admin, left) ───────────────────────────

function toggleCompletedSidePanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('completed-side-panel');
  var app = document.querySelector('.vgt-app');
  if (!panel || !app) return;

  completedSidePanelOpen = typeof show === 'boolean' ? show : !completedSidePanelOpen;

  if (completedSidePanelOpen) {
    panel.style.display = 'flex';
    app.classList.add('panel-open-left');
    renderCompletedSidePanel();
  } else {
    panel.style.display = 'none';
    app.classList.remove('panel-open-left');
  }
}

// ── Admin Controls Panel (admin, far left) ───────────────────────

function toggleAdminControlsPanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('admin-controls-panel');
  var completedPanel = document.getElementById('completed-side-panel');
  if (!panel) return;

  adminControlsPanelOpen = typeof show === 'boolean' ? show : !adminControlsPanelOpen;

  if (adminControlsPanelOpen) {
    panel.style.display = 'flex';
    if (completedPanel) completedPanel.classList.add('has-neighbor-left');
    var worldInput = document.getElementById('ac-world-input');
    if (worldInput) worldInput.value = currentWorld;
    updateToggleOpenBtn();
    updateSessionDisplay();
  } else {
    panel.style.display = 'none';
    if (completedPanel) completedPanel.classList.remove('has-neighbor-left');
  }
}

function renderCompletedSidePanel(filter) {
  var listEl = document.getElementById('completed-side-list');
  if (!listEl) return;

  var filtered = completedData;
  if (filter) {
    var f = filter.toLowerCase();
    filtered = completedData.filter(function(n) {
      return n.toLowerCase().indexOf(f) !== -1;
    });
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="vgt-completed-side-empty">' + (filter ? 'No results' : 'No completed kills') + '</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    html += '<div class="vgt-completed-side-item">' +
      '<span class="vgt-completed-side-name" data-original="' + escapeHtml(filtered[i]) + '">' + escapeHtml(filtered[i]) + '</span>' +
      '<button class="vgt-completed-side-skip" data-name="' + escapeHtml(filtered[i]) + '" title="Move to skipped">\u2717</button>' +
      '</div>';
  }
  listEl.innerHTML = html;
}

// ── Admin Chat ────────────────────────────────────────────────────

async function fetchAdminChat() {
  try {
    var result = await sb.from('admin_chat').select('*').order('created_at', { ascending: true }).limit(100);
    if (result.error) throw result.error;
    chatMessages = result.data || [];
    renderChatMessages();
  } catch (err) {
    console.warn('[VGT] Failed to fetch chat:', err);
  }
}

function renderChatMessages() {
  var el = document.getElementById('chat-messages');
  if (!el) return;

  if (chatMessages.length === 0) {
    el.innerHTML = '<div class="vgt-chat-empty">No messages yet</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < chatMessages.length; i++) {
    var m = chatMessages[i];
    var time = '';
    try {
      var d = new Date(m.created_at);
      time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {}
    html += '<div class="vgt-chat-msg">' +
      '<span class="vgt-chat-msg-time">' + escapeHtml(time) + '</span>' +
      '<span class="vgt-chat-msg-name">' + escapeHtml(m.sender || 'Admin') + '</span>' +
      '<div class="vgt-chat-msg-text">' + escapeHtml(m.message) + '</div>' +
      '</div>';
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

async function sendChatMessage() {
  var input = document.getElementById('chat-input');
  var msg = input.value.trim();
  if (!msg || !calibrated) return;

  var sender = getEffectiveName() || 'Admin';
  var btn = document.getElementById('chat-send-btn');
  btn.disabled = true;
  input.disabled = true;

  try {
    var result = await sb.rpc('send_admin_chat', { pass: adminPass, msg: msg, sender_name: sender });
    if (result.error) throw result.error;
    input.value = '';
  } catch (err) {
    console.warn('[VGT] Send chat failed:', err);
  }

  btn.disabled = false;
  input.disabled = false;
  input.focus();
}

function toggleChatPanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('chat-panel');
  var skippedPanel = document.getElementById('skipped-panel');
  if (!panel) return;

  chatPanelOpen = typeof show === 'boolean' ? show : !chatPanelOpen;

  if (chatPanelOpen) {
    panel.style.display = 'flex';
    if (skippedPanel) skippedPanel.classList.add('has-neighbor-right');
    fetchAdminChat();
  } else {
    panel.style.display = 'none';
    if (skippedPanel) skippedPanel.classList.remove('has-neighbor-right');
  }
}

// ── Join Queue ────────────────────────────────────────────────────

var lastSubmittedName = '';
var lastSubmitTime    = 0;

async function joinQueue() {
  var name = getEffectiveName();
  if (!name) return;

  var infoInput = document.getElementById('info-phrase-input');
  var infoValue = infoInput ? infoInput.value.trim().toLowerCase() : '';
  if (infoValue !== INFO_CODE) return;

  var btn = document.getElementById('join-queue-btn');

  if (name.toLowerCase() === lastSubmittedName.toLowerCase() && Date.now() - lastSubmitTime < 30000) {
    btn.textContent = 'Already submitted';
    btn.disabled = true;
    btn.classList.add('submitted');
    setTimeout(function() {
      btn.textContent = '+ Join Queue';
      btn.disabled = false;
      btn.classList.remove('submitted');
    }, 3000);
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Submitting...';

  try {
    var result = await sb.rpc('join_queue', { player_name: name });
    if (result.error) throw result.error;
    var data = result.data;
    if (data.ok) {
      btn.textContent = '\u2713 Joined queue!';
      lastSubmittedName = name;
      lastSubmitTime = Date.now();
    } else if (data.error === 'duplicate') {
      btn.textContent = 'Already in queue';
    } else {
      btn.textContent = '\u2717 Failed — try again';
    }
  } catch (e) {
    console.warn('[VGT] Join queue error:', e);
    btn.textContent = '\u2717 Error — try again';
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
  function switchToTab(tabName) {
    document.querySelectorAll('.vgt-tab').forEach(function(t) {
      t.classList.remove('active');
    });
    document.querySelectorAll('.vgt-page').forEach(function(p) {
      p.classList.remove('active');
    });
    var tabBtn = document.querySelector('.vgt-tab[data-tab="' + tabName + '"]');
    if (tabBtn) tabBtn.classList.add('active');
    var tabPage = document.getElementById('tab-' + tabName);
    if (tabPage) tabPage.classList.add('active');
    try { localStorage.setItem('vgt_activeTab', tabName); } catch (e) {}
    if (calibrated && tabName === 'queue') {
      toggleAdminControlsPanel(true);
      toggleSkippedPanel(true);
      toggleCompletedSidePanel(true);
      toggleChatPanel(true);
    } else {
      toggleAdminControlsPanel(false);
      toggleSkippedPanel(false);
      toggleCompletedSidePanel(false);
      toggleChatPanel(false);
    }
  }

  document.querySelectorAll('.vgt-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      switchToTab(tab.dataset.tab);
    });
  });

  // Restore last active tab
  var savedTab = localStorage.getItem('vgt_activeTab');
  if (savedTab) switchToTab(savedTab);

  // ── Name input
  var nameDebounce = null;
  var heartbeatDebounce = null;
  document.getElementById('name-override').addEventListener('input', function() {
    try { localStorage.setItem('vgt_playerName', this.value.trim()); } catch (e) {}
    updateStatus(queueData);
    updateQueueList(queueData);
    clearTimeout(nameDebounce);
    nameDebounce = setTimeout(refresh, 1000);
    clearTimeout(heartbeatDebounce);
    heartbeatDebounce = setTimeout(sendHeartbeat, 5000);
  });

  // ── Info phrase input
  document.getElementById('info-phrase-input').addEventListener('input', function() {
    updateStatus(queueData);
  });

  // ── Join Queue button
  document.getElementById('join-queue-btn').addEventListener('click', joinQueue);

  // ── Refresh buttons
  document.getElementById('refresh-btn').addEventListener('click', refresh);
  document.getElementById('refresh-btn-queue').addEventListener('click', refresh);

  // ── Initial load
  refresh();
  fetchCompleted();

  // ── Realtime — instant updates from Supabase
  setupRealtime();

  // ── Heartbeat — announce presence every 15 s
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

  // ── Admin helpers ───────────────────────────────────────────────
  function activateAdmin(pass) {
    calibrated = true;
    adminPass = pass;
    try {
      localStorage.setItem('vgt_adminPass', pass);
      localStorage.setItem('vgt_adminExpiry', String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    } catch (e) {}
    var ab = document.getElementById('admin-btn');
    ab.textContent = 'Admin \u2713';
    ab.classList.add('active');
    updateQueueList(queueData);
    var activeTab = document.querySelector('.vgt-tab.active');
    if (activeTab && activeTab.dataset.tab === 'queue') {
      toggleAdminControlsPanel(true);
      toggleSkippedPanel(true);
      toggleCompletedSidePanel(true);
      toggleChatPanel(true);
    }
    fetchSessionCount();
    updateSessionDisplay();
    updateToggleOpenBtn();
  }

  function deactivateAdmin() {
    calibrated = false;
    adminPass = '';
    try {
      localStorage.removeItem('vgt_adminPass');
      localStorage.removeItem('vgt_adminExpiry');
    } catch (e) {}
    var ab = document.getElementById('admin-btn');
    ab.textContent = 'Admin';
    ab.classList.remove('active');
    toggleAdminControlsPanel(false);
    toggleSkippedPanel(false);
    toggleCompletedSidePanel(false);
    toggleChatPanel(false);
    updateQueueList(queueData);
  }

  // ── Auto-login from saved session ─────────────────────────────
  try {
    var savedPass = localStorage.getItem('vgt_adminPass');
    var savedExpiry = localStorage.getItem('vgt_adminExpiry');
    if (savedPass && savedExpiry && Date.now() < Number(savedExpiry)) {
      sb.rpc('check_admin', { pass: savedPass }).then(function(result) {
        if (result.data === true) {
          activateAdmin(savedPass);
        } else {
          localStorage.removeItem('vgt_adminPass');
          localStorage.removeItem('vgt_adminExpiry');
        }
      });
    } else {
      localStorage.removeItem('vgt_adminPass');
      localStorage.removeItem('vgt_adminExpiry');
    }
  } catch (e) {}

  // ── Admin login ──────────────────────────────────────────────────
  var adminBtn       = document.getElementById('admin-btn');
  var adminOverlay   = document.getElementById('admin-overlay');
  var adminPassInput = document.getElementById('admin-pass-input');
  var adminLoginBtn  = document.getElementById('admin-login-btn');
  var adminCancelBtn = document.getElementById('admin-cancel-btn');
  var adminError     = document.getElementById('admin-error');

  adminBtn.addEventListener('click', function() {
    if (calibrated) {
      deactivateAdmin();
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

  async function attemptCalibration() {
    var entered = adminPassInput.value.trim();
    if (!entered) return;
    adminLoginBtn.disabled = true;
    try {
      var result = await sb.rpc('check_admin', { pass: entered });
      if (result.error) throw result.error;
      if (result.data === true) {
        activateAdmin(entered);
        adminOverlay.style.display = 'none';
      } else {
        adminError.textContent = 'Invalid key';
        adminError.style.display = 'block';
        adminPassInput.value = '';
        adminPassInput.focus();
      }
    } catch (err) {
      adminError.textContent = 'Could not verify — retry';
      adminError.style.display = 'block';
    }
    adminLoginBtn.disabled = false;
  }

  adminLoginBtn.addEventListener('click', attemptCalibration);

  adminPassInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') attemptCalibration();
    if (e.key === 'Escape') adminOverlay.style.display = 'none';
  });

  // ── Queue action delegation ──────────────────────────────────────
  var queueListEl = document.getElementById('queue-list');

  queueListEl.addEventListener('click', function(e) {
    if (!calibrated) return;

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

      var input = document.createElement('input');
      input.className = 'vgt-queue-name-input';
      input.type = 'text';
      input.value = original;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('data-lpignore', 'true');
      input.setAttribute('data-1p-ignore', 'true');
      input.setAttribute('data-bwignore', 'true');
      input.setAttribute('data-protonpass-ignore', 'true');
      input.setAttribute('data-form-type', 'other');
      input.setAttribute('role', 'presentation');
      input.setAttribute('name', 'vgt-edit-' + Date.now());

      nameEl.textContent = '';
      nameEl.appendChild(input);
      input.focus();
      input.select();

      var saved = false;
      var blurTimeout = null;

      function saveEdit() {
        if (saved) return;
        saved = true;
        if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
        var newName = input.value.trim();
        if (newName && newName !== original) {
          nameEl.textContent = newName;
          nameEl.classList.remove('editing');
          sb.rpc('admin_edit_name', { pass: adminPass, old_name: original, new_name: newName })
            .catch(function(err) { console.warn('[VGT] Edit failed:', err); });
        } else {
          nameEl.textContent = original;
          nameEl.classList.remove('editing');
        }
      }

      input.addEventListener('blur', function() {
        blurTimeout = setTimeout(saveEdit, 150);
      });

      input.addEventListener('focus', function() {
        if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
      });

      input.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); }
        if (ev.key === 'Escape') {
          saved = true;
          if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
          nameEl.textContent = original;
          nameEl.classList.remove('editing');
        }
      });
    }
  });

  // ── Move up/down buttons ────────────────────────────────────────
  queueListEl.addEventListener('click', function(e) {
    var moveBtn = e.target.closest('.vgt-move-btn');
    if (!moveBtn || !calibrated || moveBtn.disabled) return;

    var dir = moveBtn.getAttribute('data-dir');
    var movedName = moveBtn.getAttribute('data-name');

    var fromIndex = -1;
    for (var i = 0; i < queueData.length; i++) {
      if (queueData[i] === movedName) { fromIndex = i; break; }
    }
    var toIndex = dir === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (fromIndex === -1 || toIndex < 0 || toIndex >= queueData.length) return;

    // Optimistically reorder
    queueData.splice(fromIndex, 1);
    queueData.splice(toIndex, 0, movedName);
    updateQueueList(queueData);

    sb.rpc('admin_move_queue', { pass: adminPass, player_name: movedName, direction: dir })
      .catch(function(err) { console.warn('[VGT] Move failed:', err); });
  });

  // ── Admin controls panel buttons ─────────────────────────────
  document.getElementById('ac-toggle-submissions').addEventListener('click', async function() {
    if (!calibrated) return;
    var btn = this;
    btn.disabled = true;
    try {
      var result = await sb.rpc('admin_toggle_submissions', { pass: adminPass });
      if (result.error) throw result.error;
      submissionsOpen = result.data === 'true';
      updateToggleOpenBtn();
      updateSubmissionsStatus();
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

  // ── Session Start / End buttons (admin controls panel) ──────────
  document.getElementById('ac-session-start').addEventListener('click', async function() {
    if (!calibrated) return;
    this.disabled = true;
    try {
      var result = await sb.rpc('admin_session_start', { pass: adminPass });
      if (result.error) throw result.error;
      sessionActive = true;
      sessionKillCount = 0;
      localStorage.setItem('vgt-session-active', 'true');
      updateSessionDisplay();
    } catch (err) {
      console.warn('[VGT] Session start failed:', err);
    }
    this.disabled = false;
  });

  document.getElementById('ac-session-end').addEventListener('click', function() {
    sessionActive = false;
    localStorage.setItem('vgt-session-active', 'false');
    updateSessionDisplay();
  });

  // ── World input (admin controls panel) ─────────────────────────
  var worldDebounce = null;
  document.getElementById('ac-world-input').addEventListener('input', function() {
    var val = this.value.trim();
    clearTimeout(worldDebounce);
    worldDebounce = setTimeout(function() {
      if (!calibrated) return;
      currentWorld = val;
      var el = document.getElementById('vgt-world');
      if (el) el.textContent = val ? 'World: ' + val : '';
      sb.from('app_state').update({ value: val }).eq('key', 'world')
        .then(function(res) {
          if (res.error) console.warn('[VGT] World update failed:', res.error);
        });
    }, 500);
  });

  // ── Completed side panel search ──────────────────────────────────
  document.getElementById('completed-side-search').addEventListener('input', function() {
    renderCompletedSidePanel(this.value.trim());
  });

  // ── Completed side panel actions ────────────────────────────────
  document.getElementById('completed-side-list').addEventListener('click', function(e) {
    if (!calibrated) return;

    // Move to skipped (X button)
    var skipBtn = e.target.closest('.vgt-completed-side-skip');
    if (skipBtn && !skipBtn.disabled) {
      var skipName = skipBtn.getAttribute('data-name');
      skipBtn.disabled = true;
      skipBtn.textContent = '...';
      sb.rpc('admin_uncomplete_to_skip', { pass: adminPass, player_name: skipName })
        .then(function(result) {
          if (result.error) throw result.error;
          var item = skipBtn.closest('.vgt-completed-side-item');
          if (item) item.remove();
        })
        .catch(function(err) {
          console.warn('[VGT] Uncomplete to skip failed:', err);
          skipBtn.disabled = false;
          skipBtn.textContent = '\u2717';
        });
      return;
    }

    // Inline name editing
    var nameEl = e.target.closest('.vgt-completed-side-name');
    if (!nameEl || nameEl.classList.contains('editing')) return;

    var original = nameEl.getAttribute('data-original');
    nameEl.classList.add('editing');

    var input = document.createElement('input');
    input.className = 'vgt-completed-side-edit';
    input.type = 'text';
    input.value = original;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('data-1p-ignore', 'true');

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    var saved = false;
    var blurTimeout = null;

    function saveEdit() {
      if (saved) return;
      saved = true;
      if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
      var newName = input.value.trim();
      if (newName && newName !== original) {
        nameEl.textContent = newName;
        nameEl.setAttribute('data-original', newName);
        nameEl.classList.remove('editing');
        sb.rpc('admin_edit_completed_name', { pass: adminPass, old_name: original, new_name: newName })
          .catch(function(err) { console.warn('[VGT] Completed edit failed:', err); });
      } else {
        nameEl.textContent = original;
        nameEl.classList.remove('editing');
      }
    }

    input.addEventListener('blur', function() {
      blurTimeout = setTimeout(saveEdit, 150);
    });

    input.addEventListener('focus', function() {
      if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
    });

    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); }
      if (ev.key === 'Escape') {
        saved = true;
        if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
        nameEl.textContent = original;
        nameEl.classList.remove('editing');
      }
    });
  });

  // ── Admin chat send ────────────────────────────────────────────────
  document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
  });

  // ── Skipped panel delegation ─────────────────────────────────────
  document.getElementById('skipped-list').addEventListener('click', async function(e) {
    if (!calibrated) return;

    // Unskip → back to queue
    var unskipBtn = e.target.closest('.vgt-unskip-btn');
    if (unskipBtn && !unskipBtn.disabled) {
      var name = unskipBtn.getAttribute('data-name');
      unskipBtn.disabled = true;
      unskipBtn.textContent = '...';
      try {
        var result = await sb.rpc('admin_unskip', { pass: adminPass, player_name: name });
        if (result.error) throw result.error;
        skippedData = skippedData.filter(function(n) { return n !== name; });
        renderSkippedPanel();
      } catch (err) {
        console.warn('[VGT] Unskip failed:', err);
        unskipBtn.disabled = false;
        unskipBtn.textContent = 'Unskip';
      }
      return;
    }

    // Complete → move from skipped to completed
    var completeBtn = e.target.closest('.vgt-skip-complete-btn');
    if (completeBtn && !completeBtn.disabled) {
      var cName = completeBtn.getAttribute('data-name');
      completeBtn.disabled = true;
      completeBtn.textContent = '...';
      try {
        var result = await sb.rpc('admin_skip_to_complete', { pass: adminPass, player_name: cName });
        if (result.error) throw result.error;
        skippedData = skippedData.filter(function(n) { return n !== cName; });
        renderSkippedPanel();
      } catch (err) {
        console.warn('[VGT] Skip to complete failed:', err);
        completeBtn.disabled = false;
        completeBtn.textContent = 'Complete';
      }
    }
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
  document.body.classList.add('browser-view');
  var banner = document.getElementById('alt1-banner');
  if (banner) banner.style.display = 'flex';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
