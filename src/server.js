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

// Helper to send JSON responses
function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// Parse request body
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Helper to determine country emoji by server name
function detectFlag(name) {
  const lower = name.toLowerCase();
  if (lower.includes('hong kong') || lower.includes('hk')) return '🇭🇰';
  if (lower.includes('europe') || lower.includes('eu')) return '🇪🇺';
  if (lower.includes('united states') || lower.includes('usa') || lower.includes('us')) return '🇺🇸';
  if (lower.includes('germany') || lower.includes('de')) return '🇩🇪';
  if (lower.includes('singapore') || lower.includes('sg')) return '🇸🇬';
  if (lower.includes('japan') || lower.includes('jp')) return '🇯🇵';
  if (lower.includes('turkey') || lower.includes('tr')) return '🇹🇷';
  if (lower.includes('russia') || lower.includes('ru')) return '🇷🇺';
  if (lower.includes('uzbekistan') || lower.includes('uz')) return '🇺🇿';
  return '🌐';
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

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
      routingMode: settings.routingMode
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
      const fetchSubscription = (targetUrl) => {
        return new Promise((resolve, reject) => {
          const client = targetUrl.startsWith('https') ? https : http;
          client.get(targetUrl, { headers: { 'User-Agent': 'v2rayN/sing-box/Hiddify' } }, (resp) => {
            let data = '';
            resp.on('data', chunk => data += chunk);
            resp.on('end', () => {
              const userInfo = resp.headers['subscription-userinfo'];
              resolve({ data, userInfo });
            });
          }).on('error', reject);
        });
      };

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
    const updated = { ...current, ...body };
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
  let filePath = path.join(PUBLIC_DIR, reqPath);

  if (!fs.existsSync(filePath)) {
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
