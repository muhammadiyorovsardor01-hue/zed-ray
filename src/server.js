const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const SingboxManager = require('./core/singbox');
const { parseShareLink, parseSubscriptionContent, parseSubscriptionUserInfo } = require('./core/parser');
const { testAllServers, testTcpLatency } = require('./core/ping');
const {
  getServers,
  saveServers,
  getSettings,
  saveSettings,
  getSubscription,
  saveSubscription,
  EMPTY_SUBSCRIPTION
} = require('./storage/store');

const PORT = 4040;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const singbox = new SingboxManager();

let subscriptionInfo = getSubscription();

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  'https://muhammadiyorovsardor01-hue.github.io'
]);
const VALID_MODES = new Set(['tun', 'system_proxy']);
const VALID_ROUTING = new Set(['rule', 'global']);

// Helper to send JSON responses.
// Allows CORS strictly for local loopback and the trusted ZedRay GitHub Pages origin.
function sendJson(res, data, status = 200, requestOrigin = '') {
  const headers = { 'Content-Type': 'application/json' };
  const normalized = String(requestOrigin || '').toLowerCase();
  if (ALLOWED_ORIGINS.has(normalized)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
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

function decodeProfileTitle(rawTitle) {
  if (!rawTitle) return '';
  const trimmed = String(rawTitle).trim();
  if (/^base64:/i.test(trimmed)) {
    try {
      return Buffer.from(trimmed.slice(7).trim(), 'base64').toString('utf-8').trim();
    } catch {
      return '';
    }
  }
  return trimmed;
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
    const req = client.get(parsed, { headers: { 'User-Agent': 'sing-box/1.14.4' }, timeout: 15000 }, (resp) => {
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
      resp.on('end', () => resolve({
        data,
        userInfo: resp.headers['subscription-userinfo'],
        profileTitle: resp.headers['profile-title']
      }));
      resp.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

async function importSubscription(subUrl, requestedName = '') {
  const result = await fetchSubscription(subUrl);
  const parsedServers = parseSubscriptionContent(result.data);

  if (parsedServers.length === 0) {
    return { success: false, status: 400, error: 'Obunadan birorta ham VLESS server topilmadi' };
  }

  parsedServers.forEach(s => {
    s.country = detectFlag(s.name);
    s.source = 'subscription';
  });

  const pingResults = await testAllServers(parsedServers);
  parsedServers.forEach(srv => {
    const p = pingResults.find(r => r.id === srv.id);
    if (p) srv.ping = p.ping;
  });

  const existing = getServers().filter(s => s.source === 'manual');
  const merged = [...parsedServers, ...existing];
  saveServers(merged);

  const decodedTitle = decodeProfileTitle(result.profileTitle);
  const parsedStats = parseSubscriptionUserInfo(result.userInfo);
  subscriptionInfo = {
    name: requestedName || decodedTitle || 'MultiCo VPN',
    serverCount: parsedServers.length,
    updatedText: 'updated just now',
    usedGb: parsedStats ? parseFloat(parsedStats.usedGb) || 0 : 0,
    totalGb: parsedStats ? parseFloat(parsedStats.totalGb) || 0 : 0,
    daysLeft: parsedStats ? parseInt(parsedStats.daysLeft, 10) || 0 : 0,
    url: subUrl
  };
  saveSubscription(subscriptionInfo);

  const settings = getSettings();
  if (!settings.selectedServerId || !merged.some(s => s.id === settings.selectedServerId)) {
    settings.selectedServerId = merged.length > 1 ? 'auto' : merged[0].id;
    saveSettings(settings);
  }

  return { success: true, servers: merged, subscription: subscriptionInfo, selectedServerId: settings.selectedServerId };
}

const server = http.createServer(async (req, res) => {
  // Reject requests with an unexpected Host header (DNS-rebinding protection)
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const rawOrigin = String(req.headers.origin || '');
  const originLower = rawOrigin.toLowerCase();
  const isAllowedOrigin = !rawOrigin || ALLOWED_ORIGINS.has(originLower);

  // Preflight CORS + Chrome Private Network Access check for trusted PWA origin
  if (req.method === 'OPTIONS') {
    if (!rawOrigin || !ALLOWED_ORIGINS.has(originLower)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const headers = {
      'Access-Control-Allow-Origin': rawOrigin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
      headers['Access-Control-Allow-Private-Network'] = 'true';
    }
    res.writeHead(204, headers);
    return res.end();
  }

  // Reject cross-site requests from untrusted origins (CSRF / PNA protection)
  if (rawOrigin && !isAllowedOrigin) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const replyJson = (data, status = 200) => sendJson(res, data, status, rawOrigin);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // --- API ROUTES ---
  if (url.pathname === '/api/status' && req.method === 'GET') {
    const statusData = singbox.getStatus();
    const settings = getSettings();
    return replyJson({
      ...statusData,
      settings
    });
  }

  if (url.pathname === '/api/servers' && req.method === 'GET') {
    const servers = getServers();
    const settings = getSettings();
    return replyJson({
      servers,
      subscription: subscriptionInfo,
      selectedServerId: settings.selectedServerId
    });
  }

  if (url.pathname === '/api/connect' && req.method === 'POST') {
    const body = await parseBody(req);
    const servers = getServers();
    const settings = getSettings();

    const targetId = body.serverId || settings.selectedServerId || 'auto';
    if (!servers.length) {
      return replyJson({ success: false, error: 'Serverlar topilmadi' }, 400);
    }

    settings.selectedServerId = targetId;
    saveSettings(settings);

    const isAuto = targetId === 'auto' || !targetId;
    let candidates = [];
    if (isAuto) {
      const reachable = servers.filter(s => s.ping && s.ping > 0).sort((a, b) => a.ping - b.ping);
      const rest = servers.filter(s => !s.ping || s.ping <= 0);
      candidates = [...reachable, ...rest];
    } else {
      const single = servers.find(s => s.id === targetId) || servers[0];
      candidates = [single];
    }

    const runOpts = {
      mode: settings.mode,
      mtu: settings.mtu,
      routingMode: settings.routingMode,
      autoReconnect: settings.autoReconnect
    };

    if (!isAuto) {
      const result = await singbox.start(candidates[0], runOpts);
      return replyJson({ ...result, activeServer: candidates[0] }, result.success ? 200 : 500);
    }

    let lastErr = 'Ishlaydigan server topilmadi';
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const result = await singbox.start(cand, runOpts);
      if (result.success) {
        await new Promise(r => setTimeout(r, 300));
        const healthy = await singbox.checkTunnelHealth();
        if (healthy) {
          return replyJson({ success: true, activeServer: cand });
        }
        lastErr = `${cand.name}: tunnel tekshiruvi o'tmadi`;
        await singbox.stop();
      } else {
        lastErr = result.error || lastErr;
      }
    }
    return replyJson({ success: false, error: lastErr }, 500);
  }

  if (url.pathname === '/api/disconnect' && req.method === 'POST') {
    const result = await singbox.stop();
    return replyJson(result);
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
    return replyJson({ servers: updatedServers });
  }

  if (url.pathname === '/api/servers/add' && req.method === 'POST') {
    const body = await parseBody(req);
    const input = String(body.link || '').trim();
    if (!input) {
      return replyJson({ success: false, error: 'Havola kiritilmadi' }, 400);
    }

    // Allow pasting a subscription URL directly here as well
    if (/^https?:\/\//i.test(input)) {
      try {
        const resObj = await importSubscription(input, body.name || '');
        if (!resObj.success) {
          return replyJson({ success: false, error: resObj.error }, resObj.status || 400);
        }
        return replyJson(resObj);
      } catch (err) {
        return replyJson({ success: false, error: `Obunani yuklab bo'lmadi: ${err.message}` }, 500);
      }
    }

    const single = parseShareLink(input);
    if (single) {
      single.country = detectFlag(single.name);
      single.source = 'manual';
      single.ping = await testTcpLatency(single.server, single.server_port);

      const servers = getServers();
      servers.unshift(single);
      saveServers(servers);

      return replyJson({ success: true, server: single, servers });
    }

    // Fallback: multi-line VLESS list or Base64 subscription payload
    const multi = parseSubscriptionContent(input);
    if (multi.length > 0) {
      multi.forEach(s => {
        s.country = detectFlag(s.name);
        s.source = 'manual';
      });
      const pingResults = await testAllServers(multi);
      multi.forEach(srv => {
        const p = pingResults.find(r => r.id === srv.id);
        if (p) srv.ping = p.ping;
      });
      const existing = getServers();
      const merged = [...multi, ...existing];
      saveServers(merged);
      return replyJson({ success: true, server: multi[0], servers: merged, addedCount: multi.length });
    }

    return replyJson({ success: false, error: 'Noto‘g‘ri VLESS yoki obuna havolasi' }, 400);
  }

  if (url.pathname === '/api/subscription/update' && req.method === 'POST') {
    const body = await parseBody(req);
    const subUrl = String(body.url || subscriptionInfo.url || '').trim();

    if (!subUrl) {
      return replyJson({ success: false, error: 'Obuna URL havolasi kerak' }, 400);
    }

    try {
      const resObj = await importSubscription(subUrl, body.name || '');
      if (!resObj.success) {
        return replyJson({ success: false, error: resObj.error }, resObj.status || 400);
      }
      return replyJson(resObj);
    } catch (err) {
      return replyJson({ success: false, error: `Failed to fetch subscription: ${err.message}` }, 500);
    }
  }

  if ((url.pathname === '/api/subscription/delete' && req.method === 'POST') ||
      (url.pathname === '/api/subscription' && req.method === 'DELETE')) {
    const statusData = singbox.getStatus();
    if (statusData.status !== 'disconnected' && (!statusData.activeServer || statusData.activeServer.source === 'subscription')) {
      await singbox.stop();
    }

    const remaining = getServers().filter(s => s.source !== 'subscription');
    saveServers(remaining);

    subscriptionInfo = { ...EMPTY_SUBSCRIPTION };
    saveSubscription(subscriptionInfo);

    const settings = getSettings();
    if (settings.selectedServerId !== 'auto' && !remaining.some(s => s.id === settings.selectedServerId)) {
      settings.selectedServerId = remaining.length > 1 ? 'auto' : (remaining[0] ? remaining[0].id : 'auto');
      saveSettings(settings);
    }

    return replyJson({
      success: true,
      servers: remaining,
      subscription: subscriptionInfo,
      selectedServerId: settings.selectedServerId
    });
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
    return replyJson({ success: true, settings: updated });
  }

  if (url.pathname.startsWith('/api/servers/') && req.method === 'DELETE') {
    const id = url.pathname.replace('/api/servers/', '');
    let servers = getServers();
    servers = servers.filter(s => s.id !== id);
    saveServers(servers);
    return replyJson({ success: true });
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

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`[ZedRay] Bridge already running on 127.0.0.1:${PORT}`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ZedVPN] Server running at http://127.0.0.1:${PORT}`);
});
