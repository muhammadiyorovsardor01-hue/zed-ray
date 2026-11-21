const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SUBSCRIPTION_FILE = path.join(DATA_DIR, 'subscription.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const DEFAULT_SETTINGS = {
  mode: 'system_proxy', // 'system_proxy' (no admin required) or 'tun'
  mtu: 1400,
  autoReconnect: true,
  routingMode: 'rule', // 'rule' or 'global'
  dnsProvider: 'cloudflare',
  selectedServerId: 'auto'
};

const INITIAL_SERVERS = [];

const EMPTY_SUBSCRIPTION = {
  name: '',
  serverCount: 0,
  updatedText: '',
  usedGb: 0,
  totalGb: 0,
  daysLeft: 0,
  url: ''
};

function getServers() {
  ensureDataDir();
  if (!fs.existsSync(SERVERS_FILE)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveServers(servers) {
  ensureDataDir();
  fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2), 'utf-8');
}

function getSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

function getSubscription() {
  ensureDataDir();
  if (!fs.existsSync(SUBSCRIPTION_FILE)) {
    return { ...EMPTY_SUBSCRIPTION };
  }
  try {
    return { ...EMPTY_SUBSCRIPTION, ...JSON.parse(fs.readFileSync(SUBSCRIPTION_FILE, 'utf-8')) };
  } catch {
    return { ...EMPTY_SUBSCRIPTION };
  }
}

function saveSubscription(sub) {
  ensureDataDir();
  fs.writeFileSync(SUBSCRIPTION_FILE, JSON.stringify({ ...EMPTY_SUBSCRIPTION, ...sub }, null, 2), 'utf-8');
}

module.exports = {
  getServers,
  saveServers,
  getSettings,
  saveSettings,
  getSubscription,
  saveSubscription,
  EMPTY_SUBSCRIPTION,
  INITIAL_SUBSCRIPTION: EMPTY_SUBSCRIPTION
};
