/**
 * ZedRay Pro - Client Logic with SVG Flags, Live Speed Chart & Cyber UI
 */

let appState = {
  servers: [],
  subscription: null,
  selectedServerId: 'auto',
  status: 'disconnected',
  activeServer: null,
  duration: 0,
  filter: 'all',
  searchQuery: '',
  timerInterval: null,
  speedHistory: Array(30).fill(0),
  speedInterval: null
};

// ================= DOM ELEMENTS =================
const searchInput = document.getElementById('searchInput');
const searchContainer = document.getElementById('searchContainer');
const chipsRow = document.getElementById('chipsRow');
const serversList = document.getElementById('serversList');
const subName = document.getElementById('subName');
const subServerInfo = document.getElementById('subServerInfo');
const subProgressFill = document.getElementById('subProgressFill');
const subUsageText = document.getElementById('subUsageText');
const subDaysLeft = document.getElementById('subDaysLeft');
const cardAutoSelect = document.getElementById('cardAutoSelect');
const chipAllCount = document.getElementById('chipAllCount');
const chipManualCount = document.getElementById('chipManualCount');

// Home Tab Elements
const securityCard = document.getElementById('securityCard');
const homeSecTitle = document.getElementById('homeSecTitle');
const homeSecIp = document.getElementById('homeSecIp');
const powerOrbit = document.getElementById('powerOrbit');
const mainConnectBtn = document.getElementById('mainConnectBtn');
const connectionTimer = document.getElementById('connectionTimer');
const homeActiveFlag = document.getElementById('homeActiveFlag');
const homeActiveName = document.getElementById('homeActiveName');
const homeActiveMeta = document.getElementById('homeActiveMeta');
const homeSwitchBtn = document.getElementById('homeSwitchBtn');
const speedDown = document.getElementById('speedDown');
const speedUp = document.getElementById('speedUp');
const speedCanvas = document.getElementById('speedCanvas');
const ctx = speedCanvas ? speedCanvas.getContext('2d') : null;

// Settings Elements
const settingTunMode = document.getElementById('settingTunMode');
const settingWatchdog = document.getElementById('settingWatchdog');
const settingMtu = document.getElementById('settingMtu');

// Modals & Buttons
const addModal = document.getElementById('addModal');
const openAddModalBtn = document.getElementById('openAddModalBtn');
const closeAddModalBtn = document.getElementById('closeAddModalBtn');
const tabAddLink = document.getElementById('tabAddLink');
const tabAddSub = document.getElementById('tabAddSub');
const paneAddLink = document.getElementById('paneAddLink');
const paneAddSub = document.getElementById('paneAddSub');
const vlessLinkInput = document.getElementById('vlessLinkInput');
const saveLinkBtn = document.getElementById('saveLinkBtn');
const subNameInput = document.getElementById('subNameInput');
const subUrlInput = document.getElementById('subUrlInput');
const saveSubBtn = document.getElementById('saveSubBtn');
const pingAllBtn = document.getElementById('pingAllBtn');
const subRefreshBtn = document.getElementById('subRefreshBtn');

// ================= NAVIGATION =================
const bnavItems = document.querySelectorAll('.bnav-item');
const tabViews = document.querySelectorAll('.tab-view');

bnavItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetTab = item.dataset.tab;

    bnavItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    tabViews.forEach(v => v.classList.remove('active'));
    document.getElementById(targetTab).classList.add('active');

    if (targetTab === 'viewServers') {
      searchContainer.style.display = 'flex';
      chipsRow.style.display = 'flex';
    } else {
      searchContainer.style.display = 'none';
      chipsRow.style.display = 'none';
    }
  });
});

homeSwitchBtn.addEventListener('click', () => {
  const serversBtn = document.querySelector('.bnav-item[data-tab="viewServers"]');
  if (serversBtn) serversBtn.click();
});

// ================= CHIP FILTERING =================
const chips = document.querySelectorAll('.chip');
chips.forEach(chip => {
  chip.addEventListener('click', () => {
    chips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    appState.filter = chip.dataset.filter;
    renderServers();
  });
});

searchInput.addEventListener('input', (e) => {
  appState.searchQuery = e.target.value.toLowerCase().trim();
  renderServers();
});

// ================= DATA FETCHING =================
async function loadServers() {
  try {
    const res = await fetch('/api/servers');
    const data = await res.json();
    appState.servers = data.servers || [];
    appState.subscription = data.subscription;
    appState.selectedServerId = data.selectedServerId || 'auto';

    renderSubscription();
    renderServers();
    updateHomeServerPreview();
  } catch (err) {
    console.error('Error fetching servers:', err);
  }
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    appState.status = data.status;
    appState.activeServer = data.activeServer;
    appState.duration = data.duration || 0;

    if (data.settings) {
      settingTunMode.checked = data.settings.mode === 'tun';
      settingMtu.value = data.settings.mtu || 1400;
      settingWatchdog.checked = data.settings.autoReconnect !== false;
    }

    updateConnectionUI();
  } catch (err) {
    console.error('Error fetching status:', err);
  }
}

// ================= RENDER FUNCTIONS =================
function renderSubscription() {
  if (!appState.subscription) return;
  const sub = appState.subscription;
  subName.textContent = sub.name || 'MultiCo VPN';
  subServerInfo.textContent = `${appState.servers.length} ta server · ${sub.updatedText || 'yaqinda yangilandi'}`;
  subUsageText.textContent = `${sub.usedGb || 0} GB / ${sub.totalGb || 10240} GB`;
  subDaysLeft.textContent = `${sub.daysLeft || 348} kun qoldi`;

  const percent = Math.min(100, Math.max(1, ((sub.usedGb || 1) / (sub.totalGb || 10240)) * 100));
  subProgressFill.style.width = `${percent}%`;

  chipAllCount.textContent = appState.servers.length;
  chipManualCount.textContent = appState.servers.filter(s => s.source === 'manual').length;
}

function renderServers() {
  serversList.innerHTML = '';

  if (appState.selectedServerId === 'auto') {
    cardAutoSelect.classList.add('selected');
  } else {
    cardAutoSelect.classList.remove('selected');
  }

  const filtered = appState.servers.filter(srv => {
    if (appState.searchQuery && !srv.name.toLowerCase().includes(appState.searchQuery)) {
      return false;
    }
    if (appState.filter === 'manual') return srv.source === 'manual';
    if (appState.filter === 'subscriptions') return srv.source === 'subscription';
    if (appState.filter === 'reality') return srv.security === 'reality';
    return true;
  });

  filtered.forEach(srv => {
    const isSelected = appState.selectedServerId === srv.id;
    const card = document.createElement('div');
    card.className = `server-item ${isSelected ? 'active' : ''}`;

    let pingClass = 'fast';
    let pingText = `${srv.ping || 60} ms`;
    if (!srv.ping || srv.ping <= 0) {
      pingClass = 'offline';
      pingText = 'Timeout';
    } else if (srv.ping > 200) {
      pingClass = 'slow';
    } else if (srv.ping > 90) {
      pingClass = 'medium';
    }

    const flagSvg = getCountryFlagSvg(srv.country || srv.name);

    card.innerHTML = `
      <div class="server-left">
        <div class="server-flag-wrap">${flagSvg}</div>
        <div>
          <div class="server-name">${srv.name}</div>
          <div class="server-meta">VLESS · ${srv.network ? srv.network.toUpperCase() : 'TCP'} / ${srv.security ? srv.security.toUpperCase() : 'REALITY'}</div>
        </div>
      </div>
      <div class="server-right">
        <div class="ping-pill ${pingClass}">${pingText}</div>
        <button class="server-menu-btn" title="O'chirish" data-id="${srv.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.server-menu-btn')) {
        e.stopPropagation();
        if (confirm(`"${srv.name}" serverini o'chirilsinmi?`)) {
          deleteServer(srv.id);
        }
        return;
      }
      selectServer(srv.id);
    });

    serversList.appendChild(card);
  });
}

function selectServer(id) {
  appState.selectedServerId = id;
  renderServers();
  updateHomeServerPreview();

  if (appState.status === 'connected') {
    connectServer(id);
  }
}

function updateHomeServerPreview() {
  let target = null;
  if (appState.selectedServerId === 'auto' || !appState.selectedServerId) {
    target = appState.servers[0];
  } else {
    target = appState.servers.find(s => s.id === appState.selectedServerId) || appState.servers[0];
  }

  if (target) {
    homeActiveFlag.innerHTML = getCountryFlagSvg(target.country || target.name);
    homeActiveName.textContent = appState.selectedServerId === 'auto' ? `Auto (${target.name})` : target.name;
    homeActiveMeta.textContent = `VLESS · REALITY · ${target.ping || 64} ms`;
  }
}

cardAutoSelect.addEventListener('click', () => {
  selectServer('auto');
});

// ================= CONNECTION LOGIC =================
mainConnectBtn.addEventListener('click', () => {
  if (appState.status === 'connected') {
    disconnectServer();
  } else {
    connectServer(appState.selectedServerId);
  }
});

async function connectServer(serverId) {
  appState.status = 'connecting';
  updateConnectionUI();

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId })
    });
    const data = await res.json();
    if (data.success) {
      appState.status = 'connected';
      appState.activeServer = data.activeServer;
      startTimer();
      startSpeedSimulation();
    } else {
      appState.status = 'disconnected';
      alert(`Ulanish xatosi: ${data.error || 'Noma\'lum xatolik'}`);
    }
  } catch (err) {
    appState.status = 'disconnected';
    alert(`Ulanishda xatolik: ${err.message}`);
  }
  updateConnectionUI();
}

async function disconnectServer() {
  try {
    await fetch('/api/disconnect', { method: 'POST' });
    appState.status = 'disconnected';
    appState.activeServer = null;
    stopTimer();
    stopSpeedSimulation();
  } catch (err) {
    console.error('Error disconnecting:', err);
  }
  updateConnectionUI();
}

function updateConnectionUI() {
  if (appState.status === 'connected') {
    securityCard.className = 'security-card connected';
    homeSecTitle.textContent = 'HIMOYA YOQILGAN';
    const srv = appState.activeServer || appState.servers[0];
    homeSecIp.textContent = `Virtual IP: ${srv ? srv.server : '185.196.x.x'} (Shifrlangan)`;
    powerOrbit.className = 'power-orbit-ring active';
    mainConnectBtn.className = 'power-core-btn connected';
  } else if (appState.status === 'connecting') {
    securityCard.className = 'security-card';
    homeSecTitle.textContent = 'ULANMOQDA...';
    homeSecIp.textContent = 'Shifrlangan kanal ochilmoqda...';
    powerOrbit.className = 'power-orbit-ring active';
    mainConnectBtn.className = 'power-core-btn connecting';
  } else {
    securityCard.className = 'security-card';
    homeSecTitle.textContent = 'HIMOYA O\'CHIQLI';
    homeSecIp.textContent = 'Virtual IP: Aniqlanmagan';
    powerOrbit.className = 'power-orbit-ring';
    mainConnectBtn.className = 'power-core-btn';
    stopSpeedSimulation();
  }
}

function startTimer() {
  stopTimer();
  let seconds = appState.duration || 0;
  connectionTimer.textContent = formatTimer(seconds);

  appState.timerInterval = setInterval(() => {
    seconds++;
    connectionTimer.textContent = formatTimer(seconds);
  }, 1000);
}

function stopTimer() {
  if (appState.timerInterval) {
    clearInterval(appState.timerInterval);
    appState.timerInterval = null;
  }
  connectionTimer.textContent = '00:00:00';
}

function formatTimer(sec) {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ================= LIVE SPEED MONITOR & CANVAS GRAPH =================
function startSpeedSimulation() {
  stopSpeedSimulation();
  appState.speedInterval = setInterval(() => {
    if (appState.status !== 'connected') return;
    const down = (Math.random() * 15 + 8).toFixed(1);
    const up = (Math.random() * 4 + 1.2).toFixed(1);
    speedDown.innerHTML = `${down} <small>MB/s</small>`;
    speedUp.innerHTML = `${up} <small>MB/s</small>`;

    appState.speedHistory.shift();
    appState.speedHistory.push(parseFloat(down));
    drawSpeedCanvas();
  }, 1000);
}

function stopSpeedSimulation() {
  if (appState.speedInterval) {
    clearInterval(appState.speedInterval);
    appState.speedInterval = null;
  }
  speedDown.innerHTML = `0.0 <small>MB/s</small>`;
  speedUp.innerHTML = `0.0 <small>MB/s</small>`;
  appState.speedHistory = Array(30).fill(0);
  drawSpeedCanvas();
}

function drawSpeedCanvas() {
  if (!ctx || !speedCanvas) return;
  const w = speedCanvas.width;
  const h = speedCanvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  const max = Math.max(...appState.speedHistory, 25);
  const step = w / (appState.speedHistory.length - 1);

  appState.speedHistory.forEach((val, i) => {
    const x = i * step;
    const y = h - (val / max) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = '#00f2fe';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Gradient fill under the line
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0, 242, 254, 0.25)');
  grad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

// ================= PING TEST =================
pingAllBtn.addEventListener('click', async () => {
  pingAllBtn.style.transform = 'rotate(180deg)';
  try {
    const res = await fetch('/api/ping', { method: 'POST' });
    const data = await res.json();
    if (data.servers) {
      appState.servers = data.servers;
      renderServers();
      updateHomeServerPreview();
    }
  } catch (err) {
    console.error('Ping failed:', err);
  } finally {
    pingAllBtn.style.transform = 'none';
  }
});

// ================= MODAL & ADD SERVER =================
openAddModalBtn.addEventListener('click', () => addModal.classList.add('open'));
closeAddModalBtn.addEventListener('click', () => addModal.classList.remove('open'));

tabAddLink.addEventListener('click', () => {
  tabAddLink.classList.add('active');
  tabAddSub.classList.remove('active');
  paneAddLink.classList.add('active');
  paneAddSub.classList.remove('active');
});

tabAddSub.addEventListener('click', () => {
  tabAddSub.classList.add('active');
  tabAddLink.classList.remove('active');
  paneAddSub.classList.add('active');
  paneAddLink.classList.remove('active');
});

saveLinkBtn.addEventListener('click', async () => {
  const link = vlessLinkInput.value.trim();
  if (!link) return alert('Iltimos, VLESS havolasini kiriting!');

  try {
    const res = await fetch('/api/servers/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link })
    });
    const data = await res.json();
    if (data.success) {
      vlessLinkInput.value = '';
      addModal.classList.remove('open');
      loadServers();
    } else {
      alert(`Xatolik: ${data.error}`);
    }
  } catch (err) {
    alert(`Xatolik: ${err.message}`);
  }
});

saveSubBtn.addEventListener('click', async () => {
  const url = subUrlInput.value.trim();
  const name = subNameInput.value.trim() || 'MultiCo VPN';
  if (!url) return alert('Iltimos, obuna URL havolasini kiriting!');

  saveSubBtn.textContent = 'Yuklanmoqda...';
  try {
    const res = await fetch('/api/subscription/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name })
    });
    const data = await res.json();
    if (data.success) {
      subUrlInput.value = '';
      addModal.classList.remove('open');
      loadServers();
    } else {
      alert(`Obuna xatosi: ${data.error}`);
    }
  } catch (err) {
    alert(`Obuna xatosi: ${err.message}`);
  } finally {
    saveSubBtn.textContent = 'Yangilash va Tortib olish';
  }
});

subRefreshBtn.addEventListener('click', async () => {
  subRefreshBtn.style.transform = 'rotate(360deg)';
  try {
    await fetch('/api/subscription/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    loadServers();
  } catch (err) {
    console.error('Refresh sub error:', err);
  } finally {
    setTimeout(() => subRefreshBtn.style.transform = 'none', 500);
  }
});

async function deleteServer(id) {
  try {
    await fetch(`/api/servers/${id}`, { method: 'DELETE' });
    loadServers();
  } catch (err) {
    console.error('Delete error:', err);
  }
}

// ================= SETTINGS HANDLERS =================
settingTunMode.addEventListener('change', async () => {
  const mode = settingTunMode.checked ? 'tun' : 'system_proxy';
  await updateSettings({ mode });
});

settingMtu.addEventListener('change', async () => {
  await updateSettings({ mtu: parseInt(settingMtu.value, 10) });
});

settingWatchdog.addEventListener('change', async () => {
  await updateSettings({ autoReconnect: settingWatchdog.checked });
});

async function updateSettings(partial) {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial)
    });
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

// ================= INIT =================
loadServers();
loadStatus();
drawSpeedCanvas();

setInterval(loadStatus, 2000);
