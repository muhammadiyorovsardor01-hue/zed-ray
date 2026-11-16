const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const DEFAULT_SETTINGS = {
  mode: 'tun', // 'tun' (VPN virtual adapter) or 'system_proxy'
  mtu: 1400,
  autoReconnect: true,
  routingMode: 'rule', // 'rule' or 'global'
  dnsProvider: 'cloudflare',
  selectedServerId: 'auto'
};

const INITIAL_SERVERS = [
  {
    id: 'srv_hk_turbo',
    type: 'vless',
    name: 'Hong Kong • Turbo 5G',
    country: '🇭🇰',
    server: '185.196.220.10',
    server_port: 443,
    uuid: '11111111-2222-3333-4444-555555555555',
    network: 'tcp',
    security: 'reality',
    flow: 'xtls-rprx-vision',
    tls: {
      enabled: true,
      server_name: 'yahoo.com',
      utls: { enabled: true, fingerprint: 'chrome' },
      reality: {
        enabled: true,
        public_key: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        short_id: '12345678'
      }
    },
    ping: 64,
    source: 'subscription'
  },
  {
    id: 'srv_hk_vip1',
    type: 'vless',
    name: 'Hong Kong • VIP 1',
    country: '🇭🇰',
    server: '185.196.220.11',
    server_port: 443,
    uuid: '22222222-3333-4444-5555-666666666666',
    network: 'tcp',
    security: 'reality',
    flow: 'xtls-rprx-vision',
    tls: {
      enabled: true,
      server_name: 'microsoft.com',
      utls: { enabled: true, fingerprint: 'chrome' },
      reality: {
        enabled: true,
        public_key: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        short_id: '12345678'
      }
    },
    ping: 61,
    source: 'subscription'
  },
  {
    id: 'srv_hk_vip2',
    type: 'vless',
    name: 'Hong Kong • VIP 2',
    country: '🇭🇰',
    server: '185.196.220.12',
    server_port: 443,
    uuid: '33333333-4444-5555-6666-777777777777',
    network: 'tcp',
    security: 'reality',
    flow: 'xtls-rprx-vision',
    tls: {
      enabled: true,
      server_name: 'cloudflare.com',
      utls: { enabled: true, fingerprint: 'chrome' },
      reality: {
        enabled: true,
        public_key: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        short_id: '12345678'
      }
    },
    ping: 68,
    source: 'subscription'
  },
  {
    id: 'srv_eu_vip1',
    type: 'vless',
    name: 'Europe • VIP 1',
    country: '🇪🇺',
    server: '194.26.29.40',
    server_port: 443,
    uuid: '44444444-5555-6666-7777-888888888888',
    network: 'tcp',
    security: 'reality',
    flow: 'xtls-rprx-vision',
    tls: {
      enabled: true,
      server_name: 'apple.com',
      utls: { enabled: true, fingerprint: 'chrome' },
      reality: {
        enabled: true,
        public_key: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        short_id: '12345678'
      }
    },
    ping: 236,
    source: 'subscription'
  }
];

const INITIAL_SUBSCRIPTION = {
  name: 'MultiCo VPN',
  serverCount: 5,
  updatedText: 'updated recently',
  usedGb: 65.86,
  totalGb: 10240.00,
  daysLeft: 348,
  url: ''
};

function getServers() {
  ensureDataDir();
  if (!fs.existsSync(SERVERS_FILE)) {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(INITIAL_SERVERS, null, 2), 'utf-8');
    return INITIAL_SERVERS;
  }
  try {
    return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf-8'));
  } catch {
    return INITIAL_SERVERS;
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
    return DEFAULT_SETTINGS;
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

module.exports = {
  getServers,
  saveServers,
  getSettings,
  saveSettings,
  INITIAL_SUBSCRIPTION
};
