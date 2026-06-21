'use strict';

var SUPABASE_URL = 'https://gogwmrnsofnqkjjxyskt.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZ3dtcm5zb2ZucWtqanh5c2t0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNjE1OTcsImV4cCI6MjA4NzkzNzU5N30.Pw__3qey7A9dV2hjzei-9VNUY4Jc7unVFUGgU-3nTdk';
var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

var HEARTBEAT_MS        = 15000;
var ONLINE_THRESHOLD_MS = 20000;
var INFO_CODE           = '';

var queueData            = [];
var wasFirst             = false;
var wasInTopThree        = false;
var submissionsOpen      = true;
var heartbeatTimer       = null;
var realtimeDebounce     = null;
var heartbeatData        = {};
var currentWorld         = '';
var calibrated           = false;
var adminPass            = '';
var adminName            = '';
var superCalibrated      = false;
var superAdminPass       = '';
var blacklist            = [];
var lastPingCheck        = new Date().toISOString();
var completedData        = [];
var sessionActive        = false;
var sessionKillCount     = 0;
var skippedData          = [];
var skippedPanelOpen     = false;
var completedSidePanelOpen = false;
var adminControlsPanelOpen = false;
var chatPanelOpen        = false;
var chatMessages         = [];
var dragSrcIndex         = -1;
var dragOverIndex        = -1;
var isDragging           = false;
var otherHidden          = false;
var completePendingRSN   = '';
var completePendingBtn   = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getPlayerRSN() {
  var el = document.getElementById('oth-rsn-input');
  return el ? el.value.trim() : '';
}

function generateTimeOptions(selectEl, savedValue) {
  if (!selectEl) return;
  var html = '';
  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 30) {
      var hh = h < 10 ? '0' + h : '' + h;
      var mm = m === 0 ? '00' : '30';
      var val = hh + ':' + mm;
      html += '<option value="' + val + '"' + (val === savedValue ? ' selected' : '') + '>' + val + '</option>';
    }
  }
  selectEl.innerHTML = html;
}

function getSelectedAchievements() {
  var cbs = document.querySelectorAll('.oth-achievement-checkbox:checked');
  var out = [];
  for (var i = 0; i < cbs.length; i++) out.push(cbs[i].value);
  return out;
}

// ── Fetches ───────────────────────────────────────────────────────

async function fetchQueue() {
  try {
    var result = await sb.from('other_queue').select('rsn,discord_name,start_time,end_time,achievements').order('position');
    if (result.error) throw result.error;
    queueData = result.data || [];
    return queueData;
  } catch (err) {
    console.warn('[OTHER] fetchQueue failed:', err);
    return null;
  }
}

async function fetchBlacklist() {
  try {
    var result = await sb.from('blacklist').select('name');
    if (result.error) throw result.error;
    blacklist = (result.data || []).map(function(r) { return r.name.toLowerCase(); });
    renderBlacklistPanel();
    checkBanned();
  } catch (err) {
    console.warn('[OTHER] fetchBlacklist failed:', err);
  }
}

async function fetchInfoCode() {
  try {
    var result = await sb.from('other_app_state').select('value').eq('key','info_code').single();
    if (result.error) throw result.error;
    INFO_CODE = (result.data.value || '').toLowerCase().trim();
  } catch (err) { console.warn('[OTHER] fetchInfoCode failed:', err); }
}

async function fetchSubmissionsOpen() {
  try {
    var result = await sb.from('other_app_state').select('value').eq('key','submissions_open').single();
    if (result.error) throw result.error;
    submissionsOpen = result.data.value === 'true';
  } catch (err) { submissionsOpen = true; }
}

async function fetchWorld() {
  try {
    var result = await sb.from('other_app_state').select('value').eq('key','world').single();
    if (result.error) throw result.error;
    currentWorld = result.data.value || '';
    var el = document.getElementById('vgt-world');
    if (el) el.textContent = currentWorld ? 'World: ' + currentWorld : '';
    var wi = document.getElementById('ac-world-input');
    if (wi && document.activeElement !== wi) wi.value = currentWorld;
  } catch (err) { console.warn('[OTHER] fetchWorld failed:', err); }
}

async function fetchStats() {
  try {
    var result = await sb.from('other_app_state').select('key,value').in('key',['total_kills','session_kills']);
    if (result.error) throw result.error;
    var total = '—', today = '—';
    for (var i = 0; i < result.data.length; i++) {
      if (result.data[i].key === 'total_kills') total = result.data[i].value || '—';
      if (result.data[i].key === 'session_kills') today = result.data[i].value || '—';
    }
    var et = document.getElementById('info-total'); if (et) et.textContent = 'Total: ' + total;
    var ed = document.getElementById('info-today'); if (ed) ed.textContent = 'Today: ' + today;
    var eq = document.getElementById('queue-total-carries'); if (eq) eq.textContent = 'Total: ' + total;
  } catch (err) { console.warn('[OTHER] fetchStats failed:', err); }
}

async function fetchCompleted() {
  try {
    var result = await sb.from('other_completed').select('id,rsn,discord_name,achievements').order('id',{ascending:false});
    if (result.error) throw result.error;
    completedData = result.data || [];
    updateCompletedPanel();
    if (completedSidePanelOpen) {
      var s = document.getElementById('completed-side-search');
      renderCompletedSidePanel(s ? s.value.trim() : '');
    }
  } catch (err) { console.warn('[OTHER] fetchCompleted failed:', err); }
}

async function fetchHeartbeats() {
  try {
    var result = await sb.from('heartbeats').select('name,last_seen');
    if (result.error) throw result.error;
    heartbeatData = {};
    if (result.data) for (var i = 0; i < result.data.length; i++)
      heartbeatData[result.data[i].name.toLowerCase()] = result.data[i].last_seen;
  } catch (err) { console.warn('[OTHER] fetchHeartbeats failed:', err); }
}

async function sendHeartbeat() {
  var rsn = getPlayerRSN();
  if (!rsn) return;
  try { await sb.rpc('upsert_heartbeat', { player_name: rsn }); } catch (err) {}
}

async function fetchPings() {
  var rsn = getPlayerRSN();
  if (!rsn) return;
  try {
    var result = await sb.from('pings').select('pinged_at').ilike('target_name', rsn).gt('pinged_at', lastPingCheck).limit(1);
    if (result.error) throw result.error;
    if (result.data && result.data.length > 0) playAlert('turn');
    lastPingCheck = new Date().toISOString();
  } catch (err) {}
}

async function fetchSessionState() {
  try {
    var result = await sb.from('other_app_state').select('key,value').in('key',['session_kills','session_active']);
    if (result.error) throw result.error;
    for (var i = 0; i < result.data.length; i++) {
      if (result.data[i].key === 'session_kills') sessionKillCount = parseInt(result.data[i].value, 10) || 0;
      if (result.data[i].key === 'session_active') sessionActive = result.data[i].value === 'true';
    }
    updateSessionDisplay();
  } catch (err) { console.warn('[OTHER] fetchSessionState failed:', err); }
}

async function fetchSkipped() {
  try {
    var result = await sb.from('other_skipped').select('id,rsn,discord_name,achievements').order('id',{ascending:false}).limit(30);
    if (result.error) throw result.error;
    skippedData = result.data || [];
    renderSkippedPanel();
  } catch (err) { console.warn('[OTHER] fetchSkipped failed:', err); }
}

async function fetchHiddenState() {
  try {
    var result = await sb.from('other_app_state').select('value').eq('key','section_hidden').single();
    if (result.error) throw result.error;
    otherHidden = result.data.value === 'true';
    updateHiddenBtn();
    applyHiddenState();
  } catch (err) { console.warn('[OTHER] fetchHiddenState failed:', err); }
}

function updateHiddenBtn() {
  var st = document.getElementById('ac-hidden-status');
  var btn = document.getElementById('ac-toggle-hidden');
  if (!st || !btn) return;
  if (otherHidden) { st.textContent = 'Hidden'; st.className = 'vgt-ac-status closed'; btn.textContent = 'Show Section'; }
  else { st.textContent = 'Visible'; st.className = 'vgt-ac-status open'; btn.textContent = 'Hide Section'; }
}

function applyHiddenState() {
  var ov = document.getElementById('other-hidden-overlay');
  if (!ov) return;
  ov.style.display = (otherHidden && !calibrated) ? 'block' : 'none';
}

// ── Status / Queue display ────────────────────────────────────────

function setCard(el, state) { el.className = 'vgt-alert-card ' + state; }

function updateStatus(queue) {
  var alertCard  = document.getElementById('alert-card');
  var alertIcon  = document.getElementById('alert-icon');
  var alertTitle = document.getElementById('alert-title');
  var alertSub   = document.getElementById('alert-sub');
  var posEl      = document.getElementById('queue-position');
  var joinBtn    = document.getElementById('join-queue-btn');

  if (!queue) {
    setCard(alertCard,'error'); alertIcon.textContent='❌';
    alertTitle.textContent='Failed to load queue'; alertSub.textContent='Check your internet connection';
    posEl.textContent='—'; joinBtn.style.display='none'; return;
  }

  var rsn = getPlayerRSN();
  if (!rsn) {
    setCard(alertCard,'warning'); alertIcon.textContent='👤';
    alertTitle.textContent='No name set'; alertSub.textContent='Enter your RS name above';
    posEl.textContent='—'; joinBtn.style.display='none'; return;
  }

  var rsnLower = rsn.toLowerCase();
  var idx = -1;
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].rsn.toLowerCase() === rsnLower) { idx = i; break; }
  }

  var rank = idx + 1;

  if (idx === -1) {
    setCard(alertCard,'neutral'); alertIcon.textContent='💤';
    alertTitle.textContent='Not in queue'; alertSub.textContent='You are not currently listed';
    posEl.textContent='—';
    if (!submissionsOpen) {
      joinBtn.style.display='none';
    } else {
      joinBtn.style.display='block';
      var discord = (document.getElementById('oth-discord-input')||{}).value || '';
      var infoVal = ((document.getElementById('info-phrase-input')||{}).value||'').trim().toLowerCase();
      var canJoin = discord.trim() && infoVal === INFO_CODE;
      joinBtn.disabled = !canJoin;
      if (!canJoin) {
        joinBtn.classList.add('closed');
        if (!discord.trim()) joinBtn.textContent = 'Enter Discord name';
        else if (infoVal !== INFO_CODE) joinBtn.textContent = 'Incorrect Password';
        else joinBtn.textContent = '+ Join Queue';
      } else {
        joinBtn.disabled = false;
        joinBtn.classList.remove('closed');
        joinBtn.textContent = '+ Join Queue';
      }
    }
    wasInTopThree = false; wasFirst = false; return;
  }

  joinBtn.style.display = 'none';
  posEl.textContent = '#' + rank;

  if (idx === 0) {
    setCard(alertCard,'turn'); alertIcon.textContent='⚔️';
    alertTitle.textContent="It's your turn!";
    alertSub.innerHTML = (currentWorld ? 'Head to World: ' + currentWorld + ' now!' : 'Head over now!') + '<br>Please get ready!';
    if (!wasFirst) playAlert('turn');
    wasFirst = true; wasInTopThree = true; return;
  }
  if (idx <= 2) {
    setCard(alertCard,'soon'); alertIcon.textContent='⚠️';
    alertTitle.textContent='Get ready!';
    alertSub.innerHTML = currentWorld ? 'You are #' + rank + ' — head to World: ' + currentWorld + ' soon' : 'You are #' + rank + ' — up soon';
    if (!wasInTopThree) playAlert('soon');
    wasInTopThree = true; wasFirst = false; return;
  }
  setCard(alertCard,'waiting'); alertIcon.textContent='⏳';
  alertTitle.textContent='In queue'; alertSub.textContent='Position #' + rank + ' — wait for your turn';
  wasInTopThree = false; wasFirst = false;
}

function updateToggleOpenBtn() {
  var st = document.getElementById('ac-submissions-status');
  var btn = document.getElementById('ac-toggle-submissions');
  if (!st || !btn) return;
  if (submissionsOpen) {
    st.textContent='Open'; st.className='vgt-ac-status open';
    btn.textContent='Close'; btn.className='vgt-ac-btn toggle open-state';
  } else {
    st.textContent='Closed'; st.className='vgt-ac-status closed';
    btn.textContent='Open'; btn.className='vgt-ac-btn toggle';
  }
}

function updateQueueList(queue) {
  updateToggleOpenBtn();
  var listEl = document.getElementById('queue-list');
  var countEl = document.getElementById('queue-count');
  if (countEl) countEl.textContent = queue ? queue.length : 0;
  if (isDragging || listEl.querySelector('.vgt-queue-name.editing')) return;

  if (!queue) { listEl.innerHTML='<div class="vgt-queue-state">Failed to load queue.</div>'; return; }
  if (queue.length === 0) { listEl.innerHTML='<div class="vgt-queue-state">The queue is empty.</div>'; return; }

  var rsn = getPlayerRSN();
  var rsnLower = rsn ? rsn.toLowerCase() : '';
  var html = '';

  for (var i = 0; i < queue.length; i++) {
    var item = queue[i];
    var rank = i + 1;
    var isYou = item.rsn.toLowerCase() === rsnLower;
    var isFirst = rank === 1;
    var isTop3 = rank <= 3 && !isFirst;

    var cls = 'vgt-queue-item';
    if (isFirst) cls += ' first';
    if (isTop3)  cls += ' top3';
    if (isYou)   cls += ' is-you';

    var badge = '';

    var youTag = isYou ? '<span class="you-tag">YOU</span>' : '';
    var online = isOnline(item.rsn);
    var dotCls = online ? 'vgt-presence online' : 'vgt-presence offline';

    var adminBtns = '', dragHandle = '', draggableAttr = '', nameCls = 'vgt-queue-name';
    if (calibrated) {
      adminBtns = '<span class="vgt-admin-actions">' +
        '<button class="vgt-admin-action done" data-action="adminDone" data-rsn="' + escapeHtml(item.rsn) + '" title="Mark Done">✓</button>' +
        '<button class="vgt-admin-action skip" data-action="adminSkip" data-rsn="' + escapeHtml(item.rsn) + '" title="Mark Skip">✗</button>' +
        '<button class="vgt-admin-action ping" data-action="ping" data-rsn="' + escapeHtml(item.rsn) + '" title="Ping Player">♪</button>' +
        '</span>';
      dragHandle = '<span class="vgt-drag-handle" title="Drag to reorder">≡</span>';
      draggableAttr = ' draggable="true"';
      nameCls += ' editable';
    }

    var metaLine = '';
    var metaParts = [];
    if (item.discord_name) metaParts.push('<span style="color:#6b7280;">Discord:</span> ' + escapeHtml(item.discord_name));
    if (item.start_time) metaParts.push('<span style="color:#6b7280;">Time:</span> ' + escapeHtml(item.start_time) + ' – ' + escapeHtml(item.end_time));
    if (metaParts.length) metaLine = '<div class="oth-queue-meta">' + metaParts.join(' &nbsp;·&nbsp; ') + '</div>';

    var tagsLine = '';
    if (item.achievements && item.achievements.length > 0) {
      var tags = item.achievements.map(function(a) {
        return '<span class="oth-ach-tag">' + escapeHtml(a) + '</span>';
      }).join('');
      tagsLine = '<div class="oth-queue-tags">' + tags + '</div>';
    }

    html +=
      '<div class="' + cls + '" data-index="' + i + '"' + draggableAttr + '>' +
        dragHandle +
        '<span class="vgt-queue-rank">#' + rank + '</span>' +
        '<span class="' + dotCls + '"></span>' +
        '<span class="' + nameCls + '" data-original="' + escapeHtml(item.rsn) + '">' + escapeHtml(item.rsn) + youTag + '</span>' +
        badge + adminBtns +
        metaLine + tagsLine +
      '</div>';
  }
  listEl.innerHTML = html;
}

// ── Completed ─────────────────────────────────────────────────────

function updateCompletedPanel() {
  var btn = document.getElementById('completed-toggle');
  var listEl = document.getElementById('completed-list');
  if (!btn || !listEl) return;
  var arrow = btn.textContent.slice(-1);
  btn.textContent = calibrated ? 'Completed (' + completedData.length + ') ' + arrow : 'Completed ' + arrow;
  var s = (document.getElementById('completed-search')||{}).value || '';
  renderCompletedList(s);
}

function renderCompletedList(filter) {
  var listEl = document.getElementById('completed-list');
  if (!listEl) return;
  var filtered = completedData;
  if (filter) {
    var f = filter.toLowerCase();
    filtered = completedData.filter(function(item) { return item.rsn.toLowerCase().indexOf(f) !== -1; });
  }
  if (filtered.length === 0) { listEl.innerHTML='<div class="vgt-completed-item" style="color:var(--text-muted);">No results</div>'; return; }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var item = filtered[i];
    var achHtml = '';
    if (item.achievements && item.achievements.length > 0) {
      achHtml = '<div class="oth-queue-tags" style="margin-top:3px;">' +
        item.achievements.map(function(a) { return '<span class="oth-ach-tag">' + escapeHtml(a) + '</span>'; }).join('') +
        '</div>';
    }
    html += '<div class="vgt-completed-item">' + escapeHtml(item.rsn) + achHtml + '</div>';
  }
  listEl.innerHTML = html;
}

function showCompletedSuggestions(value) {
  var el = document.getElementById('completed-suggestions');
  if (!el) return;
  if (!value) { el.style.display='none'; return; }
  var v = value.toLowerCase();
  var matches = completedData.filter(function(item) { return item.rsn.toLowerCase().indexOf(v) !== -1; });
  if (matches.length === 0 || (matches.length === 1 && matches[0].rsn.toLowerCase() === v)) { el.style.display='none'; return; }
  var html = '';
  for (var i = 0; i < Math.min(matches.length, 8); i++)
    html += '<div class="vgt-completed-suggestion" data-name="' + escapeHtml(matches[i].rsn) + '">' + escapeHtml(matches[i].rsn) + '</div>';
  el.innerHTML = html; el.style.display = 'block';
}

function renderCompletedSidePanel(filter) {
  var listEl = document.getElementById('completed-side-list');
  if (!listEl) return;
  var filtered = completedData;
  if (filter) {
    var f = filter.toLowerCase();
    filtered = completedData.filter(function(item) { return item.rsn.toLowerCase().indexOf(f) !== -1; });
  }
  if (filtered.length === 0) { listEl.innerHTML='<div class="vgt-completed-side-empty">' + (filter ? 'No results' : 'No completed entries') + '</div>'; return; }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var ci = filtered[i];
    var achTags = '';
    if (ci.achievements && ci.achievements.length > 0) {
      achTags = '<div class="oth-queue-tags" style="margin-top:3px;flex-basis:100%;">' +
        ci.achievements.map(function(a) { return '<span class="oth-ach-tag">' + escapeHtml(a) + '</span>'; }).join('') +
        '</div>';
    }
    var discordLine = ci.discord_name
      ? '<div style="font-size:11px;color:#6b7280;margin-top:1px;"><span style="color:#6b7280;">Discord:</span> ' + escapeHtml(ci.discord_name) + '</div>'
      : '';
    html += '<div class="vgt-completed-side-item" style="flex-wrap:wrap;gap:2px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<span class="vgt-completed-side-name" data-original="' + escapeHtml(ci.rsn) + '">' + escapeHtml(ci.rsn) + '</span>' +
        discordLine +
      '</div>' +
      '<button class="vgt-completed-side-skip" data-rsn="' + escapeHtml(ci.rsn) + '" data-id="' + ci.id + '" title="Move to skipped">✗</button>' +
      (achTags ? '<div style="flex-basis:100%;padding-top:2px;">' + achTags + '</div>' : '') +
      '</div>';
  }
  listEl.innerHTML = html;
}

// ── Skipped ───────────────────────────────────────────────────────

function renderSkippedPanel() {
  var listEl = document.getElementById('skipped-list');
  if (!listEl) return;
  if (skippedData.length === 0) { listEl.innerHTML='<div class="vgt-skipped-empty">No skipped players</div>'; return; }
  var html = '';
  for (var i = 0; i < skippedData.length; i++) {
    var item = skippedData[i];
    var achTags = '';
    if (item.achievements && item.achievements.length > 0) {
      achTags = '<div class="oth-queue-tags" style="margin-top:4px;">' +
        item.achievements.map(function(a) { return '<span class="oth-ach-tag">' + escapeHtml(a) + '</span>'; }).join('') +
        '</div>';
    }
    var discordLine = item.discord_name
      ? '<div style="font-size:11px;color:#9aa0a6;margin-top:1px;">' + escapeHtml(item.discord_name) + '</div>'
      : '';
    html += '<div class="vgt-skipped-item" style="flex-wrap:wrap;gap:4px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<span class="vgt-skipped-name">' + escapeHtml(item.rsn) + '</span>' +
        discordLine +
      '</div>' +
      '<div style="display:flex;gap:4px;align-items:center;">' +
        '<button class="vgt-unskip-btn" data-rsn="' + escapeHtml(item.rsn) + '">Unskip</button>' +
        '<button class="vgt-skip-complete-btn" data-rsn="' + escapeHtml(item.rsn) + '">Complete</button>' +
      '</div>' +
      (achTags ? '<div style="flex-basis:100%;">' + achTags + '</div>' : '') +
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
  if (skippedPanelOpen) { panel.style.display='flex'; app.classList.add('panel-open'); fetchSkipped(); }
  else { panel.style.display='none'; app.classList.remove('panel-open'); }
}

function toggleCompletedSidePanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('completed-side-panel');
  var app = document.querySelector('.vgt-app');
  if (!panel || !app) return;
  completedSidePanelOpen = typeof show === 'boolean' ? show : !completedSidePanelOpen;
  if (completedSidePanelOpen) { panel.style.display='flex'; app.classList.add('panel-open-left'); renderCompletedSidePanel(); }
  else { panel.style.display='none'; app.classList.remove('panel-open-left'); }
}

function toggleAdminControlsPanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('admin-controls-panel');
  var cp = document.getElementById('completed-side-panel');
  if (!panel) return;
  adminControlsPanelOpen = typeof show === 'boolean' ? show : !adminControlsPanelOpen;
  if (adminControlsPanelOpen) {
    panel.style.display='flex';
    if (cp) cp.classList.add('has-neighbor-left');
    var wi = document.getElementById('ac-world-input'); if (wi) wi.value = currentWorld;
    updateToggleOpenBtn(); updateSessionDisplay();
  } else {
    panel.style.display='none';
    if (cp) cp.classList.remove('has-neighbor-left');
  }
}

function toggleChatPanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('chat-panel');
  var sp = document.getElementById('skipped-panel');
  if (!panel) return;
  chatPanelOpen = typeof show === 'boolean' ? show : !chatPanelOpen;
  if (chatPanelOpen) { panel.style.display='flex'; if (sp) sp.classList.add('has-neighbor-right'); fetchAdminChat(); }
  else { panel.style.display='none'; if (sp) sp.classList.remove('has-neighbor-right'); }
}

function toggleInfoSidePanel(show) {
  if (!document.body.classList.contains('browser-view')) return;
  var panel = document.getElementById('info-side-panel');
  var app = document.querySelector('.vgt-app');
  if (!panel) return;
  if (show) { panel.style.display='flex'; if (app) app.classList.add('panel-open'); }
  else { panel.style.display='none'; if (app && !skippedPanelOpen) app.classList.remove('panel-open'); }
}

// ── Session ───────────────────────────────────────────────────────

function updateSessionDisplay() {
  var st = document.getElementById('ac-session-status');
  var ct = document.getElementById('ac-session-count');
  var sb2 = document.getElementById('ac-session-start');
  var eb = document.getElementById('ac-session-end');
  if (!ct) return;
  ct.textContent = 'Completions: ' + sessionKillCount;
  if (sessionActive) {
    if (st) { st.textContent='Active'; st.className='vgt-ac-status active'; }
    if (sb2) sb2.style.display='none'; if (eb) eb.style.display='';
  } else {
    if (st) { st.textContent='Inactive'; st.className='vgt-ac-status inactive'; }
    if (sb2) sb2.style.display=''; if (eb) eb.style.display='none';
  }
}

// ── Blacklist ─────────────────────────────────────────────────────

function checkBanned() {
  var rsn = getPlayerRSN().toLowerCase();
  var banned = rsn && blacklist.indexOf(rsn) !== -1;
  var bo = document.getElementById('banned-overlay'); if (bo) bo.style.display = banned ? 'flex' : 'none';
  var jb = document.getElementById('join-queue-btn'); if (jb) jb.style.display = banned ? 'none' : '';
}

function renderBlacklistPanel() {
  var list = document.getElementById('ac-blacklist-list');
  if (!list) return;
  if (blacklist.length === 0) { list.innerHTML='<div style="color:#666;font-size:12px;padding:4px 0;">No banned players</div>'; return; }
  list.innerHTML = blacklist.map(function(n) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:13px;">' +
      '<span style="color:#eee;">' + escapeHtml(n) + '</span>' +
      '<button onclick="unbanPlayer(\'' + escapeHtml(n) + '\')" style="background:#c0392b;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Unban</button>' +
      '</div>';
  }).join('');
}

function unbanPlayer(name) {
  if (!superCalibrated) return;
  sb.rpc('super_admin_remove_blacklist', { pass: superAdminPass, player_name: name })
    .then(function(res) { if (!res.error) fetchBlacklist(); });
}

// ── Audio ─────────────────────────────────────────────────────────

function playAlert(type) {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = new AC(); var osc = ctx.createOscillator(); var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    var t = ctx.currentTime;
    if (type === 'turn') {
      osc.frequency.setValueAtTime(660,t); osc.frequency.setValueAtTime(880,t+.12); osc.frequency.setValueAtTime(1100,t+.24);
      gain.gain.setValueAtTime(.28,t); gain.gain.exponentialRampToValueAtTime(.001,t+.55);
      osc.start(t); osc.stop(t+.55);
    } else {
      osc.frequency.setValueAtTime(660,t); osc.frequency.setValueAtTime(880,t+.15);
      gain.gain.setValueAtTime(.18,t); gain.gain.exponentialRampToValueAtTime(.001,t+.40);
      osc.start(t); osc.stop(t+.40);
    }
  } catch (e) {}
}

// ── Dot / time helpers ────────────────────────────────────────────

function setDot(status) { var d = document.getElementById('vgt-dot'); if (d) d.className = 'vgt-status-dot ' + status; }
function updateTimestamp() { var el = document.getElementById('last-updated'); if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString(); }
function isOnline(name) {
  var ts = heartbeatData[name.toLowerCase()];
  if (!ts) return false;
  var t = new Date(ts).getTime();
  return !isNaN(t) && (Date.now() - t) < ONLINE_THRESHOLD_MS;
}

function updateSubmissionsStatus() {
  var el = document.getElementById('submissions-status');
  if (!el) return;
  if (submissionsOpen) { el.textContent='Submissions open'; el.className='vgt-submissions-status open'; }
  else { el.textContent='Submissions closed'; el.className='vgt-submissions-status closed'; }
}

// ── Admin chat ────────────────────────────────────────────────────

async function fetchAdminChat() {
  try {
    var result = await sb.from('admin_chat').select('*').order('created_at',{ascending:true}).limit(100);
    if (result.error) throw result.error;
    chatMessages = result.data || [];
    renderChatMessages();
  } catch (err) { console.warn('[OTHER] fetchAdminChat failed:', err); }
}

function renderChatMessages() {
  var el = document.getElementById('chat-messages');
  if (!el) return;
  if (chatMessages.length === 0) { el.innerHTML='<div class="vgt-chat-empty">No messages yet</div>'; return; }
  var html = '';
  for (var i = 0; i < chatMessages.length; i++) {
    var m = chatMessages[i];
    var time = '';
    try { time = new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); } catch(e) {}
    html += '<div class="vgt-chat-msg">' +
      '<span class="vgt-chat-msg-time">' + escapeHtml(time) + '</span>' +
      (calibrated ? '<button class="vgt-chat-delete-btn" data-id="' + m.id + '" title="Delete">✕</button>' : '') +
      '<span class="vgt-chat-msg-name">' + escapeHtml(m.sender||'Admin') + '</span>' +
      '<div class="vgt-chat-msg-text">' + escapeHtml(m.message) + '</div></div>';
  }
  el.innerHTML = html; el.scrollTop = el.scrollHeight;
}

async function sendChatMessage() {
  var input = document.getElementById('chat-input');
  var msg = input.value.trim();
  if (!msg || !calibrated) return;
  var sender = adminName || localStorage.getItem('admin_display_name') || getPlayerRSN() || 'Admin';
  var btn = document.getElementById('chat-send-btn');
  btn.disabled = true; input.disabled = true;
  try {
    var result = await sb.rpc('other_send_admin_chat', { pass: adminPass, msg: msg, sender_name: sender });
    if (result.error) throw result.error;
    input.value = '';
  } catch (err) { console.warn('[OTHER] sendChatMessage failed:', err); }
  btn.disabled = false; input.disabled = false; input.focus();
}

// ── Queue actions ─────────────────────────────────────────────────

function showCompleteModal(rsn, achievements, btnEl) {
  completePendingRSN = rsn;
  completePendingBtn = btnEl;
  var titleEl = document.getElementById('complete-modal-title');
  var achEl   = document.getElementById('complete-modal-achievements');
  if (titleEl) titleEl.textContent = 'Mark Done — ' + rsn;
  if (achEl) {
    if (!achievements || achievements.length === 0) {
      achEl.innerHTML = '<div style="color:#9aa0a6;font-size:12px;padding:4px 0;">No achievements tracked — will move to completed.</div>';
    } else {
      achEl.innerHTML = achievements.map(function(a) {
        return '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;cursor:pointer;color:#dde1e7;">' +
          '<input type="checkbox" class="complete-ach-cb" value="' + escapeHtml(a) + '" checked ' +
          'style="accent-color:#e8a800;width:15px;height:15px;flex-shrink:0;cursor:pointer;" />' +
          escapeHtml(a) + '</label>';
      }).join('');
    }
  }
  document.getElementById('complete-modal').style.display = 'flex';
}

async function runAction(action, rsn, btnEl) {
  if (!calibrated) return;
  btnEl.disabled = true;
  if (action === 'adminDone') {
    var item = null;
    for (var i = 0; i < queueData.length; i++) {
      if (queueData[i].rsn.toLowerCase() === rsn.toLowerCase()) { item = queueData[i]; break; }
    }
    showCompleteModal(rsn, item ? item.achievements : [], btnEl);
    return;
  }
  try {
    var result;
    if (action === 'adminSkip') {
      result = await sb.rpc('other_admin_skip', { pass: adminPass, p_rsn: rsn });
    } else if (action === 'ping') {
      result = await sb.rpc('other_admin_ping', { pass: adminPass, target: rsn });
    }
    if (result.error) throw result.error;
    btnEl.textContent = '✓';
    onRealtimeChange();
  } catch (err) {
    console.warn('[OTHER] Action failed:', err);
    btnEl.textContent = '!'; btnEl.disabled = false;
  }
}

// ── Join Queue ────────────────────────────────────────────────────

var lastSubmittedRSN = '';
var lastSubmitTime = 0;

async function joinQueue() {
  var rsn = getPlayerRSN();
  var discordEl = document.getElementById('oth-discord-input');
  var discord = discordEl ? discordEl.value.trim() : '';
  var startTime = (document.getElementById('oth-start-time')||{}).value || '';
  var endTime = (document.getElementById('oth-end-time')||{}).value || '';
  var achievements = getSelectedAchievements();
  var infoVal = ((document.getElementById('info-phrase-input')||{}).value||'').trim().toLowerCase();

  if (!rsn || !discord) return;
  if (blacklist.indexOf(rsn.toLowerCase()) !== -1) return;
  if (infoVal !== INFO_CODE) return;

  var btn = document.getElementById('join-queue-btn');

  if (rsn.toLowerCase() === lastSubmittedRSN.toLowerCase() && Date.now() - lastSubmitTime < 30000) {
    btn.textContent='Already submitted'; btn.disabled=true; btn.classList.add('submitted');
    setTimeout(function() { btn.textContent='+ Join Queue'; btn.disabled=false; btn.classList.remove('submitted'); }, 3000);
    return;
  }

  btn.disabled=true; btn.textContent='Submitting...';
  try {
    var result = await sb.rpc('other_join_queue', {
      p_rsn: rsn, p_discord: discord, p_start_time: startTime,
      p_end_time: endTime, p_achievements: achievements, p_info_code: infoVal
    });
    if (result.error) throw result.error;
    var data = result.data;
    if (data === 'ok' || data === null) {
      btn.textContent='✓ Joined queue!';
      lastSubmittedRSN = rsn; lastSubmitTime = Date.now();
      try {
        localStorage.setItem('oth_playerDiscord', discord);
        localStorage.setItem('oth_playerStartTime', startTime);
        localStorage.setItem('oth_playerEndTime', endTime);
        localStorage.setItem('oth_playerAchievements', JSON.stringify(achievements));
      } catch(e) {}
    } else if (data === 'already_queued') { btn.textContent='Already in queue'; }
    else if (data === 'closed') { btn.textContent='Submissions closed'; }
    else if (data === 'banned') { btn.textContent='You are banned'; }
    else if (data === 'wrong_code') { btn.textContent='✗ Incorrect password'; }
    else { btn.textContent='✗ Failed — try again'; }
  } catch(e) {
    console.warn('[OTHER] joinQueue error:', e); btn.textContent='✗ Error — try again';
  }
  btn.classList.add('submitted');
  setTimeout(function() { btn.textContent='+ Join Queue'; btn.disabled=false; btn.classList.remove('submitted'); refresh(); }, 4000);
}

// ── Refresh ───────────────────────────────────────────────────────

async function refresh() {
  setDot('loading');
  var fetches = [fetchQueue(), fetchSubmissionsOpen(), fetchHeartbeats(), fetchWorld(), fetchPings(), fetchStats(), fetchInfoCode(), fetchBlacklist(), fetchHiddenState()];
  if (calibrated) { fetches.push(fetchSessionState()); fetches.push(fetchSkipped()); }
  var results = await Promise.all(fetches);
  var queue = results[0];
  setDot(queue ? 'connected' : 'error');
  updateSubmissionsStatus();
  updateStatus(queue);
  updateQueueList(queue);
  updateTimestamp();
}

function onRealtimeChange() {
  clearTimeout(realtimeDebounce);
  realtimeDebounce = setTimeout(refresh, 300);
}

function setupRealtime() {
  sb.channel('oth-realtime')
    .on('postgres_changes',{event:'*',schema:'public',table:'other_queue'},onRealtimeChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'other_app_state'},onRealtimeChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'other_skipped'},function() { fetchCompleted(); onRealtimeChange(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'blacklist'},function() { fetchBlacklist(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'other_completed'},function() { fetchCompleted(); onRealtimeChange(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'pings'},function() { fetchPings(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'heartbeats'},function() { fetchHeartbeats(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'admin_chat'},function() { if (chatPanelOpen) fetchAdminChat(); })
    .subscribe();
}

// ── Init ──────────────────────────────────────────────────────────

function init() {
  try {
    var sRSN = localStorage.getItem('oth_playerRSN');
    if (sRSN) { var el = document.getElementById('oth-rsn-input'); if (el) el.value = sRSN.trim(); }
    var sDisc = localStorage.getItem('oth_playerDiscord');
    if (sDisc) { var el2 = document.getElementById('oth-discord-input'); if (el2) el2.value = sDisc.trim(); }
    var sStart = localStorage.getItem('oth_playerStartTime') || '00:00';
    var sEnd   = localStorage.getItem('oth_playerEndTime')   || '23:30';
    generateTimeOptions(document.getElementById('oth-start-time'), sStart);
    generateTimeOptions(document.getElementById('oth-end-time'),   sEnd);
    var sAchs = localStorage.getItem('oth_playerAchievements');
    if (sAchs) {
      try {
        var achs = JSON.parse(sAchs);
        document.querySelectorAll('.oth-achievement-checkbox').forEach(function(cb) {
          if (achs.indexOf(cb.value) !== -1) cb.checked = true;
        });
      } catch(e) {}
    }
  } catch(e) {}

  // Reminder toggle
  var rt = document.getElementById('reminder-toggle');
  var savedR = localStorage.getItem('oth_remindersEnabled');
  if (savedR !== null) rt.checked = savedR === 'true';
  window.VGT_remindersEnabled = rt.checked;
  rt.addEventListener('change', function() {
    window.VGT_remindersEnabled = this.checked;
    localStorage.setItem('oth_remindersEnabled', this.checked);
  });

  // Tab switching
  function updateSwitchBtnTab(tabName) {
    document.querySelectorAll('.vgt-game-dropdown a').forEach(function(a) {
      var base = a.getAttribute('href').split('?')[0];
      a.setAttribute('href', base + '?tab=' + tabName);
    });
  }

  function switchToTab(tabName) {
    document.querySelectorAll('.vgt-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.vgt-page').forEach(function(p) { p.classList.remove('active'); });
    var tb = document.querySelector('.vgt-tab[data-tab="' + tabName + '"]'); if (tb) tb.classList.add('active');
    var pg = document.getElementById('tab-' + tabName); if (pg) pg.classList.add('active');
    try { localStorage.setItem('oth_activeTab', tabName); } catch(e) {}
    updateSwitchBtnTab(tabName);
    if (calibrated && tabName === 'queue') {
      toggleAdminControlsPanel(true); toggleSkippedPanel(true); toggleCompletedSidePanel(true); toggleChatPanel(true);
    } else {
      toggleAdminControlsPanel(false); toggleSkippedPanel(false); toggleCompletedSidePanel(false); toggleChatPanel(false);
    }
    toggleInfoSidePanel(tabName === 'info');
  }

  document.querySelectorAll('.vgt-tab').forEach(function(tab) {
    tab.addEventListener('click', function() { switchToTab(tab.dataset.tab); });
  });

  var urlTab = new URLSearchParams(window.location.search).get('tab');
  var savedTab = urlTab || localStorage.getItem('oth_activeTab') || 'info';
  switchToTab(savedTab);

  // Form inputs
  document.getElementById('oth-rsn-input').addEventListener('input', function() {
    try { localStorage.setItem('oth_playerRSN', this.value.trim()); } catch(e) {}
    updateStatus(queueData); updateQueueList(queueData); checkBanned();
  });

  document.getElementById('oth-discord-input').addEventListener('input', function() {
    try { localStorage.setItem('oth_playerDiscord', this.value.trim()); } catch(e) {}
    updateStatus(queueData);
  });

  document.getElementById('oth-start-time').addEventListener('change', function() {
    try { localStorage.setItem('oth_playerStartTime', this.value); } catch(e) {}
    updateStatus(queueData);
  });

  document.getElementById('oth-end-time').addEventListener('change', function() {
    try { localStorage.setItem('oth_playerEndTime', this.value); } catch(e) {}
    updateStatus(queueData);
  });

  document.querySelectorAll('.oth-achievement-checkbox').forEach(function(cb) {
    cb.addEventListener('change', function() {
      try { localStorage.setItem('oth_playerAchievements', JSON.stringify(getSelectedAchievements())); } catch(e) {}
      updateStatus(queueData);
    });
  });

  document.getElementById('info-phrase-input').addEventListener('input', function() { updateStatus(queueData); });
  document.getElementById('join-queue-btn').addEventListener('click', joinQueue);
  document.getElementById('refresh-btn').addEventListener('click', refresh);
  document.getElementById('refresh-btn-queue').addEventListener('click', refresh);

  refresh();
  fetchCompleted();
  setupRealtime();
  setInterval(refresh, 10000);
  setInterval(fetchCompleted, 10000);
  setInterval(function() { if (chatPanelOpen) fetchAdminChat(); }, 5000);
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

  // ── Admin helpers ────────────────────────────────────────────────
  function activateAdmin(pass, displayName) {
    calibrated = true; adminPass = pass;
    if (displayName) adminName = displayName;
    try { localStorage.setItem('oth_adminPass', pass); localStorage.setItem('oth_adminExpiry', String(Date.now() + 7*24*60*60*1000)); if (displayName) localStorage.setItem('admin_display_name', displayName); } catch(e) {}
    var ab = document.getElementById('admin-btn'); ab.textContent='Admin ✓'; ab.classList.add('active');
    updateQueueList(queueData);
    var at = document.querySelector('.vgt-tab.active');
    if (at && at.dataset.tab === 'queue') { toggleAdminControlsPanel(true); toggleSkippedPanel(true); toggleCompletedSidePanel(true); toggleChatPanel(true); }
    fetchSessionState(); updateToggleOpenBtn();
    var qtc = document.getElementById('queue-total-carries'); if (qtc) qtc.style.display='';
    applyHiddenState();
  }

  function deactivateAdmin() {
    calibrated = false; adminPass = ''; adminName = '';
    deactivateSuperAdmin();
    try { localStorage.removeItem('oth_adminPass'); localStorage.removeItem('oth_adminExpiry'); } catch(e) {}
    var ab = document.getElementById('admin-btn'); ab.textContent='Admin'; ab.classList.remove('active');
    applyHiddenState();
    toggleAdminControlsPanel(false); toggleSkippedPanel(false); toggleCompletedSidePanel(false); toggleChatPanel(false);
    updateQueueList(queueData);
    var qtc = document.getElementById('queue-total-carries'); if (qtc) qtc.style.display='none';
  }

  function activateSuperAdmin(pass) {
    superCalibrated = true; superAdminPass = pass;
    try { localStorage.setItem('vgt_superPass', pass); localStorage.setItem('vgt_superExpiry', String(Date.now() + 7*24*60*60*1000)); } catch(e) {}
    var s = document.getElementById('ac-blacklist-section'); if (s) s.style.display='';
    if (!calibrated) { var ab = document.getElementById('admin-btn'); if (ab) { ab.textContent='Admin ✓'; ab.classList.add('active'); } toggleAdminControlsPanel(true); }
    fetchBlacklist();
  }

  function deactivateSuperAdmin() {
    superCalibrated = false; superAdminPass = '';
    try { localStorage.removeItem('vgt_superPass'); localStorage.removeItem('vgt_superExpiry'); } catch(e) {}
    var s = document.getElementById('ac-blacklist-section'); if (s) s.style.display='none';
    if (!calibrated) { var ab = document.getElementById('admin-btn'); if (ab) { ab.textContent='Admin'; ab.classList.remove('active'); } toggleAdminControlsPanel(false); }
  }

  // Blacklist ban
  var blInput = document.getElementById('ac-blacklist-input');
  var blBtn = document.getElementById('ac-blacklist-add-btn');
  if (blBtn) {
    blBtn.addEventListener('click', function() {
      if (!superCalibrated) return;
      var n = blInput ? blInput.value.trim() : ''; if (!n) return;
      sb.rpc('super_admin_add_blacklist', { pass: superAdminPass, player_name: n })
        .then(function(res) { if (!res.error) { if (blInput) blInput.value=''; fetchBlacklist(); } });
    });
  }

  // Manual complete / add to queue
  var mcInput  = document.getElementById('ac-manual-complete-input');
  var mdInput  = document.getElementById('ac-manual-discord-input');
  var mcBtn    = document.getElementById('ac-manual-complete-btn');

  function getAcAchievements() {
    var cbs = document.querySelectorAll('.ac-ach-cb:checked');
    var out = []; for (var i = 0; i < cbs.length; i++) out.push(cbs[i].value); return out;
  }
  function clearAcFields() {
    if (mcInput) mcInput.value = '';
    if (mdInput) mdInput.value = '';
    document.querySelectorAll('.ac-ach-cb').forEach(function(cb) { cb.checked = false; });
  }

  if (mcBtn) {
    var doManualComplete = async function() {
      if (!calibrated) return;
      var n = mcInput ? mcInput.value.trim() : ''; if (!n) return;
      var d = mdInput ? mdInput.value.trim() : '';
      var a = getAcAchievements();
      mcBtn.disabled=true; mcBtn.textContent='...';
      try {
        var r = await sb.rpc('other_admin_add_to_completed', { pass: adminPass, p_rsn: n, p_discord: d, p_achievements: a });
        if (r.error) throw r.error;
        clearAcFields();
        mcBtn.textContent='✓ Done';
        fetchCompleted(); onRealtimeChange();
        setTimeout(function() { mcBtn.textContent='Complete'; mcBtn.disabled=false; }, 2000);
      } catch(err) { console.warn('[OTHER] manual complete failed:', err); mcBtn.textContent='!'; mcBtn.disabled=false; }
    };
    mcBtn.addEventListener('click', doManualComplete);
    if (mcInput) mcInput.addEventListener('keydown', function(e) { if (e.key==='Enter') doManualComplete(); });
  }

  // Manual add to queue
  var mqBtn = document.getElementById('ac-manual-queue-btn');
  if (mqBtn) {
    mqBtn.addEventListener('click', async function() {
      if (!calibrated) return;
      var n = mcInput ? mcInput.value.trim() : ''; if (!n) return;
      var d = mdInput ? mdInput.value.trim() : '';
      var a = getAcAchievements();
      mqBtn.disabled=true; mqBtn.textContent='...';
      try {
        var r = await sb.rpc('other_admin_add_to_queue', { pass: adminPass, p_rsn: n, p_discord: d, p_achievements: a });
        if (r.error) throw r.error;
        clearAcFields();
        mqBtn.textContent='✓ Done';
        onRealtimeChange();
        setTimeout(function() { mqBtn.textContent='Add to Queue'; mqBtn.disabled=false; }, 2000);
      } catch(err) { console.warn('[OTHER] manual queue add failed:', err); mqBtn.textContent='!'; mqBtn.disabled=false; }
    });
  }

  // Toggle hidden
  var thBtn = document.getElementById('ac-toggle-hidden');
  if (thBtn) {
    thBtn.addEventListener('click', async function() {
      if (!calibrated) { this.textContent='Not admin!'; var s=this; setTimeout(function(){updateHiddenBtn();},1500); return; }
      var btn=this; btn.disabled=true; btn.textContent='...';
      try {
        var r = await sb.rpc('other_admin_toggle_hidden', { pass: adminPass });
        if (r.error) throw r.error;
        otherHidden = r.data === 'true';
        updateHiddenBtn();
      } catch(err) {
        console.warn('[OTHER] toggle hidden failed:', err);
        btn.textContent='Error: '+(err.message||err.code||'unknown');
        setTimeout(function(){updateHiddenBtn();btn.disabled=false;},3000); return;
      }
      btn.disabled=false;
    });
  }

  // Auto-login: try global admin session
  try {
    var vgtPass = localStorage.getItem('vgt_adminPass');
    var savedAdminName = localStorage.getItem('admin_display_name');
    var vgtExpiry = parseInt(localStorage.getItem('vgt_adminExpiry'),10);
    if (vgtPass && vgtExpiry && Date.now() < vgtExpiry) {
      sb.rpc('check_other_admin',{pass:vgtPass}).then(function(r) {
        if (r.data===true && !calibrated) {
          activateAdmin(vgtPass, savedAdminName);
          sb.rpc('check_super_admin',{pass:vgtPass}).then(function(r2) { if (r2.data===true) activateSuperAdmin(vgtPass); });
        }
      });
    }
  } catch(e) {}

  // Auto-login: try Other-specific session
  try {
    var othPass = localStorage.getItem('oth_adminPass');
    var othAdminName = localStorage.getItem('admin_display_name');
    var othExpiry = parseInt(localStorage.getItem('oth_adminExpiry'),10);
    if (othPass && othExpiry && Date.now() < othExpiry) {
      sb.rpc('check_other_admin',{pass:othPass}).then(function(r) {
        if (r.data===true && !calibrated) activateAdmin(othPass, othAdminName);
      });
    }
  } catch(e) {}

  // Admin login button
  var adminBtn       = document.getElementById('admin-btn');
  var adminOverlay   = document.getElementById('admin-overlay');
  var adminPassInput = document.getElementById('admin-pass-input');
  var adminLoginBtn  = document.getElementById('admin-login-btn');
  var adminCancelBtn = document.getElementById('admin-cancel-btn');
  var adminError     = document.getElementById('admin-error');

  adminBtn.addEventListener('click', function() {
    if (calibrated) { deactivateAdmin(); return; }
    var adminNameInput = document.getElementById('admin-name-input');
    if (adminNameInput) adminNameInput.value = '';
    adminOverlay.style.display='flex'; adminPassInput.value=''; adminError.style.display='none';
    if (adminNameInput) adminNameInput.focus(); else adminPassInput.focus();
  });
  adminCancelBtn.addEventListener('click', function() { adminOverlay.style.display='none'; });

  async function attemptCalibration() {
    var adminNameInput = document.getElementById('admin-name-input');
    var enteredName = adminNameInput ? adminNameInput.value.trim() : '';
    var enteredPass = adminPassInput.value.trim();
    if (!enteredName || !enteredPass) {
      adminError.textContent='Enter your name and passcode'; adminError.style.display='block'; return;
    }
    adminLoginBtn.disabled=true;
    try {
      var result = await sb.rpc('login_admin', {
        p_name: enteredName,
        p_passcode: enteredPass,
        p_required_roles: ['vorkath_misc', 'admin', 'super_admin']
      });
      if (result.error) throw result.error;
      if (result.data && result.data.valid) {
        var credential = enteredName + '|' + enteredPass;
        activateAdmin(credential, result.data.display_name);
        adminOverlay.style.display='none';
        if (adminNameInput) adminNameInput.value='';
        adminPassInput.value='';
        if (result.data.is_super) activateSuperAdmin(credential);
      } else {
        adminError.textContent='Invalid name or passcode'; adminError.style.display='block';
      }
    } catch(err) { adminError.textContent='Could not verify — retry'; adminError.style.display='block'; }
    adminLoginBtn.disabled=false;
  }

  adminLoginBtn.addEventListener('click', attemptCalibration);
  adminPassInput.addEventListener('keydown', function(e) {
    if (e.key==='Enter') attemptCalibration();
    if (e.key==='Escape') adminOverlay.style.display='none';
  });
  var adminNameInputEl = document.getElementById('admin-name-input');
  if (adminNameInputEl) {
    adminNameInputEl.addEventListener('keydown', function(e) {
      if (e.key==='Enter') { var pi=document.getElementById('admin-pass-input'); if(pi) pi.focus(); }
      if (e.key==='Escape') adminOverlay.style.display='none';
    });
  }

  // Achievement completion modal
  document.getElementById('complete-modal-cancel').addEventListener('click', function() {
    document.getElementById('complete-modal').style.display = 'none';
    if (completePendingBtn) { completePendingBtn.disabled = false; completePendingBtn = null; }
    completePendingRSN = '';
  });

  document.getElementById('complete-modal-confirm').addEventListener('click', async function() {
    var rsn = completePendingRSN;
    if (!rsn || !calibrated) return;
    var doneAchs = [];
    document.querySelectorAll('#complete-modal-achievements .complete-ach-cb:checked').forEach(function(cb) {
      doneAchs.push(cb.value);
    });
    var confirmBtn = this;
    confirmBtn.disabled = true; confirmBtn.textContent = '...';
    document.getElementById('complete-modal').style.display = 'none';
    try {
      var result = await sb.rpc('other_admin_partial_complete', {
        pass: adminPass, p_rsn: rsn,
        done_achievements: doneAchs, increment_session: sessionActive
      });
      if (result.error) throw result.error;
      if (doneAchs.length > 0 && sessionActive) { sessionKillCount += doneAchs.length; updateSessionDisplay(); }
      if (result.data === 'completed') fetchCompleted();
      onRealtimeChange();
      if (completePendingBtn) { completePendingBtn.textContent = '✓'; completePendingBtn.disabled = false; }
    } catch(err) {
      console.warn('[OTHER] partial complete failed:', err);
      if (completePendingBtn) { completePendingBtn.textContent = '!'; completePendingBtn.disabled = false; }
    }
    confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm';
    completePendingBtn = null; completePendingRSN = '';
  });

  // Queue action delegation
  var queueListEl = document.getElementById('queue-list');
  queueListEl.addEventListener('click', function(e) {
    if (!calibrated) return;
    var btn = e.target.closest('.vgt-admin-action');
    if (btn && !btn.disabled) {
      var action = btn.getAttribute('data-action');
      var rsn    = btn.getAttribute('data-rsn');
      if (action && rsn) runAction(action, rsn, btn);
      return;
    }
    // Inline name editing
    var nameEl = e.target.closest('.vgt-queue-name.editable');
    if (nameEl && !nameEl.classList.contains('editing')) {
      var original = nameEl.getAttribute('data-original');
      nameEl.classList.add('editing');
      var input = document.createElement('input');
      input.className='vgt-queue-name-input'; input.type='text'; input.value=original;
      input.setAttribute('autocomplete','off'); input.setAttribute('spellcheck','false');
      input.setAttribute('data-lpignore','true'); input.setAttribute('data-1p-ignore','true');
      nameEl.textContent=''; nameEl.appendChild(input); input.focus(); input.select();
      var saved=false, blurTimeout=null;
      function saveEdit() {
        if (saved) return; saved=true;
        if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout=null; }
        var newName = input.value.trim();
        if (newName && newName !== original) {
          nameEl.textContent=newName; nameEl.classList.remove('editing');
          sb.rpc('other_admin_edit_name',{pass:adminPass,old_rsn:original,new_rsn:newName})
            .catch(function(err){console.warn('[OTHER] edit name failed:',err);});
        } else { nameEl.textContent=original; nameEl.classList.remove('editing'); }
      }
      input.addEventListener('blur',function(){ blurTimeout=setTimeout(saveEdit,150); });
      input.addEventListener('focus',function(){ if(blurTimeout){clearTimeout(blurTimeout);blurTimeout=null;} });
      input.addEventListener('keydown',function(ev) {
        if(ev.key==='Enter'){ev.preventDefault();saveEdit();}
        if(ev.key==='Escape'){saved=true;if(blurTimeout){clearTimeout(blurTimeout);blurTimeout=null;}nameEl.textContent=original;nameEl.classList.remove('editing');}
      });
    }
  });

  // Drag-and-drop
  queueListEl.addEventListener('dragstart',function(e) {
    var item=e.target.closest('.vgt-queue-item[draggable="true"]');
    if(!item||!calibrated) return;
    dragSrcIndex=parseInt(item.getAttribute('data-index'),10); isDragging=true;
    item.classList.add('vgt-dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',''+dragSrcIndex);
  });
  queueListEl.addEventListener('dragover',function(e) {
    e.preventDefault(); e.dataTransfer.dropEffect='move';
    var item=e.target.closest('.vgt-queue-item'); if(!item) return;
    var items=queueListEl.querySelectorAll('.vgt-queue-item');
    for(var i=0;i<items.length;i++) items[i].classList.remove('vgt-drop-above','vgt-drop-below');
    var idx=parseInt(item.getAttribute('data-index'),10);
    var rect=item.getBoundingClientRect(); var midY=rect.top+rect.height/2;
    if(e.clientY<midY){item.classList.add('vgt-drop-above');dragOverIndex=idx;}
    else{item.classList.add('vgt-drop-below');dragOverIndex=idx+1;}
  });
  queueListEl.addEventListener('dragleave',function(e) {
    var item=e.target.closest('.vgt-queue-item');
    if(item) item.classList.remove('vgt-drop-above','vgt-drop-below');
  });
  queueListEl.addEventListener('dragend',function() {
    isDragging=false; dragSrcIndex=-1; dragOverIndex=-1;
    var items=queueListEl.querySelectorAll('.vgt-queue-item');
    for(var i=0;i<items.length;i++) items[i].classList.remove('vgt-dragging','vgt-drop-above','vgt-drop-below');
  });
  queueListEl.addEventListener('drop',function(e) {
    e.preventDefault();
    var targetIdx=dragOverIndex, srcIdx=dragSrcIndex;
    isDragging=false; dragSrcIndex=-1; dragOverIndex=-1;
    var items=queueListEl.querySelectorAll('.vgt-queue-item');
    for(var i=0;i<items.length;i++) items[i].classList.remove('vgt-dragging','vgt-drop-above','vgt-drop-below');
    if(srcIdx===-1||targetIdx===-1||srcIdx===targetIdx) return;
    if(targetIdx>srcIdx) targetIdx--;
    if(srcIdx===targetIdx) return;
    var moved=queueData[srcIdx]; queueData.splice(srcIdx,1); queueData.splice(targetIdx,0,moved);
    updateQueueList(queueData);
    clearTimeout(realtimeDebounce);
    var rsns=queueData.map(function(item){return item.rsn;});
    sb.rpc('other_admin_reorder_queue',{pass:adminPass,rsns:rsns})
      .then(function(res){if(res.error){console.warn('[OTHER] reorder failed:',res.error);refresh();}})
      .catch(function(err){console.warn('[OTHER] reorder failed:',err);refresh();});
  });

  // Admin controls buttons
  document.getElementById('ac-toggle-submissions').addEventListener('click', async function() {
    if (!calibrated) return;
    var btn = this;
    btn.disabled = true;
    try {
      var result = await sb.rpc('other_admin_toggle_submissions', { pass: adminPass });
      if (result.error) throw result.error;
      submissionsOpen = result.data === 'true';
      updateToggleOpenBtn();
      updateSubmissionsStatus();
    } catch (err) {
      console.warn('[OTHER] Failed to toggle submissions:', err);
    }
    btn.disabled = false;
  });

  document.getElementById('ac-session-start').addEventListener('click',async function() {
    if(!calibrated) return; this.disabled=true;
    try {
      var r=await sb.rpc('other_admin_session_start',{pass:adminPass});
      if(r.error) throw r.error; sessionActive=true; sessionKillCount=0; updateSessionDisplay();
    } catch(err){console.warn('[OTHER] session start failed:',err);}
    this.disabled=false;
  });
  document.getElementById('ac-session-end').addEventListener('click',async function() {
    if(!calibrated) return; this.disabled=true;
    try {
      var r=await sb.rpc('other_admin_session_end',{pass:adminPass});
      if(r.error) throw r.error; sessionActive=false; updateSessionDisplay();
    } catch(err){console.warn('[OTHER] session end failed:',err);}
    this.disabled=false;
  });

  var worldDebounce=null;
  document.getElementById('ac-world-input').addEventListener('input',function() {
    var val=this.value.trim(); clearTimeout(worldDebounce);
    worldDebounce=setTimeout(function() {
      if(!calibrated) return;
      currentWorld=val; var el=document.getElementById('vgt-world'); if(el) el.textContent=val?'World: '+val:'';
      sb.rpc('other_admin_set_world',{pass:adminPass,new_world:val}).then(function(res) {
        var wi=document.getElementById('ac-world-input');
        if(wi) wi.style.borderColor=res.error?'#e74c3c':'#2ecc71';
        setTimeout(function(){if(wi)wi.style.borderColor='';},2000);
      });
    },500);
  });

  // Completed panel
  document.getElementById('completed-toggle').addEventListener('click',function() {
    var body=document.getElementById('completed-body'); var open=body.style.display!=='none';
    body.style.display=open?'none':'block';
    var arrow=open?'▸':'▾';
    this.textContent=calibrated?'Completed ('+completedData.length+') '+arrow:'Completed '+arrow;
  });
  document.getElementById('completed-search').addEventListener('input',function() {
    var val=this.value.trim(); renderCompletedList(val); showCompletedSuggestions(val);
  });
  document.getElementById('completed-suggestions').addEventListener('click',function(e) {
    var item=e.target.closest('.vgt-completed-suggestion'); if(!item) return;
    var name=item.getAttribute('data-name');
    document.getElementById('completed-search').value=name;
    renderCompletedList(name); this.style.display='none';
  });

  // Completed side panel
  document.getElementById('completed-side-search').addEventListener('input',function() { renderCompletedSidePanel(this.value.trim()); });
  document.getElementById('completed-side-list').addEventListener('click',function(e) {
    if(!calibrated) return;
    var skipBtn=e.target.closest('.vgt-completed-side-skip');
    if(skipBtn&&!skipBtn.disabled) {
      var rsn=skipBtn.getAttribute('data-rsn');
      var cid=parseInt(skipBtn.getAttribute('data-id'),10);
      skipBtn.disabled=true; skipBtn.textContent='...';
      sb.rpc('other_admin_uncomplete_to_skip',{pass:adminPass,p_id:cid,p_rsn:rsn})
        .then(function(res) {
          if(res.error) throw res.error;
          var item=skipBtn.closest('.vgt-completed-side-item'); if(item) item.remove();
          fetchCompleted(); onRealtimeChange();
        }).catch(function(err){console.warn('[OTHER] uncomplete failed:',err);skipBtn.disabled=false;skipBtn.textContent='✗';});
      return;
    }
    // Inline edit
    var nameEl=e.target.closest('.vgt-completed-side-name');
    if(!nameEl||nameEl.classList.contains('editing')) return;
    var original=nameEl.getAttribute('data-original'); nameEl.classList.add('editing');
    var input=document.createElement('input'); input.className='vgt-completed-side-edit'; input.type='text'; input.value=original;
    input.setAttribute('autocomplete','off'); input.setAttribute('spellcheck','false');
    nameEl.textContent=''; nameEl.appendChild(input); input.focus(); input.select();
    var saved=false,blurTimeout=null;
    function saveCEdit(){
      if(saved) return; saved=true; if(blurTimeout){clearTimeout(blurTimeout);blurTimeout=null;}
      var newName=input.value.trim();
      if(newName&&newName!==original){
        nameEl.textContent=newName; nameEl.setAttribute('data-original',newName); nameEl.classList.remove('editing');
        sb.rpc('other_admin_edit_completed_name',{pass:adminPass,old_rsn:original,new_rsn:newName})
          .catch(function(err){console.warn('[OTHER] edit completed name failed:',err);});
      } else { nameEl.textContent=original; nameEl.classList.remove('editing'); }
    }
    input.addEventListener('blur',function(){blurTimeout=setTimeout(saveCEdit,150);});
    input.addEventListener('focus',function(){if(blurTimeout){clearTimeout(blurTimeout);blurTimeout=null;}});
    input.addEventListener('keydown',function(ev){
      if(ev.key==='Enter'){ev.preventDefault();saveCEdit();}
      if(ev.key==='Escape'){saved=true;if(blurTimeout){clearTimeout(blurTimeout);blurTimeout=null;}nameEl.textContent=original;nameEl.classList.remove('editing');}
    });
  });

  // Admin chat
  document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();sendChatMessage();}});
  document.getElementById('chat-messages').addEventListener('click', async function(e) {
    var btn = e.target.closest('.vgt-chat-delete-btn');
    if (!btn || !calibrated || btn.disabled) return;
    var id = parseInt(btn.getAttribute('data-id'), 10);
    btn.disabled = true;
    try {
      var r = await sb.rpc('other_delete_admin_chat', { pass: adminPass, p_id: id });
      if (r.error) throw r.error;
      chatMessages = chatMessages.filter(function(m) { return m.id !== id; });
      renderChatMessages();
    } catch(err) { btn.disabled = false; }
  });

  // Skipped panel
  var flushSkippedBtn = document.getElementById('flush-skipped-btn');
  if (flushSkippedBtn) {
    flushSkippedBtn.addEventListener('click', async function() {
      if (!calibrated) return;
      flushSkippedBtn.disabled = true; flushSkippedBtn.textContent = '...';
      try {
        var r = await sb.rpc('other_admin_flush_skipped', { pass: adminPass });
        if (r.error) throw r.error;
        skippedData = [];
        renderSkippedPanel();
        flushSkippedBtn.textContent = '✓';
        setTimeout(function() { flushSkippedBtn.textContent = 'Flush'; flushSkippedBtn.disabled = false; }, 1500);
      } catch(err) { console.warn('[OTHER] flush skipped failed:', err); flushSkippedBtn.textContent = 'Flush'; flushSkippedBtn.disabled = false; }
    });
  }

  document.getElementById('skipped-list').addEventListener('click',async function(e) {
    if(!calibrated) return;
    var unskipBtn=e.target.closest('.vgt-unskip-btn');
    if(unskipBtn&&!unskipBtn.disabled){
      var rsn=unskipBtn.getAttribute('data-rsn'); unskipBtn.disabled=true; unskipBtn.textContent='...';
      try {
        var r=await sb.rpc('other_admin_unskip',{pass:adminPass,p_rsn:rsn});
        if(r.error) throw r.error;
        skippedData=skippedData.filter(function(item){return item.rsn!==rsn;});
        renderSkippedPanel(); onRealtimeChange();
      } catch(err){console.warn('[OTHER] unskip failed:',err);unskipBtn.disabled=false;unskipBtn.textContent='Unskip';}
      return;
    }
    var complBtn=e.target.closest('.vgt-skip-complete-btn');
    if(complBtn&&!complBtn.disabled){
      var cRsn=complBtn.getAttribute('data-rsn'); complBtn.disabled=true; complBtn.textContent='...';
      try {
        var r2=await sb.rpc('other_admin_skip_to_complete',{pass:adminPass,p_rsn:cRsn});
        if(r2.error) throw r2.error;
        skippedData=skippedData.filter(function(item){return item.rsn!==cRsn;});
        renderSkippedPanel(); fetchCompleted(); onRealtimeChange();
      } catch(err){console.warn('[OTHER] skip to complete failed:',err);complBtn.disabled=false;complBtn.textContent='Complete';}
    }
  });
}

if (typeof alt1 !== 'undefined') {
  try { alt1.identifyAppUrl('./otherappconfig.json'); } catch(e) {}
} else {
  document.body.classList.add('browser-view');
  var banner = document.getElementById('alt1-banner');
  if (banner) banner.style.display = 'flex';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }
