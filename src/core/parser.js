/**
 * VLESS, Trojan, VMess & Subscription Parser
 * Extracts protocol configuration from share links and subscriptions.
 */

function parseVless(link) {
  try {
    const url = new URL(link);
    const uuid = url.username;
    const server = url.hostname;
    const port = parseInt(url.port, 10) || 443;
    const name = decodeURIComponent(url.hash ? url.hash.substring(1) : `${server}:${port}`);
    const params = Object.fromEntries(url.searchParams.entries());

    const isReality = params.security === 'reality';
    const isTls = params.security === 'tls';
    const netType = params.type || 'tcp';
    const alpnList = params.alpn
      ? params.alpn.split(',').map(s => s.trim()).filter(Boolean)
      : (netType === 'ws' && isTls ? ['http/1.1'] : undefined);

    let transport;
    if (netType === 'ws') {
      const rawPath = params.path || '/';
      const edMatch = rawPath.match(/[?&]ed=(\d+)/i);
      const maxEarlyData = edMatch ? parseInt(edMatch[1], 10) : 0;
      const cleanPath = rawPath.replace(/[?&]ed=\d+/i, '') || '/';
      const hostHeader = params.host || params.sni || server;
      transport = {
        type: 'ws',
        path: cleanPath,
        headers: hostHeader ? { Host: hostHeader } : undefined
      };
      if (maxEarlyData > 0) {
        transport.max_early_data = maxEarlyData;
        transport.early_data_header_name = 'Sec-WebSocket-Protocol';
      }
    } else if (netType === 'grpc') {
      transport = {
        type: 'grpc',
        service_name: params.serviceName || ''
      };
    } else if (netType === 'httpupgrade') {
      transport = {
        type: 'httpupgrade',
        host: params.host || params.sni || server,
        path: params.path || '/'
      };
    }

    const serverObj = {
      id: 'srv_' + Math.random().toString(36).substring(2, 10),
      type: 'vless',
      name: name.trim(),
      server: server,
      server_port: port,
      uuid: uuid,
      network: netType,
      security: params.security || 'none',
      flow: params.flow || '',
      tls: (isReality || isTls) ? {
        enabled: true,
        server_name: params.sni || params.host || server,
        utls: {
          enabled: true,
          fingerprint: params.fp || 'chrome'
        },
        ...(alpnList && alpnList.length > 0 ? { alpn: alpnList } : {}),
        reality: isReality ? {
          enabled: true,
          public_key: params.pbk || '',
          short_id: params.sid || ''
        } : undefined
      } : undefined,
      transport,
      raw_link: link,
      ping: -1
    };

    return serverObj;
  } catch (err) {
    console.error('Failed to parse VLESS link:', err.message);
    return null;
  }
}

function parseShareLink(link) {
  const trimmed = link.trim();
  if (trimmed.startsWith('vless://')) {
    return parseVless(trimmed);
  }
  // Fallback for simple formats
  return null;
}

function parseSubscriptionContent(content) {
  let decoded = content.trim();
  // Check if Base64 encoded
  if (!decoded.includes('://')) {
    try {
      decoded = Buffer.from(decoded, 'base64').toString('utf-8');
    } catch {
      // not base64
    }
  }

  const lines = decoded.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const servers = [];

  for (const line of lines) {
    const srv = parseShareLink(line);
    if (srv) {
      servers.push(srv);
    }
  }

  return servers;
}

function parseSubscriptionUserInfo(headerValue) {
  if (!headerValue) return null;
  const parts = headerValue.split(';').map(p => p.trim());
  const data = {};
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k && v) {
      data[k.trim()] = parseInt(v.trim(), 10) || 0;
    }
  }

  const upload = data.upload || 0;
  const download = data.download || 0;
  const total = data.total || 0;
  const expire = data.expire || 0;

  return {
    usedGb: ((upload + download) / (1024 ** 3)).toFixed(2),
    totalGb: (total / (1024 ** 3)).toFixed(2),
    daysLeft: expire ? Math.max(0, Math.ceil((expire * 1000 - Date.now()) / (1000 * 60 * 60 * 24))) : 365
  };
}

module.exports = {
  parseVless,
  parseShareLink,
  parseSubscriptionContent,
  parseSubscriptionUserInfo
};
