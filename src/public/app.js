/**
 * Zed Secure VPN Client - Frontend Logic
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
  timerInterval: null
};

// ================= DOM ELEMENTS =================
const pageTitle = document.getElementById('pageTitle');
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
const homeStatusBadge = document.getElementById('homeStatusBadge');
const homeStatusText = document.getElementById('homeStatusText');
const mainConnectBtn = document.getElementById('mainConnectBtn');
const connectionTimer = document.getElementById('connectionTimer');
const homeActiveFlag = document.getElementById('homeActiveFlag');
const homeActiveName = document.getElementById('homeActiveName');
const homeActiveMeta = document.getElementById('homeActiveMeta');
const homeSwitchBtn = document.getElementById('homeSwitchBtn');
const metricMode = document.getElementById('metricMode');

// Settings Elements
const settingTunMode = document.getElementById('settingTunMode');
const settingWatchdog = document.getElementById('settingWatchdog');
const settingMtu = document.getElementById('settingMtu');
const settingDns = document.getElementById('settingDns');

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
const openSubManagerBtn = document.getElementById('openSubManagerBtn');

// ================= NAVIGATION =================
const navItems = document.querySelectorAll('.nav-item');
const tabViews = document.querySelectorAll('.tab-view');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetTab = item.dataset.tab;

    // Update active nav button
    navItems.forEach(n => {
      n.classList.remove('active');
      const label = n.querySelector('.nav-label');
      if (label) label.remove();
    });
    item.classList.add('active');

    // Add label to active tab
    const labelSpan = document.createElement('span');
    labelSpan.className = 'nav-label';
    if (targetTab === 'viewHome') labelSpan.textContent = 'Home';
    else if (targetTab === 'viewServers') labelSpan.textContent = 'Servers';
    else if (targetTab === 'viewRouting') labelSpan.textContent = 'Routing';
    else if (targetTab === 'viewSettings') labelSpan.textContent = 'Settings';
    item.appendChild(labelSpan);

    // Switch view
    tabViews.forEach(v => v.classList.remove('active'));
    document.getElementById(targetTab).classList.add('active');

    // Show/hide search & chips based on view
    if (targetTab === 'viewServers') {
      pageTitle.textContent = 'Servers';
      searchContainer.style.display = 'flex';
      chipsRow.style.display = 'flex';
    } else if (targetTab === 'viewHome') {
      pageTitle.textContent = 'ZedRay';
      searchContainer.style.display = 'none';
      chipsRow.style.display = 'none';
    } else if (targetTab === 'viewRouting') {
      pageTitle.textContent = 'Routing';
      searchContainer.style.display = 'none';
      chipsRow.style.display = 'none';
    } else if (targetTab === 'viewSettings') {
      pageTitle.textContent = 'Settings';
      searchContainer.style.display = 'none';
      chipsRow.style.display = 'none';
    }
  });
});

homeSwitchBtn.addEventListener('click', () => {
  const serversNavItem = document.querySelector('.nav-item[data-tab="viewServers"]');
  serversNavItem.click();
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
      metricMode.textContent = data.settings.mode === 'tun' ? 'TUN (VPN)' : 'System Proxy';
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
  subServerInfo.textContent = `${appState.servers.length} servers · ${sub.updatedText || 'updated recently'}`;
  subUsageText.textContent = `${sub.usedGb || 0} GB of ${sub.totalGb || 10240} GB used`;
  subDaysLeft.textContent = `${sub.daysLeft || 348} days left`;

  const percent = Math.min(100, Math.max(1, ((sub.usedGb || 1) / (sub.totalGb || 10240)) * 100));
  subProgressFill.style.width = `${percent}%`;

  chipAllCount.textContent = appState.servers.length;
  chipManualCount.textContent = appState.servers.filter(s => s.source === 'manual').length;
}

function renderServers() {
  serversList.innerHTML = '';

  // Auto Select Card highlight
  if (appState.selectedServerId === 'auto') {
    cardAutoSelect.classList.add('selected');
  } else {
    cardAutoSelect.classList.remove('selected');
  }

  const filtered = appState.servers.filter(srv => {
    // Search query match
    if (appState.searchQuery && !srv.name.toLowerCase().includes(appState.searchQuery)) {
      return false;
    }
    // Filter chip match
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

    card.innerHTML = `
      <div class="server-left">
        <span class="flag-icon">${srv.country || '🌐'}</span>
        <div>
          <div class="server-name">${srv.name}</div>
          <div class="server-meta">VLESS · ${srv.network ? srv.network.toUpperCase() : 'TCP'} / ${srv.security ? srv.security.toUpperCase() : 'REALITY'}</div>
        </div>
      </div>
      <div class="server-right">
        <div class="ping-badge ${pingClass}">
          <span>${pingText}</span>
          ${isSelected ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
        </div>
        <button class="server-menu-btn" title="Delete / Edit" data-id="${srv.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
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

  // If already connected, reconnect to the newly selected server
  if (appState.status === 'connected') {
    connectServer(id);
  } else {
    // Update Home active server preview
    const srv = appState.servers.find(s => s.id === id);
    if (srv) {
      homeActiveFlag.textContent = srv.country || '🌐';
      homeActiveName.textContent = srv.name;
      homeActiveMeta = `VLESS · TCP / REALITY · ${srv.ping || 60} ms`;
    }
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
  } catch (err) {
    console.error('Error disconnecting:', err);
  }
  updateConnectionUI();
}

function updateConnectionUI() {
  if (appState.status === 'connected') {
    homeStatusBadge.className = 'status-badge connected';
    homeStatusText.textContent = 'CONNECTED';
    mainConnectBtn.className = 'power-button connected';

    if (appState.activeServer) {
      homeActiveFlag.textContent = appState.activeServer.country || '🌐';
      homeActiveName.textContent = appState.activeServer.name;
      homeActiveMeta.textContent = `VLESS · TCP / REALITY · ${appState.activeServer.ping || 64} ms`;
    }
  } else if (appState.status === 'connecting') {
    homeStatusBadge.className = 'status-badge';
    homeStatusText.textContent = 'CONNECTING...';
    mainConnectBtn.className = 'power-button connecting';
  } else {
    homeStatusBadge.className = 'status-badge';
    homeStatusText.textContent = 'DISCONNECTED';
    mainConnectBtn.className = 'power-button';
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

// ================= PING TEST =================
pingAllBtn.addEventListener('click', async () => {
  pingAllBtn.style.transform = 'rotate(180deg)';
  try {
    const res = await fetch('/api/ping', { method: 'POST' });
    const data = await res.json();
    if (data.servers) {
      appState.servers = data.servers;
      renderServers();
    }
  } catch (err) {
    console.error('Ping failed:', err);
  } finally {
    pingAllBtn.style.transform = 'none';
  }
});

// ================= MODAL & ADD SERVER =================
openAddModalBtn.addEventListener('click', () => {
  addModal.classList.add('open');
});

closeAddModalBtn.addEventListener('click', () => {
  addModal.classList.remove('open');
});

openSubManagerBtn.addEventListener('click', () => {
  addModal.classList.add('open');
  tabAddSub.click();
});

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
    saveSubBtn.textContent = 'Yangilash va Sinxronlash';
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
  metricMode.textContent = mode === 'tun' ? 'TUN (VPN)' : 'System Proxy';
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

// Polling status every 2 seconds
setInterval(loadStatus, 2000);
