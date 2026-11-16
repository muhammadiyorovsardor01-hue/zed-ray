const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const SingboxManager = require('./core/singbox');
const { parseShareLink, parseSubscriptionContent, parseSubscriptionUserInfo } = require('./core/parser');
const { testAllServers, testTcpLatency } = require('./core/ping');
const { getServers, saveServers, getSettings, saveSettings, INITIAL_SUBSCRIPTION } = require('./storage/store');

const PORT = 4040;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const singbox = new SingboxManager();

let subscriptionInfo = { ...INITIAL_SUBSCRIPTION };

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const VALID_MODES = new Set(['tun', 'system_proxy']);
const VALID_ROUTING = new Set(['rule', 'global']);

// Helper to send JSON responses.
// No CORS headers on purpose: the UI is served from this very server (same origin),
// and a wildcard CORS policy would let any website you open control your VPN.
function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Parse request body (size-limited)
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        return resolve({});
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Helper to determine country emoji by server name.
// Two-letter codes must match as whole words ("us" must not match "Russia" or "Plus").
function detectFlag(name) {
  const lower = String(name || '').toLowerCase();
  const has = (...words) => words.some(w => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(lower));
  if (has('hong kong', 'hongkong', 'hk')) return '🇭🇰';
  if (has('europe', 'eu')) return '🇪🇺';
  if (has('united states', 'usa', 'us', 'america')) return '🇺🇸';
  if (has('germany', 'de')) return '🇩🇪';
  if (has('singapore', 'sg')) return '🇸🇬';
  if (has('japan', 'jp')) return '🇯🇵';
  if (has('turkey', 'turkiye', 'tr')) return '🇹🇷';
  if (has('russia', 'ru')) return '🇷🇺';
  if (has('uzbekistan', 'uz')) return '🇺🇿';
  return '🌐';
}

// Fetch a subscription URL: follows redirects, enforces a timeout and a size cap.
function fetchSubscription(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error('Invalid subscription URL'));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('Only http(s) subscription URLs are supported'));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, { headers: { 'User-Agent': 'v2rayN/sing-box/Hiddify' }, timeout: 15000 }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        resp.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        return resolve(fetchSubscription(new URL(resp.headers.location, parsed).toString(), redirectsLeft - 1));
      }
      if (resp.statusCode !== 200) {
        resp.resume();
        return reject(new Error(`Server responded with HTTP ${resp.statusCode}`));
      }

      let data = '';
      let size = 0;
      resp.setEncoding('utf8');
      resp.on('data', chunk => {
        size += chunk.length;
        if (size > 5 * MAX_BODY_BYTES) {
          req.destroy(new Error('Subscription is too large'));
          return;
        }
        data += chunk;
      });
      resp.on('end', () => resolve({ data, userInfo: resp.headers['subscription-userinfo'] }));
      resp.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Reject requests with an unexpected Host header (DNS-rebinding protection)
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // Reject cross-site state-changing requests (CSRF protection)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, '').toLowerCase())) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // --- API ROUTES ---
  if (url.pathname === '/api/status' && req.method === 'GET') {
    const statusData = singbox.getStatus();
    const settings = getSettings();
    return sendJson(res, {
      ...statusData,
      settings
    });
  }

  if (url.pathname === '/api/servers' && req.method === 'GET') {
    const servers = getServers();
    const settings = getSettings();
    return sendJson(res, {
      servers,
      subscription: subscriptionInfo,
      selectedServerId: settings.selectedServerId
    });
  }

  if (url.pathname === '/api/connect' && req.method === 'POST') {
    const body = await parseBody(req);
    const servers = getServers();
    const settings = getSettings();

    let targetServer = null;
    const targetId = body.serverId || settings.selectedServerId;

    if (targetId === 'auto' || !targetId) {
      // Find fastest server with ping > 0
      const validServers = servers.filter(s => s.ping && s.ping > 0).sort((a, b) => a.ping - b.ping);
      targetServer = validServers[0] || servers[0];
    } else {
      targetServer = servers.find(s => s.id === targetId) || servers[0];
    }

    if (!targetServer) {
      return sendJson(res, { success: false, error: 'No servers configured' }, 400);
    }

    // Save selection
    settings.selectedServerId = targetId;
    saveSettings(settings);

    const result = await singbox.start(targetServer, {
      mode: settings.mode,
      mtu: settings.mtu,
      routingMode: settings.routingMode,
      autoReconnect: settings.autoReconnect
    });

    return sendJson(res, { ...result, activeServer: targetServer });
  }

  if (url.pathname === '/api/disconnect' && req.method === 'POST') {
    const result = await singbox.stop();
    return sendJson(res, result);
  }

  if (url.pathname === '/api/ping' && req.method === 'POST') {
    const servers = getServers();
    const pingResults = await testAllServers(servers);

    // Update in store
    const updatedServers = servers.map(srv => {
      const match = pingResults.find(p => p.id === srv.id);
      return match ? { ...srv, ping: match.ping } : srv;
    });

    saveServers(updatedServers);
    return sendJson(res, { servers: updatedServers });
  }

  if (url.pathname === '/api/servers/add' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.link) {
      return sendJson(res, { success: false, error: 'Link is required' }, 400);
    }

    const srv = parseShareLink(body.link);
    if (!srv) {
      return sendJson(res, { success: false, error: 'Invalid VLESS/Reality link format' }, 400);
    }

    srv.country = detectFlag(srv.name);
    srv.source = 'manual';
    srv.ping = await testTcpLatency(srv.server, srv.server_port);

    const servers = getServers();
    servers.unshift(srv);
    saveServers(servers);

    return sendJson(res, { success: true, server: srv });
  }

  if (url.pathname === '/api/subscription/update' && req.method === 'POST') {
    const body = await parseBody(req);
    const subUrl = body.url || subscriptionInfo.url;

    if (!subUrl) {
      return sendJson(res, { success: false, error: 'Subscription URL is required' }, 400);
    }

    try {
      const result = await fetchSubscription(subUrl);
      const parsedServers = parseSubscriptionContent(result.data);

      if (parsedServers.length === 0) {
        return sendJson(res, { success: false, error: 'No valid VLESS servers found in subscription' }, 400);
      }

      parsedServers.forEach(s => {
        s.country = detectFlag(s.name);
        s.source = 'subscription';
      });

      // Ping them
      const pingResults = await testAllServers(parsedServers);
      parsedServers.forEach(srv => {
        const p = pingResults.find(r => r.id === srv.id);
        if (p) srv.ping = p.ping;
      });

      // Retain manual servers and append subscription servers
      const existing = getServers().filter(s => s.source === 'manual');
      const merged = [...parsedServers, ...existing];
      saveServers(merged);

      // Update subscription info
      const parsedStats = parseSubscriptionUserInfo(result.userInfo);
      subscriptionInfo = {
        name: body.name || 'MultiCo VPN',
        serverCount: parsedServers.length,
        updatedText: 'updated just now',
        usedGb: parsedStats ? parsedStats.usedGb : 65.86,
        totalGb: parsedStats ? parsedStats.totalGb : 10240.00,
        daysLeft: parsedStats ? parsedStats.daysLeft : 348,
        url: subUrl
      };

      return sendJson(res, { success: true, servers: merged, subscription: subscriptionInfo });
    } catch (err) {
      return sendJson(res, { success: false, error: `Failed to fetch subscription: ${err.message}` }, 500);
    }
  }

  if (url.pathname === '/api/settings' && req.method === 'POST') {
    const body = await parseBody(req);
    const current = getSettings();
    const updated = { ...current };

    // Whitelist + validate: never persist arbitrary keys or out-of-range values
    if (VALID_MODES.has(body.mode)) updated.mode = body.mode;
    if (VALID_ROUTING.has(body.routingMode)) updated.routingMode = body.routingMode;
    if (Number.isInteger(body.mtu) && body.mtu >= 1280 && body.mtu <= 1500) updated.mtu = body.mtu;
    if (typeof body.autoReconnect === 'boolean') updated.autoReconnect = body.autoReconnect;
    if (typeof body.selectedServerId === 'string') updated.selectedServerId = body.selectedServerId;

    saveSettings(updated);
    return sendJson(res, { success: true, settings: updated });
  }

  if (url.pathname.startsWith('/api/servers/') && req.method === 'DELETE') {
    const id = url.pathname.replace('/api/servers/', '');
    let servers = getServers();
    servers = servers.filter(s => s.id !== id);
    saveServers(servers);
    return sendJson(res, { success: true });
  }

  // --- STATIC FILES SERVING ---
  let reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    reqPath = decodeURIComponent(reqPath);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  let filePath = path.join(PUBLIC_DIR, reqPath);

  // Stay inside the public directory and only serve real files
  const insidePublic = filePath === PUBLIC_DIR || filePath.startsWith(PUBLIC_DIR + path.sep);
  if (!insidePublic || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading asset');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ZedVPN] Server running at http://127.0.0.1:${PORT}`);
});
